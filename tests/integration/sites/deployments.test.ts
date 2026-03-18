import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq, and } from "drizzle-orm";
import archiver from "archiver";

/**
 * Create a simple site ZIP file for testing deployments
 */
async function createTestZipFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const blob = new Blob([buffer], { type: "application/zip" });
      const file = new File([blob], "site.zip", { type: "application/zip" });
      resolve(file);
    });
    archive.on("error", reject);

    const packageJson = {
      name: "test-site",
      version: "1.0.0",
      scripts: { build: "echo build" },
      dependencies: { next: "^14.0.0", react: "^18.0.0" },
    };

    archive.append(JSON.stringify(packageJson, null, 2), { name: "package.json" });
    archive.append("console.log('hello');", { name: "index.js" });
    archive.finalize();
  });
}

describe("Deployments API", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Create a test site for deployments
    const siteData = createSiteFixture();
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;

    // Upload source files so deploy endpoint works
    const zipFile = await createTestZipFile();
    const formData = new FormData();
    formData.append("file", zipFile);
    await testClient.postForm(`/api/sites/${testSiteId}/upload`, formData);
  });

  describe("POST /api/sites/:id/deploy", () => {
    // Note: beforeEach uploads a ZIP file which creates deployment version 1
    // So the first manual deploy call creates version 2

    it("should trigger a new deployment", async () => {
      const response = await testClient.post<{ deployment: any; message: string }>(
        `/api/sites/${testSiteId}/deploy`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("deployment");
      expect(response.body.deployment.siteId).toBe(testSiteId);
      expect(response.body.deployment.status).toBe("pending");
      expect(response.body.deployment.triggeredBy).toBe("manual");
      expect(response.body.deployment.version).toBe(2); // Version 1 was created by upload
    });

    it("should increment version number for subsequent deployments", async () => {
      // Version 1 was created by upload in beforeEach
      await testClient.post(`/api/sites/${testSiteId}/deploy`); // version 2
      await testClient.post(`/api/sites/${testSiteId}/deploy`); // version 3
      const response = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy` // version 4
      );

      expect(response.body.deployment.version).toBe(4);
    });

    it("should assign alternating slots", async () => {
      const res1 = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const res2 = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );

      // Slots should alternate
      expect([res1.body.deployment.slot, res2.body.deployment.slot]).toContain("blue");
      expect([res1.body.deployment.slot, res2.body.deployment.slot]).toContain("green");
    });

    it("should update site status to building", async () => {
      await testClient.post(`/api/sites/${testSiteId}/deploy`);

      const siteRes = await testClient.get<{ site: any }>(`/api/sites/${testSiteId}`);
      expect(siteRes.body.site.status).toBe("building");
    });
  });

  describe("GET /api/deployments", () => {
    // Note: beforeEach uploads a ZIP which creates deployment version 1

    it("should list all deployments for a site", async () => {
      await testClient.post(`/api/sites/${testSiteId}/deploy`);
      await testClient.post(`/api/sites/${testSiteId}/deploy`);

      const response = await testClient.get<{ deployments: any[] }>(
        `/api/deployments?siteId=${testSiteId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(3); // 1 from upload + 2 deploys
    });

    it("should respect limit parameter", async () => {
      // Create multiple deployments (1 already exists from upload)
      for (let i = 0; i < 5; i++) {
        await testClient.post(`/api/sites/${testSiteId}/deploy`);
      }

      const response = await testClient.get<{ deployments: any[] }>(
        `/api/deployments?siteId=${testSiteId}&limit=2`
      );

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(2);
    });

    it("should respect offset parameter", async () => {
      // Create multiple deployments (1 already exists from upload)
      for (let i = 0; i < 5; i++) {
        await testClient.post(`/api/sites/${testSiteId}/deploy`);
      }

      // Total: 6 deployments (1 upload + 5 deploys), offset 2 = 4 remaining
      const response = await testClient.get<{ deployments: any[] }>(
        `/api/deployments?siteId=${testSiteId}&limit=10&offset=2`
      );

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(4);
    });
  });

  describe("GET /api/deployments/:id", () => {
    it("should return deployment details", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      const response = await testClient.get<{ deployment: any }>(
        `/api/deployments/${deploymentId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.deployment.id).toBe(deploymentId);
      expect(response.body.deployment.site).toBeDefined();
      expect(response.body.deployment.site.id).toBe(testSiteId);
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.get(
        `/api/deployments/non-existent-id`
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/deployments/:id/cancel", () => {
    it("should cancel a pending deployment", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      const response = await testClient.post<{ deployment: any }>(
        `/api/deployments/${deploymentId}/cancel`
      );

      expect(response.status).toBe(200);
      expect(response.body.deployment.status).toBe("cancelled");
    });

    it("should not cancel a live deployment", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      // Set deployment to live in database
      await testDb
        .update(schema.deployments)
        .set({ status: "live" })
        .where(eq(schema.deployments.id, deploymentId));

      const response = await testClient.post<{ error: string }>(
        `/api/deployments/${deploymentId}/cancel`
      );

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/deployments/:id/promote", () => {
    it("should promote a live deployment to active", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      // Set deployment to live
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: false })
        .where(eq(schema.deployments.id, deploymentId));

      const response = await testClient.post<{ deployment: any }>(
        `/api/deployments/${deploymentId}/promote`
      );

      expect(response.status).toBe(200);
      expect(response.body.deployment.isActive).toBe(true);
    });

    it("should not promote a pending deployment", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      const response = await testClient.post<{ error: string }>(
        `/api/deployments/${deploymentId}/promote`
      );

      expect(response.status).toBe(400);
    });

    it("should not promote already active deployment", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      // Set deployment to live and active
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: true })
        .where(eq(schema.deployments.id, deploymentId));

      const response = await testClient.post<{ error: string }>(
        `/api/deployments/${deploymentId}/promote`
      );

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/sites/:id/rollback/:deploymentId", () => {
    it("should rollback to a previous deployment", async () => {
      // Create two deployments
      const res1 = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deployment1Id = res1.body.deployment.id;

      const res2 = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deployment2Id = res2.body.deployment.id;

      // Set both to live, second one active
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: false })
        .where(eq(schema.deployments.id, deployment1Id));
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: true })
        .where(eq(schema.deployments.id, deployment2Id));
      await testDb
        .update(schema.sites)
        .set({ activeDeploymentId: deployment2Id })
        .where(eq(schema.sites.id, testSiteId));

      // Rollback to first deployment
      const response = await testClient.post<{ message: string }>(
        `/api/sites/${testSiteId}/rollback/${deployment1Id}`
      );

      expect(response.status).toBe(200);
    });

    it("should reject rollback to non-live deployment", async () => {
      const res = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = res.body.deployment.id;

      // Deployment is still pending
      const response = await testClient.post<{ error: string }>(
        `/api/sites/${testSiteId}/rollback/${deploymentId}`
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/deployments/:id/logs", () => {
    it("should return deployment build logs for completed deployment", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      // Add some logs and mark as completed
      await testDb
        .update(schema.deployments)
        .set({
          buildLogs:
            "[12:00:00] Starting build...\n[12:00:10] Build complete",
          status: "live",
        })
        .where(eq(schema.deployments.id, deploymentId));

      const response = await testClient.get<{ logs: string; status: string; complete: boolean }>(
        `/api/deployments/${deploymentId}/logs`
      );

      expect(response.status).toBe(200);
      expect(response.body.logs).toContain("Starting build");
      expect(response.body.complete).toBe(true);
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.get(
        `/api/deployments/non-existent-id/logs`
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/deployments/:id/preview", () => {
    it("should return preview URL when available", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      // Set preview URL
      await testDb
        .update(schema.deployments)
        .set({
          previewUrl: "https://preview.example.com/screenshot.png",
          status: "live",
        })
        .where(eq(schema.deployments.id, deploymentId));

      const response = await testClient.get<{ previewUrl: string }>(
        `/api/deployments/${deploymentId}/preview`
      );

      expect(response.status).toBe(200);
      expect(response.body.previewUrl).toContain("screenshot.png");
    });

    it("should return 404 when no preview available", async () => {
      const createRes = await testClient.post<{ deployment: any }>(
        `/api/sites/${testSiteId}/deploy`
      );
      const deploymentId = createRes.body.deployment.id;

      const response = await testClient.get(
        `/api/deployments/${deploymentId}/preview`
      );

      expect(response.status).toBe(404);
    });
  });
});
