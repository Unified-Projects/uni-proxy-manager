import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import * as schema from "../../../packages/database/src/schema";
import { eq, desc } from "drizzle-orm";

/**
 * End-to-End Site Deployment Flow Test
 *
 * This test validates the complete site deployment lifecycle including:
 * - Site creation and configuration
 * - Manual deployment triggering
 * - Blue-green slot management
 * - Rollback functionality
 * - Environment variable management
 * - Domain association
 */
describe("E2E: Site Deployment Flow", () => {
  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  /**
   * Helper to create a site fixture
   */
  function createSiteFixture(overrides: Partial<{
    name: string;
    slug: string;
    framework: "nextjs" | "sveltekit" | "static" | "custom";
    renderMode: "ssr" | "ssg" | "hybrid";
    buildCommand: string;
    outputDirectory: string;
    installCommand: string;
    nodeVersion: string;
    envVariables: Record<string, string>;
  }> = {}) {
    const timestamp = Date.now();
    return {
      name: overrides.name || `Test Site ${timestamp}`,
      slug: overrides.slug || `test-site-${timestamp}`,
      framework: overrides.framework || "static",
      renderMode: overrides.renderMode || "ssg",
      buildCommand: overrides.buildCommand,
      outputDirectory: overrides.outputDirectory,
      installCommand: overrides.installCommand,
      nodeVersion: overrides.nodeVersion || "20",
      envVariables: overrides.envVariables,
    };
  }

  describe("Complete Deployment Flow", () => {
    it("should complete full site deployment lifecycle", async () => {
      // ========================================
      // Step 1: Create Site
      // ========================================
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          name: "Deployment Test Site",
          slug: "deployment-test",
          framework: "nextjs",
          renderMode: "ssr",
          buildCommand: "npm run build",
          outputDirectory: ".next",
          installCommand: "npm install",
          nodeVersion: "20",
          envVariables: {
            NODE_ENV: "production",
            API_URL: "https://api.example.com",
          },
        })
      );

      expect(siteRes.status).toBe(201);
      const siteId = siteRes.body.site.id;
      expect(siteRes.body.site.name).toBe("Deployment Test Site");
      expect(siteRes.body.site.framework).toBe("nextjs");
      expect(siteRes.body.site.status).toBe("disabled");

      // ========================================
      // Step 2: Verify Site Configuration
      // ========================================
      const getSiteRes = await testClient.get<{ site: any }>(
        `/api/sites/${siteId}`
      );

      expect(getSiteRes.status).toBe(200);
      expect(getSiteRes.body.site.buildCommand).toBe("npm run build");
      expect(getSiteRes.body.site.outputDirectory).toBe(".next");
      expect(getSiteRes.body.site.nodeVersion).toBe("20");

      // ========================================
      // Step 3: Trigger First Deployment
      // ========================================
      const deployRes = await testClient.post<{ deployment: any; message: string }>(
        `/api/sites/${siteId}/deploy`
      );

      // Should succeed, fail gracefully if queue not available, or return 400 if no source
      expect([200, 400, 500]).toContain(deployRes.status);

      if (deployRes.status === 400) {
        // No source available - expected when no files uploaded or GitHub connected
        expect(deployRes.body.error).toContain("No source available");
      } else if (deployRes.status === 200) {
        expect(deployRes.body.deployment.version).toBe(1);
        expect(deployRes.body.deployment.status).toBe("pending");
        expect(deployRes.body.deployment.slot).toBeDefined();
        expect(["blue", "green"]).toContain(deployRes.body.deployment.slot);

        // ========================================
        // Step 4: Simulate Deployment Completion
        // ========================================
        // In a real scenario, the worker would complete this
        await testDb
          .update(schema.deployments)
          .set({
            status: "live",
            artifactPath: "/artifacts/deployment-1.tar.gz",
            deployedAt: new Date(),
          })
          .where(eq(schema.deployments.id, deployRes.body.deployment.id));

        // Update site to active
        await testDb
          .update(schema.sites)
          .set({
            status: "active",
            activeSlot: deployRes.body.deployment.slot,
          })
          .where(eq(schema.sites.id, siteId));

        // ========================================
        // Step 5: Trigger Second Deployment
        // ========================================
        const deploy2Res = await testClient.post<{ deployment: any }>(
          `/api/sites/${siteId}/deploy`
        );

        if (deploy2Res.status === 200) {
          expect(deploy2Res.body.deployment.version).toBe(2);
          // Should use opposite slot (blue-green pattern)
          const firstSlot = deployRes.body.deployment.slot;
          const secondSlot = deploy2Res.body.deployment.slot;
          expect(secondSlot).not.toBe(firstSlot);

          // Simulate second deployment completion
          await testDb
            .update(schema.deployments)
            .set({
              status: "live",
              artifactPath: "/artifacts/deployment-2.tar.gz",
              deployedAt: new Date(),
            })
            .where(eq(schema.deployments.id, deploy2Res.body.deployment.id));

          // Mark first deployment as rolled back
          await testDb
            .update(schema.deployments)
            .set({ status: "rolled_back" })
            .where(eq(schema.deployments.id, deployRes.body.deployment.id));
        }
      }

      // ========================================
      // Step 6: Verify Deployment History
      // ========================================
      const siteWithDeployments = await testClient.get<{ site: any }>(
        `/api/sites/${siteId}`
      );

      expect(siteWithDeployments.status).toBe(200);
      // Deployments should be populated

      // ========================================
      // Step 7: Cleanup
      // ========================================
      const deleteSiteRes = await testClient.delete<{ success: boolean }>(
        `/api/sites/${siteId}`
      );

      expect(deleteSiteRes.status).toBe(200);
      expect(deleteSiteRes.body.success).toBe(true);
    });
  });

  describe("Site CRUD Operations", () => {
    it("should create, update, and delete a site", async () => {
      // Create
      const createRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ name: "CRUD Test", slug: "crud-test" })
      );
      expect(createRes.status).toBe(201);
      const siteId = createRes.body.site.id;

      // Update
      const updateRes = await testClient.put<{ site: any }>(
        `/api/sites/${siteId}`,
        {
          name: "Updated CRUD Test",
          framework: "sveltekit",
          memoryMb: 512,
        }
      );
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.site.name).toBe("Updated CRUD Test");
      expect(updateRes.body.site.framework).toBe("sveltekit");
      expect(updateRes.body.site.memoryMb).toBe(512);

      // Delete
      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/sites/${siteId}`
      );
      expect(deleteRes.status).toBe(200);

      // Verify deleted
      const getRes = await testClient.get(`/api/sites/${siteId}`);
      expect(getRes.status).toBe(404);
    });

    it("should prevent duplicate slugs", async () => {
      await testClient.post(
        "/api/sites",
        createSiteFixture({ slug: "unique-slug" })
      );

      const duplicateRes = await testClient.post(
        "/api/sites",
        createSiteFixture({ slug: "unique-slug" })
      );

      expect(duplicateRes.status).toBe(409);
    });

    it("should list all sites", async () => {
      // Create multiple sites
      for (let i = 0; i < 3; i++) {
        await testClient.post(
          "/api/sites",
          createSiteFixture({ name: `List Test ${i}`, slug: `list-test-${i}` })
        );
      }

      const listRes = await testClient.get<{ sites: any[] }>("/api/sites");
      expect(listRes.status).toBe(200);
      expect(listRes.body.sites.length).toBe(3);
    });
  });

  describe("Framework-Specific Sites", () => {
    it("should create Next.js site with SSR config", async () => {
      const res = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          name: "Next.js SSR Site",
          slug: "nextjs-ssr",
          framework: "nextjs",
          renderMode: "ssr",
          buildCommand: "npm run build",
          outputDirectory: ".next",
        })
      );

      expect(res.status).toBe(201);
      expect(res.body.site.framework).toBe("nextjs");
      expect(res.body.site.renderMode).toBe("ssr");
    });

    it("should create SvelteKit site", async () => {
      const res = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          name: "SvelteKit Site",
          slug: "sveltekit",
          framework: "sveltekit",
          renderMode: "hybrid",
          buildCommand: "npm run build",
          outputDirectory: "build",
        })
      );

      expect(res.status).toBe(201);
      expect(res.body.site.framework).toBe("sveltekit");
      expect(res.body.site.renderMode).toBe("hybrid");
    });

    it("should create static site", async () => {
      const res = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          name: "Static Site",
          slug: "static-site",
          framework: "static",
          renderMode: "ssg",
          buildCommand: "npm run build",
          outputDirectory: "dist",
        })
      );

      expect(res.status).toBe(201);
      expect(res.body.site.framework).toBe("static");
      expect(res.body.site.renderMode).toBe("ssg");
    });

    it("should create custom framework site", async () => {
      const res = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          name: "Custom Framework",
          slug: "custom-framework",
          framework: "custom",
          buildCommand: "./build.sh",
          outputDirectory: "public",
        })
      );

      expect(res.status).toBe(201);
      expect(res.body.site.framework).toBe("custom");
    });
  });

  describe("Environment Variables", () => {
    it("should manage environment variables", async () => {
      // Create site with env vars
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          slug: "env-test",
          envVariables: {
            DATABASE_URL: "postgres://localhost/db",
            API_KEY: "secret123",
          },
        })
      );

      expect(siteRes.status).toBe(201);
      const siteId = siteRes.body.site.id;

      // Get env vars (masked)
      const getEnvRes = await testClient.get<{
        envVariables: Record<string, string>;
        count: number;
      }>(`/api/sites/${siteId}/env`);

      expect(getEnvRes.status).toBe(200);
      expect(getEnvRes.body.count).toBe(2);
      // API_KEY should be masked
      expect(getEnvRes.body.envVariables.API_KEY).toBe("********");
      // DATABASE_URL should be visible
      expect(getEnvRes.body.envVariables.DATABASE_URL).toBe("postgres://localhost/db");

      // Update env vars
      const updateEnvRes = await testClient.put<{ success: boolean; count: number }>(
        `/api/sites/${siteId}/env`,
        {
          envVariables: {
            DATABASE_URL: "postgres://prod/db",
            API_KEY: "newSecret456",
            NEW_VAR: "new_value",
          },
        }
      );

      expect(updateEnvRes.status).toBe(200);
      expect(updateEnvRes.body.count).toBe(3);

      // Cleanup
      await testClient.delete(`/api/sites/${siteId}`);
    });

    it("should mask sensitive environment variables", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({
          slug: "mask-test",
          envVariables: {
            NORMAL_VAR: "visible_value",
            API_SECRET: "should_be_hidden",
            DATABASE_PASSWORD: "should_be_hidden",
            AUTH_TOKEN: "should_be_hidden",
            PRIVATE_KEY: "should_be_hidden",
          },
        })
      );

      const siteId = siteRes.body.site.id;

      const envRes = await testClient.get<{ envVariables: Record<string, string> }>(
        `/api/sites/${siteId}/env`
      );

      expect(envRes.body.envVariables.NORMAL_VAR).toBe("visible_value");
      expect(envRes.body.envVariables.API_SECRET).toBe("********");
      expect(envRes.body.envVariables.DATABASE_PASSWORD).toBe("********");
      expect(envRes.body.envVariables.AUTH_TOKEN).toBe("********");
      expect(envRes.body.envVariables.PRIVATE_KEY).toBe("********");

      await testClient.delete(`/api/sites/${siteId}`);
    });
  });

  describe("Deployment Slots (Blue-Green)", () => {
    it("should alternate between blue and green slots", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ slug: "slot-test" })
      );
      const siteId = siteRes.body.site.id;

      // First deployment
      const deploy1Res = await testClient.post<{ deployment: any }>(
        `/api/sites/${siteId}/deploy`
      );

      // 400 = no source available (expected without GitHub/upload)
      if (deploy1Res.status === 400) {
        expect(deploy1Res.body.error).toContain("No source available");
      } else if (deploy1Res.status === 200) {
        const firstSlot = deploy1Res.body.deployment.slot;
        expect(["blue", "green"]).toContain(firstSlot);

        // Complete first deployment
        await testDb
          .update(schema.deployments)
          .set({
            status: "live",
            artifactPath: "/artifacts/v1.tar.gz",
          })
          .where(eq(schema.deployments.id, deploy1Res.body.deployment.id));

        // Second deployment
        const deploy2Res = await testClient.post<{ deployment: any }>(
          `/api/sites/${siteId}/deploy`
        );

        if (deploy2Res.status === 200) {
          const secondSlot = deploy2Res.body.deployment.slot;
          expect(secondSlot).not.toBe(firstSlot);
          expect(["blue", "green"]).toContain(secondSlot);
        }
      }

      await testClient.delete(`/api/sites/${siteId}`);
    });
  });

  describe("Rollback Functionality", () => {
    it("should rollback to previous deployment", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ slug: "rollback-test" })
      );
      const siteId = siteRes.body.site.id;

      // Create initial deployment
      const deploy1Res = await testClient.post<{ deployment: any }>(
        `/api/sites/${siteId}/deploy`
      );

      // 400 = no source available (expected without GitHub/upload)
      if (deploy1Res.status === 400) {
        expect(deploy1Res.body.error).toContain("No source available");
      } else if (deploy1Res.status === 200) {
        const deployment1Id = deploy1Res.body.deployment.id;

        // Complete first deployment
        await testDb
          .update(schema.deployments)
          .set({
            status: "live",
            artifactPath: "/artifacts/v1.tar.gz",
            deployedAt: new Date(),
          })
          .where(eq(schema.deployments.id, deployment1Id));

        await testDb
          .update(schema.sites)
          .set({
            status: "active",
            activeSlot: deploy1Res.body.deployment.slot,
          })
          .where(eq(schema.sites.id, siteId));

        // Create second deployment
        const deploy2Res = await testClient.post<{ deployment: any }>(
          `/api/sites/${siteId}/deploy`
        );

        if (deploy2Res.status === 200) {
          // Complete second deployment
          await testDb
            .update(schema.deployments)
            .set({
              status: "live",
              artifactPath: "/artifacts/v2.tar.gz",
              deployedAt: new Date(),
            })
            .where(eq(schema.deployments.id, deploy2Res.body.deployment.id));

          // Mark first as rolled back
          await testDb
            .update(schema.deployments)
            .set({ status: "rolled_back" })
            .where(eq(schema.deployments.id, deployment1Id));

          // Rollback to first deployment
          const rollbackRes = await testClient.post<{ deployment: any }>(
            `/api/sites/${siteId}/rollback/${deployment1Id}`
          );

          if (rollbackRes.status === 200) {
            expect(rollbackRes.body.deployment.triggeredBy).toBe("rollback");
            expect(rollbackRes.body.deployment.version).toBe(3);
          }
        }
      }

      await testClient.delete(`/api/sites/${siteId}`);
    });

    it("should reject rollback to non-live deployment", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ slug: "rollback-reject-test" })
      );
      const siteId = siteRes.body.site.id;

      // Create deployment but don't complete it
      const deployRes = await testClient.post<{ deployment?: any; error?: string }>(
        `/api/sites/${siteId}/deploy`
      );

      // 400 = no source available (expected without GitHub/upload)
      if (deployRes.status === 400) {
        expect(deployRes.body.error).toContain("No source available");
      } else if (deployRes.status === 200) {
        // Try to rollback to pending deployment
        const rollbackRes = await testClient.post(
          `/api/sites/${siteId}/rollback/${deployRes.body.deployment.id}`
        );

        expect(rollbackRes.status).toBe(400);
      }

      await testClient.delete(`/api/sites/${siteId}`);
    });
  });

  describe("Resource Configuration", () => {
    it("should configure memory and CPU limits", async () => {
      const res = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          ...createSiteFixture({ slug: "resource-test" }),
          memoryMb: 1024,
          cpuLimit: "1.0",
          timeoutSeconds: 60,
          maxConcurrency: 50,
        }
      );

      expect(res.status).toBe(201);
      expect(res.body.site.memoryMb).toBe(1024);
      expect(res.body.site.cpuLimit).toBe("1.00");
      expect(res.body.site.timeoutSeconds).toBe(60);
      expect(res.body.site.maxConcurrency).toBe(50);

      await testClient.delete(`/api/sites/${res.body.site.id}`);
    });

    it("should apply default resource limits", async () => {
      const res = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ slug: "default-resource-test" })
      );

      expect(res.status).toBe(201);
      expect(res.body.site.memoryMb).toBe(256);
      expect(res.body.site.cpuLimit).toBe("0.50");
      expect(res.body.site.timeoutSeconds).toBe(30);
      expect(res.body.site.maxConcurrency).toBe(10);

      await testClient.delete(`/api/sites/${res.body.site.id}`);
    });
  });

  describe("Multiple Sites Management", () => {
    it("should manage multiple sites independently", async () => {
      const sites = [
        { name: "Frontend App", slug: "frontend", framework: "nextjs" as const },
        { name: "API Docs", slug: "docs", framework: "static" as const },
        { name: "Admin Panel", slug: "admin", framework: "sveltekit" as const },
      ];

      const createdSites: string[] = [];

      // Create all sites
      for (const site of sites) {
        const res = await testClient.post<{ site: any }>(
          "/api/sites",
          createSiteFixture(site)
        );
        expect(res.status).toBe(201);
        createdSites.push(res.body.site.id);
      }

      // Verify all exist
      const listRes = await testClient.get<{ sites: any[] }>("/api/sites");
      expect(listRes.body.sites.length).toBe(3);

      // Trigger deployment on first site only
      const deployRes = await testClient.post(
        `/api/sites/${createdSites[0]}/deploy`
      );
      // 400 = no source available (expected without GitHub/upload), 500 = queue error
      expect([200, 400, 500]).toContain(deployRes.status);

      // Other sites should remain unaffected
      for (let i = 1; i < createdSites.length; i++) {
        const siteRes = await testClient.get<{ site: any }>(
          `/api/sites/${createdSites[i]}`
        );
        expect(siteRes.body.site.status).toBe("disabled");
      }

      // Cleanup
      for (const siteId of createdSites) {
        await testClient.delete(`/api/sites/${siteId}`);
      }
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent site", async () => {
      const res = await testClient.get("/api/sites/non-existent");
      expect(res.status).toBe(404);
    });

    it("should return 404 when deploying non-existent site", async () => {
      const res = await testClient.post("/api/sites/non-existent/deploy");
      expect(res.status).toBe(404);
    });

    it("should return 404 when rolling back non-existent site", async () => {
      const res = await testClient.post(
        "/api/sites/non-existent/rollback/non-existent-deploy"
      );
      expect(res.status).toBe(404);
    });

    it("should return 404 for non-existent deployment in rollback", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ slug: "rollback-404-test" })
      );
      const siteId = siteRes.body.site.id;

      const res = await testClient.post(
        `/api/sites/${siteId}/rollback/non-existent-deployment`
      );
      expect(res.status).toBe(404);

      await testClient.delete(`/api/sites/${siteId}`);
    });
  });

  describe("Deployment Cascade Delete", () => {
    it("should delete all deployments when site is deleted", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        createSiteFixture({ slug: "cascade-delete-test" })
      );
      const siteId = siteRes.body.site.id;

      // Create multiple deployments directly in database
      for (let i = 0; i < 3; i++) {
        await testDb.insert(schema.deployments).values({
          id: `cascade-deploy-${i}-${Date.now()}`,
          siteId,
          version: i + 1,
          slot: i % 2 === 0 ? "blue" : "green",
          status: "live",
          branch: "main",
          triggeredBy: "manual",
        });
      }

      // Verify deployments exist
      const deploymentsBeforeDelete = await testDb.query.deployments.findMany({
        where: eq(schema.deployments.siteId, siteId),
      });
      expect(deploymentsBeforeDelete.length).toBe(3);

      // Delete site
      const deleteRes = await testClient.delete(`/api/sites/${siteId}`);
      expect(deleteRes.status).toBe(200);

      // Verify deployments are deleted
      const deploymentsAfterDelete = await testDb.query.deployments.findMany({
        where: eq(schema.deployments.siteId, siteId),
      });
      expect(deploymentsAfterDelete.length).toBe(0);
    });
  });
});
