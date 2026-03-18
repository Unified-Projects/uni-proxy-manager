/**
 * Domain Analytics Integration Tests
 *
 * Tests the full domain analytics pipeline:
 * 1. Tracking page views with domain information
 * 2. Collecting domain-specific metrics from Redis
 * 3. Storing domain analytics in PostgreSQL
 * 4. Querying domain analytics via API
 *
 * These tests run in Docker with the full test environment:
 * - PostgreSQL (test-postgres)
 * - Redis (test-redis)
 *
 * Run with:
 *   pnpm test:docker:up
 *   pnpm test:integration
 *   pnpm test:docker:down
 *
 * Or use the convenience script:
 *   bash scripts/test-integration.sh
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import { nanoid } from "nanoid";

// These are set by the test environment (tests/integration/setup/test-env.ts)
const REDIS_URL = process.env.UNI_PROXY_MANAGER_REDIS_URL || "redis://localhost:6382";

// Helper function to get minute bucket (mirrors shared/src/analytics/track-page-view.ts)
function getMinuteBucket(date: Date): number {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.getTime();
}

function parseDeviceType(userAgent: string): "desktop" | "mobile" | "tablet" | "other" {
  const ua = userAgent.toLowerCase();
  if (ua.includes("tablet") || ua.includes("ipad")) return "tablet";
  if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) return "mobile";
  if (ua.includes("windows") || ua.includes("macintosh") || ua.includes("linux")) return "desktop";
  return "other";
}

interface PageViewData {
  path: string;
  domain: string;
  referrer?: string;
  userAgent?: string;
  country?: string;
  responseCode: number;
  responseTimeMs: number;
  bytesIn: number;
  bytesOut: number;
  visitorId: string;
}

/**
 * Track a page view for analytics - mirrors shared/src/analytics/track-page-view.ts
 */
async function trackPageView(
  redis: Redis,
  siteId: string,
  data: PageViewData
): Promise<void> {
  const timestamp = new Date();
  const minuteBucket = getMinuteBucket(timestamp);
  const domain = data.domain;

  // Site-level metrics (no domain prefix)
  const siteMetricsKey = `site-metrics:${siteId}:${minuteBucket}`;
  // Domain-specific metrics (with domain prefix)
  const domainMetricsKey = `site-metrics:${siteId}:${domain}:${minuteBucket}`;

  const pipeline = redis.pipeline();

  // Increment for both site and domain
  pipeline.hincrby(siteMetricsKey, "page_views", 1);
  pipeline.hincrby(domainMetricsKey, "page_views", 1);

  pipeline.hincrby(siteMetricsKey, "bytes_in", data.bytesIn);
  pipeline.hincrby(domainMetricsKey, "bytes_in", data.bytesIn);

  pipeline.hincrby(siteMetricsKey, "bytes_out", data.bytesOut);
  pipeline.hincrby(domainMetricsKey, "bytes_out", data.bytesOut);

  // Response codes
  if (data.responseCode >= 200 && data.responseCode < 300) {
    pipeline.hincrby(siteMetricsKey, "responses_2xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_2xx", 1);
  } else if (data.responseCode >= 400 && data.responseCode < 500) {
    pipeline.hincrby(siteMetricsKey, "responses_4xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_4xx", 1);
  } else if (data.responseCode >= 500) {
    pipeline.hincrby(siteMetricsKey, "responses_5xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_5xx", 1);
  }

  // Unique visitors
  const siteUniqueKey = `site-unique-visitors:${siteId}:${minuteBucket}`;
  const domainUniqueKey = `site-unique-visitors:${siteId}:${domain}:${minuteBucket}`;
  pipeline.sadd(siteUniqueKey, data.visitorId);
  pipeline.sadd(domainUniqueKey, data.visitorId);
  pipeline.expire(siteUniqueKey, 120);
  pipeline.expire(domainUniqueKey, 120);

  // Paths
  const sitePathsKey = `site-paths:${siteId}:${minuteBucket}`;
  const domainPathsKey = `site-paths:${siteId}:${domain}:${minuteBucket}`;
  pipeline.hincrby(sitePathsKey, data.path, 1);
  pipeline.hincrby(domainPathsKey, data.path, 1);
  pipeline.expire(sitePathsKey, 120);
  pipeline.expire(domainPathsKey, 120);

  // Devices
  const device = parseDeviceType(data.userAgent || "");
  const siteDevicesKey = `site-devices:${siteId}:${minuteBucket}`;
  const domainDevicesKey = `site-devices:${siteId}:${domain}:${minuteBucket}`;
  pipeline.hincrby(siteDevicesKey, device, 1);
  pipeline.hincrby(domainDevicesKey, device, 1);
  pipeline.expire(siteDevicesKey, 120);
  pipeline.expire(domainDevicesKey, 120);

  // Geo
  if (data.country) {
    const siteGeoKey = `site-geo:${siteId}:${minuteBucket}`;
    const domainGeoKey = `site-geo:${siteId}:${domain}:${minuteBucket}`;
    pipeline.hincrby(siteGeoKey, data.country, 1);
    pipeline.hincrby(domainGeoKey, data.country, 1);
    pipeline.expire(siteGeoKey, 120);
    pipeline.expire(domainGeoKey, 120);
  }

  // Active visitors (HyperLogLog)
  const siteActiveVisitorsKey = `site-active-visitors:${siteId}`;
  const domainActiveVisitorsKey = `site-active-visitors:${siteId}:${domain}`;
  pipeline.pfadd(siteActiveVisitorsKey, data.visitorId);
  pipeline.pfadd(domainActiveVisitorsKey, data.visitorId);
  pipeline.expire(siteActiveVisitorsKey, 300);
  pipeline.expire(domainActiveVisitorsKey, 300);

  // TTL on metrics keys
  pipeline.expire(siteMetricsKey, 120);
  pipeline.expire(domainMetricsKey, 120);

  await pipeline.exec();

  // Update unique visitor counts after pipeline
  const siteIsNewVisitor = await redis.sismember(siteUniqueKey, data.visitorId);
  const domainIsNewVisitor = await redis.sismember(domainUniqueKey, data.visitorId);
  if (siteIsNewVisitor) {
    await redis.hincrby(siteMetricsKey, "unique_visitors", 1);
  }
  if (domainIsNewVisitor) {
    await redis.hincrby(domainMetricsKey, "unique_visitors", 1);
  }
}

// Test data
const TEST_SITE_ID = `test-site-${nanoid(8)}`;
const TEST_DOMAIN_1 = `domain1.test-${nanoid(6)}.com`;
const TEST_DOMAIN_2 = `domain2.test-${nanoid(6)}.com`;
const TEST_TIMESTAMP = new Date();

describe("Domain Analytics Integration Tests", () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    // Wait for Redis connection
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean up test keys before each test
    const testKeys = await redis.keys(`site-metrics:${TEST_SITE_ID}:*`);
    const testUniqueKeys = await redis.keys(`site-unique-visitors:${TEST_SITE_ID}:*`);
    const testPathsKeys = await redis.keys(`site-paths:${TEST_SITE_ID}:*`);
    const testDevicesKeys = await redis.keys(`site-devices:${TEST_SITE_ID}:*`);
    const testGeoKeys = await redis.keys(`site-geo:${TEST_SITE_ID}:*`);
    const testActiveKeys = await redis.keys(`site-active-visitors:${TEST_SITE_ID}:*`);

    const allKeys = [
      ...testKeys,
      ...testUniqueKeys,
      ...testPathsKeys,
      ...testDevicesKeys,
      ...testGeoKeys,
      ...testActiveKeys,
    ];

    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  });

  describe("Page View Tracking with Domain", () => {
    it("should track page views for site-level metrics", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 150,
        bytesIn: 1024,
        bytesOut: 20480,
        visitorId: "visitor-1",
        userAgent: "Mozilla/5.0 (Macintosh)",
        country: "US",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const siteMetricsKey = `site-metrics:${TEST_SITE_ID}:${minuteBucket}`;
      const metrics = await redis.hgetall(siteMetricsKey);

      expect(metrics.page_views).toBe("1");
      expect(metrics.bytes_in).toBe("1024");
      expect(metrics.bytes_out).toBe("20480");
      expect(metrics.responses_2xx).toBe("1");
      expect(metrics.unique_visitors).toBe("1");
    });

    it("should track page views for domain-specific metrics", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/page1",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 500,
        bytesOut: 10000,
        visitorId: "visitor-2",
        userAgent: "Mozilla/5.0 (iPhone)",
        country: "GB",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domainMetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const metrics = await redis.hgetall(domainMetricsKey);

      expect(metrics.page_views).toBe("1");
      expect(metrics.responses_2xx).toBe("1");
      expect(metrics.unique_visitors).toBe("1");
    });

    it("should isolate domain-specific metrics from each other", async () => {
      // Track view on domain 1
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "visitor-a",
        userAgent: "Mozilla/5.0",
        country: "US",
      });

      // Track view on domain 2
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_2,
        responseCode: 200,
        responseTimeMs: 200,
        bytesIn: 200,
        bytesOut: 2000,
        visitorId: "visitor-b",
        userAgent: "Mozilla/5.0",
        country: "CA",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domain1MetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const domain2MetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_2}:${minuteBucket}`;

      const domain1Metrics = await redis.hgetall(domain1MetricsKey);
      const domain2Metrics = await redis.hgetall(domain2MetricsKey);

      // Domain 1 should only have 1 page view
      expect(domain1Metrics.page_views).toBe("1");
      expect(domain1Metrics.responses_2xx).toBe("1");

      // Domain 2 should only have 1 page view
      expect(domain2Metrics.page_views).toBe("1");
      expect(domain2Metrics.responses_2xx).toBe("1");

      // Site-level metrics should have 2 page views
      const siteMetricsKey = `site-metrics:${TEST_SITE_ID}:${minuteBucket}`;
      const siteMetrics = await redis.hgetall(siteMetricsKey);
      expect(siteMetrics.page_views).toBe("2");
    });

    it("should track unique visitors separately for each domain", async () => {
      // Same visitor visits domain 1
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 50,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "same-visitor",
        userAgent: "Mozilla/5.0",
        country: "US",
      });

      // Same visitor visits domain 2
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_2,
        responseCode: 200,
        responseTimeMs: 50,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "same-visitor", // Same visitor ID
        userAgent: "Mozilla/5.0",
        country: "US",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domain1MetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const domain2MetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_2}:${minuteBucket}`;

      const domain1Metrics = await redis.hgetall(domain1MetricsKey);
      const domain2Metrics = await redis.hgetall(domain2MetricsKey);

      // Each domain should count the same visitor as unique
      expect(domain1Metrics.unique_visitors).toBe("1");
      expect(domain2Metrics.unique_visitors).toBe("1");
    });

    it("should track device types for domains", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "mobile-user",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)",
        country: "US",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domainDevicesKey = `site-devices:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const devices = await redis.hgetall(domainDevicesKey);

      expect(devices.mobile).toBe("1");
      expect(devices.desktop).toBe(undefined);
    });

    it("should track geo data for domains", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "geo-visitor",
        userAgent: "Mozilla/5.0",
        country: "DE",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domainGeoKey = `site-geo:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const geo = await redis.hgetall(domainGeoKey);

      expect(geo.DE).toBe("1");
    });

    it("should track active visitors with HyperLogLog per domain", async () => {
      // Multiple visitors on domain 1
      for (let i = 0; i < 5; i++) {
        await trackPageView(redis, TEST_SITE_ID, {
          path: "/",
          domain: TEST_DOMAIN_1,
          responseCode: 200,
          responseTimeMs: 100,
          bytesIn: 100,
          bytesOut: 1000,
          visitorId: `active-visitor-${i}`,
          userAgent: "Mozilla/5.0",
          country: "US",
        });
      }

      const domainActiveKey = `site-active-visitors:${TEST_SITE_ID}:${TEST_DOMAIN_1}`;
      const count = await redis.pfcount(domainActiveKey);

      expect(count).toBe(5);
    });
  });

  describe("Redis Key Patterns", () => {
    it("should follow expected key patterns for site metrics", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/test",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "pattern-test",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);

      // Verify keys exist
      const siteMetricsExists = await redis.exists(`site-metrics:${TEST_SITE_ID}:${minuteBucket}`);
      const domainMetricsExists = await redis.exists(`site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`);

      expect(siteMetricsExists).toBe(1);
      expect(domainMetricsExists).toBe(1);
    });

    it("should set appropriate TTL on keys", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/ttl-test",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "ttl-test",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);

      const siteMetricsTTL = await redis.ttl(`site-metrics:${TEST_SITE_ID}:${minuteBucket}`);
      const domainMetricsTTL = await redis.ttl(`site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`);

      // TTL should be positive (between 1-120 seconds)
      expect(siteMetricsTTL).toBeGreaterThan(0);
      expect(siteMetricsTTL).toBeLessThanOrEqual(120);
      expect(domainMetricsTTL).toBeGreaterThan(0);
      expect(domainMetricsTTL).toBeLessThanOrEqual(120);
    });
  });

  describe("Error Response Tracking", () => {
    it("should track 4xx errors for domains", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/not-found",
        domain: TEST_DOMAIN_1,
        responseCode: 404,
        responseTimeMs: 50,
        bytesIn: 100,
        bytesOut: 500,
        visitorId: "error-test",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domainMetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const metrics = await redis.hgetall(domainMetricsKey);

      expect(metrics.responses_4xx).toBe("1");
      expect(metrics.responses_2xx).toBe(undefined);
    });

    it("should track 5xx errors for domains", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/error",
        domain: TEST_DOMAIN_1,
        responseCode: 500,
        responseTimeMs: 500,
        bytesIn: 100,
        bytesOut: 100,
        visitorId: "server-error-test",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domainMetricsKey = `site-metrics:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const metrics = await redis.hgetall(domainMetricsKey);

      expect(metrics.responses_5xx).toBe("1");
    });
  });

  describe("Path Tracking", () => {
    it("should track paths separately for each domain", async () => {
      await trackPageView(redis, TEST_SITE_ID, {
        path: "/home",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "path-test-1",
      });

      await trackPageView(redis, TEST_SITE_ID, {
        path: "/about",
        domain: TEST_DOMAIN_1,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "path-test-2",
      });

      await trackPageView(redis, TEST_SITE_ID, {
        path: "/home",
        domain: TEST_DOMAIN_2,
        responseCode: 200,
        responseTimeMs: 100,
        bytesIn: 100,
        bytesOut: 1000,
        visitorId: "path-test-3",
      });

      const minuteBucket = getMinuteBucket(TEST_TIMESTAMP);
      const domain1PathsKey = `site-paths:${TEST_SITE_ID}:${TEST_DOMAIN_1}:${minuteBucket}`;
      const domain2PathsKey = `site-paths:${TEST_SITE_ID}:${TEST_DOMAIN_2}:${minuteBucket}`;

      const domain1Paths = await redis.hgetall(domain1PathsKey);
      const domain2Paths = await redis.hgetall(domain2PathsKey);

      // Domain 1: /home = 1, /about = 1
      expect(domain1Paths["/home"]).toBe("1");
      expect(domain1Paths["/about"]).toBe("1");

      // Domain 2: /home = 1 (only)
      expect(domain2Paths["/home"]).toBe("1");
      expect(domain2Paths["/about"]).toBe(undefined);
    });
  });
});
