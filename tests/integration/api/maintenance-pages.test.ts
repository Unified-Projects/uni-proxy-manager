import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import {
  createMaintenancePageFixture,
  createTestZipFile,
  createDomainFixture,
} from "../setup/fixtures";
import { checkPlaywrightAvailable } from "../setup/playwright-check";
import { readFile } from "fs/promises";
import { join } from "path";

let playwrightAvailable = false;

describe("Maintenance Pages API", () => {
  beforeAll(async () => {
    await clearDatabase();
    playwrightAvailable = await checkPlaywrightAvailable();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("POST /api/error-pages (maintenance type)", () => {
    it("should create maintenance page", async () => {
      const pageData = createMaintenancePageFixture();
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData,
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.name).toBe(pageData.name);
      expect(response.body.errorPage.type).toBe("maintenance");
      expect(response.body.errorPage.directoryPath).toBeDefined();
    });

    it("should create maintenance page with description", async () => {
      const pageData = {
        ...createMaintenancePageFixture(),
        description: "Scheduled maintenance window page",
      };
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData,
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.description).toBe(pageData.description);
    });
  });

  describe("GET /api/error-pages (maintenance filtering)", () => {
    it("should list maintenance pages with other error pages", async () => {
      // Create both error and maintenance pages
      await testClient.post("/api/error-pages", {
        name: "503 Error",
        type: "503",
      });
      await testClient.post("/api/error-pages", {
        name: "Maintenance 1",
        type: "maintenance",
      });
      await testClient.post("/api/error-pages", {
        name: "404 Error",
        type: "404",
      });

      const response = await testClient.get<{ errorPages: any[] }>(
        "/api/error-pages",
      );

      expect(response.status).toBe(200);
      expect(response.body.errorPages).toHaveLength(3);
    });
  });

  describe("POST /api/error-pages/:id/upload (maintenance page)", () => {
    it("should upload ZIP file for maintenance page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = createRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        '<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Under Maintenance</h1></body></html>',
      );
      const response = await testClient.uploadFile<{
        success: boolean;
        errorPage: any;
      }>(`/api/error-pages/${pageId}/upload`, zipFile);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.errorPage.uploadedAt).toBeDefined();
      expect(response.body.errorPage.fileSize).toBeGreaterThan(0);

      const compiledResponse = await readFile(
        join(createRes.body.errorPage.directoryPath, "maintenance.http"),
        "utf-8",
      );
      expect(compiledResponse).toContain("HTTP/1.0 503 Service Unavailable");
      expect(compiledResponse).toContain("body { color: red; }");
      expect(compiledResponse).not.toContain('href="style.css"');
    });

    it.skipIf(!playwrightAvailable)(
      "should auto-generate preview on upload",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createMaintenancePageFixture(),
        );
        const pageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body><h1>Under Maintenance</h1></body></html>",
        );
        const response = await testClient.uploadFile<{
          success: boolean;
          errorPage: any;
        }>(`/api/error-pages/${pageId}/upload`, zipFile);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.errorPage.previewImagePath).toBeDefined();
        expect(response.body.errorPage.previewImagePath).toContain(
          "preview.png",
        );
      },
    );
  });

  describe("POST /api/error-pages/:id/assign/:domainId (maintenance)", () => {
    it("should assign maintenance page to domain", async () => {
      const pageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = pageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      const response = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${pageId}/assign/${domainId}?type=maintenance`,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify domain was updated
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(domainCheck.body.domain.maintenancePageId).toBe(pageId);
    });

    it("should update config version when assigning maintenance page", async () => {
      const pageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = pageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;
      const initialVersion = domainRes.body.domain.configVersion;

      await testClient.post(
        `/api/error-pages/${pageId}/assign/${domainId}?type=maintenance`,
      );

      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(domainCheck.body.domain.configVersion).toBeGreaterThan(
        initialVersion,
      );
    });
  });

  describe("PUT /api/error-pages/:id (maintenance page)", () => {
    it("should update maintenance page metadata", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.put<{ errorPage: any }>(
        `/api/error-pages/${pageId}`,
        {
          name: "Updated Maintenance Page",
          description: "Now with better messaging",
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.errorPage.name).toBe("Updated Maintenance Page");
      expect(response.body.errorPage.description).toBe(
        "Now with better messaging",
      );
    });
  });

  describe("DELETE /api/error-pages/:id (maintenance page)", () => {
    it("should delete maintenance page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/error-pages/${pageId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const getRes = await testClient.get(`/api/error-pages/${pageId}`);
      expect(getRes.status).toBe(404);
    });

    it("should clean up files when deleting maintenance page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = createRes.body.errorPage.id;

      // Upload files
      const zipFile = await createTestZipFile(
        "<html><body>Maintenance</body></html>",
      );
      await testClient.uploadFile(`/api/error-pages/${pageId}/upload`, zipFile);

      // Delete
      const response = await testClient.delete<{ success: boolean }>(
        `/api/error-pages/${pageId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe("POST /api/error-pages/:id/regenerate-preview (maintenance)", () => {
    it.skipIf(!playwrightAvailable)(
      "should regenerate preview for maintenance page",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createMaintenancePageFixture(),
        );
        const pageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body><h1>Under Maintenance</h1></body></html>",
        );
        await testClient.uploadFile(
          `/api/error-pages/${pageId}/upload`,
          zipFile,
        );

        const response = await testClient.post<{
          success: boolean;
          errorPage: any;
        }>(`/api/error-pages/${pageId}/regenerate-preview`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.errorPage.previewImagePath).toBeDefined();
        expect(response.body.errorPage.previewImagePath).toContain(
          "preview.png",
        );
      },
    );

    it("should fail without uploaded files", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.post(
        `/api/error-pages/${pageId}/regenerate-preview`,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/error-pages/:id/download (maintenance)", () => {
    it("should download maintenance page files as ZIP", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture(),
      );
      const pageId = createRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        "<html><body>Maintenance</body></html>",
      );
      await testClient.uploadFile(`/api/error-pages/${pageId}/upload`, zipFile);

      const response = await testClient.get(
        `/api/error-pages/${pageId}/download`,
      );

      expect(response.status).toBe(200);
    });
  });
});
