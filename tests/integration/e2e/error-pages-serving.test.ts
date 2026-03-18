import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import {
  createDomainFixture,
  createBackendFixture,
  createErrorPageFixture,
  createTestZipFile,
} from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Error Pages Serving E2E", () => {
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

  describe("503 Error Page Assignment", () => {
    it("should assign 503 error page to domain and reflect in config", async () => {
      // Create 503 error page
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Service Unavailable",
          type: "503",
          description: "Custom 503 page",
          entryFile: "index.html",
        }
      );
      expect(errorPageRes.status).toBe(201);
      const errorPageId = errorPageRes.body.errorPage.id;

      // Upload ZIP file
      const zipFile = await createTestZipFile(
        `<!DOCTYPE html>
<html>
<head><title>503 Service Unavailable</title></head>
<body>
<h1>Service Temporarily Unavailable</h1>
<p>Please try again later.</p>
</body>
</html>`
      );
      const uploadRes = await testClient.uploadFile<{ success: boolean }>(
        `/api/error-pages/${errorPageId}/upload`,
        zipFile
      );
      expect(uploadRes.status).toBe(200);

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "503-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Activate domain
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Add backend
      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Assign 503 page
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

      // Verify config reflects error page
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );
      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("503-test.example.com");
    });

    it("should handle multiple domains with different error pages", async () => {
      // Create two different error pages
      const errorPage1Res = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Error Page 1",
          type: "503",
          description: "First error page",
        }
      );
      const errorPage2Res = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Error Page 2",
          type: "503",
          description: "Second error page",
        }
      );

      // Create two domains
      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "domain1-error.example.com" })
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "domain2-error.example.com" })
      );

      const domain1Id = domain1Res.body.domain.id;
      const domain2Id = domain2Res.body.domain.id;

      // Activate both
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domain1Id));
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domain2Id));

      // Add backends
      await testClient.post("/api/backends", createBackendFixture(domain1Id));
      await testClient.post("/api/backends", createBackendFixture(domain2Id));

      // Assign different error pages
      await testClient.post(
        `/api/error-pages/${errorPage1Res.body.errorPage.id}/assign/${domain1Id}?type=503`
      );
      await testClient.post(
        `/api/error-pages/${errorPage2Res.body.errorPage.id}/assign/${domain2Id}?type=503`
      );

      // Verify both domains have different error pages
      const check1 = await testClient.get<{ domain: any }>(
        `/api/domains/${domain1Id}`
      );
      const check2 = await testClient.get<{ domain: any }>(
        `/api/domains/${domain2Id}`
      );

      expect(check1.body.domain.errorPageId).toBe(
        errorPage1Res.body.errorPage.id
      );
      expect(check2.body.domain.errorPageId).toBe(
        errorPage2Res.body.errorPage.id
      );
      expect(check1.body.domain.errorPageId).not.toBe(
        check2.body.domain.errorPageId
      );
    });
  });

  describe("Maintenance Page Assignment", () => {
    it("should assign maintenance page and enable maintenance mode", async () => {
      // Create maintenance page
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Under Maintenance",
          type: "maintenance",
          description: "Maintenance page",
          entryFile: "index.html",
        }
      );
      const maintPageId = maintPageRes.body.errorPage.id;

      // Upload maintenance page content
      const zipFile = await createTestZipFile(
        `<!DOCTYPE html>
<html>
<head><title>Under Maintenance</title></head>
<body>
<h1>We're Currently Under Maintenance</h1>
<p>We'll be back shortly. Thank you for your patience.</p>
</body>
</html>`
      );
      await testClient.uploadFile(
        `/api/error-pages/${maintPageId}/upload`,
        zipFile
      );

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maint-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Activate domain
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Add backend
      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Assign maintenance page
      await testClient.post(
        `/api/error-pages/${maintPageId}/assign/${domainId}?type=maintenance`
      );

      // Enable maintenance mode
      const enableRes = await testClient.post<{
        success: boolean;
        maintenanceWindowId: string;
      }>(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Scheduled update",
        bypassIps: ["10.0.0.1"],
      });
      expect(enableRes.status).toBe(200);

      // Verify domain state
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.maintenancePageId).toBe(maintPageId);
      expect(domainCheck.body.domain.maintenanceEnabled).toBe(true);
      expect(domainCheck.body.domain.maintenanceBypassIps).toContain("10.0.0.1");

      // Verify config includes maintenance settings
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );
      expect(configRes.body).toContain("maint-test.example.com");
      expect(configRes.body).toContain("10.0.0.1");
    });

    it("should toggle maintenance mode on and off", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "toggle-maint.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Activate
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Enable maintenance
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Test",
      });

      let check = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(check.body.domain.maintenanceEnabled).toBe(true);

      // Disable maintenance
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

      check = await testClient.get<{ domain: any }>(`/api/domains/${domainId}`);
      expect(check.body.domain.maintenanceEnabled).toBe(false);

      // Enable again
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Another test",
      });

      check = await testClient.get<{ domain: any }>(`/api/domains/${domainId}`);
      expect(check.body.domain.maintenanceEnabled).toBe(true);
    });
  });

  describe("Custom Error Pages", () => {
    it("should create custom error page with specific status code", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Bad Gateway",
          type: "custom",
          httpStatusCode: 502,
          description: "Custom 502 error",
          entryFile: "502.html",
        }
      );

      expect(errorPageRes.status).toBe(201);
      expect(errorPageRes.body.errorPage.type).toBe("custom");
      expect(errorPageRes.body.errorPage.httpStatusCode).toBe(502);

      // Upload custom content
      const zipFile = await createTestZipFile(
        `<!DOCTYPE html>
<html>
<head><title>502 Bad Gateway</title></head>
<body>
<h1>Bad Gateway</h1>
<p>The server received an invalid response.</p>
</body>
</html>`
      );
      await testClient.uploadFile(
        `/api/error-pages/${errorPageRes.body.errorPage.id}/upload`,
        zipFile
      );

      // Verify upload
      const checkRes = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${errorPageRes.body.errorPage.id}`
      );
      expect(checkRes.body.errorPage.uploadedAt).toBeDefined();
      expect(checkRes.body.errorPage.originalZipName).toBe("error-page.zip");
    });

    it("should list error pages by type", async () => {
      // Create various error pages
      await testClient.post("/api/error-pages", createErrorPageFixture("503"));
      await testClient.post("/api/error-pages", createErrorPageFixture("503"));
      await testClient.post(
        "/api/error-pages",
        createErrorPageFixture("maintenance")
      );
      await testClient.post("/api/error-pages", {
        name: "Custom 500",
        type: "custom",
        httpStatusCode: 500,
      });

      // List all
      const allRes = await testClient.get<{ errorPages: any[] }>(
        "/api/error-pages"
      );
      expect(allRes.body.errorPages).toHaveLength(4);

      // Count by type
      const pages503 = allRes.body.errorPages.filter(
        (p: any) => p.type === "503"
      );
      const pagesMaint = allRes.body.errorPages.filter(
        (p: any) => p.type === "maintenance"
      );
      const pagesCustom = allRes.body.errorPages.filter(
        (p: any) => p.type === "custom"
      );

      expect(pages503).toHaveLength(2);
      expect(pagesMaint).toHaveLength(1);
      expect(pagesCustom).toHaveLength(1);
    });
  });

  describe("Error Page Updates", () => {
    it("should update error page metadata", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      const updateRes = await testClient.put<{ errorPage: any }>(
        `/api/error-pages/${pageId}`,
        {
          name: "Updated Error Page Name",
          description: "Updated description",
          entryFile: "error.html",
        }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.errorPage.name).toBe("Updated Error Page Name");
      expect(updateRes.body.errorPage.description).toBe("Updated description");
      expect(updateRes.body.errorPage.entryFile).toBe("error.html");
    });

    it("should delete error page and cleanup", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const pageId = createRes.body.errorPage.id;

      // Delete
      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/error-pages/${pageId}`
      );
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify deleted
      const checkRes = await testClient.get(`/api/error-pages/${pageId}`);
      expect(checkRes.status).toBe(404);
    });
  });
});
