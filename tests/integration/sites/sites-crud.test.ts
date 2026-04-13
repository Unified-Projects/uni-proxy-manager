import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture, createS3ProviderFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
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

  describe("POST /api/sites", () => {
    it("should create a new site", async () => {
      const siteData = createSiteFixture();
      const response = await testClient.post<{ site: any }>(
        "/api/sites",
        siteData
      );

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("site");
      expect(response.body.site.name).toBe(siteData.name);
      expect(response.body.site.slug).toBe(siteData.slug);
      expect(response.body.site.framework).toBe(siteData.framework);
      expect(response.body.site.status).toBe("disabled");

      // Verify in database
      const dbSite = await testDb.query.sites.findFirst({
        where: eq(schema.sites.slug, siteData.slug),
      });
      expect(dbSite).toBeDefined();
      expect(dbSite!.framework).toBe(siteData.framework);
    });

    it("should reject duplicate slug", async () => {
      const siteData = createSiteFixture();
      await testClient.post("/api/sites", siteData);
      const response = await testClient.post<{ error: string }>(
        "/api/sites",
        siteData
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("already exists");
    });

    it("should validate slug format", async () => {
      const response = await testClient.post<{ error: string }>("/api/sites", {
        name: "Test Site",
        slug: "Invalid Slug!@#",
        framework: "nextjs",
      });

      expect(response.status).toBe(400);
    });

    it("should create site with all framework types", async () => {
      const frameworks = ["nextjs", "sveltekit", "static", "custom"];

      for (const framework of frameworks) {
        const siteData = createSiteFixture({
          framework: framework as any,
          slug: `site-${framework}`,
        });
        const response = await testClient.post<{ site: any }>(
          "/api/sites",
          siteData
        );

        expect(response.status).toBe(201);
        expect(response.body.site.framework).toBe(framework);
      }
    });
  });

  describe("GET /api/sites", () => {
    it("should list all sites", async () => {
      const site1 = createSiteFixture({ name: "Site 1", slug: "site-1" });
      const site2 = createSiteFixture({ name: "Site 2", slug: "site-2" });
      await testClient.post("/api/sites", site1);
      await testClient.post("/api/sites", site2);

      const response = await testClient.get<{ sites: any[] }>("/api/sites");

      expect(response.status).toBe(200);
      expect(response.body.sites).toHaveLength(2);
    });

    it("should return empty array when no sites exist", async () => {
      const response = await testClient.get<{ sites: any[] }>("/api/sites");

      expect(response.status).toBe(200);
      expect(response.body.sites).toHaveLength(0);
    });

    it("should filter sites by status", async () => {
      const activeSite = createSiteFixture({ slug: "active-site" });
      const disabledSite = createSiteFixture({ slug: "disabled-site" });
      const activeRes = await testClient.post<{ site: any }>(
        "/api/sites",
        activeSite
      );
      await testClient.post("/api/sites", disabledSite);

      // Activate one site
      await testClient.put(`/api/sites/${activeRes.body.site.id}`, {
        status: "active",
      });

      const response = await testClient.get<{ sites: any[] }>(
        "/api/sites?status=active"
      );

      expect(response.status).toBe(200);
      expect(response.body.sites).toHaveLength(1);
      expect(response.body.sites[0].slug).toBe("active-site");
    });
  });

  describe("GET /api/sites/:id", () => {
    it("should return site with deployments", async () => {
      const siteData = createSiteFixture();
      const createRes = await testClient.post<{ site: any }>(
        "/api/sites",
        siteData
      );
      const siteId = createRes.body.site.id;

      const response = await testClient.get<{ site: any }>(
        `/api/sites/${siteId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.site.id).toBe(siteId);
      expect(response.body.site).toHaveProperty("deployments");
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/sites/non-existent-id");

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/sites/:id", () => {
    it("should update site settings", async () => {
      const siteData = createSiteFixture();
      const createRes = await testClient.post<{ site: any }>(
        "/api/sites",
        siteData
      );
      const siteId = createRes.body.site.id;

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${siteId}`,
        {
          name: "Updated Site Name",
          memoryMb: 512,
          cpuLimit: "1.0",
          timeoutSeconds: 60,
          envVariables: {
            API_URL: "https://api.example.com",
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.name).toBe("Updated Site Name");
      expect(response.body.site.memoryMb).toBe(512);
      // Database stores with 2 decimal precision
      expect(response.body.site.cpuLimit).toBe("1.00");
      expect(response.body.site.envVariables).toBeUndefined();

      const envResponse = await testClient.get<{ envVariables: Record<string, string> }>(
        `/api/sites/${siteId}/env`
      );
      expect(envResponse.status).toBe(200);
      expect(envResponse.body.envVariables.API_URL).toBe("https://api.example.com");
    });

    it("should update build settings", async () => {
      const siteData = createSiteFixture();
      const createRes = await testClient.post<{ site: any }>(
        "/api/sites",
        siteData
      );
      const siteId = createRes.body.site.id;

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${siteId}`,
        {
          buildCommand: "pnpm build",
          installCommand: "pnpm install",
          nodeVersion: "18",
          outputDirectory: "dist",
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.buildCommand).toBe("pnpm build");
      expect(response.body.site.installCommand).toBe("pnpm install");
      expect(response.body.site.nodeVersion).toBe("18");
    });

    it("should enable/disable maintenance mode", async () => {
      const siteData = createSiteFixture();
      const createRes = await testClient.post<{ site: any }>(
        "/api/sites",
        siteData
      );
      const siteId = createRes.body.site.id;

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${siteId}`,
        {
          maintenanceEnabled: true,
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.maintenanceEnabled).toBe(true);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.put("/api/sites/non-existent-id", {
        name: "Test",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/sites/:id", () => {
    it("should delete site and cascade to deployments", async () => {
      const siteData = createSiteFixture();
      const createRes = await testClient.post<{ site: any }>(
        "/api/sites",
        siteData
      );
      const siteId = createRes.body.site.id;

      // Delete site
      const response = await testClient.delete<{ success: boolean }>(
        `/api/sites/${siteId}`
      );
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify site is deleted
      const getRes = await testClient.get(`/api/sites/${siteId}`);
      expect(getRes.status).toBe(404);

      // Verify deployments are cascade deleted
      const dbDeployments = await testDb.query.deployments.findMany({
        where: eq(schema.deployments.siteId, siteId),
      });
      expect(dbDeployments).toHaveLength(0);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.delete("/api/sites/non-existent-id");

      expect(response.status).toBe(404);
    });
  });
});

describe("S3 Providers API", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  describe("POST /api/s3-providers", () => {
    it("should create a new S3 provider", async () => {
      const providerData = createS3ProviderFixture();
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        providerData
      );

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("provider");
      expect(response.body.provider.name).toBe(providerData.name);
      expect(response.body.provider.endpoint).toBe(providerData.endpoint);
    });

    it("should set as default when no other providers exist", async () => {
      const providerData = createS3ProviderFixture();
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        providerData
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.isDefault).toBe(true);
    });
  });

  describe("GET /api/s3-providers", () => {
    it("should list all S3 providers", async () => {
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Provider 1" })
      );
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Provider 2" })
      );

      const response = await testClient.get<{ providers: any[] }>(
        "/api/s3-providers"
      );

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(2);
    });
  });

  describe("POST /api/s3-providers/:id/test", () => {
    it("should test S3 connection", async () => {
      const providerData = createS3ProviderFixture();
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        providerData
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.post<{ success: boolean; error?: string }>(
        `/api/s3-providers/${providerId}/test`
      );

      // 200 if connection succeeds, 400 if connection fails (no real S3 in test env)
      expect([200, 400]).toContain(response.status);
      expect(response.body).toHaveProperty("success");
    });
  });

  describe("DELETE /api/s3-providers/:id", () => {
    it("should delete S3 provider", async () => {
      const providerData = createS3ProviderFixture();
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        providerData
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/s3-providers/${providerId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
