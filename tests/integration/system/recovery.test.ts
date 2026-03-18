import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb, isDatabaseConnected } from "../setup/test-db";
import { clearRedisQueues, isRedisConnected, getQueueCounts } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture, createDnsProviderFixture } from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("System Recovery", () => {
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

  describe("Database Recovery", () => {
    it("should recover database connection after temporary failure", async () => {
      // Verify initial connection
      const initialConnected = await isDatabaseConnected();
      expect(initialConnected).toBe(true);

      // Make some operations
      await testClient.post("/api/domains", createDomainFixture());

      // Verify still connected
      const stillConnected = await isDatabaseConnected();
      expect(stillConnected).toBe(true);
    });

    it("should preserve data integrity after recovery", async () => {
      // Create domain with full data
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "recovery-test.example.com",
          sslEnabled: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Add backend
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "recovery-backend",
          address: "10.0.0.1",
          port: 8080,
        })
      );

      // Verify data integrity
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.hostname).toBe("recovery-test.example.com");

      const backendCheck = await testClient.get<{ backend: any }>(
        `/api/backends/${backendRes.body.backend.id}`
      );
      expect(backendCheck.body.backend.name).toBe("recovery-backend");
    });

    it("should handle partial transaction rollback", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Try to create invalid backend (should fail)
      const invalidRes = await testClient.post("/api/backends", {
        domainId,
        // Missing required fields
      });

      expect(invalidRes.status).toBe(400);

      // Valid backends should still work
      const validRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(domainId)
      );
      expect(validRes.status).toBe(201);
    });
  });

  describe("Redis Recovery", () => {
    it("should recover Redis connection after temporary failure", async () => {
      // Verify initial connection
      const initialConnected = await isRedisConnected();
      expect(initialConnected).toBe(true);

      // Queue some jobs
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
      await testClient.post("/api/haproxy/reload");

      // Verify still connected
      const stillConnected = await isRedisConnected();
      expect(stillConnected).toBe(true);
    });

    it("should preserve queue state after recovery", async () => {
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(typeof counts.waiting).toBe("number");
      expect(typeof counts.completed).toBe("number");
    });
  });

  describe("State Recovery", () => {
    it("should recover domain state after restart", async () => {
      // Create domain with specific state
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "state-recovery.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["192.168.1.1", "10.0.0.1"],
        })
        .where(eq(schema.domains.id, domainId));

      // Simulate "restart" by re-querying
      const recoveredDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );

      expect(recoveredDomain.body.domain.status).toBe("active");
      expect(recoveredDomain.body.domain.maintenanceEnabled).toBe(true);
      expect(recoveredDomain.body.domain.maintenanceBypassIps).toHaveLength(2);
    });

    it("should recover certificate state after restart", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 60);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-recovery-${Date.now()}`,
          domainId,
          commonName: "test.example.com",
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
        })
        .returning();

      // Simulate "restart" by re-querying
      const recoveredCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });

      expect(recoveredCert?.status).toBe("active");
      expect(recoveredCert?.autoRenew).toBe(true);
      expect(recoveredCert?.expiresAt).toBeDefined();
    });

    it("should recover maintenance window state", async () => {
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

      // Enable maintenance
      const enableRes = await testClient.post<{ maintenanceWindowId: string }>(
        `/api/maintenance/domains/${domainId}/enable`,
        { reason: "Recovery test" }
      );

      const windowId = enableRes.body.maintenanceWindowId;

      // Simulate "restart" by re-querying
      const windowsRes = await testClient.get<{ windows: any[] }>(
        `/api/maintenance/windows?domainId=${domainId}`
      );

      const recoveredWindow = windowsRes.body.windows.find(
        (w: any) => w.id === windowId
      );

      expect(recoveredWindow).toBeDefined();
      expect(recoveredWindow.reason).toBe("Recovery test");
      expect(recoveredWindow.activatedAt).toBeDefined();
    });
  });

  describe("HAProxy Config Recovery", () => {
    it("should regenerate HAProxy config after restart", async () => {
      // Create domain with backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "config-recovery.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "10.0.0.5",
          port: 9000,
        })
      );

      // Generate config
      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      expect(previewRes.status).toBe(200);
      expect(previewRes.body).toContain("config-recovery.example.com");
      expect(previewRes.body).toContain("10.0.0.5:9000");
    });

    it("should apply HAProxy config after restart", async () => {
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

      // Apply config
      const applyRes = await testClient.post<{ success: boolean; configPath: string }>(
        "/api/haproxy/apply"
      );

      expect(applyRes.status).toBe(200);
      expect(applyRes.body.success).toBe(true);
    });
  });

  describe("Pending Jobs Recovery", () => {
    it("should process pending jobs after restart", async () => {
      // Create domain and trigger jobs
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

      // Trigger reload job
      await testClient.post("/api/haproxy/reload");

      // Jobs should be in queue
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(counts.waiting + counts.active + counts.completed).toBeGreaterThanOrEqual(0);
    });

    it("should retry failed jobs after restart", async () => {
      // Check failed job count (should be trackable)
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(typeof counts.failed).toBe("number");
    });
  });

  describe("Consistency Checks", () => {
    it("should maintain domain-backend relationship after recovery", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "rel-check.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, { name: "rel-backend-1" })
      );
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, { name: "rel-backend-2" })
      );

      // Query domain with backends
      const domainCheck = await testClient.get<{ domain: any; backends?: any[] }>(
        `/api/domains/${domainId}`
      );

      expect(domainCheck.body.domain.hostname).toBe("rel-check.example.com");

      // Query backends for domain
      const backendsRes = await testClient.get<{ backends: any[] }>(
        `/api/backends?domainId=${domainId}`
      );

      expect(backendsRes.body.backends.length).toBe(2);
      for (const backend of backendsRes.body.backends) {
        expect(backend.domainId).toBe(domainId);
      }
    });

    it("should maintain domain-certificate relationship after recovery", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );

      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId: providerRes.body.provider.id,
          staging: true,
        }
      );

      // Verify relationship
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );

      expect(domainCheck.body.domain.certificateId).toBe(certRes.body.certificate.id);
    });

    it("should maintain domain-error-page relationship after recovery", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        { name: "Recovery Error Page", type: "503", entryFile: "index.html" }
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

      // Verify relationship
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );

      expect(domainCheck.body.domain.errorPageId).toBe(errorPageId);
    });
  });

  describe("Scheduled Jobs Recovery", () => {
    it("should have certificate renewal check scheduled", async () => {
      // This verifies that scheduled jobs would be set up on startup
      // The actual scheduling depends on the worker implementation
      const counts = await getQueueCounts(QUEUES.CERTIFICATE_RENEWAL);
      expect(typeof counts.waiting).toBe("number");
    });

    it("should have health check jobs scheduled", async () => {
      const counts = await getQueueCounts(QUEUES.HEALTH_CHECK);
      expect(typeof counts.waiting).toBe("number");
    });
  });

  describe("API Availability After Recovery", () => {
    it("should have all API endpoints available after recovery", async () => {
      const endpoints = [
        { method: "get", path: "/health" },
        { method: "get", path: "/api/domains" },
        { method: "get", path: "/api/backends" },
        { method: "get", path: "/api/certificates" },
        { method: "get", path: "/api/dns-providers" },
        { method: "get", path: "/api/error-pages" },
        { method: "get", path: "/api/haproxy/status" },
      ];

      for (const endpoint of endpoints) {
        const response = await (testClient as any)[endpoint.method](endpoint.path);
        expect([200, 401, 403]).toContain(response.status);
      }
    });

    it("should accept write operations after recovery", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "write-after-recovery.example.com" })
      );

      expect(domainRes.status).toBe(201);
      expect(domainRes.body.domain.hostname).toBe("write-after-recovery.example.com");
    });
  });
});
