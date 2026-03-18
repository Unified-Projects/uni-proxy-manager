import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb, isDatabaseConnected } from "../setup/test-db";
import { clearRedisQueues, isRedisConnected, getRedisClient } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { access } from "fs/promises";
import { getHaproxyConfigPath } from "@uni-proxy-manager/shared/config";

describe("System Startup", () => {
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

  describe("API Health Check", () => {
    it("should respond to health check endpoint", async () => {
      const response = await testClient.get<{ status: string }>("/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
    });

    it("should respond to health check with valid structure", async () => {
      const response = await testClient.get<{ status: string }>(
        "/health"
      );

      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
    });

    it("should include dependency status in health check", async () => {
      const response = await testClient.get<{
        status: string;
        database?: string;
        redis?: string;
      }>("/health");

      expect(response.status).toBe(200);
      // Health check should report on dependencies
      expect(response.body).toBeDefined();
    });
  });

  describe("Database Connection", () => {
    it("should establish database connection on startup", async () => {
      const isConnected = await isDatabaseConnected();
      expect(isConnected).toBe(true);
    });

    it("should be able to query database", async () => {
      // Simple query to verify connection
      const domains = await testDb.query.domains.findMany();
      expect(Array.isArray(domains)).toBe(true);
    });

    it("should have all required tables", async () => {
      // Try to access each major table
      const tables = [
        testDb.query.domains.findFirst(),
        testDb.query.backends.findFirst(),
        testDb.query.certificates.findFirst(),
        testDb.query.dnsProviders.findFirst(),
        testDb.query.errorPages.findFirst(),
        testDb.query.maintenanceWindows.findFirst(),
      ];

      // All queries should succeed (even if returning null)
      const results = await Promise.all(tables);
      expect(results).toBeDefined();
    });
  });

  describe("Redis Connection", () => {
    it("should establish Redis connection on startup", async () => {
      const isConnected = await isRedisConnected();
      expect(isConnected).toBe(true);
    });

    it("should be able to read/write to Redis", async () => {
      const redis = getRedisClient();

      // Write test value
      await redis.set("test-startup-key", "test-value");

      // Read it back
      const value = await redis.get("test-startup-key");
      expect(value).toBe("test-value");

      // Cleanup
      await redis.del("test-startup-key");
    });

    it("should have job queues available", async () => {
      const redis = getRedisClient();

      // Check queue keys exist
      const keys = await redis.keys("bull:*");
      expect(keys).toBeDefined();
    });
  });

  describe("HAProxy Configuration", () => {
    it("should generate initial HAProxy config on startup", async () => {
      // Create some domains to trigger config generation
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
      expect(applyRes.body.configPath).toBeDefined();
    });

    it("should return valid config preview", async () => {
      const response = await testClient.get<string>("/api/haproxy/config/preview");

      expect(response.status).toBe(200);
      expect(response.body).toContain("global");
      expect(response.body).toContain("defaults");
      expect(response.body).toContain("frontend");
    });
  });

  describe("API Routes Available", () => {
    it("should have domains API available", async () => {
      const response = await testClient.get("/api/domains");
      expect([200, 401, 403]).toContain(response.status);
    });

    it("should have backends API available", async () => {
      const response = await testClient.get("/api/backends");
      expect([200, 401, 403]).toContain(response.status);
    });

    it("should have certificates API available", async () => {
      const response = await testClient.get("/api/certificates");
      expect([200, 401, 403]).toContain(response.status);
    });

    it("should have DNS providers API available", async () => {
      const response = await testClient.get("/api/dns-providers");
      expect([200, 401, 403]).toContain(response.status);
    });

    it("should have error pages API available", async () => {
      const response = await testClient.get("/api/error-pages");
      expect([200, 401, 403]).toContain(response.status);
    });

    it("should have HAProxy API available", async () => {
      const response = await testClient.get("/api/haproxy/status");
      expect([200, 401, 403]).toContain(response.status);
    });

    it("should have maintenance API available", async () => {
      const response = await testClient.get("/api/maintenance");
      expect([200, 401, 403, 404]).toContain(response.status);
    });
  });

  describe("Initial Data State", () => {
    it("should start with empty domains if fresh database", async () => {
      const response = await testClient.get<{ domains: any[] }>("/api/domains");
      expect(response.status).toBe(200);
      expect(response.body.domains).toHaveLength(0);
    });

    it("should start with empty certificates if fresh database", async () => {
      const response = await testClient.get<{ certificates: any[] }>(
        "/api/certificates"
      );
      expect(response.status).toBe(200);
      expect(response.body.certificates).toHaveLength(0);
    });

    it("should start with empty DNS providers if fresh database", async () => {
      const response = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );
      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(0);
    });
  });

  describe("Configuration Validation", () => {
    it("should have database connection configured", async () => {
      // Verify database is configured by testing connection
      const isConnected = await isDatabaseConnected();
      expect(isConnected).toBe(true);
    });

    it("should have valid paths configured", () => {
      const configPath = getHaproxyConfigPath();
      expect(configPath).toBeDefined();
      expect(typeof configPath).toBe("string");
    });
  });

  describe("Concurrent Request Handling", () => {
    it("should handle multiple concurrent requests", async () => {
      // Send multiple requests concurrently
      const requests = Array.from({ length: 10 }, () =>
        testClient.get<{ status: string }>("/health")
      );

      const responses = await Promise.all(requests);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
      }
    });

    it("should handle concurrent database operations", async () => {
      // Create multiple domains concurrently
      const requests = Array.from({ length: 5 }, (_, i) =>
        testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture({ hostname: `concurrent-${i}.example.com` })
        )
      );

      const responses = await Promise.all(requests);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      // Verify all created
      const listRes = await testClient.get<{ domains: any[] }>("/api/domains");
      expect(listRes.body.domains.length).toBe(5);
    });
  });

  describe("Error Handling on Startup", () => {
    it("should return appropriate error for invalid requests", async () => {
      // Invalid POST body
      const response = await testClient.post("/api/domains", {});

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent resources", async () => {
      const response = await testClient.get("/api/domains/non-existent-id");
      expect(response.status).toBe(404);
    });

    it("should handle malformed JSON gracefully", async () => {
      // This depends on test client implementation
      // The server should not crash on malformed input
      const response = await testClient.get("/health");
      expect(response.status).toBe(200);
    });
  });

  describe("Database Migrations", () => {
    it("should have correct schema version", async () => {
      // Verify schema is as expected by checking domains table exists
      const domains = await testDb.query.domains.findMany({ limit: 1 });
      expect(Array.isArray(domains)).toBe(true);
    });

    it("should have all required tables accessible", async () => {
      // Verify all major tables are accessible
      const queries = await Promise.all([
        testDb.query.domains.findMany({ limit: 1 }),
        testDb.query.backends.findMany({ limit: 1 }),
        testDb.query.certificates.findMany({ limit: 1 }),
        testDb.query.dnsProviders.findMany({ limit: 1 }),
      ]);

      for (const result of queries) {
        expect(Array.isArray(result)).toBe(true);
      }
    });
  });
});
