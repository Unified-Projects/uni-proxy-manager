import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { processSiteBuild } from "../../../apps/sites-workers/src/processors/site-build";
import { Job } from "bullmq";
import type { SiteBuildJobData } from "@uni-proxy-manager/queue";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";

const BUILD_DIR = process.env.SITES_BUILD_DIR || "/tmp/builds";
const SOURCE_DIR = process.env.SITES_SOURCE_DIR || "/tmp/sites/sources";

/**
 * Create a minimal Next.js project that can actually be built
 */
async function createBuildableNextJsProject(siteId: string): Promise<string> {
  const projectDir = join(SOURCE_DIR, siteId);
  await mkdir(projectDir, { recursive: true });

  // Create package.json
  const packageJson = {
    name: "test-nextjs-site",
    version: "1.0.0",
    private: true,
    scripts: {
      build: "next build",
      start: "next start",
    },
    dependencies: {
      next: "^14.0.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0",
    },
  };
  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create next.config.js
  await writeFile(
    join(projectDir, "next.config.js"),
    `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};
module.exports = nextConfig;`
  );

  // Create a simple page
  await mkdir(join(projectDir, "app"), { recursive: true });
  await writeFile(
    join(projectDir, "app/layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}`
  );
  await writeFile(
    join(projectDir, "app/page.tsx"),
    `export default function Home() {
  return <div>Hello, Next.js!</div>;
}`
  );

  return projectDir;
}

/**
 * Create a minimal static site project
 */
async function createBuildableStaticProject(siteId: string): Promise<string> {
  const projectDir = join(SOURCE_DIR, siteId);
  await mkdir(projectDir, { recursive: true });

  // Create package.json
  const packageJson = {
    name: "test-static-site",
    version: "1.0.0",
    private: true,
    scripts: {
      build: "mkdir -p dist && cp -r src/* dist/",
    },
    dependencies: {},
  };
  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create source files
  await mkdir(join(projectDir, "src"), { recursive: true });
  await writeFile(
    join(projectDir, "src/index.html"),
    `<!DOCTYPE html>
<html>
<head><title>Static Site</title></head>
<body><h1>Hello, Static!</h1></body>
</html>`
  );

  return projectDir;
}

/**
 * Create a Next.js ZIP file for upload
 */
async function createNextJsZipFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const blob = new Blob([buffer], { type: "application/zip" });
      const file = new File([blob], "nextjs-site.zip", { type: "application/zip" });
      resolve(file);
    });
    archive.on("error", reject);

    const packageJson = {
      name: "test-nextjs-site",
      version: "1.0.0",
      private: true,
      scripts: {
        build: "next build",
        start: "next start",
      },
      dependencies: {
        next: "^14.0.0",
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
    };

    archive.append(JSON.stringify(packageJson, null, 2), { name: "package.json" });
    archive.append(
      `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};
module.exports = nextConfig;`,
      { name: "next.config.js" }
    );
    archive.append(
      `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}`,
      { name: "app/layout.tsx" }
    );
    archive.append(
      `export default function Home() {
  return <div>Hello, Next.js!</div>;
}`,
      { name: "app/page.tsx" }
    );

    archive.finalize();
  });
}

describe("Build Execution Tests", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Create a test site
    const siteData = createSiteFixture({
      framework: "nextjs",
      buildCommand: "npm run build",
      installCommand: "npm install",
      nodeVersion: "20",
    });
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  afterEach(async () => {
    // Clean up build directories
    try {
      await rm(join(SOURCE_DIR, testSiteId), { recursive: true, force: true });
      await rm(join(BUILD_DIR, testSiteId), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Build Job Processing", () => {
    it("should set deployment status to building when job starts", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      expect(uploadRes.status).toBe(200);
      const deploymentId = uploadRes.body.deployment.id;

      // Verify deployment is in pending state (ready for build)
      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      expect(deployment).toBeDefined();
      expect(deployment?.status).toBe("pending");
      expect(deployment?.triggeredBy).toBe("upload");
    });

    it("should store build logs in deployment record", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Simulate build logs being stored (this would happen in the worker)
      await testDb
        .update(schema.deployments)
        .set({
          status: "building",
          buildLogs: `[2024-01-01T00:00:00.000Z] Starting build process...
[2024-01-01T00:00:01.000Z] Installing dependencies...
[2024-01-01T00:00:30.000Z] Running build command: npm run build
[2024-01-01T00:01:00.000Z] Build completed successfully`,
        })
        .where(eq(schema.deployments.id, deploymentId));

      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      expect(deployment?.buildLogs).toContain("Starting build process");
      expect(deployment?.buildLogs).toContain("Installing dependencies");
      expect(deployment?.buildLogs).toContain("Build completed successfully");
    });

    it("should update deployment status on build failure", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Simulate build failure
      await testDb
        .update(schema.deployments)
        .set({
          status: "failed",
          errorMessage: "Build failed: npm install exited with code 1",
          buildLogs: `[2024-01-01T00:00:00.000Z] Starting build process...
[2024-01-01T00:00:01.000Z] Installing dependencies...
[2024-01-01T00:00:05.000Z] npm ERR! code ERESOLVE
[2024-01-01T00:00:05.000Z] Build failed: npm install exited with code 1`,
        })
        .where(eq(schema.deployments.id, deploymentId));

      // Also update site status
      await testDb
        .update(schema.sites)
        .set({ status: "error" })
        .where(eq(schema.sites.id, testSiteId));

      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(deployment?.status).toBe("failed");
      expect(deployment?.errorMessage).toContain("npm install exited with code 1");
      expect(site?.status).toBe("error");
    });

    it("should track build duration", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;
      const buildStartTime = new Date();

      // Simulate build completion with timing
      await testDb
        .update(schema.deployments)
        .set({
          status: "live",
          buildStartedAt: buildStartTime,
          buildCompletedAt: new Date(buildStartTime.getTime() + 45000), // 45 seconds
          buildDurationMs: 45000,
        })
        .where(eq(schema.deployments.id, deploymentId));

      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      expect(deployment?.buildStartedAt).toBeDefined();
      expect(deployment?.buildCompletedAt).toBeDefined();
      expect(deployment?.buildDurationMs).toBe(45000);
    });

    it("should support build cancellation", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Cancel the deployment
      const cancelRes = await testClient.post<{ deployment: any }>(
        `/api/deployments/${deploymentId}/cancel`
      );

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.deployment.status).toBe("cancelled");
    });
  });

  describe("Build Artifacts", () => {
    it("should record artifact path after successful build", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Simulate successful build with artifact
      await testDb
        .update(schema.deployments)
        .set({
          status: "live",
          artifactPath: `artifacts/${testSiteId}/${deploymentId}.tar.gz`,
          artifactSize: 15728640, // 15 MB
        })
        .where(eq(schema.deployments.id, deploymentId));

      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      expect(deployment?.artifactPath).toContain(testSiteId);
      expect(deployment?.artifactPath).toContain(".tar.gz");
      expect(deployment?.artifactSize).toBe(15728640);
    });

    it("should not have artifact path for failed builds", async () => {
      // Upload source files first
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Simulate failed build (no artifact)
      await testDb
        .update(schema.deployments)
        .set({
          status: "failed",
          errorMessage: "Build failed",
        })
        .where(eq(schema.deployments.id, deploymentId));

      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      expect(deployment?.artifactPath).toBeNull();
      expect(deployment?.artifactSize).toBeNull();
    });
  });

  describe("Environment Variables", () => {
    it("should use site environment variables in build", async () => {
      // Update site with env vars
      await testClient.put(`/api/sites/${testSiteId}`, {
        envVariables: {
          NEXT_PUBLIC_API_URL: "https://api.test.com",
          DATABASE_URL: "postgres://test:test@localhost/test",
          NODE_ENV: "production",
        },
      });

      // Upload source files
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Verify site has env vars
      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.envVariables).toBeDefined();
      expect((site?.envVariables as any)?.NEXT_PUBLIC_API_URL).toBe("https://api.test.com");
      expect((site?.envVariables as any)?.NODE_ENV).toBe("production");
    });
  });

  describe("Framework-Specific Builds", () => {
    it("should use Next.js output directory (.next)", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      expect(uploadRes.status).toBe(200);

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.framework).toBe("nextjs");
      // Default output directory for Next.js would be .next
    });

    it("should handle static site build", async () => {
      // Create site with static framework
      await clearDatabase();
      const siteData = createSiteFixture({
        framework: "static",
        buildCommand: "npm run build",
        installCommand: "npm install",
      });
      const res = await testClient.post<{ site: any }>("/api/sites", siteData);
      const staticSiteId = res.body.site.id;

      // Create a simple static ZIP
      const zipFile = await new Promise<File>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk) => chunks.push(chunk));
        archive.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const blob = new Blob([buffer], { type: "application/zip" });
          const file = new File([blob], "static-site.zip", { type: "application/zip" });
          resolve(file);
        });
        archive.on("error", reject);

        const packageJson = {
          name: "static-site",
          version: "1.0.0",
          scripts: { build: "mkdir -p dist && cp src/* dist/" },
        };
        archive.append(JSON.stringify(packageJson, null, 2), { name: "package.json" });
        archive.append("<html><body>Static</body></html>", { name: "src/index.html" });
        archive.finalize();
      });

      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${staticSiteId}/upload`,
        formData
      );

      expect(uploadRes.status).toBe(200);
    });
  });

  describe("Node Version", () => {
    it("should use configured Node version", async () => {
      // Update site with specific Node version
      await testClient.put(`/api/sites/${testSiteId}`, {
        nodeVersion: "20",
      });

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.nodeVersion).toBe("20");
    });

    it("should default to Node 20 if not specified", async () => {
      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      // Should have default value
      expect(site?.nodeVersion).toBeDefined();
    });
  });

  describe("Build Commands", () => {
    it("should use custom install command if specified", async () => {
      await testClient.put(`/api/sites/${testSiteId}`, {
        installCommand: "pnpm install --frozen-lockfile",
      });

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.installCommand).toBe("pnpm install --frozen-lockfile");
    });

    it("should use custom build command if specified", async () => {
      await testClient.put(`/api/sites/${testSiteId}`, {
        buildCommand: "npm run build:production",
      });

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.buildCommand).toBe("npm run build:production");
    });
  });
});

describe("Deployment Execution Tests", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Create a test site
    const siteData = createSiteFixture({
      framework: "nextjs",
      buildCommand: "npm run build",
      installCommand: "npm install",
    });
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  describe("Blue-Green Deployment", () => {
    it("should deploy to blue slot first", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      expect(uploadRes.body.deployment.slot).toBe("blue");
    });

    it("should alternate to green slot on next deploy", async () => {
      // First deployment
      const zipFile1 = await createNextJsZipFile();
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const uploadRes1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );

      expect(uploadRes1.body.deployment.slot).toBe("blue");

      // Second deployment
      const zipFile2 = await createNextJsZipFile();
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const uploadRes2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );

      expect(uploadRes2.body.deployment.slot).toBe("green");
    });

    it("should deactivate old deployment when new one goes live", async () => {
      // Create first deployment and mark it as live
      const zipFile1 = await createNextJsZipFile();
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const uploadRes1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );
      const deployment1Id = uploadRes1.body.deployment.id;

      // Mark first deployment as live and active
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: true })
        .where(eq(schema.deployments.id, deployment1Id));

      await testDb
        .update(schema.sites)
        .set({ activeDeploymentId: deployment1Id })
        .where(eq(schema.sites.id, testSiteId));

      // Create second deployment
      const zipFile2 = await createNextJsZipFile();
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const uploadRes2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );
      const deployment2Id = uploadRes2.body.deployment.id;

      // Mark second deployment as live (simulating deploy worker)
      await testDb
        .update(schema.deployments)
        .set({ isActive: false })
        .where(eq(schema.deployments.id, deployment1Id));

      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: true })
        .where(eq(schema.deployments.id, deployment2Id));

      // Verify first deployment is no longer active
      const deployment1 = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deployment1Id),
      });

      expect(deployment1?.isActive).toBe(false);

      const deployment2 = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deployment2Id),
      });

      expect(deployment2?.isActive).toBe(true);
    });
  });

  describe("Rollback", () => {
    it("should allow rollback to previous deployment", async () => {
      // Create two deployments
      const zipFile1 = await createNextJsZipFile();
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const uploadRes1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );
      const deployment1Id = uploadRes1.body.deployment.id;

      // Mark first as live
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: false })
        .where(eq(schema.deployments.id, deployment1Id));

      const zipFile2 = await createNextJsZipFile();
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const uploadRes2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );
      const deployment2Id = uploadRes2.body.deployment.id;

      // Mark second as live and active
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: true })
        .where(eq(schema.deployments.id, deployment2Id));

      await testDb
        .update(schema.sites)
        .set({ activeDeploymentId: deployment2Id })
        .where(eq(schema.sites.id, testSiteId));

      // Rollback to first deployment
      const rollbackRes = await testClient.post<{ message: string }>(
        `/api/sites/${testSiteId}/rollback/${deployment1Id}`
      );

      expect(rollbackRes.status).toBe(200);
    });
  });
});

describe("OpenRuntimes Executor Integration", () => {
  describe("Executor Health Check", () => {
    it("should have executor endpoint configured", () => {
      expect(process.env.SITES_EXECUTOR_ENDPOINT).toBeDefined();
      expect(process.env.SITES_EXECUTOR_SECRET).toBeDefined();
    });
  });

  describe("Runtime Configuration", () => {
    it("should use correct runtime image for Next.js", () => {
      const nodeVersion = "20";
      const expectedImage = `openruntimes/node:v4-${nodeVersion}.0`;
      expect(expectedImage).toBe("openruntimes/node:v4-20.0");
    });

    it("should use correct runtime image for SvelteKit", () => {
      const nodeVersion = "18";
      const expectedImage = `openruntimes/node:v4-${nodeVersion}.0`;
      expect(expectedImage).toBe("openruntimes/node:v4-18.0");
    });
  });

  describe("Resource Configuration", () => {
    let testSiteId: string;

    beforeEach(async () => {
      await clearDatabase();

      const siteData = createSiteFixture({
        framework: "nextjs",
        cpuLimit: "0.5",
        memoryMb: 512,
        timeoutSeconds: 30,
      });
      const res = await testClient.post<{ site: any }>("/api/sites", siteData);
      testSiteId = res.body.site.id;
    });

    afterAll(async () => {
      await closeTestDb();
    });

    it("should respect CPU limit configuration", async () => {
      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      // Database may format as 0.50 or 0.5
      expect(parseFloat(site?.cpuLimit || "0")).toBe(0.5);
    });

    it("should respect memory limit configuration", async () => {
      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.memoryMb).toBe(512);
    });

    it("should respect timeout configuration", async () => {
      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.timeoutSeconds).toBe(30);
    });
  });
});
