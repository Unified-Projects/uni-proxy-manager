import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";

/**
 * Create a Next.js project ZIP file with specific configuration
 */
async function createNextJsZipFile(options: {
  outputMode?: "standalone" | "export" | "default";
  hasAppRouter?: boolean;
  hasApiRoutes?: boolean;
  hasMiddleware?: boolean;
  nextVersion?: string;
  includeNodeModules?: boolean;
  customBuildCommand?: string;
} = {}): Promise<File> {
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

    const nextVersion = options.nextVersion || "^14.0.0";

    // Create package.json
    const packageJson: Record<string, any> = {
      name: "test-nextjs-site",
      version: "1.0.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: options.customBuildCommand || "next build",
        start: "next start",
        lint: "next lint",
      },
      dependencies: {
        next: nextVersion,
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
      devDependencies: {
        "@types/node": "^20.0.0",
        "@types/react": "^18.2.0",
        typescript: "^5.0.0",
      },
    };

    archive.append(JSON.stringify(packageJson, null, 2), { name: "package.json" });

    // Create next.config.js based on output mode
    let nextConfigContent: string;
    switch (options.outputMode) {
      case "standalone":
        nextConfigContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  generateEtags: true,
};

module.exports = nextConfig;`;
        break;
      case "export":
        nextConfigContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;`;
        break;
      default:
        nextConfigContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;`;
    }

    archive.append(nextConfigContent, { name: "next.config.js" });

    // Create tsconfig.json
    const tsConfig = {
      compilerOptions: {
        target: "es5",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    };

    archive.append(JSON.stringify(tsConfig, null, 2), { name: "tsconfig.json" });

    // Create pages or app router structure
    if (options.hasAppRouter) {
      // App Router structure
      archive.append(
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
        { name: "app/layout.tsx" }
      );

      archive.append(
        `export default function Home() {
  return <main><h1>Next.js App Router</h1></main>;
}`,
        { name: "app/page.tsx" }
      );

      if (options.hasApiRoutes) {
        archive.append(
          `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}`,
          { name: "app/api/health/route.ts" }
        );
      }
    } else {
      // Pages Router structure
      archive.append(
        `import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}`,
        { name: "pages/_app.tsx" }
      );

      archive.append(
        `export default function Home() {
  return <main><h1>Next.js Pages Router</h1></main>;
}`,
        { name: "pages/index.tsx" }
      );

      if (options.hasApiRoutes) {
        archive.append(
          `import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ status: 'ok' });
}`,
          { name: "pages/api/health.ts" }
        );
      }
    }

    // Create middleware if requested
    if (options.hasMiddleware) {
      archive.append(
        `import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};`,
        { name: "middleware.ts" }
      );
    }

    // Create public directory with a sample file
    archive.append("/* styles */", { name: "public/styles.css" });

    // Create next-env.d.ts
    archive.append(
      `/// <reference types="next" />
/// <reference types="next/image-types/global" />`,
      { name: "next-env.d.ts" }
    );

    archive.finalize();
  });
}

/**
 * Create a static HTML site ZIP (for testing non-Next.js detection)
 */
async function createStaticSiteZipFile(): Promise<File> {
  return new Promise((resolve, reject) => {
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

    archive.append("<!DOCTYPE html><html><body><h1>Static Site</h1></body></html>", {
      name: "index.html",
    });
    archive.append("body { font-family: sans-serif; }", { name: "styles.css" });

    archive.finalize();
  });
}

describe("Next.js Manual Upload Tests", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    const siteData = createSiteFixture({ framework: "nextjs" });
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  describe("Framework Detection", () => {
    describe("Next.js Detection", () => {
      it("should detect Next.js framework from package.json dependencies", async () => {
        const zipFile = await createNextJsZipFile();
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          stats: { detectedFramework: string };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.stats.detectedFramework).toBe("nextjs");
      });

      it("should detect Next.js with different versions", async () => {
        const versions = ["^13.0.0", "^14.0.0", "14.2.0", "latest"];

        for (const version of versions) {
          await clearDatabase();
          const siteData = createSiteFixture({ framework: "nextjs" });
          const res = await testClient.post<{ site: any }>("/api/sites", siteData);
          const siteId = res.body.site.id;

          const zipFile = await createNextJsZipFile({ nextVersion: version });
          const formData = new FormData();
          formData.append("file", zipFile);

          const response = await testClient.postForm<{
            stats: { detectedFramework: string };
          }>(`/api/sites/${siteId}/upload`, formData);

          expect(response.status).toBe(200);
          expect(response.body.stats.detectedFramework).toBe("nextjs");
        }
      });

      it("should not detect Next.js for static HTML sites", async () => {
        const zipFile = await createStaticSiteZipFile();
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          stats: { detectedFramework: string | null };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.stats.detectedFramework).not.toBe("nextjs");
      });
    });

    describe("Render Mode Detection", () => {
      it("should detect SSR mode for standalone output", async () => {
        const zipFile = await createNextJsZipFile({ outputMode: "standalone" });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.deployment).toBeDefined();

        // Verify the site was updated correctly
        const site = await testDb.query.sites.findFirst({
          where: eq(schema.sites.id, testSiteId),
        });
        expect(site?.framework).toBe("nextjs");
      });

      it("should detect SSG/Static mode for export output", async () => {
        const zipFile = await createNextJsZipFile({ outputMode: "export" });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.deployment).toBeDefined();
      });

      it("should detect Hybrid mode for default output", async () => {
        const zipFile = await createNextJsZipFile({ outputMode: "default" });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.deployment).toBeDefined();
      });
    });

    describe("App/Pages Router Detection", () => {
      it("should handle App Router projects", async () => {
        const zipFile = await createNextJsZipFile({
          hasAppRouter: true,
          hasApiRoutes: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          stats: { detectedFramework: string };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.stats.detectedFramework).toBe("nextjs");
      });

      it("should handle Pages Router projects", async () => {
        const zipFile = await createNextJsZipFile({
          hasAppRouter: false,
          hasApiRoutes: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          stats: { detectedFramework: string };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.stats.detectedFramework).toBe("nextjs");
      });

      it("should handle projects with middleware", async () => {
        const zipFile = await createNextJsZipFile({
          hasMiddleware: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.deployment).toBeDefined();
      });
    });
  });

  describe("Deployment Creation", () => {
    it("should create deployment with correct properties for Next.js upload", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        success: boolean;
        deployment: {
          id: string;
          siteId: string;
          version: number;
          slot: string;
          status: string;
          triggeredBy: string;
          branch: string;
          commitMessage: string;
        };
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);
      expect(response.body.deployment.siteId).toBe(testSiteId);
      expect(response.body.deployment.version).toBe(1);
      expect(response.body.deployment.slot).toBe("blue");
      expect(response.body.deployment.status).toBe("pending");
      expect(response.body.deployment.triggeredBy).toBe("upload");
      expect(response.body.deployment.branch).toBe("upload");
      expect(response.body.deployment.commitMessage).toContain("nextjs-site.zip");
    });

    it("should increment version for multiple uploads", async () => {
      // First upload
      const zipFile1 = await createNextJsZipFile();
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const res1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );

      // Second upload
      const zipFile2 = await createNextJsZipFile({ outputMode: "standalone" });
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const res2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );

      // Third upload
      const zipFile3 = await createNextJsZipFile({ outputMode: "export" });
      const formData3 = new FormData();
      formData3.append("file", zipFile3);

      const res3 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData3
      );

      expect(res1.body.deployment.version).toBe(1);
      expect(res2.body.deployment.version).toBe(2);
      expect(res3.body.deployment.version).toBe(3);
    });

    it("should alternate deployment slots (blue/green)", async () => {
      const slots: string[] = [];

      for (let i = 0; i < 4; i++) {
        const zipFile = await createNextJsZipFile();
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{ deployment: any }>(
          `/api/sites/${testSiteId}/upload`,
          formData
        );

        slots.push(response.body.deployment.slot);
      }

      expect(slots).toEqual(["blue", "green", "blue", "green"]);
    });

    it("should update site status to building after upload", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      await testClient.postForm(`/api/sites/${testSiteId}/upload`, formData);

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.status).toBe("building");
    });

    it("should update site framework to nextjs after detection", async () => {
      // Create site without framework
      await clearDatabase();
      const siteData = createSiteFixture({ framework: "static" });
      const res = await testClient.post<{ site: any }>("/api/sites", siteData);
      const siteId = res.body.site.id;

      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      await testClient.postForm(`/api/sites/${siteId}/upload`, formData);

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, siteId),
      });

      expect(site?.framework).toBe("nextjs");
    });
  });

  describe("Build Logs", () => {
    it("should have pending status for new deployment", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Check deployment status directly from database
      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deploymentId),
      });

      expect(deployment).toBeDefined();
      expect(deployment?.status).toBe("pending");
      expect(deployment?.buildLogs).toBeNull();
    });

    it("should return build logs for completed deployment", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Simulate build completion with logs
      await testDb
        .update(schema.deployments)
        .set({
          status: "live",
          buildLogs: `[12:00:00] Installing dependencies...
[12:00:30] npm install completed
[12:00:31] Building Next.js application...
[12:01:00] Creating optimized production build
[12:01:30] Build completed successfully
[12:01:31] Uploading artifacts to S3...
[12:01:45] Deployment complete`,
        })
        .where(eq(schema.deployments.id, deploymentId));

      const logsRes = await testClient.get<{
        logs: string;
        status: string;
        complete: boolean;
      }>(`/api/deployments/${deploymentId}/logs`);

      expect(logsRes.status).toBe(200);
      expect(logsRes.body.status).toBe("live");
      expect(logsRes.body.complete).toBe(true);
      expect(logsRes.body.logs).toContain("Installing dependencies");
      expect(logsRes.body.logs).toContain("Building Next.js application");
      expect(logsRes.body.logs).toContain("Deployment complete");
    });

    it("should return error logs for failed deployment", async () => {
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
          buildLogs: `[12:00:00] Installing dependencies...
[12:00:30] npm install completed
[12:00:31] Building Next.js application...
[12:01:00] Error: Module not found: Can't resolve 'missing-module'
[12:01:01] Build failed with exit code 1`,
        })
        .where(eq(schema.deployments.id, deploymentId));

      const logsRes = await testClient.get<{
        logs: string;
        status: string;
        complete: boolean;
      }>(`/api/deployments/${deploymentId}/logs`);

      expect(logsRes.status).toBe(200);
      expect(logsRes.body.status).toBe("failed");
      expect(logsRes.body.complete).toBe(true);
      expect(logsRes.body.logs).toContain("Error: Module not found");
      expect(logsRes.body.logs).toContain("Build failed");
    });
  });

  describe("Deployment Lifecycle", () => {
    it("should allow cancellation of pending deployment", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      const cancelRes = await testClient.post<{ deployment: any }>(
        `/api/deployments/${deploymentId}/cancel`
      );

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.deployment.status).toBe("cancelled");
    });

    it("should allow promotion of live deployment", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      // Set deployment to live but not active
      await testDb
        .update(schema.deployments)
        .set({ status: "live", isActive: false })
        .where(eq(schema.deployments.id, deploymentId));

      const promoteRes = await testClient.post<{ deployment: any }>(
        `/api/deployments/${deploymentId}/promote`
      );

      expect(promoteRes.status).toBe(200);
      expect(promoteRes.body.deployment.isActive).toBe(true);
    });

    it("should allow rollback to previous deployment", async () => {
      // First deployment
      const zipFile1 = await createNextJsZipFile({ outputMode: "default" });
      const formData1 = new FormData();
      formData1.append("file", zipFile1);

      const res1 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData1
      );
      const deployment1Id = res1.body.deployment.id;

      // Second deployment
      const zipFile2 = await createNextJsZipFile({ outputMode: "standalone" });
      const formData2 = new FormData();
      formData2.append("file", zipFile2);

      const res2 = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData2
      );
      const deployment2Id = res2.body.deployment.id;

      // Set both deployments to live
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
      const rollbackRes = await testClient.post<{ message: string }>(
        `/api/sites/${testSiteId}/rollback/${deployment1Id}`
      );

      expect(rollbackRes.status).toBe(200);
    });
  });

  describe("Deployment Details", () => {
    it("should return deployment details with site info", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const uploadRes = await testClient.postForm<{ deployment: any }>(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      const deploymentId = uploadRes.body.deployment.id;

      const detailsRes = await testClient.get<{ deployment: any }>(
        `/api/deployments/${deploymentId}`
      );

      expect(detailsRes.status).toBe(200);
      expect(detailsRes.body.deployment.id).toBe(deploymentId);
      expect(detailsRes.body.deployment.site).toBeDefined();
      expect(detailsRes.body.deployment.site.id).toBe(testSiteId);
    });

    it("should list all deployments for site", async () => {
      // Create multiple deployments
      for (let i = 0; i < 3; i++) {
        const zipFile = await createNextJsZipFile();
        const formData = new FormData();
        formData.append("file", zipFile);
        await testClient.postForm(`/api/sites/${testSiteId}/upload`, formData);
      }

      const listRes = await testClient.get<{ deployments: any[] }>(
        `/api/deployments?siteId=${testSiteId}`
      );

      expect(listRes.status).toBe(200);
      expect(listRes.body.deployments).toHaveLength(3);
    });

    it("should support pagination for deployment list", async () => {
      // Create 5 deployments
      for (let i = 0; i < 5; i++) {
        const zipFile = await createNextJsZipFile();
        const formData = new FormData();
        formData.append("file", zipFile);
        await testClient.postForm(`/api/sites/${testSiteId}/upload`, formData);
      }

      const page1 = await testClient.get<{ deployments: any[] }>(
        `/api/deployments?siteId=${testSiteId}&limit=2&offset=0`
      );

      const page2 = await testClient.get<{ deployments: any[] }>(
        `/api/deployments?siteId=${testSiteId}&limit=2&offset=2`
      );

      expect(page1.body.deployments).toHaveLength(2);
      expect(page2.body.deployments).toHaveLength(2);
    });
  });

  describe("Error Handling", () => {
    it("should reject upload for non-existent site", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm(
        `/api/sites/non-existent-site-id/upload`,
        formData
      );

      expect(response.status).toBe(404);
    });

    it("should reject non-ZIP files", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["not a zip"], "project.txt", { type: "text/plain" })
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

    it("should handle empty ZIP files gracefully", async () => {
      const emptyZip = await new Promise<File>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk) => chunks.push(chunk));
        archive.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const blob = new Blob([buffer], { type: "application/zip" });
          const file = new File([blob], "empty.zip", { type: "application/zip" });
          resolve(file);
        });
        archive.on("error", reject);

        archive.finalize();
      });

      const formData = new FormData();
      formData.append("file", emptyZip);

      const response = await testClient.postForm(
        `/api/sites/${testSiteId}/upload`,
        formData
      );

      // Should accept but detect as unknown/static
      expect(response.status).toBe(200);
    });
  });

  describe("Multiple Output Mode Configurations", () => {
    describe("SSR Mode (Standalone)", () => {
      it("should properly handle standalone Next.js projects", async () => {
        const zipFile = await createNextJsZipFile({
          outputMode: "standalone",
          hasApiRoutes: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
          stats: { detectedFramework: string };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.stats.detectedFramework).toBe("nextjs");
      });

      it("should handle standalone with App Router", async () => {
        const zipFile = await createNextJsZipFile({
          outputMode: "standalone",
          hasAppRouter: true,
          hasApiRoutes: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.deployment).toBeDefined();
      });
    });

    describe("Static Mode (Export)", () => {
      it("should properly handle static export Next.js projects", async () => {
        const zipFile = await createNextJsZipFile({
          outputMode: "export",
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
          stats: { detectedFramework: string };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.stats.detectedFramework).toBe("nextjs");
      });

      it("should not have API routes in static export", async () => {
        // Static export cannot have API routes
        const zipFile = await createNextJsZipFile({
          outputMode: "export",
          hasApiRoutes: false,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    describe("Hybrid Mode (Default)", () => {
      it("should properly handle default/hybrid Next.js projects", async () => {
        const zipFile = await createNextJsZipFile({
          outputMode: "default",
          hasApiRoutes: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
          deployment: any;
          stats: { detectedFramework: string };
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.stats.detectedFramework).toBe("nextjs");
      });

      it("should handle hybrid with middleware", async () => {
        const zipFile = await createNextJsZipFile({
          outputMode: "default",
          hasMiddleware: true,
          hasApiRoutes: true,
        });
        const formData = new FormData();
        formData.append("file", zipFile);

        const response = await testClient.postForm<{
          success: boolean;
        }>(`/api/sites/${testSiteId}/upload`, formData);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe("Build Queue Integration", () => {
    it("should queue build job after upload", async () => {
      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        success: boolean;
        deployment: any;
        message: string;
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("queued");

      // Verify deployment is in pending state waiting for build
      const deployment = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, response.body.deployment.id),
      });

      expect(deployment?.status).toBe("pending");
    });

    it("should include correct build parameters in deployment", async () => {
      const zipFile = await createNextJsZipFile({
        outputMode: "standalone",
        customBuildCommand: "next build && echo done",
      });
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        success: boolean;
        deployment: any;
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);
      expect(response.body.deployment).toBeDefined();
    });
  });

  describe("Site Configuration Updates", () => {
    it("should update site build command based on detection", async () => {
      // Create site with default settings
      await clearDatabase();
      const siteData = createSiteFixture({
        framework: "static",
        buildCommand: "echo default",
      });
      const res = await testClient.post<{ site: any }>("/api/sites", siteData);
      const siteId = res.body.site.id;

      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      await testClient.postForm(`/api/sites/${siteId}/upload`, formData);

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, siteId),
      });

      // Framework should be updated
      expect(site?.framework).toBe("nextjs");
    });

    it("should preserve custom environment variables", async () => {
      // Update site with custom env vars
      await testClient.put(`/api/sites/${testSiteId}`, {
        envVariables: {
          NEXT_PUBLIC_API_URL: "https://api.example.com",
          DATABASE_URL: "postgres://localhost/db",
        },
      });

      const zipFile = await createNextJsZipFile();
      const formData = new FormData();
      formData.append("file", zipFile);

      const response = await testClient.postForm<{
        success: boolean;
        deployment: any;
      }>(`/api/sites/${testSiteId}/upload`, formData);

      expect(response.status).toBe(200);

      // Verify env vars are preserved
      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.envVariables).toBeDefined();
      expect((site?.envVariables as any)?.NEXT_PUBLIC_API_URL).toBe("https://api.example.com");
    });
  });
});

describe("Framework Builder Configuration Tests", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("Next.js Build Configuration", () => {
    it("should generate correct config for SSR (standalone)", async () => {
      const { getNextJsBuildConfig } = await import(
        "../../../packages/shared/src/builders/nextjs"
      );

      const config = getNextJsBuildConfig(
        { buildCommand: null, outputDirectory: null, envVariables: null },
        { output: "standalone" }
      );

      expect(config.renderMode).toBe("ssr");
      expect(config.outputDirectory).toBe(".next/standalone");
      expect(config.entryPoint).toBe("server.js");
    });

    it("should generate correct config for SSG (export)", async () => {
      const { getNextJsBuildConfig } = await import(
        "../../../packages/shared/src/builders/nextjs"
      );

      const config = getNextJsBuildConfig(
        { buildCommand: null, outputDirectory: null, envVariables: null },
        { output: "export" }
      );

      expect(config.renderMode).toBe("ssg");
      expect(config.outputDirectory).toBe("out");
      expect(config.entryPoint).toBeUndefined();
    });

    it("should generate correct config for Hybrid (default)", async () => {
      const { getNextJsBuildConfig } = await import(
        "../../../packages/shared/src/builders/nextjs"
      );

      const config = getNextJsBuildConfig(
        { buildCommand: null, outputDirectory: null, envVariables: null },
        {}
      );

      expect(config.renderMode).toBe("hybrid");
      expect(config.outputDirectory).toBe(".next");
    });
  });

  describe("Framework Detection", () => {
    it("should detect Next.js from package.json", async () => {
      const { detectFramework } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const result = detectFramework({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
      });

      expect(result.framework).toBe("nextjs");
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should detect SSG mode from build script", async () => {
      const { detectFramework } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const result = detectFramework({
        dependencies: { next: "^14.0.0" },
        scripts: { build: "next build && next export" },
      });

      expect(result.framework).toBe("nextjs");
      expect(result.renderMode).toBe("ssg");
    });

    it("should default to hybrid for standard Next.js", async () => {
      const { detectFramework } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const result = detectFramework({
        dependencies: { next: "^14.0.0" },
        scripts: { build: "next build" },
      });

      expect(result.framework).toBe("nextjs");
      expect(result.renderMode).toBe("hybrid");
    });
  });

  describe("Build Environment Generation", () => {
    it("should generate correct build environment for Next.js", async () => {
      const { generateBuildEnv } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const env = generateBuildEnv({
        framework: "nextjs",
        envVariables: { NEXT_PUBLIC_API_URL: "https://api.example.com" },
      });

      expect(env.NODE_ENV).toBe("production");
      expect(env.CI).toBe("true");
      expect(env.NEXT_TELEMETRY_DISABLED).toBe("1");
      expect(env.NEXT_PUBLIC_API_URL).toBe("https://api.example.com");
    });
  });

  describe("Start Command Generation", () => {
    it("should generate SSG start command", async () => {
      const { getStartCommand } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const command = getStartCommand("nextjs", "ssg");
      expect(command).toBe("npx serve -s");
    });

    it("should generate SSR start command", async () => {
      const { getStartCommand } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const command = getStartCommand("nextjs", "ssr");
      expect(command).toBe("node server.js");
    });

    it("should generate hybrid start command", async () => {
      const { getStartCommand } = await import(
        "../../../packages/shared/src/builders/index"
      );

      const command = getStartCommand("nextjs", "hybrid");
      expect(command).toBe("node server.js");
    });
  });
});

describe("Executor Integration Tests", () => {
  describe("OpenRuntimes Configuration", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("should validate executor configuration", async () => {
      const { validateOpenRuntimesConfiguration } = await import(
        "../../../packages/shared/src/openruntimes/client"
      );

      process.env.SITES_EXECUTOR_SECRET = "test-secret";
      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(true);
    });

    it("should fail validation without secret", async () => {
      const { validateOpenRuntimesConfiguration } = await import(
        "../../../packages/shared/src/openruntimes/client"
      );

      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(false);
    });

    it("should check if executor is configured", async () => {
      const { isOpenRuntimesConfigured } = await import(
        "../../../packages/shared/src/openruntimes/client"
      );

      process.env.SITES_EXECUTOR_SECRET = "test-secret";
      expect(isOpenRuntimesConfigured()).toBe(true);

      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;
      expect(isOpenRuntimesConfigured()).toBe(false);
    });
  });
});
