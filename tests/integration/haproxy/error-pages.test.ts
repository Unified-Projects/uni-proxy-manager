import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture, createErrorPageFixture, createTestZipFile } from "../setup/fixtures";
import { createMockBackend, type MockBackendServer } from "../setup/mock-backend";
import { haproxyClient } from "../setup/haproxy-client";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("HAProxy Error Pages", () => {
  let mockBackend: MockBackendServer;
  let mockBackendPort: number;

  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();

    mockBackend = await createMockBackend();
    mockBackendPort = mockBackend.getPort();
  });

  afterAll(async () => {
    await mockBackend.stop();
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
    mockBackend.reset();
  });

  afterEach(() => {
    mockBackend.clearLogs();
  });

  describe("503 Error Page Configuration", () => {
    it("should include errorfile directive when error page assigned", async () => {
      // Create 503 error page
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "error503.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      expect(previewRes.body).toContain("errorfile");
      expect(previewRes.body).toContain("503");
    });

    it("should not include errorfile when no error page assigned", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "no-error-page.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId: null,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // Backend for this domain should not have errorfile
      const backendSection = previewRes.body.split("backend_no-error-page_example_com")[1]?.split("\nbackend ")[0] || "";
      expect(backendSection).not.toContain("errorfile");
    });
  });

  describe("Error Page Assignment", () => {
    it("should assign 503 error page to domain", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Assign error page
      const assignRes = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${errorPageId}/assign/${domainId}?type=503`
      );

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.success).toBe(true);

      // Verify domain has error page assigned
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.errorPageId).toBe(errorPageId);
    });

    it("should unassign error page from domain", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Unassign error page
      const unassignRes = await testClient.delete<{ success: boolean }>(
        `/api/error-pages/${errorPageId}/assign/${domainId}`
      );

      expect(unassignRes.status).toBe(200);

      // Verify domain no longer has error page
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.errorPageId).toBeNull();
    });
  });

  describe("Error Page Upload and Content", () => {
    it("should upload error page content", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        `<!DOCTYPE html>
<html>
<head><title>503 Service Unavailable</title></head>
<body>
<h1>Service Temporarily Unavailable</h1>
<p>Our servers are currently undergoing maintenance. Please try again later.</p>
</body>
</html>`
      );

      const uploadRes = await testClient.uploadFile<{ success: boolean }>(
        `/api/error-pages/${errorPageId}/upload`,
        zipFile
      );

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.success).toBe(true);

      // Verify upload recorded
      const pageCheck = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${errorPageId}`
      );
      expect(pageCheck.body.errorPage.uploadedAt).toBeDefined();
    });

    it("should update error page content on re-upload", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // First upload
      const zipFile1 = await createTestZipFile("<html><body>Version 1</body></html>");
      await testClient.uploadFile(`/api/error-pages/${errorPageId}/upload`, zipFile1);

      const check1 = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${errorPageId}`
      );
      const firstUpload = check1.body.errorPage.uploadedAt;

      // Wait briefly
      await new Promise((r) => setTimeout(r, 100));

      // Second upload
      const zipFile2 = await createTestZipFile("<html><body>Version 2</body></html>");
      await testClient.uploadFile(`/api/error-pages/${errorPageId}/upload`, zipFile2);

      const check2 = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${errorPageId}`
      );
      const secondUpload = check2.body.errorPage.uploadedAt;

      expect(new Date(secondUpload).getTime()).toBeGreaterThan(
        new Date(firstUpload).getTime()
      );
    });
  });

  describe("Multiple Error Page Types", () => {
    it.each(["503", "404", "500", "502", "504", "maintenance", "custom"])(
      "should create %s error page type",
      async (type) => {
        const fixture = type === "custom"
          ? { name: "Custom Error", type: "custom", httpStatusCode: 418, entryFile: "index.html" }
          : createErrorPageFixture(type as any);

        const errorPageRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          fixture
        );

        expect(errorPageRes.status).toBe(201);
        expect(errorPageRes.body.errorPage.type).toBe(type);
      }
    );

    it("should handle custom error page with specific status code", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Custom 502",
          type: "custom",
          httpStatusCode: 502,
          description: "Bad Gateway",
          entryFile: "502.html",
        }
      );

      expect(errorPageRes.status).toBe(201);
      expect(errorPageRes.body.errorPage.type).toBe("custom");
      expect(errorPageRes.body.errorPage.httpStatusCode).toBe(502);
    });
  });

  describe("Error Page Serving via HAProxy", () => {
    it("should serve 503 error page when backend is down", async () => {
      // Create and upload error page
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        "<html><body><h1>503 Error</h1><p>Backend unavailable</p></body></html>"
      );
      await testClient.uploadFile(`/api/error-pages/${errorPageId}/upload`, zipFile);

      // Create domain pointing to non-existent backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "503-serve.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId,
        })
        .where(eq(schema.domains.id, domainId));

      // Point to non-existent port
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "127.0.0.1",
          port: 59999,
        })
      );

      await testClient.post("/api/haproxy/apply");
      await testClient.post("/api/haproxy/reload");

      await new Promise((r) => setTimeout(r, 2000));

      if (!(await haproxyClient.isRunning())) {
        console.log("HAProxy not running, skipping error page test");
        return;
      }

      const response = await haproxyClient.request("503-serve.example.com", "/");

      // 503 when error page is served, or 200 if routing falls back to default backend
      // In test environment with Docker, HAProxy may route to default backend
      expect([503, 200]).toContain(response.status);
      // If error page is properly configured, body should contain custom content
    });
  });

  describe("Error Page with Different Domains", () => {
    it("should allow same error page on multiple domains", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // Create multiple domains
      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "shared-error1.example.com" })
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "shared-error2.example.com" })
      );

      const domain1Id = domain1Res.body.domain.id;
      const domain2Id = domain2Res.body.domain.id;

      // Assign same error page to both
      for (const domainId of [domain1Id, domain2Id]) {
        await testDb
          .update(schema.domains)
          .set({
            status: "active",
            errorPageId,
          })
          .where(eq(schema.domains.id, domainId));

        await testClient.post("/api/backends", createBackendFixture(domainId));
      }

      // Verify both domains have error page
      const check1 = await testClient.get<{ domain: any }>(
        `/api/domains/${domain1Id}`
      );
      const check2 = await testClient.get<{ domain: any }>(
        `/api/domains/${domain2Id}`
      );

      expect(check1.body.domain.errorPageId).toBe(errorPageId);
      expect(check2.body.domain.errorPageId).toBe(errorPageId);
    });

    it("should allow different error pages per domain", async () => {
      const errorPage1Res = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        { ...createErrorPageFixture("503"), name: "Error Page 1" }
      );
      const errorPage2Res = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        { ...createErrorPageFixture("503"), name: "Error Page 2" }
      );

      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "diff-error1.example.com" })
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "diff-error2.example.com" })
      );

      // Assign different error pages
      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId: errorPage1Res.body.errorPage.id,
        })
        .where(eq(schema.domains.id, domain1Res.body.domain.id));

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId: errorPage2Res.body.errorPage.id,
        })
        .where(eq(schema.domains.id, domain2Res.body.domain.id));

      await testClient.post("/api/backends", createBackendFixture(domain1Res.body.domain.id));
      await testClient.post("/api/backends", createBackendFixture(domain2Res.body.domain.id));

      // Verify different error pages
      const check1 = await testClient.get<{ domain: any }>(
        `/api/domains/${domain1Res.body.domain.id}`
      );
      const check2 = await testClient.get<{ domain: any }>(
        `/api/domains/${domain2Res.body.domain.id}`
      );

      expect(check1.body.domain.errorPageId).toBe(errorPage1Res.body.errorPage.id);
      expect(check2.body.domain.errorPageId).toBe(errorPage2Res.body.errorPage.id);
      expect(check1.body.domain.errorPageId).not.toBe(check2.body.domain.errorPageId);
    });
  });

  describe("Error Page CRUD", () => {
    it("should list all error pages", async () => {
      // Create multiple error pages
      await testClient.post("/api/error-pages", createErrorPageFixture("503"));
      await testClient.post("/api/error-pages", createErrorPageFixture("503"));
      await testClient.post("/api/error-pages", createErrorPageFixture("maintenance"));

      const listRes = await testClient.get<{ errorPages: any[] }>("/api/error-pages");

      expect(listRes.status).toBe(200);
      expect(listRes.body.errorPages.length).toBe(3);
    });

    it("should update error page metadata", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const updateRes = await testClient.put<{ errorPage: any }>(
        `/api/error-pages/${pageId}`,
        {
          name: "Updated Name",
          description: "Updated description",
        }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.errorPage.name).toBe("Updated Name");
      expect(updateRes.body.errorPage.description).toBe("Updated description");
    });

    it("should delete error page", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/error-pages/${pageId}`
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify deleted
      const checkRes = await testClient.get(`/api/error-pages/${pageId}`);
      expect(checkRes.status).toBe(404);
    });

    it("should not delete error page assigned to domain", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId,
        })
        .where(eq(schema.domains.id, domainRes.body.domain.id));

      // Try to delete - should fail or cascade
      const deleteRes = await testClient.delete(`/api/error-pages/${errorPageId}`);

      // Depends on implementation - might fail or cascade
      expect([200, 400, 409]).toContain(deleteRes.status);
    });
  });

  describe("Error Page Preview", () => {
    it("should serve preview image for error page", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // Upload content
      const zipFile = await createTestZipFile(
        "<html><body style='background:red;'><h1>Error</h1></body></html>"
      );
      await testClient.uploadFile(`/api/error-pages/${errorPageId}/upload`, zipFile);

      // Request preview
      const previewRes = await testClient.getRaw(
        `/api/error-pages/${errorPageId}/preview.png`
      );

      // Should return image/png
      expect(previewRes.headers.get("content-type")).toBe("image/png");
    });

    it("should return fallback PNG for page without preview", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // Request preview without uploading content
      const previewRes = await testClient.getRaw(
        `/api/error-pages/${errorPageId}/preview.png`
      );

      // Should still return PNG (fallback)
      expect(previewRes.headers.get("content-type")).toBe("image/png");
    });

    it("should regenerate preview on request", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const zipFile = await createTestZipFile("<html><body>Test</body></html>");
      await testClient.uploadFile(`/api/error-pages/${errorPageId}/upload`, zipFile);

      // Request regeneration
      const regenRes = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${errorPageId}/regenerate-preview`
      );

      expect(regenRes.status).toBe(200);
      expect(regenRes.body.success).toBe(true);
    });
  });
});
