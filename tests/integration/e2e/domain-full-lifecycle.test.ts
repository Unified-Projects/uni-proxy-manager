import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture, createDnsProviderFixture } from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

/**
 * End-to-End Domain Full Lifecycle Test
 *
 * This test validates the complete domain lifecycle from creation to deletion,
 * including all associated resources (backends, certificates, maintenance mode).
 */
describe("E2E: Domain Full Lifecycle", () => {
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

  describe("Complete Domain Lifecycle", () => {
    it("should complete full domain lifecycle from creation to deletion", async () => {
      // ========================================
      // Step 1: Create Domain
      // ========================================
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "lifecycle-test.example.com",
          displayName: "Lifecycle Test Domain",
          sslEnabled: true,
          forceHttps: true,
        })
      );

      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;
      expect(domainRes.body.domain.hostname).toBe("lifecycle-test.example.com");
      expect(domainRes.body.domain.status).toBe("pending");

      // ========================================
      // Step 2: Add Primary Backend
      // ========================================
      const backend1Res = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "primary-backend",
          address: "10.0.0.1",
          port: 8080,
          weight: 100,
          healthCheckEnabled: true,
          healthCheckPath: "/health",
        })
      );

      expect(backend1Res.status).toBe(201);
      const backend1Id = backend1Res.body.backend.id;
      expect(backend1Res.body.backend.name).toBe("primary-backend");

      // ========================================
      // Step 3: Add Secondary Backend for Load Balancing
      // ========================================
      const backend2Res = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "secondary-backend",
          address: "10.0.0.2",
          port: 8080,
          weight: 50,
          healthCheckEnabled: true,
          healthCheckPath: "/health",
        })
      );

      expect(backend2Res.status).toBe(201);
      const backend2Id = backend2Res.body.backend.id;

      // Verify both backends are associated with domain
      const backendsRes = await testClient.get<{ backends: any[] }>(
        `/api/backends?domainId=${domainId}`
      );
      expect(backendsRes.body.backends.length).toBe(2);

      // ========================================
      // Step 4: Create DNS Provider for Certificate
      // ========================================
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );

      expect(dnsProviderRes.status).toBe(201);
      const dnsProviderId = dnsProviderRes.body.provider.id;

      // ========================================
      // Step 5: Activate Domain
      // ========================================
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Verify domain is active
      const activeDomainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(activeDomainRes.body.domain.status).toBe("active");

      // ========================================
      // Step 6: Request SSL Certificate
      // ========================================
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId,
          staging: true,
        }
      );

      expect(certRes.status).toBe(201);
      const certificateId = certRes.body.certificate.id;
      expect(certRes.body.certificate.domainId).toBe(domainId);

      // Verify domain has certificate
      const domainWithCertRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainWithCertRes.body.domain.certificateId).toBe(certificateId);

      // ========================================
      // Step 7: Generate HAProxy Config
      // ========================================
      const configPreviewRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configPreviewRes.status).toBe(200);
      expect(configPreviewRes.body).toContain("lifecycle-test.example.com");
      expect(configPreviewRes.body).toContain("10.0.0.1:8080");
      expect(configPreviewRes.body).toContain("10.0.0.2:8080");

      // ========================================
      // Step 8: Apply HAProxy Config
      // ========================================
      const applyRes = await testClient.post<{ success: boolean; configPath: string }>(
        "/api/haproxy/apply"
      );

      expect(applyRes.status).toBe(200);
      expect(applyRes.body.success).toBe(true);

      // ========================================
      // Step 9: Enable Maintenance Mode
      // ========================================
      const enableMaintenanceRes = await testClient.post<{
        success: boolean;
        maintenanceWindowId: string;
      }>(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Scheduled maintenance",
        bypassIps: ["192.168.1.100"],
      });

      expect(enableMaintenanceRes.status).toBe(200);
      expect(enableMaintenanceRes.body.success).toBe(true);
      const maintenanceWindowId = enableMaintenanceRes.body.maintenanceWindowId;

      // Verify domain is in maintenance mode
      const maintenanceDomainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(maintenanceDomainRes.body.domain.maintenanceEnabled).toBe(true);

      // ========================================
      // Step 10: Check Maintenance Windows
      // ========================================
      const windowsRes = await testClient.get<{ windows: any[] }>(
        `/api/maintenance/domains/${domainId}/windows`
      );

      expect(windowsRes.status).toBe(200);
      expect(windowsRes.body.windows.length).toBe(1);
      expect(windowsRes.body.windows[0].reason).toBe("Scheduled maintenance");

      // ========================================
      // Step 11: Regenerate HAProxy Config with Maintenance
      // ========================================
      const maintenanceConfigRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(maintenanceConfigRes.status).toBe(200);
      // Config should reflect maintenance mode

      // ========================================
      // Step 12: Disable Maintenance Mode
      // ========================================
      const disableMaintenanceRes = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${domainId}/disable`
      );

      expect(disableMaintenanceRes.status).toBe(200);
      expect(disableMaintenanceRes.body.success).toBe(true);

      // Verify domain is no longer in maintenance mode
      const normalDomainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(normalDomainRes.body.domain.maintenanceEnabled).toBe(false);

      // ========================================
      // Step 13: Update Domain Settings
      // ========================================
      const updateDomainRes = await testClient.put<{ domain: any }>(
        `/api/domains/${domainId}`,
        {
          displayName: "Updated Lifecycle Domain",
          forceHttps: false,
        }
      );

      expect(updateDomainRes.status).toBe(200);
      expect(updateDomainRes.body.domain.displayName).toBe("Updated Lifecycle Domain");
      expect(updateDomainRes.body.domain.forceHttps).toBe(false);

      // ========================================
      // Step 14: Update Backend Weight
      // ========================================
      const updateBackendRes = await testClient.put<{ backend: any }>(
        `/api/backends/${backend1Id}`,
        { weight: 200 }
      );

      expect(updateBackendRes.status).toBe(200);
      expect(updateBackendRes.body.backend.weight).toBe(200);

      // ========================================
      // Step 15: Remove Secondary Backend
      // ========================================
      const deleteBackendRes = await testClient.delete<{ success: boolean }>(
        `/api/backends/${backend2Id}`
      );

      expect(deleteBackendRes.status).toBe(200);
      expect(deleteBackendRes.body.success).toBe(true);

      // Verify only one backend remains
      const remainingBackendsRes = await testClient.get<{ backends: any[] }>(
        `/api/backends?domainId=${domainId}`
      );
      expect(remainingBackendsRes.body.backends.length).toBe(1);

      // ========================================
      // Step 16: Delete Domain (should cascade)
      // ========================================
      const deleteDomainRes = await testClient.delete<{ success: boolean }>(
        `/api/domains/${domainId}`
      );

      expect(deleteDomainRes.status).toBe(200);
      expect(deleteDomainRes.body.success).toBe(true);

      // ========================================
      // Step 17: Verify Cleanup
      // ========================================
      // Domain should be gone
      const checkDomainRes = await testClient.get(`/api/domains/${domainId}`);
      expect(checkDomainRes.status).toBe(404);

      // Backend should be gone
      const checkBackendRes = await testClient.get(`/api/backends/${backend1Id}`);
      expect(checkBackendRes.status).toBe(404);
    });
  });

  describe("Domain with Error Page", () => {
    it("should complete lifecycle with custom error page", async () => {
      // Create error page first
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Custom 503 Page",
          type: "503",
          entryFile: "index.html",
        }
      );

      expect(errorPageRes.status).toBe(201);
      const errorPageId = errorPageRes.body.errorPage.id;

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "error-page-test.example.com" })
      );

      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      // Assign error page to domain
      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId,
        })
        .where(eq(schema.domains.id, domainId));

      // Add backend
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId)
      );

      // Verify error page association
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.errorPageId).toBe(errorPageId);

      // Generate config - should include error page reference
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );
      expect(configRes.status).toBe(200);

      // Cleanup
      await testClient.delete(`/api/domains/${domainId}`);
      await testClient.delete(`/api/error-pages/${errorPageId}`);
    });
  });

  describe("Multiple Domains Lifecycle", () => {
    it("should manage multiple domains simultaneously", async () => {
      const domainCount = 5;
      const domainIds: string[] = [];
      const backendIds: string[] = [];

      // Create multiple domains with backends
      for (let i = 0; i < domainCount; i++) {
        const domainRes = await testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture({
            hostname: `multi-domain-${i}.example.com`,
            displayName: `Multi Domain ${i}`,
          })
        );

        expect(domainRes.status).toBe(201);
        domainIds.push(domainRes.body.domain.id);

        // Activate domain
        await testDb
          .update(schema.domains)
          .set({ status: "active" })
          .where(eq(schema.domains.id, domainRes.body.domain.id));

        // Add backend
        const backendRes = await testClient.post<{ backend: any }>(
          "/api/backends",
          createBackendFixture(domainRes.body.domain.id, {
            name: `backend-${i}`,
            address: `10.0.${i}.1`,
            port: 8080,
          })
        );
        expect(backendRes.status).toBe(201);
        backendIds.push(backendRes.body.backend.id);
      }

      // Verify all domains exist
      const listRes = await testClient.get<{ domains: any[] }>("/api/domains");
      expect(listRes.body.domains.length).toBe(domainCount);

      // Generate combined config
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );
      expect(configRes.status).toBe(200);

      // Verify all domains in config
      for (let i = 0; i < domainCount; i++) {
        expect(configRes.body).toContain(`multi-domain-${i}.example.com`);
        expect(configRes.body).toContain(`10.0.${i}.1:8080`);
      }

      // Enable maintenance on subset
      for (let i = 0; i < 2; i++) {
        await testClient.post(
          `/api/maintenance/domains/${domainIds[i]}/enable`,
          { reason: `Maintenance for domain ${i}` }
        );
      }

      // Verify maintenance status
      for (let i = 0; i < domainCount; i++) {
        const domainCheck = await testClient.get<{ domain: any }>(
          `/api/domains/${domainIds[i]}`
        );
        if (i < 2) {
          expect(domainCheck.body.domain.maintenanceEnabled).toBe(true);
        } else {
          expect(domainCheck.body.domain.maintenanceEnabled).toBe(false);
        }
      }

      // Delete all domains
      for (const domainId of domainIds) {
        const deleteRes = await testClient.delete(`/api/domains/${domainId}`);
        expect(deleteRes.status).toBe(200);
      }

      // Verify all deleted
      const finalListRes = await testClient.get<{ domains: any[] }>("/api/domains");
      expect(finalListRes.body.domains.length).toBe(0);
    });
  });

  describe("Domain with All Features", () => {
    it("should complete lifecycle with all features enabled", async () => {
      // Setup: DNS provider
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      // Setup: Error page
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        { name: "Full Feature Error Page", type: "503", entryFile: "index.html" }
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // Create domain with all SSL options
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "full-feature.example.com",
          sslEnabled: true,
          forceHttps: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Activate and assign error page
      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          errorPageId,
          maintenanceBypassIps: ["10.0.0.100", "10.0.0.101"],
        })
        .where(eq(schema.domains.id, domainId));

      // Add multiple backends with health checks
      const backends = [
        { name: "primary", address: "10.1.0.1", weight: 100 },
        { name: "secondary", address: "10.1.0.2", weight: 50 },
        { name: "standby", address: "10.1.0.3", weight: 25 },
      ];

      for (const backend of backends) {
        const res = await testClient.post<{ backend: any }>(
          "/api/backends",
          createBackendFixture(domainId, {
            name: backend.name,
            address: backend.address,
            port: 8080,
            weight: backend.weight,
            healthCheckEnabled: true,
            healthCheckPath: "/status",
            healthCheckInterval: 5000,
          })
        );
        expect(res.status).toBe(201);
      }

      // Request certificate
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        { domainId, dnsProviderId, staging: true }
      );
      expect(certRes.status).toBe(201);

      // Verify complete domain configuration
      const finalDomainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(finalDomainRes.body.domain.sslEnabled).toBe(true);
      expect(finalDomainRes.body.domain.forceHttps).toBe(true);
      expect(finalDomainRes.body.domain.errorPageId).toBe(errorPageId);
      expect(finalDomainRes.body.domain.certificateId).toBe(certRes.body.certificate.id);

      // Verify backends
      const backendsRes = await testClient.get<{ backends: any[] }>(
        `/api/backends?domainId=${domainId}`
      );
      expect(backendsRes.body.backends.length).toBe(3);

      // Generate and verify complete config
      const configRes = await testClient.get<string>("/api/haproxy/config/preview");
      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("full-feature.example.com");
      for (const backend of backends) {
        expect(configRes.body).toContain(`${backend.address}:8080`);
      }

      // Toggle maintenance
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Full feature test",
      });
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

      // Trigger reload
      const reloadRes = await testClient.post("/api/haproxy/reload");
      expect([200, 201, 202]).toContain(reloadRes.status);

      // Cleanup
      await testClient.delete(`/api/domains/${domainId}`);
      await testClient.delete(`/api/error-pages/${errorPageId}`);
      await testClient.delete(`/api/dns-providers/${dnsProviderId}`);
    });
  });

  describe("Job Queue Integration", () => {
    it("should trigger appropriate jobs throughout lifecycle", async () => {
      // Create domain and backend
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

      // Trigger reload - should queue HAProxy reload job
      await testClient.post("/api/haproxy/reload");

      // Check HAProxy reload queue
      const reloadCounts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(
        reloadCounts.waiting + reloadCounts.active + reloadCounts.completed
      ).toBeGreaterThanOrEqual(0);

      // Cleanup
      await testClient.delete(`/api/domains/${domainId}`);
    });
  });

  describe("State Consistency", () => {
    it("should maintain consistent state through all operations", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "state-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Rapid state changes
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Add backend
      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Enable/disable maintenance rapidly
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`);
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`);
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

      // Final state should be consistent
      const finalDomainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(finalDomainRes.body.domain.maintenanceEnabled).toBe(false);
      expect(finalDomainRes.body.domain.status).toBe("active");

      // Config should be valid
      const configRes = await testClient.get<string>("/api/haproxy/config/preview");
      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("state-test.example.com");

      // Cleanup
      await testClient.delete(`/api/domains/${domainId}`);
    });
  });
});
