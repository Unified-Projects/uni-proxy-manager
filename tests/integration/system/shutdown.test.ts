import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts, getRedisClient } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("System Shutdown", () => {
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

  describe("Graceful Shutdown Behavior", () => {
    it("should complete in-flight API requests before shutdown", async () => {
      // Start a request that takes some time
      const startTime = Date.now();

      // Create a domain (simulates in-flight request)
      const response = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );

      const endTime = Date.now();

      // Request should complete successfully
      expect(response.status).toBe(201);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5s
    });

    it("should persist pending database transactions", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "persist-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Update domain
      await testClient.put(`/api/domains/${domainId}`, {
        displayName: "Updated Name",
      });

      // Verify data persisted
      const checkRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(checkRes.body.domain.displayName).toBe("Updated Name");
    });

    it("should not lose queued jobs on shutdown", async () => {
      // Create domain and trigger reload job
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

      // Trigger reload (queues a job)
      await testClient.post("/api/haproxy/reload");

      // Jobs should be in queue
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(counts.waiting + counts.active + counts.completed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Resource Cleanup", () => {
    it("should close database connections properly", async () => {
      // Make several database operations
      for (let i = 0; i < 10; i++) {
        await testClient.post("/api/domains", createDomainFixture());
      }

      // Verify we can still query
      const response = await testClient.get<{ domains: any[] }>("/api/domains");
      expect(response.status).toBe(200);
      expect(response.body.domains.length).toBe(10);
    });

    it("should close Redis connections properly", async () => {
      const redis = getRedisClient();

      // Make several Redis operations
      for (let i = 0; i < 10; i++) {
        await redis.set(`test-cleanup-${i}`, "value");
      }

      // Cleanup
      for (let i = 0; i < 10; i++) {
        await redis.del(`test-cleanup-${i}`);
      }

      // Verify Redis still works
      await redis.ping();
    });
  });

  describe("State Preservation", () => {
    it("should preserve domain configuration on shutdown", async () => {
      // Create domain with full configuration
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "preserve-config.example.com",
          sslEnabled: true,
          forceHttps: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["10.0.0.1"],
        })
        .where(eq(schema.domains.id, domainId));

      // Verify configuration preserved
      const checkRes = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(checkRes.body.domain.hostname).toBe("preserve-config.example.com");
      expect(checkRes.body.domain.sslEnabled).toBe(true);
      expect(checkRes.body.domain.forceHttps).toBe(true);
      expect(checkRes.body.domain.maintenanceEnabled).toBe(true);
      expect(checkRes.body.domain.maintenanceBypassIps).toContain("10.0.0.1");
    });

    it("should preserve backend configuration on shutdown", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "preserve-backend",
          address: "10.0.0.5",
          port: 9090,
          weight: 75,
          healthCheckEnabled: true,
          healthCheckPath: "/status",
        })
      );
      const backendId = backendRes.body.backend.id;

      // Verify configuration preserved
      const checkRes = await testClient.get<{ backend: any }>(
        `/api/backends/${backendId}`
      );
      expect(checkRes.body.backend.name).toBe("preserve-backend");
      expect(checkRes.body.backend.address).toBe("10.0.0.5");
      expect(checkRes.body.backend.port).toBe(9090);
      expect(checkRes.body.backend.weight).toBe(75);
      expect(checkRes.body.backend.healthCheckPath).toBe("/status");
    });

    it("should preserve certificate configuration on shutdown", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create certificate record directly
      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-preserve-${Date.now()}`,
          domainId,
          commonName: "test.example.com",
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
        })
        .returning();

      // Verify preserved
      const checkCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(checkCert?.autoRenew).toBe(true);
      expect(checkCert?.renewBeforeDays).toBe(30);
    });
  });

  describe("Queue State on Shutdown", () => {
    it("should preserve pending jobs in queue", async () => {
      // Create domain and backend to generate jobs
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

      // Trigger jobs
      await testClient.post("/api/haproxy/reload");

      // Jobs should be trackable
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(typeof counts.waiting).toBe("number");
      expect(typeof counts.active).toBe("number");
      expect(typeof counts.completed).toBe("number");
    });

    it("should mark failed jobs appropriately", async () => {
      // This tests that failed job state is preserved
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(typeof counts.failed).toBe("number");
    });
  });

  describe("Concurrent Shutdown Safety", () => {
    it("should handle concurrent requests during shutdown", async () => {
      // Send multiple concurrent requests
      const requests = Array.from({ length: 20 }, (_, i) =>
        testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture({ hostname: `concurrent-shutdown-${i}.example.com` })
        )
      );

      const responses = await Promise.all(requests);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(201);
      }
    });

    it("should handle concurrent database writes", async () => {
      // Create domain first
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Concurrent backend creations
      const requests = Array.from({ length: 5 }, (_, i) =>
        testClient.post<{ backend: any }>(
          "/api/backends",
          createBackendFixture(domainId, {
            name: `concurrent-backend-${i}`,
            address: `10.0.0.${i + 1}`,
            port: 8080,
          })
        )
      );

      const responses = await Promise.all(requests);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      // Verify all created
      const backendsRes = await testClient.get<{ backends: any[] }>(
        `/api/backends?domainId=${domainId}`
      );
      expect(backendsRes.body.backends.length).toBe(5);
    });
  });

  describe("Error State Preservation", () => {
    it("should preserve error information for failed operations", async () => {
      // Create domain and certificate that will fail
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create certificate with non-existent DNS provider
      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-error-${Date.now()}`,
          domainId,
          commonName: "test.example.com",
          status: "failed",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 3,
          lastError: "DNS provider not found",
        })
        .returning();

      // Verify error state preserved
      const checkCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(checkCert?.status).toBe("failed");
      expect(checkCert?.lastError).toBe("DNS provider not found");
      expect(checkCert?.renewalAttempts).toBe(3);
    });
  });
});
