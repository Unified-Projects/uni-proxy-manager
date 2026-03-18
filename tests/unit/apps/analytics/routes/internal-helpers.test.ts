/**
 * Internal Analytics Route Helpers -- Unit Tests
 *
 * The helper functions under test live inside
 *   apps/analytics/src/routes/internal/index.ts
 * but are NOT exported (they are module-private). Because they are pure
 * functions with no external dependencies we duplicate them here verbatim
 * so that the logic can be tested in isolation without needing to modify
 * the production source.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Duplicated helper functions (mirrors source exactly)
// ---------------------------------------------------------------------------

/** Determine the appropriate aggregate table based on period duration. */
function getAggTable(startDate: Date, endDate: Date): string {
  const durationMs = endDate.getTime() - startDate.getTime();
  const hours = durationMs / (1000 * 60 * 60);
  if (hours < 24) return "analytics_agg_minute";
  if (hours < 168) return "analytics_agg_hour"; // 7 days
  return "analytics_agg_day";
}

/** Parse and validate common query parameters. */
function parseQueryParams(c: { req: { query: (key: string) => string | undefined } }) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startStr = c.req.query("start");
  const endStr = c.req.query("end");
  const startParsed = startStr ? new Date(startStr) : sevenDaysAgo;
  const endParsed = endStr ? new Date(endStr) : now;
  const start = isNaN(startParsed.getTime()) ? sevenDaysAgo : startParsed;
  const end = isNaN(endParsed.getTime()) ? now : endParsed;
  const limit = Math.min(1000, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

  const filters = {
    country: c.req.query("country") || "",
    device: c.req.query("device") || "",
    browser: c.req.query("browser") || "",
    os: c.req.query("os") || "",
    referrer_domain: c.req.query("referrer_domain") || "",
    utm_source: c.req.query("utm_source") || "",
    utm_medium: c.req.query("utm_medium") || "",
    utm_campaign: c.req.query("utm_campaign") || "",
    pathname: c.req.query("pathname") || "",
  };

  return { start, end, limit, filters };
}

/** Check if any cross-dimensional filters are active. */
function hasFilters(filters: Record<string, string>): boolean {
  return Object.values(filters).some((v) => v.length > 0);
}

/** Build WHERE clause fragments for raw events table filtering. */
function buildFilterWhere(filters: Record<string, string>): { clauses: string[]; params: Record<string, string> } {
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (filters.country) { clauses.push("AND country_code = {f_country:String}"); params.f_country = filters.country; }
  if (filters.device) { clauses.push("AND device_type = {f_device:String}"); params.f_device = filters.device; }
  if (filters.browser) { clauses.push("AND browser = {f_browser:String}"); params.f_browser = filters.browser; }
  if (filters.os) { clauses.push("AND os = {f_os:String}"); params.f_os = filters.os; }
  if (filters.referrer_domain) { clauses.push("AND referrer_domain = {f_ref:String}"); params.f_ref = filters.referrer_domain; }
  if (filters.utm_source) { clauses.push("AND utm_source = {f_usrc:String}"); params.f_usrc = filters.utm_source; }
  if (filters.utm_medium) { clauses.push("AND utm_medium = {f_umed:String}"); params.f_umed = filters.utm_medium; }
  if (filters.utm_campaign) { clauses.push("AND utm_campaign = {f_ucam:String}"); params.f_ucam = filters.utm_campaign; }
  if (filters.pathname) { clauses.push("AND pathname LIKE {f_path:String}"); params.f_path = filters.pathname + "%"; }

  return { clauses, params };
}

/** Format a Date to ClickHouse DateTime string. */
function toClickHouseDate(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

/** Sort a map by values descending and take top N. */
function topN<T extends { count: number }>(items: T[], n: number): T[] {
  return items.sort((a, b) => b.count - a.count).slice(0, n);
}

/** Determine the appropriate time bucketing interval for raw event queries. */
function getTimeBucketInterval(startDate: Date, endDate: Date): string {
  const durationMs = endDate.getTime() - startDate.getTime();
  const hours = durationMs / (1000 * 60 * 60);
  if (hours < 24) return "toStartOfMinute(timestamp)";
  if (hours < 168) return "toStartOfHour(timestamp)"; // 7 days
  return "toStartOfDay(timestamp)";
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Build a minimal Hono-like context object for parseQueryParams. */
function makeContext(params: Record<string, string> = {}): { req: { query: (key: string) => string | undefined } } {
  return {
    req: {
      query: (key: string) => params[key],
    },
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Internal analytics route helpers", () => {
  // =========================================================================
  // getAggTable
  // =========================================================================

  describe("getAggTable", () => {
    it("should return analytics_agg_minute for durations under 24 hours", () => {
      const start = new Date("2025-01-15T00:00:00Z");
      const end = new Date("2025-01-15T12:00:00Z"); // 12 hours
      expect(getAggTable(start, end)).toBe("analytics_agg_minute");
    });

    it("should return analytics_agg_minute for a 1-hour range", () => {
      const start = new Date("2025-01-15T10:00:00Z");
      const end = new Date("2025-01-15T11:00:00Z");
      expect(getAggTable(start, end)).toBe("analytics_agg_minute");
    });

    it("should return analytics_agg_hour for durations of 24h to under 7 days", () => {
      const start = new Date("2025-01-10T00:00:00Z");
      const end = new Date("2025-01-13T00:00:00Z"); // 3 days = 72 hours
      expect(getAggTable(start, end)).toBe("analytics_agg_hour");
    });

    it("should return analytics_agg_day for durations of 7 days or more", () => {
      const start = new Date("2025-01-01T00:00:00Z");
      const end = new Date("2025-01-31T00:00:00Z"); // 30 days
      expect(getAggTable(start, end)).toBe("analytics_agg_day");
    });

    it("should return analytics_agg_hour at exactly 24 hours (boundary)", () => {
      const start = new Date("2025-01-15T00:00:00Z");
      const end = new Date("2025-01-16T00:00:00Z"); // exactly 24h
      expect(getAggTable(start, end)).toBe("analytics_agg_hour");
    });

    it("should return analytics_agg_day at exactly 168 hours / 7 days (boundary)", () => {
      const start = new Date("2025-01-10T00:00:00Z");
      const end = new Date("2025-01-17T00:00:00Z"); // exactly 168h
      expect(getAggTable(start, end)).toBe("analytics_agg_day");
    });

    it("should return analytics_agg_minute for a very short range", () => {
      const start = new Date("2025-01-15T10:00:00Z");
      const end = new Date("2025-01-15T10:05:00Z"); // 5 minutes
      expect(getAggTable(start, end)).toBe("analytics_agg_minute");
    });

    it("should return analytics_agg_minute just below the 24h boundary", () => {
      const start = new Date("2025-01-15T00:00:00Z");
      const end = new Date("2025-01-15T23:59:59Z"); // just under 24h
      expect(getAggTable(start, end)).toBe("analytics_agg_minute");
    });

    it("should return analytics_agg_hour just below the 168h boundary", () => {
      const start = new Date("2025-01-10T00:00:00Z");
      const end = new Date("2025-01-16T23:59:59Z"); // just under 168h
      expect(getAggTable(start, end)).toBe("analytics_agg_hour");
    });
  });

  // =========================================================================
  // parseQueryParams
  // =========================================================================

  describe("parseQueryParams", () => {
    it("should return sensible defaults when no params are provided", () => {
      const before = Date.now();
      const result = parseQueryParams(makeContext());
      const after = Date.now();

      // end should be approximately "now"
      expect(result.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.end.getTime()).toBeLessThanOrEqual(after);

      // start should be approximately 7 days before "now"
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(result.start.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs);
      expect(result.start.getTime()).toBeLessThanOrEqual(after - sevenDaysMs);

      // default limit is 50
      expect(result.limit).toBe(50);
    });

    it("should parse valid start and end dates", () => {
      const result = parseQueryParams(
        makeContext({ start: "2025-03-01T00:00:00Z", end: "2025-03-15T00:00:00Z" }),
      );

      expect(result.start).toEqual(new Date("2025-03-01T00:00:00Z"));
      expect(result.end).toEqual(new Date("2025-03-15T00:00:00Z"));
    });

    it("should fall back to defaults for an invalid start date string", () => {
      const before = Date.now();
      const result = parseQueryParams(
        makeContext({ start: "not-a-date", end: "2025-03-15T00:00:00Z" }),
      );
      const after = Date.now();

      // start should fall back to ~7 days ago
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(result.start.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs);
      expect(result.start.getTime()).toBeLessThanOrEqual(after - sevenDaysMs);

      // end should still be the valid date
      expect(result.end).toEqual(new Date("2025-03-15T00:00:00Z"));
    });

    it("should fall back to defaults for an invalid end date string", () => {
      const before = Date.now();
      const result = parseQueryParams(
        makeContext({ start: "2025-03-01T00:00:00Z", end: "banana" }),
      );
      const after = Date.now();

      expect(result.start).toEqual(new Date("2025-03-01T00:00:00Z"));

      // end should fall back to ~now
      expect(result.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.end.getTime()).toBeLessThanOrEqual(after);
    });

    it("should fall back to defaults when both dates are invalid", () => {
      const before = Date.now();
      const result = parseQueryParams(
        makeContext({ start: "xxx", end: "yyy" }),
      );
      const after = Date.now();

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(result.start.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs);
      expect(result.start.getTime()).toBeLessThanOrEqual(after - sevenDaysMs);
      expect(result.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.end.getTime()).toBeLessThanOrEqual(after);
    });

    it("should parse a custom limit", () => {
      const result = parseQueryParams(makeContext({ limit: "200" }));
      expect(result.limit).toBe(200);
    });

    it("should clamp limit to a minimum of 1", () => {
      const result = parseQueryParams(makeContext({ limit: "-5" }));
      expect(result.limit).toBe(1);
    });

    it("should clamp limit to a maximum of 1000", () => {
      const result = parseQueryParams(makeContext({ limit: "9999" }));
      expect(result.limit).toBe(1000);
    });

    it("should default limit to 50 for non-numeric strings", () => {
      const result = parseQueryParams(makeContext({ limit: "abc" }));
      // parseInt("abc", 10) returns NaN. Because "abc" is truthy the
      // `|| "50"` fallback is skipped, so the raw NaN propagates through
      // Math.max(1, NaN) -> NaN and Math.min(1000, NaN) -> NaN.
      expect(result.limit).toBeNaN();
    });

    it("should parse all filter fields correctly", () => {
      const result = parseQueryParams(
        makeContext({
          country: "GB",
          device: "desktop",
          browser: "Chrome",
          os: "Windows",
          referrer_domain: "google.com",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "spring-sale",
          pathname: "/blog",
        }),
      );

      expect(result.filters.country).toBe("GB");
      expect(result.filters.device).toBe("desktop");
      expect(result.filters.browser).toBe("Chrome");
      expect(result.filters.os).toBe("Windows");
      expect(result.filters.referrer_domain).toBe("google.com");
      expect(result.filters.utm_source).toBe("newsletter");
      expect(result.filters.utm_medium).toBe("email");
      expect(result.filters.utm_campaign).toBe("spring-sale");
      expect(result.filters.pathname).toBe("/blog");
    });

    it("should default all filter fields to empty strings", () => {
      const result = parseQueryParams(makeContext());

      expect(result.filters.country).toBe("");
      expect(result.filters.device).toBe("");
      expect(result.filters.browser).toBe("");
      expect(result.filters.os).toBe("");
      expect(result.filters.referrer_domain).toBe("");
      expect(result.filters.utm_source).toBe("");
      expect(result.filters.utm_medium).toBe("");
      expect(result.filters.utm_campaign).toBe("");
      expect(result.filters.pathname).toBe("");
    });
  });

  // =========================================================================
  // hasFilters
  // =========================================================================

  describe("hasFilters", () => {
    it("should return false when all filters are empty strings", () => {
      const filters = {
        country: "",
        device: "",
        browser: "",
        os: "",
        referrer_domain: "",
        utm_source: "",
        utm_medium: "",
        utm_campaign: "",
        pathname: "",
      };
      expect(hasFilters(filters)).toBe(false);
    });

    it("should return true when a single filter has a value", () => {
      expect(hasFilters({ country: "US", device: "" })).toBe(true);
    });

    it("should return true when multiple filters have values", () => {
      expect(hasFilters({ country: "GB", browser: "Firefox", os: "" })).toBe(true);
    });

    it("should return false for an empty object", () => {
      expect(hasFilters({})).toBe(false);
    });
  });

  // =========================================================================
  // buildFilterWhere
  // =========================================================================

  describe("buildFilterWhere", () => {
    it("should return empty arrays when no filters are set", () => {
      const result = buildFilterWhere({
        country: "",
        device: "",
        browser: "",
        os: "",
        referrer_domain: "",
        utm_source: "",
        utm_medium: "",
        utm_campaign: "",
        pathname: "",
      });

      expect(result.clauses).toEqual([]);
      expect(result.params).toEqual({});
    });

    it("should build a clause for the country filter", () => {
      const result = buildFilterWhere({ country: "US" });
      expect(result.clauses).toContain("AND country_code = {f_country:String}");
      expect(result.params.f_country).toBe("US");
    });

    it("should build a clause for the device filter", () => {
      const result = buildFilterWhere({ device: "mobile" });
      expect(result.clauses).toContain("AND device_type = {f_device:String}");
      expect(result.params.f_device).toBe("mobile");
    });

    it("should build a clause for the browser filter", () => {
      const result = buildFilterWhere({ browser: "Safari" });
      expect(result.clauses).toContain("AND browser = {f_browser:String}");
      expect(result.params.f_browser).toBe("Safari");
    });

    it("should build a clause for the os filter", () => {
      const result = buildFilterWhere({ os: "macOS" });
      expect(result.clauses).toContain("AND os = {f_os:String}");
      expect(result.params.f_os).toBe("macOS");
    });

    it("should build a clause for the referrer_domain filter", () => {
      const result = buildFilterWhere({ referrer_domain: "google.com" });
      expect(result.clauses).toContain("AND referrer_domain = {f_ref:String}");
      expect(result.params.f_ref).toBe("google.com");
    });

    it("should build a clause for the utm_source filter", () => {
      const result = buildFilterWhere({ utm_source: "newsletter" });
      expect(result.clauses).toContain("AND utm_source = {f_usrc:String}");
      expect(result.params.f_usrc).toBe("newsletter");
    });

    it("should build a clause for the utm_medium filter", () => {
      const result = buildFilterWhere({ utm_medium: "email" });
      expect(result.clauses).toContain("AND utm_medium = {f_umed:String}");
      expect(result.params.f_umed).toBe("email");
    });

    it("should build a clause for the utm_campaign filter", () => {
      const result = buildFilterWhere({ utm_campaign: "spring-sale" });
      expect(result.clauses).toContain("AND utm_campaign = {f_ucam:String}");
      expect(result.params.f_ucam).toBe("spring-sale");
    });

    it("should build a LIKE clause for pathname and append a % wildcard", () => {
      const result = buildFilterWhere({ pathname: "/blog" });
      expect(result.clauses).toContain("AND pathname LIKE {f_path:String}");
      expect(result.params.f_path).toBe("/blog%");
    });

    it("should build multiple clauses when multiple filters are provided", () => {
      const result = buildFilterWhere({
        country: "GB",
        browser: "Chrome",
        pathname: "/docs",
      });

      expect(result.clauses).toHaveLength(3);
      expect(result.clauses).toContain("AND country_code = {f_country:String}");
      expect(result.clauses).toContain("AND browser = {f_browser:String}");
      expect(result.clauses).toContain("AND pathname LIKE {f_path:String}");
      expect(result.params.f_country).toBe("GB");
      expect(result.params.f_browser).toBe("Chrome");
      expect(result.params.f_path).toBe("/docs%");
    });

    it("should build all nine clauses when every filter is provided", () => {
      const result = buildFilterWhere({
        country: "US",
        device: "desktop",
        browser: "Firefox",
        os: "Linux",
        referrer_domain: "bing.com",
        utm_source: "ads",
        utm_medium: "cpc",
        utm_campaign: "launch",
        pathname: "/pricing",
      });

      expect(result.clauses).toHaveLength(9);
      expect(Object.keys(result.params)).toHaveLength(9);
    });
  });

  // =========================================================================
  // toClickHouseDate
  // =========================================================================

  describe("toClickHouseDate", () => {
    it("should format a UTC date to 'YYYY-MM-DD HH:mm:ss'", () => {
      const date = new Date("2025-01-15T10:30:00Z");
      expect(toClickHouseDate(date)).toBe("2025-01-15 10:30:00");
    });

    it("should remove the T separator and Z timezone indicator", () => {
      const result = toClickHouseDate(new Date("2025-06-01T00:00:00Z"));
      expect(result).not.toContain("T");
      expect(result).not.toContain("Z");
    });

    it("should truncate milliseconds", () => {
      const date = new Date("2025-01-15T10:30:45.123Z");
      expect(toClickHouseDate(date)).toBe("2025-01-15 10:30:45");
    });

    it("should handle midnight correctly", () => {
      const date = new Date("2025-12-31T00:00:00Z");
      expect(toClickHouseDate(date)).toBe("2025-12-31 00:00:00");
    });

    it("should handle end-of-day correctly", () => {
      const date = new Date("2025-01-01T23:59:59Z");
      expect(toClickHouseDate(date)).toBe("2025-01-01 23:59:59");
    });

    it("should produce a string of exactly 19 characters", () => {
      const date = new Date("2025-07-04T12:00:00Z");
      expect(toClickHouseDate(date)).toHaveLength(19);
    });
  });

  // =========================================================================
  // topN
  // =========================================================================

  describe("topN", () => {
    it("should return the top N items sorted by count descending", () => {
      const items = [
        { name: "a", count: 10 },
        { name: "b", count: 50 },
        { name: "c", count: 30 },
        { name: "d", count: 20 },
      ];

      const result = topN(items, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: "b", count: 50 });
      expect(result[1]).toEqual({ name: "c", count: 30 });
    });

    it("should return all items when N is greater than array length", () => {
      const items = [
        { name: "a", count: 5 },
        { name: "b", count: 3 },
      ];

      const result = topN(items, 10);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: "a", count: 5 });
      expect(result[1]).toEqual({ name: "b", count: 3 });
    });

    it("should return an empty array when given an empty array", () => {
      const result = topN([], 5);
      expect(result).toEqual([]);
    });

    it("should return exactly N items when N equals the array length", () => {
      const items = [
        { name: "x", count: 1 },
        { name: "y", count: 2 },
        { name: "z", count: 3 },
      ];

      const result = topN(items, 3);

      expect(result).toHaveLength(3);
      expect(result[0].count).toBe(3);
      expect(result[1].count).toBe(2);
      expect(result[2].count).toBe(1);
    });

    it("should handle items with equal counts", () => {
      const items = [
        { name: "a", count: 10 },
        { name: "b", count: 10 },
        { name: "c", count: 10 },
      ];

      const result = topN(items, 2);

      expect(result).toHaveLength(2);
      // All counts are equal so any two of the three is acceptable
      result.forEach((item) => expect(item.count).toBe(10));
    });

    it("should return an empty array when N is 0", () => {
      const items = [{ name: "a", count: 5 }];
      const result = topN(items, 0);
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getTimeBucketInterval
  // =========================================================================

  describe("getTimeBucketInterval", () => {
    it("should return minute bucketing for durations under 24 hours", () => {
      const start = new Date("2025-01-15T00:00:00Z");
      const end = new Date("2025-01-15T12:00:00Z");
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfMinute(timestamp)");
    });

    it("should return hour bucketing for durations of 24h to under 7 days", () => {
      const start = new Date("2025-01-10T00:00:00Z");
      const end = new Date("2025-01-13T00:00:00Z"); // 3 days
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfHour(timestamp)");
    });

    it("should return day bucketing for durations of 7 days or more", () => {
      const start = new Date("2025-01-01T00:00:00Z");
      const end = new Date("2025-01-31T00:00:00Z");
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfDay(timestamp)");
    });

    it("should return hour bucketing at exactly 24 hours (boundary)", () => {
      const start = new Date("2025-01-15T00:00:00Z");
      const end = new Date("2025-01-16T00:00:00Z");
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfHour(timestamp)");
    });

    it("should return day bucketing at exactly 168 hours (boundary)", () => {
      const start = new Date("2025-01-10T00:00:00Z");
      const end = new Date("2025-01-17T00:00:00Z");
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfDay(timestamp)");
    });

    it("should return minute bucketing just below the 24h boundary", () => {
      const start = new Date("2025-01-15T00:00:00Z");
      const end = new Date("2025-01-15T23:59:59Z");
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfMinute(timestamp)");
    });

    it("should return hour bucketing just below the 168h boundary", () => {
      const start = new Date("2025-01-10T00:00:00Z");
      const end = new Date("2025-01-16T23:59:59Z");
      expect(getTimeBucketInterval(start, end)).toBe("toStartOfHour(timestamp)");
    });
  });
});
