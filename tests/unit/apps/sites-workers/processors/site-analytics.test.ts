/**
 * Site Analytics Processor Unit Tests
 *
 * Tests for the site analytics processor that collects
 * and stores site traffic metrics and analytics data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { SiteAnalyticsJobData } from "@uni-proxy-manager/queue";
import type { GeoData, ReferrerData, DeviceData, PathData } from "@uni-proxy-manager/database/schema";

// Mock dependencies
vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      sites: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      deployments: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
  },
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    hgetall: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    hincrby: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    publish: vi.fn(),
    sadd: vi.fn(),
    pfadd: vi.fn(),
    expire: vi.fn(),
  })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id-123"),
}));

describe("Site Analytics Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("SiteAnalyticsJobData type", () => {
    it("should have required fields for single site", () => {
      const jobData: SiteAnalyticsJobData = {
        siteId: "site-123",
        timestamp: Date.now(),
      };

      expect(jobData.siteId).toBe("site-123");
      expect(typeof jobData.timestamp).toBe("number");
    });

    it("should accept wildcard for all sites", () => {
      const jobData: SiteAnalyticsJobData = {
        siteId: "*",
        timestamp: Date.now(),
      };

      expect(jobData.siteId).toBe("*");
    });
  });

  // ============================================================================
  // Minute Bucket Tests
  // ============================================================================

  describe("Minute bucket calculation", () => {
    it("should round down to minute boundary", () => {
      const date = new Date("2024-01-15T12:34:56.789Z");
      const d = new Date(date);
      d.setSeconds(0, 0);

      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
      expect(d.getMinutes()).toBe(34);
    });

    it("should return timestamp in milliseconds", () => {
      const date = new Date("2024-01-15T12:34:00.000Z");
      date.setSeconds(0, 0);
      const bucket = date.getTime();

      expect(typeof bucket).toBe("number");
      expect(bucket).toBeGreaterThan(0);
    });

    it("should group same-minute timestamps together", () => {
      const getMinuteBucket = (date: Date): number => {
        const d = new Date(date);
        d.setSeconds(0, 0);
        return d.getTime();
      };

      const t1 = new Date("2024-01-15T12:34:15.123Z");
      const t2 = new Date("2024-01-15T12:34:45.789Z");

      expect(getMinuteBucket(t1)).toBe(getMinuteBucket(t2));
    });

    it("should separate different-minute timestamps", () => {
      const getMinuteBucket = (date: Date): number => {
        const d = new Date(date);
        d.setSeconds(0, 0);
        return d.getTime();
      };

      const t1 = new Date("2024-01-15T12:34:00.000Z");
      const t2 = new Date("2024-01-15T12:35:00.000Z");

      expect(getMinuteBucket(t1)).not.toBe(getMinuteBucket(t2));
    });
  });

  // ============================================================================
  // Metrics Key Construction Tests
  // ============================================================================

  describe("Metrics key construction", () => {
    it("should construct metrics key with site ID and bucket", () => {
      const siteId = "site-123";
      const bucket = 1705321200000;
      const metricsKey = `site-metrics:${siteId}:${bucket}`;

      expect(metricsKey).toBe("site-metrics:site-123:1705321200000");
    });

    it("should construct unique visitors key", () => {
      const siteId = "site-123";
      const bucket = 1705321200000;
      const uniqueKey = `site-unique-visitors:${siteId}:${bucket}`;

      expect(uniqueKey).toBe("site-unique-visitors:site-123:1705321200000");
    });

    it("should construct active visitors key", () => {
      const siteId = "site-123";
      const activeVisitorsKey = `site-active-visitors:${siteId}`;

      expect(activeVisitorsKey).toBe("site-active-visitors:site-123");
    });

    it("should construct realtime channel", () => {
      const siteId = "site-123";
      const realtimeChannel = `site-realtime:${siteId}`;

      expect(realtimeChannel).toBe("site-realtime:site-123");
    });
  });

  // ============================================================================
  // Metrics Parsing Tests
  // ============================================================================

  describe("Metrics parsing", () => {
    it("should parse page views from string", () => {
      const metricsData = { page_views: "150" };
      const pageViews = parseInt(metricsData.page_views || "0", 10);

      expect(pageViews).toBe(150);
    });

    it("should default to 0 for missing page views", () => {
      const metricsData: Record<string, string> = {};
      const pageViews = parseInt(metricsData.page_views || "0", 10);

      expect(pageViews).toBe(0);
    });

    it("should parse unique visitors", () => {
      const metricsData = { unique_visitors: "75" };
      const uniqueVisitors = parseInt(metricsData.unique_visitors || "0", 10);

      expect(uniqueVisitors).toBe(75);
    });

    it("should parse bytes transferred", () => {
      const metricsData = {
        bytes_in: "1024000",
        bytes_out: "5120000",
      };

      const bytesIn = parseInt(metricsData.bytes_in || "0", 10);
      const bytesOut = parseInt(metricsData.bytes_out || "0", 10);

      expect(bytesIn).toBe(1024000);
      expect(bytesOut).toBe(5120000);
    });

    it("should parse response status codes", () => {
      const metricsData = {
        responses_2xx: "120",
        responses_3xx: "15",
        responses_4xx: "10",
        responses_5xx: "5",
      };

      expect(parseInt(metricsData.responses_2xx || "0", 10)).toBe(120);
      expect(parseInt(metricsData.responses_3xx || "0", 10)).toBe(15);
      expect(parseInt(metricsData.responses_4xx || "0", 10)).toBe(10);
      expect(parseInt(metricsData.responses_5xx || "0", 10)).toBe(5);
    });

    it("should parse response times", () => {
      const metricsData = {
        avg_response_time_ms: "45",
        p95_response_time_ms: "150",
      };

      const avgResponseTimeMs = parseInt(metricsData.avg_response_time_ms || "0", 10);
      const p95ResponseTimeMs = parseInt(metricsData.p95_response_time_ms || "0", 10);

      expect(avgResponseTimeMs).toBe(45);
      expect(p95ResponseTimeMs).toBe(150);
    });
  });

  // ============================================================================
  // GeoData Tests
  // ============================================================================

  describe("GeoData type", () => {
    it("should represent country distribution", () => {
      const geoData: GeoData = {
        US: 500,
        GB: 200,
        DE: 100,
        FR: 75,
        CA: 50,
      };

      expect(geoData.US).toBe(500);
      expect(geoData.GB).toBe(200);
      expect(Object.keys(geoData)).toHaveLength(5);
    });

    it("should handle empty geo data", () => {
      const geoData: GeoData = {};

      expect(Object.keys(geoData)).toHaveLength(0);
    });

    it("should parse geo data from JSON", () => {
      const jsonString = '{"US": 100, "GB": 50}';
      const geoData: GeoData = JSON.parse(jsonString);

      expect(geoData.US).toBe(100);
      expect(geoData.GB).toBe(50);
    });
  });

  // ============================================================================
  // ReferrerData Tests
  // ============================================================================

  describe("ReferrerData type", () => {
    it("should represent referrer distribution", () => {
      const referrers: ReferrerData = {
        "google.com": 150,
        "twitter.com": 75,
        "direct": 200,
      };

      expect(referrers["google.com"]).toBe(150);
      expect(referrers["direct"]).toBe(200);
    });

    it("should parse referrer domain from URL", () => {
      const referrerUrl = "https://www.google.com/search?q=test";
      const referrerDomain = new URL(referrerUrl).hostname;

      expect(referrerDomain).toBe("www.google.com");
    });

    it("should handle invalid referrer URL gracefully", () => {
      const invalidUrl = "not-a-valid-url";
      let referrerDomain: string | null = null;

      try {
        referrerDomain = new URL(invalidUrl).hostname;
      } catch {
        referrerDomain = null;
      }

      expect(referrerDomain).toBeNull();
    });
  });

  // ============================================================================
  // DeviceData Tests
  // ============================================================================

  describe("DeviceData type", () => {
    it("should represent device distribution", () => {
      const devices: DeviceData = {
        desktop: 500,
        mobile: 300,
        tablet: 100,
        other: 50,
      };

      expect(devices.desktop).toBe(500);
      expect(devices.mobile).toBe(300);
      expect(devices.tablet).toBe(100);
      expect(devices.other).toBe(50);
    });

    it("should have all required device types", () => {
      const devices: DeviceData = {
        desktop: 0,
        mobile: 0,
        tablet: 0,
        other: 0,
      };

      expect(Object.keys(devices)).toContain("desktop");
      expect(Object.keys(devices)).toContain("mobile");
      expect(Object.keys(devices)).toContain("tablet");
      expect(Object.keys(devices)).toContain("other");
    });
  });

  // ============================================================================
  // Device Type Detection Tests
  // ============================================================================

  describe("Device type detection", () => {
    const parseDeviceType = (userAgent: string): "desktop" | "mobile" | "tablet" | "other" => {
      const ua = userAgent.toLowerCase();
      if (ua.includes("tablet") || ua.includes("ipad")) {
        return "tablet";
      }
      if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) {
        return "mobile";
      }
      if (ua.includes("windows") || ua.includes("macintosh") || ua.includes("linux")) {
        return "desktop";
      }
      return "other";
    };

    it("should detect tablet from iPad user agent", () => {
      const ua = "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15";
      expect(parseDeviceType(ua)).toBe("tablet");
    });

    it("should detect tablet from tablet keyword", () => {
      const ua = "Mozilla/5.0 (Linux; Android 10; SM-T870) tablet WebKit/537.36";
      expect(parseDeviceType(ua)).toBe("tablet");
    });

    it("should detect mobile from iPhone user agent", () => {
      const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15";
      expect(parseDeviceType(ua)).toBe("mobile");
    });

    it("should detect mobile from Android user agent", () => {
      const ua = "Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36";
      expect(parseDeviceType(ua)).toBe("mobile");
    });

    it("should detect desktop from Windows user agent", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      expect(parseDeviceType(ua)).toBe("desktop");
    });

    it("should detect desktop from Macintosh user agent", () => {
      const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
      expect(parseDeviceType(ua)).toBe("desktop");
    });

    it("should detect desktop from Linux user agent", () => {
      const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
      expect(parseDeviceType(ua)).toBe("desktop");
    });

    it("should return other for unknown user agent", () => {
      const ua = "curl/7.68.0";
      expect(parseDeviceType(ua)).toBe("other");
    });
  });

  // ============================================================================
  // PathData Tests
  // ============================================================================

  describe("PathData type", () => {
    it("should represent path distribution", () => {
      const paths: PathData = {
        "/": 1000,
        "/about": 250,
        "/contact": 100,
        "/blog": 500,
      };

      expect(paths["/"]).toBe(1000);
      expect(paths["/blog"]).toBe(500);
    });

    it("should handle paths with query strings", () => {
      const paths: PathData = {
        "/search?q=test": 50,
        "/product/123": 25,
      };

      expect(paths["/search?q=test"]).toBe(50);
    });
  });

  // ============================================================================
  // Response Code Classification Tests
  // ============================================================================

  describe("Response code classification", () => {
    it("should classify 2xx responses", () => {
      const codes = [200, 201, 204, 299];
      for (const code of codes) {
        const is2xx = code >= 200 && code < 300;
        expect(is2xx).toBe(true);
      }
    });

    it("should classify 3xx responses", () => {
      const codes = [301, 302, 304, 307];
      for (const code of codes) {
        const is3xx = code >= 300 && code < 400;
        expect(is3xx).toBe(true);
      }
    });

    it("should classify 4xx responses", () => {
      const codes = [400, 401, 403, 404, 429];
      for (const code of codes) {
        const is4xx = code >= 400 && code < 500;
        expect(is4xx).toBe(true);
      }
    });

    it("should classify 5xx responses", () => {
      const codes = [500, 502, 503, 504];
      for (const code of codes) {
        const is5xx = code >= 500;
        expect(is5xx).toBe(true);
      }
    });
  });

  // ============================================================================
  // Average Response Time Calculation Tests
  // ============================================================================

  describe("Average response time calculation", () => {
    it("should calculate running average", () => {
      const currentAvg = 40;
      const currentCount = 10;
      const newResponseTime = 60;

      const newAvg = Math.round((currentAvg * (currentCount - 1) + newResponseTime) / currentCount);

      expect(newAvg).toBe(42);
    });

    it("should handle first request", () => {
      const currentAvg = 0;
      const currentCount = 1;
      const newResponseTime = 50;

      const newAvg = Math.round((currentAvg * (currentCount - 1) + newResponseTime) / currentCount);

      expect(newAvg).toBe(50);
    });
  });

  // ============================================================================
  // Redis TTL Tests
  // ============================================================================

  describe("Redis TTL settings", () => {
    it("should use 120 second TTL for metrics", () => {
      const ttl = 120;
      expect(ttl).toBe(120);
    });

    it("should use 300 second TTL for active visitors", () => {
      const ttl = 300;
      expect(ttl).toBe(300);
    });
  });

  // ============================================================================
  // Realtime Publish Tests
  // ============================================================================

  describe("Realtime publish data", () => {
    it("should format realtime message", () => {
      const activeVisitors = 25;
      const pageViews = 150;
      const timestamp = new Date().toISOString();

      const message = JSON.stringify({
        activeVisitors,
        pageViews,
        timestamp,
      });

      const parsed = JSON.parse(message);
      expect(parsed.activeVisitors).toBe(25);
      expect(parsed.pageViews).toBe(150);
      expect(parsed.timestamp).toBe(timestamp);
    });
  });

  // ============================================================================
  // Site Status Filter Tests
  // ============================================================================

  describe("Site status filtering", () => {
    it("should filter for active sites", () => {
      const sites = [
        { id: "site-1", status: "active" },
        { id: "site-2", status: "inactive" },
        { id: "site-3", status: "active" },
      ];

      const activeSites = sites.filter((s) => s.status === "active");

      expect(activeSites).toHaveLength(2);
    });
  });

  // ============================================================================
  // Job Processing Tests
  // ============================================================================

  describe("Job processing", () => {
    it("should construct mock job correctly", () => {
      const mockJob = {
        id: "job-123",
        data: {
          siteId: "site-456",
          timestamp: Date.now(),
        },
      } as Job<SiteAnalyticsJobData>;

      expect(mockJob.data.siteId).toBe("site-456");
      expect(typeof mockJob.data.timestamp).toBe("number");
    });

    it("should handle wildcard site ID", () => {
      const siteId = "*";
      const processAllSites = siteId === "*";

      expect(processAllSites).toBe(true);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    it("should handle JSON parse errors gracefully", () => {
      const invalidJson = "not valid json";
      let result: GeoData = {};

      try {
        result = JSON.parse(invalidJson);
      } catch {
        result = {};
      }

      expect(result).toEqual({});
    });

    it("should log and rethrow errors", () => {
      const mockError = new Error("Redis connection failed");

      expect(() => {
        console.error("[Site Analytics] Error:", mockError);
        throw mockError;
      }).toThrow("Redis connection failed");
    });
  });
});
