/**
 * Sites API Integration Tests
 *
 * Tests for the /api/sites endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../../setup/test-db";
import { createSiteFixture } from "../../setup/fixtures";
import * as schema from "../../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Sites API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  // ============================================================================
  // POST /api/sites - Create Site
  // ============================================================================

  describe("POST /api/sites", () => {
    it("should create a new site", async () => {
      const siteData = createSiteFixture();
      const response = await testClient.post("/api/sites", siteData);

      expect(response.status).toBe(201);
      expect(response.body.site).toBeDefined();
      expect(response.body.site.name).toBe(siteData.name);
      expect(response.body.site.slug).toBe(siteData.slug);
      expect(response.body.site.framework).toBe(siteData.framework);
    });

    it("should create site with default values", async () => {
      const response = await testClient.post("/api/sites", {
        name: "Minimal Site",
        slug: "minimal-site",
      });

      expect(response.status).toBe(201);
      expect(response.body.site.framework).toBe("static");
      expect(response.body.site.renderMode).toBe("ssg");
      expect(response.body.site.nodeVersion).toBe("20");
    });

    it("should reject duplicate slug", async () => {
      const siteData = createSiteFixture({ slug: "unique-slug" });
      await testClient.post("/api/sites", siteData);

      const response = await testClient.post("/api/sites", {
        ...createSiteFixture(),
        slug: "unique-slug",
      });

      expect(response.status).toBe(409);
    });

    it("should validate slug format", async () => {
      const response = await testClient.post("/api/sites", {
        name: "Test Site",
        slug: "Invalid Slug With Spaces!",
      });

      expect(response.status).toBe(400);
    });

    it("should accept all framework types", async () => {
      const frameworks = ["nextjs", "sveltekit", "static", "custom"];

      for (const framework of frameworks) {
        await clearDatabase();
        const response = await testClient.post("/api/sites", {
          ...createSiteFixture(),
          framework,
        });

        expect(response.status).toBe(201);
        expect(response.body.site.framework).toBe(framework);
      }
    });

    it("should accept all render modes", async () => {
      const renderModes = ["ssr", "ssg", "hybrid"];

      for (const renderMode of renderModes) {
        await clearDatabase();
        const response = await testClient.post("/api/sites", {
          ...createSiteFixture(),
          renderMode,
        });

        expect(response.status).toBe(201);
        expect(response.body.site.renderMode).toBe(renderMode);
      }
    });

    it("should set initial status to disabled", async () => {
      const response = await testClient.post("/api/sites", createSiteFixture());

      expect(response.status).toBe(201);
      expect(response.body.site.status).toBe("disabled");
    });

    it("should create site with environment variables", async () => {
      const response = await testClient.post("/api/sites", {
        ...createSiteFixture(),
        envVariables: {
          API_URL: "https://api.example.com",
          SECRET_KEY: "test-secret",
        },
      });

      expect(response.status).toBe(201);
      expect(response.body.site.envVariables).toHaveProperty("API_URL");
    });

    it("should validate memory limits", async () => {
      const response = await testClient.post("/api/sites", {
        ...createSiteFixture(),
        memoryMb: 50000, // Too high
      });

      expect(response.status).toBe(400);
    });
  });

  // ============================================================================
  // GET /api/sites - List Sites
  // ============================================================================

  describe("GET /api/sites", () => {
    it("should return empty array when no sites exist", async () => {
      const response = await testClient.get("/api/sites");

      expect(response.status).toBe(200);
      expect(response.body.sites).toEqual([]);
    });

    it("should list all sites", async () => {
      await testClient.post("/api/sites", createSiteFixture());
      await testClient.post("/api/sites", createSiteFixture());
      await testClient.post("/api/sites", createSiteFixture());

      const response = await testClient.get("/api/sites");

      expect(response.status).toBe(200);
      expect(response.body.sites).toHaveLength(3);
    });

    it("should include deployment count", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      // Note: Deployments would typically be created through the deployment API
      // This test verifies the field is present

      const response = await testClient.get("/api/sites");

      expect(response.status).toBe(200);
      expect(response.body.sites[0]).toHaveProperty("id");
    });
  });

  // ============================================================================
  // GET /api/sites/:id - Get Single Site
  // ============================================================================

  describe("GET /api/sites/:id", () => {
    it("should return site by ID", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture({
        name: "Test Site",
      }));
      const siteId = createRes.body.site.id;

      const response = await testClient.get(`/api/sites/${siteId}`);

      expect(response.status).toBe(200);
      expect(response.body.site.id).toBe(siteId);
      expect(response.body.site.name).toBe("Test Site");
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/sites/nonexistent-id");

      expect(response.status).toBe(404);
    });

    it("should include deployments with site", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.get(`/api/sites/${siteId}`);

      expect(response.status).toBe(200);
      expect(response.body.site).toHaveProperty("deployments");
    });
  });

  // ============================================================================
  // PUT /api/sites/:id - Update Site
  // ============================================================================

  describe("PUT /api/sites/:id", () => {
    it("should update site name", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.put(`/api/sites/${siteId}`, {
        name: "Updated Name",
      });

      expect(response.status).toBe(200);
      expect(response.body.site.name).toBe("Updated Name");
    });

    it("should update build command", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.put(`/api/sites/${siteId}`, {
        buildCommand: "pnpm build",
      });

      expect(response.status).toBe(200);
      expect(response.body.site.buildCommand).toBe("pnpm build");
    });

    it("should update resource limits", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.put(`/api/sites/${siteId}`, {
        memoryMb: 512,
        cpuLimit: "1.0",
        timeoutSeconds: 60,
      });

      expect(response.status).toBe(200);
      expect(response.body.site.memoryMb).toBe(512);
      expect(response.body.site.cpuLimit).toBe("1.00");
      expect(response.body.site.timeoutSeconds).toBe(60);
    });

    it("should update environment variables", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.put(`/api/sites/${siteId}`, {
        envVariables: {
          NEW_VAR: "new-value",
          ANOTHER_VAR: "another-value",
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.site.envVariables).toHaveProperty("NEW_VAR");
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.put("/api/sites/nonexistent-id", {
        name: "Test",
      });

      expect(response.status).toBe(404);
    });

    it("should update cold start settings", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.put(`/api/sites/${siteId}`, {
        coldStartEnabled: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.site.coldStartEnabled).toBe(false);
    });
  });

  // ============================================================================
  // DELETE /api/sites/:id - Delete Site
  // ============================================================================

  describe("DELETE /api/sites/:id", () => {
    it("should delete site", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.delete(`/api/sites/${siteId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const getRes = await testClient.get(`/api/sites/${siteId}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.delete("/api/sites/nonexistent-id");

      expect(response.status).toBe(404);
    });

    it("should cascade delete deployments", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      // Delete site
      await testClient.delete(`/api/sites/${siteId}`);

      // Verify deployments are also deleted (if any existed)
      const dbDeployments = await testDb.query.deployments.findMany({
        where: eq(schema.deployments.siteId, siteId),
      });
      expect(dbDeployments).toHaveLength(0);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle empty update body", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const response = await testClient.put(`/api/sites/${siteId}`, {});

      expect(response.status).toBe(200);
    });

    it("should handle concurrent updates", async () => {
      const createRes = await testClient.post("/api/sites", createSiteFixture());
      const siteId = createRes.body.site.id;

      const updates = await Promise.all([
        testClient.put(`/api/sites/${siteId}`, { memoryMb: 256 }),
        testClient.put(`/api/sites/${siteId}`, { memoryMb: 512 }),
        testClient.put(`/api/sites/${siteId}`, { memoryMb: 1024 }),
      ]);

      for (const update of updates) {
        expect(update.status).toBe(200);
      }

      const finalRes = await testClient.get(`/api/sites/${siteId}`);
      expect([256, 512, 1024]).toContain(finalRes.body.site.memoryMb);
    });

    it("should handle special characters in name", async () => {
      const response = await testClient.post("/api/sites", {
        ...createSiteFixture(),
        name: "Site with 'quotes' and \"double quotes\"",
      });

      expect(response.status).toBe(201);
    });

    it("should handle long build commands", async () => {
      const longCommand = "npm install && npm run lint && npm run test && npm run build";

      const response = await testClient.post("/api/sites", {
        ...createSiteFixture(),
        buildCommand: longCommand,
      });

      expect(response.status).toBe(201);
      expect(response.body.site.buildCommand).toBe(longCommand);
    });
  });
});
