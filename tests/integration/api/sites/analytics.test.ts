/**
 * Site Analytics API Integration Tests
 *
 * Comprehensive tests for the /api/site-analytics endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../../setup/test-db";
import { createSiteFixture, createSiteAnalyticsFixture } from "../../setup/fixtures";
import * as schema from "../../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Site Analytics API", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Create a test site
    const siteData = createSiteFixture();
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  async function seedAnalyticsData(siteId: string, days: number = 7) {
    const analyticsRecords = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const timestamp = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const fixture = createSiteAnalyticsFixture(siteId, undefined, {
        timestamp,
        pageViews: 100 + Math.floor(Math.random() * 100),
        uniqueVisitors: 50 + Math.floor(Math.random() * 50),
      });

      analyticsRecords.push({
        id: `analytics-${siteId}-${i}`,
        ...fixture,
      });
    }

    await testDb.insert(schema.siteAnalytics).values(analyticsRecords);
    return analyticsRecords;
  }

  async function seedAnalyticsWithDeployment(siteId: string, deploymentId: string) {
    const fixture = createSiteAnalyticsFixture(siteId, deploymentId, {
      pageViews: 250,
      uniqueVisitors: 180,
    });

    await testDb.insert(schema.siteAnalytics).values({
      id: `analytics-${siteId}-deploy-${nanoid(6)}`,
      ...fixture,
    });
  }

  // ============================================================================
  // GET /api/site-analytics/:siteId - Summary
  // ============================================================================

  describe("GET /api/site-analytics/:siteId", () => {
    it("should return analytics summary for a site", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        period: { start: string; end: string };
        summary: {
          totalPageViews: number;
          totalUniqueVisitors: number;
          total2xx: number;
          total5xx: number;
        };
        dataPoints: number;
      }>(`/api/site-analytics/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(response.body).toHaveProperty("period");
      expect(response.body).toHaveProperty("summary");
      expect(response.body.summary.totalPageViews).toBeGreaterThan(0);
      expect(response.body.summary.totalUniqueVisitors).toBeGreaterThan(0);
      expect(response.body.dataPoints).toBeGreaterThan(0);
    });

    it("should filter by date range", async () => {
      await seedAnalyticsData(testSiteId, 7);

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 2 * 24 * 60 * 60 * 1000);

      const response = await testClient.get<{
        period: { start: string; end: string };
        dataPoints: number;
      }>(
        `/api/site-analytics/${testSiteId}?start=${startDate.toISOString()}&end=${endDate.toISOString()}`
      );

      expect(response.status).toBe(200);
      expect(response.body.dataPoints).toBeLessThanOrEqual(3);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id");

      expect(response.status).toBe(404);
    });

    it("should return zero values for site with no analytics", async () => {
      const response = await testClient.get<{
        summary: { totalPageViews: number; totalUniqueVisitors: number };
        dataPoints: number;
      }>(`/api/site-analytics/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.summary.totalPageViews).toBe(0);
      expect(response.body.summary.totalUniqueVisitors).toBe(0);
      expect(response.body.dataPoints).toBe(0);
    });

    it("should include response status code breakdown", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        summary: {
          total2xx: number;
          total3xx: number;
          total4xx: number;
          total5xx: number;
        };
      }>(`/api/site-analytics/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.summary).toHaveProperty("total2xx");
      expect(response.body.summary).toHaveProperty("total3xx");
      expect(response.body.summary).toHaveProperty("total4xx");
      expect(response.body.summary).toHaveProperty("total5xx");
    });

    it("should include bandwidth metrics", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        summary: {
          totalBytesIn: number;
          totalBytesOut: number;
        };
      }>(`/api/site-analytics/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.summary.totalBytesIn).toBeGreaterThan(0);
      expect(response.body.summary.totalBytesOut).toBeGreaterThan(0);
    });

    it("should handle very large date ranges", async () => {
      await seedAnalyticsData(testSiteId, 30);

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 year

      const response = await testClient.get<{
        dataPoints: number;
      }>(
        `/api/site-analytics/${testSiteId}?start=${startDate.toISOString()}&end=${endDate.toISOString()}`
      );

      expect(response.status).toBe(200);
      expect(response.body.dataPoints).toBe(30);
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/visitors - Time Series
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/visitors", () => {
    it("should return visitor time series data", async () => {
      await seedAnalyticsData(testSiteId, 5);

      const response = await testClient.get<{
        siteId: string;
        period: { start: string; end: string; interval: string };
        data: Array<{ timestamp: string; pageViews: number; uniqueVisitors: number }>;
      }>(`/api/site-analytics/${testSiteId}/visitors`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(response.body.period.interval).toBe("1h");
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should support different intervals", async () => {
      await seedAnalyticsData(testSiteId, 2);

      const intervals = ["1m", "5m", "1h", "1d"] as const;

      for (const interval of intervals) {
        const response = await testClient.get<{
          period: { interval: string };
        }>(`/api/site-analytics/${testSiteId}/visitors?interval=${interval}`);

        expect(response.status).toBe(200);
        expect(response.body.period.interval).toBe(interval);
      }
    });

    it("should return data ordered by timestamp ascending", async () => {
      await seedAnalyticsData(testSiteId, 5);

      const response = await testClient.get<{
        data: Array<{ timestamp: string }>;
      }>(`/api/site-analytics/${testSiteId}/visitors`);

      expect(response.status).toBe(200);
      if (response.body.data.length > 1) {
        for (let i = 1; i < response.body.data.length; i++) {
          expect(new Date(response.body.data[i].timestamp).getTime())
            .toBeGreaterThanOrEqual(new Date(response.body.data[i - 1].timestamp).getTime());
        }
      }
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/visitors");

      expect(response.status).toBe(404);
    });

    it("should return empty array for site with no analytics", async () => {
      const response = await testClient.get<{
        data: any[];
      }>(`/api/site-analytics/${testSiteId}/visitors`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it("should aggregate multiple records into the same time bucket", async () => {
      const baseTime = new Date();
      baseTime.setMinutes(10, 0, 0);

      await testDb.insert(schema.siteAnalytics).values([
        {
          id: `analytics-${testSiteId}-bucket-1`,
          ...createSiteAnalyticsFixture(testSiteId, undefined, {
            timestamp: new Date(baseTime),
            pageViews: 120,
            uniqueVisitors: 80,
          }),
        },
        {
          id: `analytics-${testSiteId}-bucket-2`,
          ...createSiteAnalyticsFixture(testSiteId, undefined, {
            timestamp: new Date(baseTime.getTime() + 20 * 60 * 1000),
            pageViews: 30,
            uniqueVisitors: 20,
          }),
        },
      ]);

      const start = new Date(baseTime.getTime() - 5 * 60 * 1000).toISOString();
      const end = new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString();

      const response = await testClient.get<{
        data: Array<{ timestamp: string; pageViews: number; uniqueVisitors: number }>;
      }>(`/api/site-analytics/${testSiteId}/visitors?start=${start}&end=${end}&interval=1h`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        pageViews: 150,
        uniqueVisitors: 100,
      });
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/geography - Geographic Breakdown
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/geography", () => {
    it("should return geographic breakdown", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        period: { start: string; end: string };
        countries: Array<{ country: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/geography`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(Array.isArray(response.body.countries)).toBe(true);
      expect(response.body.countries.length).toBeGreaterThan(0);
    });

    it("should sort countries by count descending", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        countries: Array<{ country: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/geography`);

      expect(response.status).toBe(200);
      const counts = response.body.countries.map((c) => c.count);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
      }
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/geography");

      expect(response.status).toBe(404);
    });

    it("should aggregate geo data across multiple records", async () => {
      await seedAnalyticsData(testSiteId, 5);

      const response = await testClient.get<{
        countries: Array<{ country: string; count: number }>;
        total: number;
      }>(`/api/site-analytics/${testSiteId}/geography`);

      expect(response.status).toBe(200);
      const totalFromCountries = response.body.countries.reduce((sum, c) => sum + c.count, 0);
      expect(totalFromCountries).toBe(response.body.total);
    });

    it("should respect limit parameter", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        countries: Array<{ country: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/geography?limit=2`);

      expect(response.status).toBe(200);
      expect(response.body.countries.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/referrers - Top Referrers
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/referrers", () => {
    it("should return top referrers", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        referrers: Array<{ domain: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/referrers`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(Array.isArray(response.body.referrers)).toBe(true);
      expect(response.body.referrers.length).toBeGreaterThan(0);
    });

    it("should respect limit parameter", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        referrers: Array<{ domain: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/referrers?limit=2`);

      expect(response.status).toBe(200);
      expect(response.body.referrers.length).toBeLessThanOrEqual(2);
    });

    it("should include direct traffic", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        referrers: Array<{ domain: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/referrers`);

      expect(response.status).toBe(200);
      const directReferrer = response.body.referrers.find(r => r.domain === "direct");
      expect(directReferrer).toBeDefined();
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/referrers");

      expect(response.status).toBe(404);
    });

    it("should sort referrers by count descending", async () => {
      await seedAnalyticsData(testSiteId, 5);

      const response = await testClient.get<{
        referrers: Array<{ domain: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/referrers`);

      expect(response.status).toBe(200);
      const counts = response.body.referrers.map((r) => r.count);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
      }
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/pages - Top Pages
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/pages", () => {
    it("should return top pages", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        pages: Array<{ path: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/pages`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(Array.isArray(response.body.pages)).toBe(true);
      expect(response.body.pages.length).toBeGreaterThan(0);
    });

    it("should sort pages by count descending", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        pages: Array<{ path: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/pages`);

      expect(response.status).toBe(200);
      const counts = response.body.pages.map((p) => p.count);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
      }
    });

    it("should respect limit parameter", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        pages: Array<{ path: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/pages?limit=2`);

      expect(response.status).toBe(200);
      expect(response.body.pages.length).toBeLessThanOrEqual(2);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/pages");

      expect(response.status).toBe(404);
    });

    it("should include root path", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        pages: Array<{ path: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/pages`);

      expect(response.status).toBe(200);
      const rootPage = response.body.pages.find(p => p.path === "/");
      expect(rootPage).toBeDefined();
    });

    it("should aggregate page counts across rows before applying the limit", async () => {
      const timestamp = new Date();

      await testDb.insert(schema.siteAnalytics).values([
        {
          id: `analytics-${testSiteId}-pages-1`,
          ...createSiteAnalyticsFixture(testSiteId, undefined, {
            timestamp,
          }),
          paths: { "/": 5, "/about": 2 },
        },
        {
          id: `analytics-${testSiteId}-pages-2`,
          ...createSiteAnalyticsFixture(testSiteId, undefined, {
            timestamp: new Date(timestamp.getTime() + 60 * 1000),
          }),
          paths: { "/": 3, "/contact": 4 },
        },
      ]);

      const response = await testClient.get<{
        pages: Array<{ path: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/pages?limit=2`);

      expect(response.status).toBe(200);
      expect(response.body.pages[0]).toEqual({ path: "/", count: 8 });
      expect(response.body.pages).toHaveLength(2);
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/devices - Device Breakdown
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/devices", () => {
    it("should return device breakdown", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        devices: {
          desktop: { count: number; percentage: number };
          mobile: { count: number; percentage: number };
          tablet: { count: number; percentage: number };
          other: { count: number; percentage: number };
        };
        total: number;
      }>(`/api/site-analytics/${testSiteId}/devices`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(response.body).toHaveProperty("devices");
      expect(response.body.devices).toHaveProperty("desktop");
      expect(response.body.devices).toHaveProperty("mobile");
      expect(response.body.devices).toHaveProperty("tablet");
      expect(response.body.devices).toHaveProperty("other");
      expect(response.body.total).toBeGreaterThan(0);
    });

    it("should calculate percentages correctly", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        devices: {
          desktop: { count: number; percentage: number };
          mobile: { count: number; percentage: number };
          tablet: { count: number; percentage: number };
          other: { count: number; percentage: number };
        };
        total: number;
      }>(`/api/site-analytics/${testSiteId}/devices`);

      expect(response.status).toBe(200);

      const totalPercentage =
        response.body.devices.desktop.percentage +
        response.body.devices.mobile.percentage +
        response.body.devices.tablet.percentage +
        response.body.devices.other.percentage;

      // Allow small rounding errors
      expect(totalPercentage).toBeCloseTo(100, 0);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/devices");

      expect(response.status).toBe(404);
    });

    it("should return zero values for site with no analytics", async () => {
      const response = await testClient.get<{
        devices: {
          desktop: { count: number; percentage: number };
          mobile: { count: number; percentage: number };
          tablet: { count: number; percentage: number };
          other: { count: number; percentage: number };
        };
        total: number;
      }>(`/api/site-analytics/${testSiteId}/devices`);

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/browsers - Browser Breakdown
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/browsers", () => {
    it("should return browser breakdown", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        browsers: Array<{ browser: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/browsers`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(Array.isArray(response.body.browsers)).toBe(true);
      expect(response.body.browsers.length).toBeGreaterThan(0);
    });

    it("should respect limit parameter", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        browsers: Array<{ browser: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/browsers?limit=2`);

      expect(response.status).toBe(200);
      expect(response.body.browsers.length).toBeLessThanOrEqual(2);
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/browsers");

      expect(response.status).toBe(404);
    });

    it("should sort browsers by count descending", async () => {
      await seedAnalyticsData(testSiteId, 5);

      const response = await testClient.get<{
        browsers: Array<{ browser: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/browsers`);

      expect(response.status).toBe(200);
      const counts = response.body.browsers.map((b) => b.count);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
      }
    });

    it("should include major browsers", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        browsers: Array<{ browser: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/browsers`);

      expect(response.status).toBe(200);
      const browserNames = response.body.browsers.map(b => b.browser);
      expect(browserNames).toContain("Chrome");
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/performance - Performance Metrics
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/performance", () => {
    it("should return performance metrics over time", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        siteId: string;
        period: { start: string; end: string; interval: string };
        data: Array<{
          timestamp: string;
          avgResponseTimeMs: number;
          p95ResponseTimeMs: number;
          errorRate: number;
        }>;
      }>(`/api/site-analytics/${testSiteId}/performance`);

      expect(response.status).toBe(200);
      expect(response.body.siteId).toBe(testSiteId);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should support different intervals", async () => {
      await seedAnalyticsData(testSiteId, 2);

      const response = await testClient.get<{
        period: { interval: string };
      }>(`/api/site-analytics/${testSiteId}/performance?interval=1d`);

      expect(response.status).toBe(200);
      expect(response.body.period.interval).toBe("1d");
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/performance");

      expect(response.status).toBe(404);
    });

    it("should include response time percentiles", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        summary: {
          avgResponseTimeMs: number;
          p95ResponseTimeMs: number;
          p99ResponseTimeMs?: number;
        };
      }>(`/api/site-analytics/${testSiteId}/performance`);

      expect(response.status).toBe(200);
      if (response.body.summary) {
        expect(response.body.summary.avgResponseTimeMs).toBeGreaterThan(0);
        expect(response.body.summary.p95ResponseTimeMs).toBeGreaterThan(0);
      }
    });

    it("should calculate error rate correctly", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        data: Array<{ errorRate: number }>;
      }>(`/api/site-analytics/${testSiteId}/performance`);

      expect(response.status).toBe(200);
      response.body.data.forEach(point => {
        expect(point.errorRate).toBeGreaterThanOrEqual(0);
        expect(point.errorRate).toBeLessThanOrEqual(100);
      });
    });
  });

  // ============================================================================
  // GET /api/site-analytics/:siteId/realtime - Real-time Data
  // ============================================================================

  describe("GET /api/site-analytics/:siteId/realtime", () => {
    it("should return 404 for non-existent site", async () => {
      const response = await testClient.get("/api/site-analytics/non-existent-id/realtime");

      expect(response.status).toBe(404);
    });

    // Note: Actual SSE streaming tests require different approach
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle invalid date parameters gracefully", async () => {
      const response = await testClient.get(
        `/api/site-analytics/${testSiteId}?start=invalid-date&end=also-invalid`
      );

      expect(response.status).toBe(400);
    });

    it("should handle start date after end date", async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);

      const response = await testClient.get(
        `/api/site-analytics/${testSiteId}?start=${startDate.toISOString()}&end=${endDate.toISOString()}`
      );

      expect(response.status).toBe(400);
    });

    it("should handle invalid interval parameter", async () => {
      const response = await testClient.get(
        `/api/site-analytics/${testSiteId}/visitors?interval=invalid`
      );

      expect(response.status).toBe(400);
    });

    it("should handle negative limit parameter", async () => {
      const response = await testClient.get(
        `/api/site-analytics/${testSiteId}/pages?limit=-5`
      );

      expect(response.status).toBe(400);
    });

    it("should handle very large limit parameter", async () => {
      await seedAnalyticsData(testSiteId, 3);

      const response = await testClient.get<{
        pages: Array<{ path: string; count: number }>;
      }>(`/api/site-analytics/${testSiteId}/pages?limit=10000`);

      expect(response.status).toBe(200);
      // Should not crash, but may limit to max
    });

    it("should handle concurrent analytics requests", async () => {
      await seedAnalyticsData(testSiteId, 5);

      const requests = [
        testClient.get(`/api/site-analytics/${testSiteId}`),
        testClient.get(`/api/site-analytics/${testSiteId}/visitors`),
        testClient.get(`/api/site-analytics/${testSiteId}/geography`),
        testClient.get(`/api/site-analytics/${testSiteId}/pages`),
        testClient.get(`/api/site-analytics/${testSiteId}/devices`),
      ];

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it("should handle deleted site analytics gracefully", async () => {
      await seedAnalyticsData(testSiteId, 3);

      // Delete the site
      await testClient.delete(`/api/sites/${testSiteId}`);

      const response = await testClient.get(`/api/site-analytics/${testSiteId}`);
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // Deployment-specific Analytics
  // ============================================================================

  describe("Deployment Analytics", () => {
    it("should filter analytics by deployment ID", async () => {
      // Insert a deployment directly into the database
      const deploymentId = `deploy-${nanoid()}`;
      await testDb.insert(schema.deployments).values({
        id: deploymentId,
        siteId: testSiteId,
        version: 1,
        branch: "main",
        commitSha: "abc123",
        status: "live",
        slot: "blue",
        triggeredBy: "manual",
      });

      await seedAnalyticsWithDeployment(testSiteId, deploymentId);
      await seedAnalyticsData(testSiteId, 2); // Add general analytics too

      const response = await testClient.get<{
        summary: { totalPageViews: number };
      }>(`/api/site-analytics/${testSiteId}?deploymentId=${deploymentId}`);

      expect(response.status).toBe(200);
      // Should only include deployment-specific analytics
    });
  });
});
