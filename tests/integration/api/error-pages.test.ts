import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import {
  createErrorPageFixture,
  createTestZipFile,
  createDomainFixture,
} from "../setup/fixtures";
import { checkPlaywrightAvailable } from "../setup/playwright-check";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

let playwrightAvailable = false;

describe("Error Pages API", () => {
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

  describe("POST /api/error-pages", () => {
    it("should create 503 error page", async () => {
      const pageData = createErrorPageFixture("503");
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.name).toBe(pageData.name);
      expect(response.body.errorPage.type).toBe("503");
      expect(response.body.errorPage.directoryPath).toBeDefined();
    });

    it("should create 404 error page", async () => {
      const pageData = createErrorPageFixture("404");
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.type).toBe("404");
    });

    it("should create 500 error page", async () => {
      const pageData = createErrorPageFixture("500");
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.type).toBe("500");
    });

    it("should create 502 error page", async () => {
      const pageData = createErrorPageFixture("502");
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.type).toBe("502");
    });

    it("should create 504 error page", async () => {
      const pageData = createErrorPageFixture("504");
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.type).toBe("504");
    });

    it("should create maintenance page", async () => {
      const pageData = createErrorPageFixture("maintenance");
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.type).toBe("maintenance");
    });

    it("should create custom error page with status code", async () => {
      const pageData = {
        ...createErrorPageFixture("custom"),
        httpStatusCode: 418,
      };
      const response = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        pageData
      );

      expect(response.status).toBe(201);
      expect(response.body.errorPage.type).toBe("custom");
      expect(response.body.errorPage.httpStatusCode).toBe(418);
    });

    it("should validate httpStatusCode range for custom type", async () => {
      const response = await testClient.post<{ error: string }>(
        "/api/error-pages",
        {
          name: "Invalid",
          type: "custom",
          httpStatusCode: 999,
        }
      );

      expect(response.status).toBe(400);
    });

    it("should validate httpStatusCode minimum for custom type", async () => {
      const response = await testClient.post<{ error: string }>(
        "/api/error-pages",
        {
          name: "Invalid",
          type: "custom",
          httpStatusCode: 99,
        }
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/error-pages", () => {
    it("should list all error pages", async () => {
      await testClient.post("/api/error-pages", createErrorPageFixture("503"));
      await testClient.post(
        "/api/error-pages",
        createErrorPageFixture("maintenance")
      );

      const response = await testClient.get<{ errorPages: any[] }>(
        "/api/error-pages"
      );

      expect(response.status).toBe(200);
      expect(response.body.errorPages).toHaveLength(2);
    });

    it("should return empty array when no error pages exist", async () => {
      const response = await testClient.get<{ errorPages: any[] }>(
        "/api/error-pages"
      );

      expect(response.status).toBe(200);
      expect(response.body.errorPages).toHaveLength(0);
    });
  });

  describe("GET /api/error-pages/:id", () => {
    it("should return a single error page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${pageId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.errorPage.id).toBe(pageId);
    });

    it("should return 404 for non-existent error page", async () => {
      const response = await testClient.get("/api/error-pages/non-existent-id");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/error-pages/:id/upload", () => {
    it("should upload ZIP file for error page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        "<html><body>Service Unavailable</body></html>"
      );
      const response = await testClient.uploadFile<{ success: boolean }>(
        `/api/error-pages/${pageId}/upload`,
        zipFile
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify metadata was updated
      const getRes = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${pageId}`
      );
      expect(getRes.body.errorPage.originalZipName).toBe("error-page.zip");
      expect(getRes.body.errorPage.uploadedAt).toBeDefined();
    });

    it("should return 404 for non-existent error page", async () => {
      const zipFile = await createTestZipFile();
      const response = await testClient.uploadFile(
        "/api/error-pages/non-existent-id/upload",
        zipFile
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/error-pages/:id", () => {
    it("should update error page metadata", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.put<{ errorPage: any }>(
        `/api/error-pages/${pageId}`,
        {
          name: "Updated Error Page",
          description: "Updated description",
          entryFile: "error.html",
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.errorPage.name).toBe("Updated Error Page");
      expect(response.body.errorPage.description).toBe("Updated description");
      expect(response.body.errorPage.entryFile).toBe("error.html");
    });

    it("should return 404 for non-existent error page", async () => {
      const response = await testClient.put("/api/error-pages/non-existent-id", {
        name: "Test",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/error-pages/:id/assign/:domainId", () => {
    it("should assign 503 error page to domain", async () => {
      const pageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = pageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const response = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${pageId}/assign/${domainId}?type=503`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify domain was updated
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.errorPageId).toBe(pageId);
      expect(domainCheck.body.domain.configVersion).toBeGreaterThan(0);
    });

    it("should assign maintenance page to domain", async () => {
      const pageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance")
      );
      const pageId = pageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const response = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${pageId}/assign/${domainId}?type=maintenance`
      );

      expect(response.status).toBe(200);

      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.maintenancePageId).toBe(pageId);
    });

    it("should return 404 for non-existent error page", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const response = await testClient.post(
        `/api/error-pages/non-existent-id/assign/${domainId}?type=503`
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for non-existent domain", async () => {
      const pageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = pageRes.body.errorPage.id;

      const response = await testClient.post(
        `/api/error-pages/${pageId}/assign/non-existent-id?type=503`
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/error-pages/:id", () => {
    it("should delete error page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/error-pages/${pageId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const getRes = await testClient.get(`/api/error-pages/${pageId}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent error page", async () => {
      const response = await testClient.delete(
        "/api/error-pages/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/error-pages/:id/regenerate-preview", () => {
    it.skipIf(!playwrightAvailable)(
      "should regenerate preview after upload",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        const pageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body>Service Unavailable</body></html>"
        );
        await testClient.uploadFile(
          `/api/error-pages/${pageId}/upload`,
          zipFile
        );

        const response = await testClient.post<{ success: boolean; errorPage: any }>(
          `/api/error-pages/${pageId}/regenerate-preview`
        );

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.errorPage.previewImagePath).toBeDefined();
        expect(response.body.errorPage.previewImagePath).toContain("preview.png");
      }
    );

    it("should fail to regenerate preview without upload", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.post(
        `/api/error-pages/${pageId}/regenerate-preview`
      );

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent error page", async () => {
      const response = await testClient.post(
        "/api/error-pages/non-existent-id/regenerate-preview"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/error-pages/:id/preview.png", () => {
    it.skipIf(!playwrightAvailable)(
      "should return 200 with valid PNG preview for uploaded page",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        const pageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body>Service Unavailable</body></html>"
        );
        await testClient.uploadFile(
          `/api/error-pages/${pageId}/upload`,
          zipFile
        );

        const response = await testClient.getRaw(
          `/api/error-pages/${pageId}/preview.png`
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");

        // Verify valid PNG content
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        expect(bytes[0]).toBe(0x89);
        expect(bytes[1]).toBe(0x50);
        expect(bytes[2]).toBe(0x4e);
        expect(bytes[3]).toBe(0x47);
      }
    );

    it("should return transparent PNG with 404 status for page without preview", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.getRaw(
        `/api/error-pages/${pageId}/preview.png`
      );

      // Should return 404 with valid PNG image (not JSON error)
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("image/png");

      // Verify it's a valid PNG (starts with PNG magic bytes)
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // PNG magic bytes: 89 50 4E 47
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50); // P
      expect(bytes[2]).toBe(0x4E); // N
      expect(bytes[3]).toBe(0x47); // G
    });

    it("should return transparent PNG for non-existent error page", async () => {
      const response = await testClient.getRaw(
        "/api/error-pages/non-existent-id/preview.png"
      );

      // Should return 404 with valid PNG (not JSON error)
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("image/png");
    });
  });

  describe("GET /api/error-pages/:id/download", () => {
    it("should download error page as ZIP", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        "<html><body>Service Unavailable</body></html>"
      );
      await testClient.uploadFile(
        `/api/error-pages/${pageId}/upload`,
        zipFile
      );

      const response = await testClient.get(
        `/api/error-pages/${pageId}/download`
      );

      expect(response.status).toBe(200);
    });

    it("should return 400 for page without upload", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const response = await testClient.get(
        `/api/error-pages/${pageId}/download`
      );

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent error page", async () => {
      const response = await testClient.get(
        "/api/error-pages/non-existent-id/download"
      );

      expect(response.status).toBe(404);
    });
  });
});
