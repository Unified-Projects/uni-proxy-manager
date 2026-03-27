import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import { closeBrowser } from "../../../apps/api/src/services/preview-generator";
import { checkPlaywrightAvailable } from "../setup/playwright-check";
import {
  createErrorPageFixture,
  createMaintenancePageFixture,
  createTestZipFile,
  createDomainFixture,
  createSiteFixture,
} from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import { access, readFile } from "fs/promises";
import { join } from "path";
import { getErrorPagesDir } from "@uni-proxy-manager/shared/config";

let playwrightAvailable = false;

describe("Error & Maintenance Page Flows", () => {
  const errorPagesDir = getErrorPagesDir();

  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();
    playwrightAvailable = await checkPlaywrightAvailable();
  });

  afterAll(async () => {
    await closeBrowser();
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  describe("Error Page Full Lifecycle", () => {
    it.skipIf(!playwrightAvailable)(
      "should complete full error page lifecycle: create, upload, preview, assign, unassign, delete",
      async () => {
        // Step 1: Create error page
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        expect(createRes.status).toBe(201);
        const pageId = createRes.body.errorPage.id;
        expect(pageId).toBeDefined();
        expect(createRes.body.errorPage.type).toBe("503");

        // Step 2: Upload HTML content
        const zipFile = await createTestZipFile(
          "<html><body style='background:#e74c3c;color:white;text-align:center;padding:50px;'><h1>503 Service Unavailable</h1><p>We are currently performing maintenance.</p></body></html>"
        );
        const uploadRes = await testClient.uploadFile<{ success: boolean; errorPage: any }>(
          `/api/error-pages/${pageId}/upload`,
          zipFile
        );
        expect(uploadRes.status).toBe(200);
        expect(uploadRes.body.success).toBe(true);
        expect(uploadRes.body.errorPage.uploadedAt).toBeDefined();
        expect(uploadRes.body.errorPage.previewImagePath).toBeDefined();
        expect(uploadRes.body.errorPage.previewImagePath).toContain("preview.png");

        // Step 3: Verify preview file on disk
        const previewPath = join(errorPagesDir, pageId, "preview.png");
        await access(previewPath);
        const previewFile = await readFile(previewPath);
        expect(previewFile.length).toBeGreaterThan(100); // A real PNG is much larger than 100 bytes
        expect(previewFile[0]).toBe(0x89);
        expect(previewFile[1]).toBe(0x50);
        expect(previewFile[2]).toBe(0x4e);
        expect(previewFile[3]).toBe(0x47);

        // Step 4: Serve preview via API
        const previewRes = await testClient.getRaw(`/api/error-pages/${pageId}/preview.png`);
        expect(previewRes.status).toBe(200);
        expect(previewRes.headers.get("content-type")).toBe("image/png");

        // Step 5: Regenerate preview
        const regenRes = await testClient.post<{ success: boolean; errorPage: any }>(
          `/api/error-pages/${pageId}/regenerate-preview`
        );
        expect(regenRes.status).toBe(200);
        expect(regenRes.body.success).toBe(true);
        expect(regenRes.body.errorPage.previewImagePath).toContain("preview.png");

        // Step 6: Create domain and assign error page
        const domainRes = await testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture()
        );
        expect(domainRes.status).toBe(201);
        const domainId = domainRes.body.domain.id;

        const assignRes = await testClient.post<{ success: boolean }>(
          `/api/error-pages/${pageId}/assign/${domainId}?type=503`
        );
        expect(assignRes.status).toBe(200);
        expect(assignRes.body.success).toBe(true);

        // Verify domain has error page assigned
        const domainCheck = await testClient.get<{ domain: any }>(
          `/api/domains/${domainId}`
        );
        expect(domainCheck.body.domain.errorPageId).toBe(pageId);
        expect(domainCheck.body.domain.configVersion).toBeGreaterThan(0);

        // Step 7: Unassign error page
        const unassignRes = await testClient.delete<{ success: boolean }>(
          `/api/error-pages/${pageId}/assign/${domainId}?type=503`
        );
        expect(unassignRes.status).toBe(200);

        const domainAfterUnassign = await testClient.get<{ domain: any }>(
          `/api/domains/${domainId}`
        );
        expect(domainAfterUnassign.body.domain.errorPageId).toBeNull();

        // Step 8: Delete error page
        const deleteRes = await testClient.delete<{ success: boolean }>(
          `/api/error-pages/${pageId}`
        );
        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.success).toBe(true);

        // Verify page is gone
        const getAfterDelete = await testClient.get(`/api/error-pages/${pageId}`);
        expect(getAfterDelete.status).toBe(404);
      }
    );
  });

  describe("Maintenance Page Full Lifecycle", () => {
    it.skipIf(!playwrightAvailable)(
      "should complete full maintenance page lifecycle: create, upload, preview, assign, enable/disable, delete",
      async () => {
        // Step 1: Create maintenance page
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createMaintenancePageFixture()
        );
        expect(createRes.status).toBe(201);
        const pageId = createRes.body.errorPage.id;
        expect(createRes.body.errorPage.type).toBe("maintenance");

        // Step 2: Upload HTML content
        const zipFile = await createTestZipFile(
          "<html><body style='background:#2c3e50;color:white;text-align:center;padding:50px;'><h1>Under Maintenance</h1><p>We will be back shortly.</p></body></html>"
        );
        const uploadRes = await testClient.uploadFile<{ success: boolean; errorPage: any }>(
          `/api/error-pages/${pageId}/upload`,
          zipFile
        );
        expect(uploadRes.status).toBe(200);
        expect(uploadRes.body.success).toBe(true);
        expect(uploadRes.body.errorPage.previewImagePath).toBeDefined();

        // Step 3: Serve preview via API
        const previewRes = await testClient.getRaw(`/api/error-pages/${pageId}/preview.png`);
        expect(previewRes.status).toBe(200);
        expect(previewRes.headers.get("content-type")).toBe("image/png");

        // Step 4: Create domain and assign as maintenance page
        const domainRes = await testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture()
        );
        expect(domainRes.status).toBe(201);
        const domainId = domainRes.body.domain.id;

        const assignRes = await testClient.post<{ success: boolean }>(
          `/api/error-pages/${pageId}/assign/${domainId}?type=maintenance`
        );
        expect(assignRes.status).toBe(200);

        // Verify domain has maintenance page assigned
        const domainCheck = await testClient.get<{ domain: any }>(
          `/api/domains/${domainId}`
        );
        expect(domainCheck.body.domain.maintenancePageId).toBe(pageId);

        // Step 5: Enable maintenance mode on domain
        const enableRes = await testClient.post<{
          success: boolean;
          maintenanceWindowId: string;
        }>(`/api/maintenance/domains/${domainId}/enable`, {
          reason: "Flow test maintenance",
          bypassIps: ["10.0.0.1"],
        });
        expect(enableRes.status).toBe(200);
        expect(enableRes.body.success).toBe(true);
        expect(enableRes.body.maintenanceWindowId).toBeDefined();

        // Verify domain is in maintenance
        const maintenanceStatus = await testClient.get<{
          maintenanceEnabled: boolean;
          activeWindow: any;
        }>(`/api/maintenance/domains/${domainId}`);
        expect(maintenanceStatus.body.maintenanceEnabled).toBe(true);
        expect(maintenanceStatus.body.activeWindow).toBeDefined();
        expect(maintenanceStatus.body.activeWindow.reason).toBe("Flow test maintenance");

        // Verify HAProxy reload was queued
        const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
        expect(counts.waiting + counts.active + counts.completed).toBeGreaterThanOrEqual(1);

        // Step 6: Disable maintenance mode
        await clearRedisQueues();
        const disableRes = await testClient.post<{ success: boolean }>(
          `/api/maintenance/domains/${domainId}/disable`
        );
        expect(disableRes.status).toBe(200);
        expect(disableRes.body.success).toBe(true);

        const statusAfterDisable = await testClient.get<{
          maintenanceEnabled: boolean;
          activeWindow?: any;
        }>(`/api/maintenance/domains/${domainId}`);
        expect(statusAfterDisable.body.maintenanceEnabled).toBe(false);
        expect(statusAfterDisable.body.activeWindow).toBeUndefined();

        // Step 7: Unassign maintenance page
        const unassignRes = await testClient.delete<{ success: boolean }>(
          `/api/error-pages/${pageId}/assign/${domainId}?type=maintenance`
        );
        expect(unassignRes.status).toBe(200);

        const domainAfterUnassign = await testClient.get<{ domain: any }>(
          `/api/domains/${domainId}`
        );
        expect(domainAfterUnassign.body.domain.maintenancePageId).toBeNull();

        // Step 8: Delete maintenance page
        const deleteRes = await testClient.delete<{ success: boolean }>(
          `/api/error-pages/${pageId}`
        );
        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.success).toBe(true);

        const getAfterDelete = await testClient.get(`/api/error-pages/${pageId}`);
        expect(getAfterDelete.status).toBe(404);
      }
    );
  });

  describe("Sites + Pages Flow (no Playwright needed)", () => {
    it("should manage error and maintenance pages through the sites API", async () => {
      // Step 1: Create error page and maintenance page
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      expect(errorPageRes.status).toBe(201);
      const errorPageId = errorPageRes.body.errorPage.id;

      const maintenancePageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture()
      );
      expect(maintenancePageRes.status).toBe(201);
      const maintenancePageId = maintenancePageRes.body.errorPage.id;

      // Step 2: Create site with both pages assigned
      const siteData = createSiteFixture();
      const siteRes = await testClient.post<{ site: any }>("/api/sites", {
        ...siteData,
        errorPageId,
        maintenancePageId,
      });
      expect(siteRes.status).toBe(201);
      const siteId = siteRes.body.site.id;
      expect(siteRes.body.site.errorPageId).toBe(errorPageId);
      expect(siteRes.body.site.maintenancePageId).toBe(maintenancePageId);

      // Step 3: Verify site GET returns both page IDs
      const getRes = await testClient.get<{ site: any }>(`/api/sites/${siteId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.site.errorPageId).toBe(errorPageId);
      expect(getRes.body.site.maintenancePageId).toBe(maintenancePageId);

      // Step 4: Toggle maintenance on site
      const toggleRes = await testClient.put<{ site: any }>(
        `/api/sites/${siteId}`,
        { maintenanceEnabled: true }
      );
      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.site.maintenanceEnabled).toBe(true);

      // Step 5: Update site to swap error page
      const newErrorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("500")
      );
      const newErrorPageId = newErrorPageRes.body.errorPage.id;

      const swapRes = await testClient.put<{ site: any }>(
        `/api/sites/${siteId}`,
        { errorPageId: newErrorPageId }
      );
      expect(swapRes.status).toBe(200);
      expect(swapRes.body.site.errorPageId).toBe(newErrorPageId);

      // Step 6: Delete site
      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/sites/${siteId}`
      );
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify site is gone
      const getAfterDelete = await testClient.get(`/api/sites/${siteId}`);
      expect(getAfterDelete.status).toBe(404);

      // Error pages should still exist
      const errorCheck = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${errorPageId}`
      );
      expect(errorCheck.status).toBe(200);
    });
  });

  describe("Multiple Error Page Types Flow", () => {
    it.skipIf(!playwrightAvailable)(
      "should create and preview all error page types",
      async () => {
        const types = ["503", "404", "500", "502", "504", "maintenance"] as const;
        const pageIds: string[] = [];

        for (const type of types) {
          // Create page
          const createRes = await testClient.post<{ errorPage: any }>(
            "/api/error-pages",
            createErrorPageFixture(type as any)
          );
          expect(createRes.status).toBe(201);
          const pageId = createRes.body.errorPage.id;
          pageIds.push(pageId);

          // Upload HTML
          const zipFile = await createTestZipFile(
            `<html><body style='background:#333;color:white;padding:40px;text-align:center;'><h1>${type} Error</h1><p>This is a ${type} page.</p></body></html>`
          );
          const uploadRes = await testClient.uploadFile<{ success: boolean; errorPage: any }>(
            `/api/error-pages/${pageId}/upload`,
            zipFile
          );
          expect(uploadRes.status).toBe(200);
          expect(uploadRes.body.success).toBe(true);
          expect(uploadRes.body.errorPage.previewImagePath).toBeDefined();

          // Verify preview serves correctly
          const previewRes = await testClient.getRaw(
            `/api/error-pages/${pageId}/preview.png`
          );
          expect(previewRes.status).toBe(200);
          expect(previewRes.headers.get("content-type")).toBe("image/png");
        }

        // Verify all pages are listed
        const listRes = await testClient.get<{ errorPages: any[] }>("/api/error-pages");
        expect(listRes.status).toBe(200);
        expect(listRes.body.errorPages).toHaveLength(types.length);

        // Clean up all pages
        for (const pageId of pageIds) {
          const deleteRes = await testClient.delete<{ success: boolean }>(
            `/api/error-pages/${pageId}`
          );
          expect(deleteRes.status).toBe(200);
        }
      }
    );
  });

  describe("Domain with Both Error and Maintenance Pages", () => {
    it("should assign both error page and maintenance page to the same domain", async () => {
      // Create pages
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const maintenancePageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture()
      );
      const maintenancePageId = maintenancePageRes.body.errorPage.id;

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Assign error page (type=503)
      const assignErrorRes = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${errorPageId}/assign/${domainId}?type=503`
      );
      expect(assignErrorRes.status).toBe(200);

      // Assign maintenance page
      const assignMaintenanceRes = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${maintenancePageId}/assign/${domainId}?type=maintenance`
      );
      expect(assignMaintenanceRes.status).toBe(200);

      // Verify both are assigned
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.errorPageId).toBe(errorPageId);
      expect(domainCheck.body.domain.maintenancePageId).toBe(maintenancePageId);
    });

    it("should handle maintenance enable/disable with both pages assigned", async () => {
      // Create pages
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const maintenancePageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createMaintenancePageFixture()
      );
      const maintenancePageId = maintenancePageRes.body.errorPage.id;

      // Create domain and assign both
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      await testClient.post(
        `/api/error-pages/${errorPageId}/assign/${domainId}?type=503`
      );
      await testClient.post(
        `/api/error-pages/${maintenancePageId}/assign/${domainId}?type=maintenance`
      );

      // Enable maintenance
      const enableRes = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${domainId}/enable`,
        { reason: "Dual page test" }
      );
      expect(enableRes.status).toBe(200);

      // Verify both assignments preserved while in maintenance
      const domainInMaintenance = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainInMaintenance.body.domain.errorPageId).toBe(errorPageId);
      expect(domainInMaintenance.body.domain.maintenancePageId).toBe(maintenancePageId);
      expect(domainInMaintenance.body.domain.maintenanceEnabled).toBe(true);

      // Disable maintenance
      const disableRes = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${domainId}/disable`
      );
      expect(disableRes.status).toBe(200);

      // Verify both assignments still preserved after disabling
      const domainAfterDisable = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainAfterDisable.body.domain.errorPageId).toBe(errorPageId);
      expect(domainAfterDisable.body.domain.maintenancePageId).toBe(maintenancePageId);
      expect(domainAfterDisable.body.domain.maintenanceEnabled).toBe(false);
    });
  });
});
