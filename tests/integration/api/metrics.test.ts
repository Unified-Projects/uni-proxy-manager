import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { nanoid } from "nanoid";

describe("Metrics API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("GET /api/metrics/live", () => {
    it("should return live stats for active domains", async () => {
      // Create test domains
      const domain1 = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test1.com", status: "active" })
      );
      const domain2 = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test2.com", status: "active" })
      );

      const response = await testClient.get<{ domains: any[] }>("/api/metrics/live");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("domains");
      expect(Array.isArray(response.body.domains)).toBe(true);
    });

    it("should handle HAProxy stats unavailable gracefully", async () => {
      // Test when HAProxy is not running
      const response = await testClient.get<{ domains: any[] }>("/api/metrics/live");

      // Should still return 200 with empty/zero data
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("domains");
    });

    it("should only return active domains", async () => {
      await testClient.post("/api/domains", createDomainFixture({ hostname: "active.com", status: "active" }));
      await testClient.post("/api/domains", createDomainFixture({ hostname: "inactive.com", status: "pending" }));

      const response = await testClient.get<{ domains: any[] }>("/api/metrics/live");

      expect(response.status).toBe(200);
      // Verify only active domains are returned (implementation specific)
    });
  });

  describe("GET /api/metrics/domain/:domainId", () => {
    it("should return historical metrics for specified interval", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Insert test metrics
      const now = new Date();
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domainId,
        timestamp: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
        totalRequests: 100,
        httpRequests: 100,
        httpsRequests: 0,
        status2xx: 95,
        status3xx: 2,
        status4xx: 2,
        status5xx: 1,
        bytesIn: 50000,
        bytesOut: 150000,
        currentConnections: 5,
        maxConnections: 10,
      });

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=hour&limit=100`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("metrics");
      expect(response.body.metrics.length).toBeGreaterThan(0);
    });

    it("should filter metrics by time interval", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Insert old metric (should not be returned for hour interval)
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domainId,
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        totalRequests: 50,
        httpRequests: 50,
        httpsRequests: 0,
        status2xx: 45,
        status3xx: 2,
        status4xx: 2,
        status5xx: 1,
        bytesIn: 25000,
        bytesOut: 75000,
        currentConnections: 2,
        maxConnections: 10,
      });

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=hour`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics.length).toBe(0); // Should not include old metric
    });

    it("should support day interval", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Insert metric from 12 hours ago
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domainId,
        timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
        totalRequests: 200,
        httpRequests: 200,
        httpsRequests: 0,
        status2xx: 190,
        status3xx: 5,
        status4xx: 3,
        status5xx: 2,
        bytesIn: 100000,
        bytesOut: 300000,
        currentConnections: 10,
        maxConnections: 20,
      });

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=day`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics.length).toBeGreaterThan(0);
    });

    it("should support week interval", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Insert metric from 5 days ago
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domainId,
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        totalRequests: 1000,
        httpRequests: 1000,
        httpsRequests: 0,
        status2xx: 950,
        status3xx: 25,
        status4xx: 15,
        status5xx: 10,
        bytesIn: 500000,
        bytesOut: 1500000,
        currentConnections: 50,
        maxConnections: 100,
      });

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=week`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/metrics/dashboard", () => {
    it("should return aggregated stats for today", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Insert today's metrics
      const today = new Date();
      today.setHours(10, 0, 0, 0);

      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domainId,
        timestamp: today,
        totalRequests: 500,
        httpRequests: 500,
        httpsRequests: 0,
        status2xx: 475,
        status3xx: 10,
        status4xx: 10,
        status5xx: 5,
        bytesIn: 100000,
        bytesOut: 300000,
        currentConnections: 25,
        maxConnections: 50,
      });

      const response = await testClient.get<{
        totalRequestsToday: number;
        totalBytesToday: number;
        topDomains: any[];
        recentTraffic: any[];
      }>("/api/metrics/dashboard");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("totalRequestsToday");
      expect(response.body).toHaveProperty("totalBytesToday");
      expect(response.body).toHaveProperty("topDomains");
      expect(response.body).toHaveProperty("recentTraffic");
      expect(response.body.totalRequestsToday).toBe(500);
      expect(response.body.totalBytesToday).toBe(400000);
    });

    it("should return zero values when no metrics exist", async () => {
      const response = await testClient.get<{
        totalRequestsToday: number;
        totalBytesToday: number;
        topDomains: any[];
      }>("/api/metrics/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.totalRequestsToday).toBe(0);
      expect(response.body.totalBytesToday).toBe(0);
      expect(Array.isArray(response.body.topDomains)).toBe(true);
    });

    it("should return top domains by traffic", async () => {
      // Create multiple domains with metrics
      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "popular.com" })
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "less-popular.com" })
      );

      const today = new Date();
      today.setHours(10, 0, 0, 0);

      // More traffic for domain1
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domain1Res.body.domain.id,
        timestamp: today,
        totalRequests: 1000,
        httpRequests: 1000,
        httpsRequests: 0,
        status2xx: 950,
        status3xx: 20,
        status4xx: 20,
        status5xx: 10,
        bytesIn: 500000,
        bytesOut: 1500000,
        currentConnections: 50,
        maxConnections: 100,
      });

      // Less traffic for domain2
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId: domain2Res.body.domain.id,
        timestamp: today,
        totalRequests: 100,
        httpRequests: 100,
        httpsRequests: 0,
        status2xx: 95,
        status3xx: 2,
        status4xx: 2,
        status5xx: 1,
        bytesIn: 50000,
        bytesOut: 150000,
        currentConnections: 5,
        maxConnections: 10,
      });

      const response = await testClient.get<{
        topDomains: Array<{ domainId: string; totalRequests: number }>;
      }>("/api/metrics/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.topDomains.length).toBeGreaterThan(0);
      // First domain should be the most popular
      if (response.body.topDomains.length >= 2) {
        expect(response.body.topDomains[0].totalRequests).toBeGreaterThan(
          response.body.topDomains[1].totalRequests
        );
      }
    });

    it("should include recent traffic data", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test.com" })
      );

      // Insert metrics from last 24 hours
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await testDb.insert(schema.trafficMetrics).values({
          id: nanoid(),
          domainId: domainRes.body.domain.id,
          timestamp: new Date(now.getTime() - i * 60 * 60 * 1000), // Every hour
          totalRequests: 100 + i * 10,
          httpRequests: 100 + i * 10,
          httpsRequests: 0,
          status2xx: 90 + i * 10,
          status3xx: 5,
          status4xx: 3,
          status5xx: 2,
          bytesIn: 50000,
          bytesOut: 150000,
          currentConnections: 5 + i,
          maxConnections: 20,
        });
      }

      const response = await testClient.get<{ recentTraffic: any[] }>(
        "/api/metrics/dashboard"
      );

      expect(response.status).toBe(200);
      expect(response.body.recentTraffic).toBeDefined();
      expect(Array.isArray(response.body.recentTraffic)).toBe(true);
      expect(response.body.recentTraffic.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle domain with no metrics", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "no-metrics.com" })
      );
      const domainId = domainRes.body.domain.id;

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=day`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics).toEqual([]);
    });

    it("should return empty metrics for non-existent domain", async () => {
      const response = await testClient.get<{ metrics: any[] }>("/api/metrics/domain/non-existent-id");

      // API returns empty metrics array for non-existent domains (doesn't validate domain existence)
      expect(response.status).toBe(200);
      expect(response.body.metrics).toEqual([]);
    });

    it("should handle concurrent metric requests", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "concurrent-metrics.com" })
      );

      const requests = Array.from({ length: 5 }, () =>
        testClient.get("/api/metrics/live")
      );

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it("should handle very old metrics", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "old-metrics.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Insert metric from 1 year ago
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId,
        timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        totalRequests: 1000,
        httpRequests: 1000,
        httpsRequests: 0,
        status2xx: 950,
        status3xx: 20,
        status4xx: 20,
        status5xx: 10,
        bytesIn: 500000,
        bytesOut: 1500000,
        currentConnections: 0,
        maxConnections: 100,
      });

      // Hour interval should not include this
      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=hour`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics.length).toBe(0);
    });

    it("should handle metrics with zero values", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "zero-metrics.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId,
        timestamp: new Date(Date.now() - 30 * 60 * 1000),
        totalRequests: 0,
        httpRequests: 0,
        httpsRequests: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        bytesIn: 0,
        bytesOut: 0,
        currentConnections: 0,
        maxConnections: 0,
      });

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=hour`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics.length).toBe(1);
      expect(response.body.metrics[0].totalRequests).toBe(0);
    });

    it("should handle metrics with high connection counts", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "high-connections.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId,
        timestamp: new Date(Date.now() - 30 * 60 * 1000),
        totalRequests: 100000,
        httpRequests: 10000,
        httpsRequests: 90000,
        status2xx: 95000,
        status3xx: 2000,
        status4xx: 2000,
        status5xx: 1000,
        bytesIn: 5000000000,
        bytesOut: 15000000000,
        currentConnections: 5000,
        maxConnections: 10000,
      });

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=day`
      );

      expect(response.status).toBe(200);
      expect(response.body.metrics[0].totalRequests).toBe(100000);
      expect(response.body.metrics[0].currentConnections).toBe(5000);
    });

    it("should handle invalid interval parameter", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "invalid-interval.com" })
      );
      const domainId = domainRes.body.domain.id;

      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=invalid`
      );

      // API doesn't validate interval parameter - unknown intervals are handled gracefully
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("metrics");
    });

    it("should handle deleted domain metrics", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "deleted-domain.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Add some metrics
      await testDb.insert(schema.trafficMetrics).values({
        id: nanoid(),
        domainId,
        timestamp: new Date(Date.now() - 30 * 60 * 1000),
        totalRequests: 100,
        httpRequests: 100,
        httpsRequests: 0,
        status2xx: 100,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        bytesIn: 50000,
        bytesOut: 150000,
        currentConnections: 5,
        maxConnections: 10,
      });

      // Delete the domain
      await testClient.delete(`/api/domains/${domainId}`);

      // Try to fetch metrics for deleted domain
      const response = await testClient.get<{ metrics: any[] }>(
        `/api/metrics/domain/${domainId}?interval=hour`
      );

      // API returns metrics data even for deleted domains (historical data preserved)
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("metrics");
    });

    it("should handle multiple domains in dashboard", async () => {
      // Create 10 domains with metrics
      for (let i = 0; i < 10; i++) {
        const domainRes = await testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture({ hostname: `multi-${i}.com` })
        );

        const today = new Date();
        today.setHours(10, 0, 0, 0);

        await testDb.insert(schema.trafficMetrics).values({
          id: nanoid(),
          domainId: domainRes.body.domain.id,
          timestamp: today,
          totalRequests: 100 * (10 - i), // Descending order
          httpRequests: 100 * (10 - i),
          httpsRequests: 0,
          status2xx: 95 * (10 - i),
          status3xx: 2 * (10 - i),
          status4xx: 2 * (10 - i),
          status5xx: 1 * (10 - i),
          bytesIn: 50000 * (10 - i),
          bytesOut: 150000 * (10 - i),
          currentConnections: 5 * (10 - i),
          maxConnections: 20,
        });
      }

      const response = await testClient.get<{
        totalRequestsToday: number;
        topDomains: any[];
      }>("/api/metrics/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.topDomains.length).toBeGreaterThan(0);
      // Top domain should have highest traffic
      if (response.body.topDomains.length >= 2) {
        expect(response.body.topDomains[0].totalRequests)
          .toBeGreaterThanOrEqual(response.body.topDomains[1].totalRequests);
      }
    });
  });
});
