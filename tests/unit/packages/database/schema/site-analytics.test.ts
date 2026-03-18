/**
 * Site Analytics Schema Unit Tests
 *
 * Tests for the site analytics database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  siteAnalytics,
  type SiteAnalytic,
  type NewSiteAnalytic,
  type GeoData,
  type ReferrerData,
  type DeviceData,
  type PathData,
} from "../../../../../packages/database/src/schema/site-analytics";

describe("Site Analytics Schema", () => {
  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("siteAnalytics table", () => {
    it("should have id as primary key", () => {
      const idColumn = siteAnalytics.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have siteId as required field", () => {
      const siteIdColumn = siteAnalytics.siteId;
      expect(siteIdColumn.name).toBe("site_id");
      expect(siteIdColumn.notNull).toBe(true);
    });

    it("should have deploymentId as optional field", () => {
      const deploymentIdColumn = siteAnalytics.deploymentId;
      expect(deploymentIdColumn.name).toBe("deployment_id");
      expect(deploymentIdColumn.notNull).toBe(false);
    });

    it("should have timestamp as required field", () => {
      const timestampColumn = siteAnalytics.timestamp;
      expect(timestampColumn.name).toBe("timestamp");
      expect(timestampColumn.notNull).toBe(true);
    });

    it("should have pageViews with default 0", () => {
      const pageViewsColumn = siteAnalytics.pageViews;
      expect(pageViewsColumn.name).toBe("page_views");
      expect(pageViewsColumn.notNull).toBe(true);
      expect(pageViewsColumn.hasDefault).toBe(true);
    });

    it("should have uniqueVisitors with default 0", () => {
      const uniqueVisitorsColumn = siteAnalytics.uniqueVisitors;
      expect(uniqueVisitorsColumn.name).toBe("unique_visitors");
      expect(uniqueVisitorsColumn.notNull).toBe(true);
      expect(uniqueVisitorsColumn.hasDefault).toBe(true);
    });

    it("should have performance metrics fields", () => {
      expect(siteAnalytics.avgResponseTimeMs.name).toBe("avg_response_time_ms");
      expect(siteAnalytics.p95ResponseTimeMs.name).toBe("p95_response_time_ms");
      // These are optional (can be null)
      expect(siteAnalytics.avgResponseTimeMs.notNull).toBe(false);
      expect(siteAnalytics.p95ResponseTimeMs.notNull).toBe(false);
    });

    it("should have bandwidth fields", () => {
      expect(siteAnalytics.bytesIn.name).toBe("bytes_in");
      expect(siteAnalytics.bytesOut.name).toBe("bytes_out");
      expect(siteAnalytics.bytesIn.notNull).toBe(true);
      expect(siteAnalytics.bytesOut.notNull).toBe(true);
      expect(siteAnalytics.bytesIn.hasDefault).toBe(true);
      expect(siteAnalytics.bytesOut.hasDefault).toBe(true);
    });

    it("should have response code counters", () => {
      expect(siteAnalytics.responses2xx.name).toBe("responses_2xx");
      expect(siteAnalytics.responses3xx.name).toBe("responses_3xx");
      expect(siteAnalytics.responses4xx.name).toBe("responses_4xx");
      expect(siteAnalytics.responses5xx.name).toBe("responses_5xx");

      // All should have defaults
      expect(siteAnalytics.responses2xx.hasDefault).toBe(true);
      expect(siteAnalytics.responses3xx.hasDefault).toBe(true);
      expect(siteAnalytics.responses4xx.hasDefault).toBe(true);
      expect(siteAnalytics.responses5xx.hasDefault).toBe(true);
    });

    it("should have geoData as JSONB field", () => {
      const geoDataColumn = siteAnalytics.geoData;
      expect(geoDataColumn.name).toBe("geo_data");
      expect(geoDataColumn.dataType).toBe("json");
    });

    it("should have referrers as JSONB field", () => {
      const referrersColumn = siteAnalytics.referrers;
      expect(referrersColumn.name).toBe("referrers");
      expect(referrersColumn.dataType).toBe("json");
    });

    it("should have devices as JSONB field", () => {
      const devicesColumn = siteAnalytics.devices;
      expect(devicesColumn.name).toBe("devices");
      expect(devicesColumn.dataType).toBe("json");
    });

    it("should have paths as JSONB field", () => {
      const pathsColumn = siteAnalytics.paths;
      expect(pathsColumn.name).toBe("paths");
      expect(pathsColumn.dataType).toBe("json");
    });

    it("should have browsers as JSONB field", () => {
      const browsersColumn = siteAnalytics.browsers;
      expect(browsersColumn.name).toBe("browsers");
      expect(browsersColumn.dataType).toBe("json");
    });

    it("should have createdAt timestamp", () => {
      const createdAtColumn = siteAnalytics.createdAt;
      expect(createdAtColumn.name).toBe("created_at");
      expect(createdAtColumn.notNull).toBe(true);
      expect(createdAtColumn.hasDefault).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("SiteAnalytic types", () => {
    it("should export SiteAnalytic select type", () => {
      const analytic: SiteAnalytic = {
        id: "analytics-1",
        siteId: "site-1",
        deploymentId: "deploy-1",
        timestamp: new Date(),
        pageViews: 1000,
        uniqueVisitors: 500,
        avgResponseTimeMs: 150,
        p95ResponseTimeMs: 350,
        bytesIn: 1024000,
        bytesOut: 5120000,
        responses2xx: 950,
        responses3xx: 20,
        responses4xx: 25,
        responses5xx: 5,
        geoData: { US: 400, GB: 200, DE: 100 },
        referrers: { "google.com": 300, direct: 200 },
        devices: { desktop: 600, mobile: 350, tablet: 40, other: 10 },
        paths: { "/": 500, "/dashboard": 300 },
        browsers: { Chrome: 600, Safari: 250 },
        createdAt: new Date(),
      };

      expect(analytic.id).toBe("analytics-1");
      expect(analytic.pageViews).toBe(1000);
    });

    it("should export NewSiteAnalytic insert type with minimal fields", () => {
      const newAnalytic: NewSiteAnalytic = {
        id: "analytics-1",
        siteId: "site-1",
        timestamp: new Date(),
      };

      expect(newAnalytic.id).toBe("analytics-1");
      expect(newAnalytic.siteId).toBe("site-1");
    });

    it("should allow null deploymentId", () => {
      const analytic: Partial<SiteAnalytic> = {
        deploymentId: null,
      };

      expect(analytic.deploymentId).toBeNull();
    });
  });

  // ============================================================================
  // GeoData Type Tests
  // ============================================================================

  describe("GeoData type", () => {
    it("should allow country code keys with number values", () => {
      const geoData: GeoData = {
        US: 1000,
        GB: 500,
        DE: 300,
        FR: 200,
        CA: 150,
      };

      expect(geoData.US).toBe(1000);
      expect(geoData.GB).toBe(500);
    });

    it("should allow empty object", () => {
      const geoData: GeoData = {};

      expect(Object.keys(geoData)).toHaveLength(0);
    });

    it("should allow any string key", () => {
      const geoData: GeoData = {
        "XX": 100, // Unknown country
        "ZZ": 50,
      };

      expect(geoData.XX).toBe(100);
    });
  });

  // ============================================================================
  // ReferrerData Type Tests
  // ============================================================================

  describe("ReferrerData type", () => {
    it("should allow domain keys with number values", () => {
      const referrerData: ReferrerData = {
        "google.com": 500,
        "twitter.com": 200,
        "direct": 300,
        "facebook.com": 150,
      };

      expect(referrerData["google.com"]).toBe(500);
      expect(referrerData.direct).toBe(300);
    });

    it("should allow empty object", () => {
      const referrerData: ReferrerData = {};

      expect(Object.keys(referrerData)).toHaveLength(0);
    });

    it("should handle various referrer formats", () => {
      const referrerData: ReferrerData = {
        "www.google.com": 100,
        "search.yahoo.com": 50,
        "t.co": 75, // Twitter short URL
        "direct": 200,
        "unknown": 25,
      };

      expect(Object.keys(referrerData)).toHaveLength(5);
    });
  });

  // ============================================================================
  // DeviceData Type Tests
  // ============================================================================

  describe("DeviceData type", () => {
    it("should have all required device categories", () => {
      const deviceData: DeviceData = {
        desktop: 600,
        mobile: 350,
        tablet: 40,
        other: 10,
      };

      expect(deviceData.desktop).toBe(600);
      expect(deviceData.mobile).toBe(350);
      expect(deviceData.tablet).toBe(40);
      expect(deviceData.other).toBe(10);
    });

    it("should allow zero values", () => {
      const deviceData: DeviceData = {
        desktop: 0,
        mobile: 0,
        tablet: 0,
        other: 0,
      };

      expect(deviceData.desktop).toBe(0);
    });

    it("should calculate total from all categories", () => {
      const deviceData: DeviceData = {
        desktop: 100,
        mobile: 50,
        tablet: 25,
        other: 25,
      };

      const total = deviceData.desktop + deviceData.mobile +
                    deviceData.tablet + deviceData.other;
      expect(total).toBe(200);
    });
  });

  // ============================================================================
  // PathData Type Tests
  // ============================================================================

  describe("PathData type", () => {
    it("should allow path keys with number values", () => {
      const pathData: PathData = {
        "/": 500,
        "/dashboard": 300,
        "/settings": 150,
        "/api/health": 50,
      };

      expect(pathData["/"]).toBe(500);
      expect(pathData["/dashboard"]).toBe(300);
    });

    it("should allow empty object", () => {
      const pathData: PathData = {};

      expect(Object.keys(pathData)).toHaveLength(0);
    });

    it("should handle complex paths", () => {
      const pathData: PathData = {
        "/": 100,
        "/users/123/profile": 50,
        "/api/v1/users": 75,
        "/assets/css/main.css": 25,
        "/dashboard?tab=overview": 30,
      };

      expect(pathData["/users/123/profile"]).toBe(50);
      expect(pathData["/dashboard?tab=overview"]).toBe(30);
    });
  });

  // ============================================================================
  // Full Record Validation Tests
  // ============================================================================

  describe("Full Analytics Record", () => {
    it("should create a valid complete analytics record", () => {
      const analytic: SiteAnalytic = {
        id: "analytics-full-1",
        siteId: "site-1",
        deploymentId: "deploy-1",
        timestamp: new Date("2024-01-15T10:00:00Z"),
        pageViews: 10000,
        uniqueVisitors: 5000,
        avgResponseTimeMs: 125,
        p95ResponseTimeMs: 280,
        bytesIn: 10240000,
        bytesOut: 51200000,
        responses2xx: 9500,
        responses3xx: 200,
        responses4xx: 250,
        responses5xx: 50,
        geoData: {
          US: 4000,
          GB: 2000,
          DE: 1500,
          FR: 1000,
          CA: 500,
        },
        referrers: {
          "google.com": 3000,
          "twitter.com": 1500,
          direct: 4000,
          "facebook.com": 1000,
          "linkedin.com": 500,
        },
        devices: {
          desktop: 6000,
          mobile: 3500,
          tablet: 400,
          other: 100,
        },
        paths: {
          "/": 4000,
          "/dashboard": 3000,
          "/settings": 1500,
          "/profile": 1000,
          "/api/health": 500,
        },
        browsers: {
          Chrome: 6000,
          Safari: 2500,
          Firefox: 1000,
          Edge: 400,
          Other: 100,
        },
        createdAt: new Date("2024-01-15T10:01:00Z"),
      };

      // Validate sums
      const totalDevices = analytic.devices.desktop + analytic.devices.mobile +
                          analytic.devices.tablet + analytic.devices.other;
      expect(totalDevices).toBe(10000);

      const totalResponses = analytic.responses2xx + analytic.responses3xx +
                            analytic.responses4xx + analytic.responses5xx;
      expect(totalResponses).toBe(10000);
    });

    it("should create a valid minimal analytics record", () => {
      const analytic: NewSiteAnalytic = {
        id: "analytics-min-1",
        siteId: "site-1",
        timestamp: new Date(),
      };

      expect(analytic.id).toBeDefined();
      expect(analytic.siteId).toBeDefined();
      expect(analytic.timestamp).toBeDefined();
      // All other fields should use defaults
    });

    it("should handle analytics without deployment", () => {
      const analytic: SiteAnalytic = {
        id: "analytics-nodeploy-1",
        siteId: "site-1",
        deploymentId: null,
        timestamp: new Date(),
        pageViews: 100,
        uniqueVisitors: 50,
        avgResponseTimeMs: null,
        p95ResponseTimeMs: null,
        bytesIn: 1024,
        bytesOut: 5120,
        responses2xx: 95,
        responses3xx: 2,
        responses4xx: 2,
        responses5xx: 1,
        geoData: {},
        referrers: {},
        devices: { desktop: 50, mobile: 40, tablet: 8, other: 2 },
        paths: {},
        browsers: {},
        createdAt: new Date(),
      };

      expect(analytic.deploymentId).toBeNull();
      expect(analytic.avgResponseTimeMs).toBeNull();
    });
  });

  // ============================================================================
  // Aggregation Logic Tests
  // ============================================================================

  describe("Aggregation Helpers", () => {
    it("should correctly sum geo data across records", () => {
      const geoData1: GeoData = { US: 100, GB: 50 };
      const geoData2: GeoData = { US: 200, DE: 75 };

      const mergedGeoData: GeoData = {};
      [geoData1, geoData2].forEach(geo => {
        Object.entries(geo).forEach(([country, count]) => {
          mergedGeoData[country] = (mergedGeoData[country] || 0) + count;
        });
      });

      expect(mergedGeoData.US).toBe(300);
      expect(mergedGeoData.GB).toBe(50);
      expect(mergedGeoData.DE).toBe(75);
    });

    it("should correctly sum device data across records", () => {
      const devices1: DeviceData = { desktop: 100, mobile: 50, tablet: 10, other: 5 };
      const devices2: DeviceData = { desktop: 200, mobile: 100, tablet: 20, other: 10 };

      const mergedDevices: DeviceData = {
        desktop: devices1.desktop + devices2.desktop,
        mobile: devices1.mobile + devices2.mobile,
        tablet: devices1.tablet + devices2.tablet,
        other: devices1.other + devices2.other,
      };

      expect(mergedDevices.desktop).toBe(300);
      expect(mergedDevices.mobile).toBe(150);
      expect(mergedDevices.tablet).toBe(30);
      expect(mergedDevices.other).toBe(15);
    });

    it("should calculate error rate from response codes", () => {
      const analytic: Partial<SiteAnalytic> = {
        responses2xx: 950,
        responses3xx: 20,
        responses4xx: 25,
        responses5xx: 5,
      };

      const total = (analytic.responses2xx || 0) + (analytic.responses3xx || 0) +
                   (analytic.responses4xx || 0) + (analytic.responses5xx || 0);
      const errorCount = (analytic.responses4xx || 0) + (analytic.responses5xx || 0);
      const errorRate = (errorCount / total) * 100;

      expect(errorRate).toBe(3);
    });

    it("should calculate success rate from response codes", () => {
      const analytic: Partial<SiteAnalytic> = {
        responses2xx: 900,
        responses3xx: 50,
        responses4xx: 30,
        responses5xx: 20,
      };

      const total = (analytic.responses2xx || 0) + (analytic.responses3xx || 0) +
                   (analytic.responses4xx || 0) + (analytic.responses5xx || 0);
      const successCount = (analytic.responses2xx || 0) + (analytic.responses3xx || 0);
      const successRate = (successCount / total) * 100;

      expect(successRate).toBe(95);
    });
  });
});
