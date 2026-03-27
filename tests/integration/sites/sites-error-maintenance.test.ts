import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import {
  createSiteFixture,
  createErrorPageFixture,
  createMaintenancePageFixture,
} from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Sites - Error & Maintenance Page Assignment", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  // Helper to create an error page and return its ID
  async function createErrorPage(type: "503" | "404" | "500" | "maintenance" = "503") {
    const res = await testClient.post<{ errorPage: any }>(
      "/api/error-pages",
      createErrorPageFixture(type)
    );
    expect(res.status).toBe(201);
    return res.body.errorPage.id;
  }

  // Helper to create a maintenance page and return its ID
  async function createMaintenancePage() {
    const res = await testClient.post<{ errorPage: any }>(
      "/api/error-pages",
      createMaintenancePageFixture()
    );
    expect(res.status).toBe(201);
    return res.body.errorPage.id;
  }

  // Helper to create a site and return its ID
  async function createSite(overrides: Record<string, any> = {}) {
    const res = await testClient.post<{ site: any }>(
      "/api/sites",
      { ...createSiteFixture(), ...overrides }
    );
    expect(res.status).toBe(201);
    return res.body.site;
  }

  describe("Create site with page assignments", () => {
    it("should create site with errorPageId", async () => {
      const errorPageId = await createErrorPage("503");

      const siteData = createSiteFixture();
      const response = await testClient.post<{ site: any }>("/api/sites", {
        ...siteData,
        errorPageId,
      });

      expect(response.status).toBe(201);
      expect(response.body.site.errorPageId).toBe(errorPageId);
    });

    it("should create site with maintenancePageId", async () => {
      const maintenancePageId = await createMaintenancePage();

      const siteData = createSiteFixture();
      const response = await testClient.post<{ site: any }>("/api/sites", {
        ...siteData,
        maintenancePageId,
      });

      expect(response.status).toBe(201);
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);
    });

    it("should create site with both errorPageId and maintenancePageId", async () => {
      const errorPageId = await createErrorPage("503");
      const maintenancePageId = await createMaintenancePage();

      const siteData = createSiteFixture();
      const response = await testClient.post<{ site: any }>("/api/sites", {
        ...siteData,
        errorPageId,
        maintenancePageId,
      });

      expect(response.status).toBe(201);
      expect(response.body.site.errorPageId).toBe(errorPageId);
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);
    });

    it("should create site with maintenanceEnabled set to true", async () => {
      const maintenancePageId = await createMaintenancePage();

      const siteData = createSiteFixture();
      const response = await testClient.post<{ site: any }>("/api/sites", {
        ...siteData,
        maintenancePageId,
        maintenanceEnabled: true,
      });

      expect(response.status).toBe(201);
      expect(response.body.site.maintenanceEnabled).toBe(true);
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);
    });
  });

  describe("Update site page assignments", () => {
    it("should assign errorPageId via update", async () => {
      const site = await createSite();
      const errorPageId = await createErrorPage("503");

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { errorPageId }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.errorPageId).toBe(errorPageId);

      // Verify via GET
      const getRes = await testClient.get<{ site: any }>(`/api/sites/${site.id}`);
      expect(getRes.body.site.errorPageId).toBe(errorPageId);
    });

    it("should assign maintenancePageId via update", async () => {
      const site = await createSite();
      const maintenancePageId = await createMaintenancePage();

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenancePageId }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);

      // Verify via GET
      const getRes = await testClient.get<{ site: any }>(`/api/sites/${site.id}`);
      expect(getRes.body.site.maintenancePageId).toBe(maintenancePageId);
    });

    it("should swap errorPageId to a different error page", async () => {
      const errorPage1 = await createErrorPage("503");
      const errorPage2 = await createErrorPage("500");
      const site = await createSite({ errorPageId: errorPage1 });

      expect(site.errorPageId).toBe(errorPage1);

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { errorPageId: errorPage2 }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.errorPageId).toBe(errorPage2);
    });

    it("should assign different error page types (404, 500, 502, 504)", async () => {
      const errorTypes = ["404", "500", "502", "504"] as const;

      for (const type of errorTypes) {
        const errorPageId = await createErrorPage(type as any);
        const site = await createSite();

        const response = await testClient.put<{ site: any }>(
          `/api/sites/${site.id}`,
          { errorPageId }
        );

        expect(response.status).toBe(200);
        expect(response.body.site.errorPageId).toBe(errorPageId);
      }
    });
  });

  describe("Toggle maintenance mode on sites", () => {
    it("should enable maintenanceEnabled on site with maintenancePageId", async () => {
      const maintenancePageId = await createMaintenancePage();
      const site = await createSite({ maintenancePageId });

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenanceEnabled: true }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.maintenanceEnabled).toBe(true);
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);
    });

    it("should enable maintenanceEnabled without maintenancePageId", async () => {
      const site = await createSite();

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenanceEnabled: true }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.maintenanceEnabled).toBe(true);
    });

    it("should disable maintenanceEnabled", async () => {
      const maintenancePageId = await createMaintenancePage();
      const site = await createSite({
        maintenancePageId,
        maintenanceEnabled: true,
      });

      const response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenanceEnabled: false }
      );

      expect(response.status).toBe(200);
      expect(response.body.site.maintenanceEnabled).toBe(false);
      // maintenancePageId should remain assigned even when mode is disabled
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);
    });

    it("should toggle maintenance mode back and forth", async () => {
      const site = await createSite();

      // Enable
      let response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenanceEnabled: true }
      );
      expect(response.body.site.maintenanceEnabled).toBe(true);

      // Disable
      response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenanceEnabled: false }
      );
      expect(response.body.site.maintenanceEnabled).toBe(false);

      // Re-enable
      response = await testClient.put<{ site: any }>(
        `/api/sites/${site.id}`,
        { maintenanceEnabled: true }
      );
      expect(response.body.site.maintenanceEnabled).toBe(true);
    });
  });

  describe("GET site includes page assignments", () => {
    it("should return errorPageId and maintenancePageId in GET response", async () => {
      const errorPageId = await createErrorPage("503");
      const maintenancePageId = await createMaintenancePage();

      const site = await createSite({
        errorPageId,
        maintenancePageId,
        maintenanceEnabled: true,
      });

      const response = await testClient.get<{ site: any }>(
        `/api/sites/${site.id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.site.errorPageId).toBe(errorPageId);
      expect(response.body.site.maintenancePageId).toBe(maintenancePageId);
      expect(response.body.site.maintenanceEnabled).toBe(true);
    });

    it("should return null page IDs for site without assignments", async () => {
      const site = await createSite();

      const response = await testClient.get<{ site: any }>(
        `/api/sites/${site.id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.site.errorPageId).toBeNull();
      expect(response.body.site.maintenancePageId).toBeNull();
      expect(response.body.site.maintenanceEnabled).toBe(false);
    });

    it("should include page assignments in sites list", async () => {
      const errorPageId = await createErrorPage("503");

      const siteData = createSiteFixture();
      await testClient.post("/api/sites", {
        ...siteData,
        errorPageId,
      });

      const response = await testClient.get<{ sites: any[] }>("/api/sites");

      expect(response.status).toBe(200);
      expect(response.body.sites).toHaveLength(1);
      expect(response.body.sites[0].errorPageId).toBe(errorPageId);
    });
  });

  describe("Database persistence", () => {
    it("should persist error page assignment in database", async () => {
      const errorPageId = await createErrorPage("503");
      const site = await createSite({ errorPageId });

      const dbSite = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, site.id),
      });

      expect(dbSite).toBeDefined();
      expect(dbSite!.errorPageId).toBe(errorPageId);
    });

    it("should persist maintenance page assignment in database", async () => {
      const maintenancePageId = await createMaintenancePage();
      const site = await createSite({
        maintenancePageId,
        maintenanceEnabled: true,
      });

      const dbSite = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, site.id),
      });

      expect(dbSite).toBeDefined();
      expect(dbSite!.maintenancePageId).toBe(maintenancePageId);
      expect(dbSite!.maintenanceEnabled).toBe(true);
    });

    it("should persist updated page assignments in database", async () => {
      const site = await createSite();
      const errorPageId = await createErrorPage("404");

      await testClient.put(`/api/sites/${site.id}`, { errorPageId });

      const dbSite = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, site.id),
      });

      expect(dbSite).toBeDefined();
      expect(dbSite!.errorPageId).toBe(errorPageId);
    });
  });

  describe("Site deletion with page assignments", () => {
    it("should delete site that has error and maintenance pages assigned", async () => {
      const errorPageId = await createErrorPage("503");
      const maintenancePageId = await createMaintenancePage();
      const site = await createSite({
        errorPageId,
        maintenancePageId,
        maintenanceEnabled: true,
      });

      const response = await testClient.delete<{ success: boolean }>(
        `/api/sites/${site.id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify site is deleted
      const getRes = await testClient.get(`/api/sites/${site.id}`);
      expect(getRes.status).toBe(404);

      // Error pages should still exist (not cascade deleted)
      const errorPageRes = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${errorPageId}`
      );
      expect(errorPageRes.status).toBe(200);

      const maintenancePageRes = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${maintenancePageId}`
      );
      expect(maintenancePageRes.status).toBe(200);
    });
  });
});
