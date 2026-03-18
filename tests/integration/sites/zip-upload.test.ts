import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture, createTestZipFile } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";

async function createSiteZipFile(options: {
  framework?: "nextjs" | "sveltekit" | "static";
  includeBuildScript?: boolean;
} = {}): Promise<File> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const blob = new Blob([buffer], { type: "application/zip" });
      const file = new File([blob], "site-source.zip", { type: "application/zip" });
      resolve(file);
    });
    archive.on("error", reject);

    const packageJson: Record<string, any> = {
      name: "test-site",
      version: "1.0.0",
      scripts: options.includeBuildScript !== false ? { build: "echo build" } : {},
      dependencies: {},
    };

    if (options.framework === "nextjs") {
      packageJson.dependencies.next = "^14.0.0";
      packageJson.dependencies.react = "^18.0.0";
    } else if (options.framework === "sveltekit") {
      packageJson.devDependencies = { "@sveltejs/kit": "^2.0.0" };
    }

    archive.append(JSON.stringify(packageJson, null, 2), { name: "package.json" });
    archive.append("console.log('hello');", { name: "index.js" });
    archive.finalize();
  });
}

describe("Sites ZIP Upload API", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    const siteData = createSiteFixture();
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  describe("POST /api/sites/:id/upload", () => {
    it("should accept a valid ZIP file and queue deployment", async () => {
      const zipFile = await createSiteZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        success: boolean;
        deployment: any;
        stats: any;
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deployment).toBeDefined();
      expect(response.body.deployment.triggeredBy).toBe("upload");
      expect(response.body.deployment.branch).toBe("upload");
    });

    it("should reject non-ZIP files", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["not a zip"], "test.txt", { type: "text/plain" })
      );

      const response = await testClient.postForm<{ error: string }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("ZIP");
    });

    it("should reject requests without file", async () => {
      const formData = new FormData();

      const response = await testClient.postForm<{ error: string }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("No file");
    });

    it("should detect Next.js framework from package.json", async () => {
      const zipFile = await createSiteZipFile({ framework: "nextjs" });
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        stats: { detectedFramework: string };
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);
      expect(response.body.stats.detectedFramework).toBe("nextjs");
    });

    it("should detect SvelteKit framework from package.json", async () => {
      const zipFile = await createSiteZipFile({ framework: "sveltekit" });
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        stats: { detectedFramework: string };
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);
      expect(response.body.stats.detectedFramework).toBe("sveltekit");
    });

    it("should return 404 for non-existent site", async () => {
      const zipFile = await createSiteZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm(
        `/api/sites/non-existent-id/upload`,
        formData
      );

      expect(response.status).toBe(404);
    });

    it("should update site status to building", async () => {
      const zipFile = await createSiteZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      await testClient.postForm(`/api/sites/${testSiteId}/upload`, formData);

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.status).toBe("building");
    });

    it("should increment deployment version", async () => {
      const zipFile1 = await createSiteZipFile();
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const res1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );

      const zipFile2 = await createSiteZipFile();
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const res2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );

      expect(res1.body.deployment.version).toBe(1);
      expect(res2.body.deployment.version).toBe(2);
    });

    it("should alternate deployment slots", async () => {
      const zipFile1 = await createSiteZipFile();
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const res1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );

      const zipFile2 = await createSiteZipFile();
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const res2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );

      expect(res1.body.deployment.slot).toBe("blue");
      expect(res2.body.deployment.slot).toBe("green");
    });
  });
});
