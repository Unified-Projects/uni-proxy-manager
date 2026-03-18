import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createBackendFixture, createCertificateFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { nanoid } from "nanoid";

describe("Stats API", () => {
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
  // GET /api/stats/dashboard - Dashboard Stats
  // ============================================================================

  describe("GET /api/stats/dashboard", () => {
    it("should return zero stats when database is empty", async () => {
      const response = await testClient.get<{
        domains: any;
        certificates: any;
        backends: any;
        maintenance: any;
      }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("domains");
      expect(response.body).toHaveProperty("certificates");
      expect(response.body).toHaveProperty("backends");
      expect(response.body).toHaveProperty("maintenance");

      expect(response.body.domains.total).toBe(0);
      expect(response.body.certificates.total).toBe(0);
      expect(response.body.backends.total).toBe(0);
      expect(response.body.maintenance.domainsInMaintenance).toBe(0);
      expect(response.body.maintenance.scheduledWindows).toBe(0);
    });

    it("should calculate domain stats correctly", async () => {
      // Create domains with different statuses
      const domainActive = await testDb.insert(schema.domains).values({
        id: nanoid(),
        hostname: "active.example.com",
        displayName: "Active Domain",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      }).returning();

      const domainPending = await testDb.insert(schema.domains).values({
        id: nanoid(),
        hostname: "pending.example.com",
        displayName: "Pending Domain",
        status: "pending",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      }).returning();

      const domainDisabled = await testDb.insert(schema.domains).values({
        id: nanoid(),
        hostname: "disabled.example.com",
        displayName: "Disabled Domain",
        status: "disabled",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      }).returning();

      const domainError = await testDb.insert(schema.domains).values({
        id: nanoid(),
        hostname: "error.example.com",
        displayName: "Error Domain",
        status: "error",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      }).returning();

      const response = await testClient.get<{ domains: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.domains.total).toBe(4);
      expect(response.body.domains.active).toBe(1);
      expect(response.body.domains.pending).toBe(1);
      expect(response.body.domains.disabled).toBe(1);
      expect(response.body.domains.error).toBe(1);
    });

    it("should calculate certificate stats correctly", async () => {
      const domainId = nanoid();

      // Create a domain first
      await testDb.insert(schema.domains).values({
        id: domainId,
        hostname: "cert-test.example.com",
        displayName: "Cert Test",
        status: "active",
        sslEnabled: true,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      });

      // Create certificates with different statuses
      const certActive = await testDb.insert(schema.certificates).values({
        id: nanoid(),
        domainId,
        commonName: "cert-active.example.com",
        altNames: [],
        status: "active",
        certPath: "/path/to/cert1.pem",
        keyPath: "/path/to/key1.pem",
        fullchainPath: "/path/to/fullchain1.pem",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      }).returning();

      const certPending = await testDb.insert(schema.certificates).values({
        id: nanoid(),
        domainId,
        commonName: "cert-pending.example.com",
        altNames: [],
        status: "pending",
        certPath: "/path/to/cert2.pem",
        keyPath: "/path/to/key2.pem",
        fullchainPath: "/path/to/fullchain2.pem",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }).returning();

      const certExpired = await testDb.insert(schema.certificates).values({
        id: nanoid(),
        domainId,
        commonName: "cert-expired.example.com",
        altNames: [],
        status: "expired",
        certPath: "/path/to/cert3.pem",
        keyPath: "/path/to/key3.pem",
        fullchainPath: "/path/to/fullchain3.pem",
        issuedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 180 days ago
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      }).returning();

      const certFailed = await testDb.insert(schema.certificates).values({
        id: nanoid(),
        domainId,
        commonName: "cert-failed.example.com",
        altNames: [],
        status: "failed",
        certPath: "/path/to/cert4.pem",
        keyPath: "/path/to/key4.pem",
        fullchainPath: "/path/to/fullchain4.pem",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }).returning();

      const response = await testClient.get<{ certificates: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.certificates.total).toBe(4);
      expect(response.body.certificates.active).toBe(1);
      expect(response.body.certificates.pending).toBe(1);
      expect(response.body.certificates.expired).toBe(1);
      expect(response.body.certificates.failed).toBe(1);
    });

    it("should calculate backend stats correctly", async () => {
      const domainId = nanoid();

      // Create a domain
      await testDb.insert(schema.domains).values({
        id: domainId,
        hostname: "backend-test.example.com",
        displayName: "Backend Test",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      });

      // Create backends (healthy = enabled + isHealthy, unhealthy = enabled + !isHealthy)
      await testDb.insert(schema.backends).values({
        id: nanoid(),
        domainId,
        name: "backend-1",
        address: "192.168.1.1",
        port: 8080,
        enabled: true,
        isHealthy: true, // healthy
        weight: 100,
        maxConnections: null,
      });

      await testDb.insert(schema.backends).values({
        id: nanoid(),
        domainId,
        name: "backend-2",
        address: "192.168.1.2",
        port: 8080,
        enabled: true,
        isHealthy: true, // healthy
        weight: 100,
        maxConnections: null,
      });

      await testDb.insert(schema.backends).values({
        id: nanoid(),
        domainId,
        name: "backend-3",
        address: "192.168.1.3",
        port: 8080,
        enabled: true,
        isHealthy: false, // unhealthy
        weight: 100,
        maxConnections: null,
      });

      const response = await testClient.get<{ backends: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.backends.total).toBe(3);
      expect(response.body.backends.healthy).toBe(2);
      expect(response.body.backends.unhealthy).toBe(1);
    });

    it("should calculate maintenance stats correctly", async () => {
      const domainId1 = nanoid();
      const domainId2 = nanoid();
      const domainId3 = nanoid();

      // Create domains
      await testDb.insert(schema.domains).values({
        id: domainId1,
        hostname: "maint1.example.com",
        displayName: "Maintenance 1",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: true, // In maintenance
      });

      await testDb.insert(schema.domains).values({
        id: domainId2,
        hostname: "maint2.example.com",
        displayName: "Maintenance 2",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false, // Not in maintenance
      });

      await testDb.insert(schema.domains).values({
        id: domainId3,
        hostname: "maint3.example.com",
        displayName: "Maintenance 3",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: true, // In maintenance
      });

      // Create maintenance windows
      // Active maintenance window
      await testDb.insert(schema.maintenanceWindows).values({
        id: nanoid(),
        domainId: domainId1,
        title: "Active Maintenance",
        reason: "System upgrade",
        isActive: true,
        activatedAt: new Date(),
        triggeredBy: "admin",
      });

      // Scheduled maintenance window (in the future)
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now
      await testDb.insert(schema.maintenanceWindows).values({
        id: nanoid(),
        domainId: domainId2,
        title: "Scheduled Maintenance",
        reason: "Database migration",
        isActive: false,
        scheduledStartAt: futureDate,
        scheduledEndAt: new Date(futureDate.getTime() + 2 * 60 * 60 * 1000), // 2 hours duration
        triggeredBy: "admin",
      });

      // Past scheduled window (should not count as scheduled)
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await testDb.insert(schema.maintenanceWindows).values({
        id: nanoid(),
        domainId: domainId3,
        title: "Past Maintenance",
        reason: "Old maintenance",
        isActive: false,
        scheduledStartAt: pastDate,
        scheduledEndAt: new Date(pastDate.getTime() + 2 * 60 * 60 * 1000),
        triggeredBy: "admin",
      });

      const response = await testClient.get<{ maintenance: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.maintenance.domainsInMaintenance).toBe(2);
      expect(response.body.maintenance.scheduledWindows).toBe(1);
    });

    it("should handle stats with mixed data", async () => {
      // Create a complex scenario with multiple entities
      const domainId1 = nanoid();
      const domainId2 = nanoid();

      // Domain 1 with certificates and backends
      await testDb.insert(schema.domains).values({
        id: domainId1,
        hostname: "mixed1.example.com",
        displayName: "Mixed 1",
        status: "active",
        sslEnabled: true,
        forceHttpsRedirect: true,
        maintenanceEnabled: false,
      });

      await testDb.insert(schema.certificates).values({
        id: nanoid(),
        domainId: domainId1,
        commonName: "mixed1.example.com",
        altNames: ["www.mixed1.example.com"],
        status: "active",
        certPath: "/path/to/cert.pem",
        keyPath: "/path/to/key.pem",
        fullchainPath: "/path/to/fullchain.pem",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });

      await testDb.insert(schema.backends).values({
        id: nanoid(),
        domainId: domainId1,
        name: "backend-1",
        address: "192.168.1.10",
        port: 3000,
        enabled: true,
        weight: 100,
        maxConnections: null,
      });

      // Domain 2 in maintenance
      await testDb.insert(schema.domains).values({
        id: domainId2,
        hostname: "mixed2.example.com",
        displayName: "Mixed 2",
        status: "pending",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: true,
      });

      await testDb.insert(schema.maintenanceWindows).values({
        id: nanoid(),
        domainId: domainId2,
        title: "Emergency Maintenance",
        reason: "Security patch",
        isActive: true,
        activatedAt: new Date(),
        triggeredBy: "system",
      });

      const response = await testClient.get<any>("/api/stats/dashboard");

      expect(response.status).toBe(200);

      // Verify all stats are calculated
      expect(response.body.domains.total).toBe(2);
      expect(response.body.domains.active).toBe(1);
      expect(response.body.domains.pending).toBe(1);

      expect(response.body.certificates.total).toBe(1);
      expect(response.body.certificates.active).toBe(1);

      expect(response.body.backends.total).toBe(1);
      expect(response.body.backends.healthy).toBe(1);

      expect(response.body.maintenance.domainsInMaintenance).toBe(1);
      expect(response.body.maintenance.scheduledWindows).toBe(0);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle concurrent stats requests", async () => {
      // Create some test data
      await testDb.insert(schema.domains).values({
        id: nanoid(),
        hostname: "concurrent1.example.com",
        displayName: "Concurrent 1",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      });

      const requests = Array.from({ length: 5 }, () =>
        testClient.get<any>("/api/stats/dashboard")
      );

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.domains.total).toBe(1);
      });
    });

    it("should handle expiring certificates correctly", async () => {
      const domainId = nanoid();

      await testDb.insert(schema.domains).values({
        id: domainId,
        hostname: "expiring-cert.example.com",
        displayName: "Expiring Cert",
        status: "active",
        sslEnabled: true,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      });

      // Certificate expiring in 5 days
      await testDb.insert(schema.certificates).values({
        id: nanoid(),
        domainId,
        commonName: "expiring-cert.example.com",
        altNames: [],
        status: "active",
        certPath: "/path/to/cert.pem",
        keyPath: "/path/to/key.pem",
        fullchainPath: "/path/to/fullchain.pem",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
      });

      const response = await testClient.get<{ certificates: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.certificates.total).toBe(1);
      expect(response.body.certificates.active).toBe(1);
      // Should potentially indicate expiring soon
      if (response.body.certificates.expiringSoon !== undefined) {
        expect(response.body.certificates.expiringSoon).toBe(1);
      }
    });

    it("should count domains with no backends", async () => {
      await testDb.insert(schema.domains).values({
        id: nanoid(),
        hostname: "no-backends.example.com",
        displayName: "No Backends",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      });

      const response = await testClient.get<{ backends: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.backends.total).toBe(0);
    });

    it("should handle multiple maintenance windows for same domain", async () => {
      const domainId = nanoid();

      await testDb.insert(schema.domains).values({
        id: domainId,
        hostname: "multi-maint.example.com",
        displayName: "Multi Maintenance",
        status: "active",
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: true,
      });

      // Active maintenance window
      await testDb.insert(schema.maintenanceWindows).values({
        id: nanoid(),
        domainId,
        title: "Current Maintenance",
        reason: "Upgrade",
        isActive: true,
        activatedAt: new Date(),
        triggeredBy: "admin",
      });

      // Scheduled future maintenance
      const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await testDb.insert(schema.maintenanceWindows).values({
        id: nanoid(),
        domainId,
        title: "Future Maintenance",
        reason: "Another upgrade",
        isActive: false,
        scheduledStartAt: futureDate,
        scheduledEndAt: new Date(futureDate.getTime() + 2 * 60 * 60 * 1000),
        triggeredBy: "admin",
      });

      const response = await testClient.get<{ maintenance: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.maintenance.domainsInMaintenance).toBe(1);
      expect(response.body.maintenance.scheduledWindows).toBe(1);
    });

    it("should handle all domain statuses", async () => {
      const statuses = ["active", "pending", "disabled", "error"] as const;

      for (const status of statuses) {
        await testDb.insert(schema.domains).values({
          id: nanoid(),
          hostname: `${status}-status.example.com`,
          displayName: `${status} Domain`,
          status,
          sslEnabled: false,
          forceHttpsRedirect: false,
          maintenanceEnabled: false,
        });
      }

      const response = await testClient.get<{ domains: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.domains.total).toBe(4);
      expect(response.body.domains.active).toBe(1);
      expect(response.body.domains.pending).toBe(1);
      expect(response.body.domains.disabled).toBe(1);
      expect(response.body.domains.error).toBe(1);
    });

    it("should handle large numbers of entities", async () => {
      // Create 50 domains
      const domains = Array.from({ length: 50 }, (_, i) => ({
        id: nanoid(),
        hostname: `domain-${i}.example.com`,
        displayName: `Domain ${i}`,
        status: "active" as const,
        sslEnabled: false,
        forceHttpsRedirect: false,
        maintenanceEnabled: false,
      }));

      await testDb.insert(schema.domains).values(domains);

      const response = await testClient.get<{ domains: any }>("/api/stats/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.domains.total).toBe(50);
      expect(response.body.domains.active).toBe(50);
    });
  });
});
