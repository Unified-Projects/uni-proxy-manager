/**
 * Tests for internal analytics query API endpoints.
 *
 * Covers: summary, timeseries, pages, referrers, geography, devices, events, utm.
 * Authentication enforcement, empty results, table selection, and filter injection
 * are verified by inspecting mock calls and HTTP response status/body.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

// ---------------------------------------------------------------------------
// Module mocks
// vi.mock factories are hoisted to the top of the file by vitest.
// Use a literal string in the factory so it doesn't reference outer variables.
// ---------------------------------------------------------------------------

const INTERNAL_SECRET = "test-secret-abc123";

vi.mock("@uni-proxy-manager/shared/config", () => ({
  getInternalSecret: vi.fn(() => "test-secret-abc123"),
  getEnv: vi.fn(() => ({})),
}));

const mockConfigStore: Record<string, unknown> = {};

vi.mock("../../services/config-cache", () => ({
  getConfigById: vi.fn((id: string) => mockConfigStore[id]),
}));

// Build a reusable mock ClickHouse result factory.
function makeResult(rows: Record<string, unknown>[]) {
  return { json: vi.fn().mockResolvedValue(rows) };
}

const mockClient = {
  query: vi.fn(),
  insert: vi.fn().mockResolvedValue(undefined),
  ping: vi.fn().mockResolvedValue(true),
} as unknown as ClickHouseClient;

vi.mock("../../clickhouse/client", () => ({
  getClickHouseClient: vi.fn(() => mockClient),
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    zcard: vi.fn().mockResolvedValue(0),
    zrange: vi.fn().mockResolvedValue([]),
    zrangebyscore: vi.fn().mockResolvedValue([]),
  })),
}));

// Import SUT after mocks are in place.
import app from "../internal/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_ID = "cfg-test-001";
const BASE_CONFIG = {
  id: CONFIG_ID,
  domainId: "dom-001",
  trackingUuid: "uuid-001",
  enabled: true,
  hostname: "example.com",
  allowedOrigins: ["https://example.com"],
  ignoredPaths: [],
  maxBreakdownEntries: 50,
  rawRetentionDays: 90,
  aggregateRetentionDays: 365,
  trackScrollDepth: true,
  trackSessionDuration: true,
  trackOutboundLinks: true,
  captureUtmParams: true,
  apiTokenSha256: null,
};

function req(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: {
      "X-Internal-Secret": INTERNAL_SECRET,
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigStore[CONFIG_ID] = { ...BASE_CONFIG };

  // Default: return empty row sets for all queries.
  (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));
});

// ---------------------------------------------------------------------------
// Authentication enforcement
// ---------------------------------------------------------------------------

describe("internal auth enforcement", () => {
  it("returns 401 when X-Internal-Secret header is missing", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/${CONFIG_ID}/summary`),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 when X-Internal-Secret header is wrong", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/${CONFIG_ID}/summary`, {
        headers: { "X-Internal-Secret": "wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown configId even with correct auth", async () => {
    const res = await app.fetch(req("/unknown-config/summary"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("CONFIG_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Summary endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/summary", () => {
  it("returns summary with zeros for empty ClickHouse results", async () => {
    const zeroRow = {
      page_views: 0, unique_visitors: 0, sessions: 0, bounces: 0,
      total_duration: 0, session_count: 0, total_scroll: 0, scroll_count: 0,
      custom_events: 0, paths_map: {}, refs_map: {},
    };
    (mockClient.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult([zeroRow]))
      .mockResolvedValueOnce(makeResult([{ page_views: 0, unique_visitors: 0, sessions: 0, bounces: 0 }]));

    const res = await app.fetch(req(`/${CONFIG_ID}/summary`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(body.summary.pageViews).toBe(0);
    expect(body.summary.uniqueVisitors).toBe(0);
    expect(body.summary.bounceRate).toBe(0);
    expect(body.summary.avgSessionDurationMs).toBe(0);
  });

  it("returns correct numeric values from ClickHouse", async () => {
    // First call is the current period, second is the previous period.
    (mockClient.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult([{
        page_views: 500,
        unique_visitors: 200,
        sessions: 220,
        bounces: 44,
        total_duration: 110000,
        session_count: 220,
        total_scroll: 6600,
        scroll_count: 220,
        custom_events: 30,
        paths_map: { "/home": 300, "/about": 200 },
        refs_map: { "google.com": 100 },
      }]))
      .mockResolvedValueOnce(makeResult([{
        page_views: 400,
        unique_visitors: 160,
        sessions: 180,
        bounces: 36,
      }]));

    const res = await app.fetch(req(`/${CONFIG_ID}/summary`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary.pageViews).toBe(500);
    expect(body.summary.uniqueVisitors).toBe(200);
    expect(body.summary.bounceRate).toBeGreaterThan(0);
    expect(body.summary.avgSessionDurationMs).toBe(500); // 110000/220
    expect(body.summary.topPage).toBe("/home");
    expect(body.summary.topReferrer).toBe("google.com");
    expect(body.comparison).not.toBeNull();
    expect(typeof body.comparison.pageViewsChange).toBe("number");
  });

  it("selects analytics_agg_minute table for < 24h range", async () => {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    const start = twelveHoursAgo.toISOString();
    const end = now.toISOString();

    await app.fetch(req(`/${CONFIG_ID}/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstQuery: string = calls[0][0].query;
    expect(firstQuery).toContain("analytics_agg_minute");
  });

  it("selects analytics_agg_hour table for 24h–7d range", async () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    const start = threeDaysAgo.toISOString();
    const end = now.toISOString();

    await app.fetch(req(`/${CONFIG_ID}/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstQuery: string = calls[0][0].query;
    expect(firstQuery).toContain("analytics_agg_hour");
  });

  it("selects analytics_agg_day table for > 7d range", async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    const start = thirtyDaysAgo.toISOString();
    const end = now.toISOString();

    await app.fetch(req(`/${CONFIG_ID}/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstQuery: string = calls[0][0].query;
    expect(firstQuery).toContain("analytics_agg_day");
  });

  it("uses raw events table when cross-dimensional filters are active", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    await app.fetch(req(`/${CONFIG_ID}/summary?country=US`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstQuery: string = calls[0][0].query;
    expect(firstQuery).toContain("analytics_events");
    expect(firstQuery).toContain("country_code");
  });
});

// ---------------------------------------------------------------------------
// Timeseries endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/timeseries", () => {
  it("returns timeseries array with correct shape", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([
      { bucket_start: "2024-01-01 00:00:00", page_views: 10, unique_visitors: 8, sessions: 9, bounces: 2, custom_events: 1 },
      { bucket_start: "2024-01-01 01:00:00", page_views: 15, unique_visitors: 12, sessions: 13, bounces: 3, custom_events: 2 },
    ]));

    const res = await app.fetch(req(`/${CONFIG_ID}/timeseries`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.timeseries)).toBe(true);
    expect(body.timeseries.length).toBe(2);
    expect(body.timeseries[0]).toMatchObject({
      pageViews: 10,
      uniqueVisitors: 8,
      sessions: 9,
    });
  });

  it("returns empty timeseries array for no data", async () => {
    const res = await app.fetch(req(`/${CONFIG_ID}/timeseries`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeseries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pages endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/pages", () => {
  it("returns pages, entryPages, exitPages, and outboundLinks fields", async () => {
    // Unfiltered path returns 5 queries (pagesQuery, pageStatsQuery, entryQuery, exitQuery, outboundQuery).
    (mockClient.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult([{ pathname: "/home", pv: 300 }]))
      .mockResolvedValueOnce(makeResult([{ pathname: "/home", unique_visitors: 150, avg_duration: 30000, avg_scroll: 60 }]))
      .mockResolvedValueOnce(makeResult([{ pathname: "/home", cnt: 100 }]))
      .mockResolvedValueOnce(makeResult([{ pathname: "/home", cnt: 80 }]))
      .mockResolvedValueOnce(makeResult([]));

    const res = await app.fetch(req(`/${CONFIG_ID}/pages`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.pages)).toBe(true);
    expect(Array.isArray(body.entryPages)).toBe(true);
    expect(Array.isArray(body.exitPages)).toBe(true);
    expect(Array.isArray(body.outboundLinks)).toBe(true);

    expect(body.pages[0].pathname).toBe("/home");
    expect(body.pages[0].pageViews).toBe(300);
    expect(body.pages[0].uniqueVisitors).toBe(150);
    expect(body.pages[0].avgDurationMs).toBe(30000);
    expect(body.pages[0].avgScrollDepthPct).toBe(60);
    expect(body.entryPages[0].pathname).toBe("/home");
    expect(body.exitPages[0].pathname).toBe("/home");
  });

  it("returns empty arrays for no data", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));

    const res = await app.fetch(req(`/${CONFIG_ID}/pages`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pages).toEqual([]);
    expect(body.entryPages).toEqual([]);
  });

  it("injects pathname filter into query params when filter active", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));

    await app.fetch(req(`/${CONFIG_ID}/pages?pathname=/blog`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    const queryParams = calls[0][0].query_params;
    expect(queryParams).toHaveProperty("f_path");
    expect(queryParams.f_path).toBe("/blog%");
  });
});

// ---------------------------------------------------------------------------
// Referrers endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/referrers", () => {
  it("returns referrers array with domain/visitors/pageViews", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([
      { domain: "google.com", cnt: 120 },
      { domain: "twitter.com", cnt: 45 },
    ]));

    const res = await app.fetch(req(`/${CONFIG_ID}/referrers`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.referrers)).toBe(true);
    expect(body.referrers[0].domain).toBe("google.com");
    expect(typeof body.referrers[0].visitors).toBe("number");
  });

  it("returns empty referrers array for no data", async () => {
    const res = await app.fetch(req(`/${CONFIG_ID}/referrers`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referrers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Geography endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/geography", () => {
  it("returns countries array with countryCode/visitors/pageViews", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([
      { country_code: "US", cnt: 500 },
      { country_code: "GB", cnt: 200 },
    ]));

    const res = await app.fetch(req(`/${CONFIG_ID}/geography`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.countries)).toBe(true);
    expect(body.countries[0].countryCode).toBe("US");
    expect(typeof body.countries[0].visitors).toBe("number");
  });

  it("returns empty countries array for no data", async () => {
    const res = await app.fetch(req(`/${CONFIG_ID}/geography`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Devices endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/devices", () => {
  it("returns devices breakdown with desktop/mobile/tablet/other counts", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{
      devices_map: { desktop: 300, mobile: 200, tablet: 50 },
      browsers_map: { Chrome: 400, Firefox: 150 },
      os_map: { Windows: 350, macOS: 200 },
    }]));

    const res = await app.fetch(req(`/${CONFIG_ID}/devices`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.devices.desktop).toBe(300);
    expect(body.devices.mobile).toBe(200);
    expect(body.devices.tablet).toBe(50);
    expect(body.devices.other).toBe(0);
    expect(Array.isArray(body.browsers)).toBe(true);
    expect(Array.isArray(body.os)).toBe(true);
  });

  it("returns zeros for all device types when no data", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    const res = await app.fetch(req(`/${CONFIG_ID}/devices`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.devices.desktop).toBe(0);
    expect(body.devices.mobile).toBe(0);
    expect(body.devices.tablet).toBe(0);
    expect(body.devices.other).toBe(0);
  });

  it("returns filtered device breakdown from raw events table when filter active", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([
      { device_type: "mobile", cnt: 100 },
    ]));

    await app.fetch(req(`/${CONFIG_ID}/devices?country=US`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    const firstQuery: string = calls[0][0].query;
    expect(firstQuery).toContain("analytics_events");
    expect(firstQuery).toContain("device_type");
  });
});

// ---------------------------------------------------------------------------
// Events endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/events", () => {
  it("returns events array with name/count/uniqueVisitors", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([
      { name: "button_click", count: 42, unique_visitors: 30 },
      { name: "form_submit", count: 15, unique_visitors: 12 },
    ]));

    const res = await app.fetch(req(`/${CONFIG_ID}/events`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events[0].name).toBe("button_click");
    expect(body.events[0].count).toBe(42);
    expect(body.events[0].uniqueVisitors).toBe(30);
  });

  it("returns empty events array when no custom events", async () => {
    const res = await app.fetch(req(`/${CONFIG_ID}/events`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });
});

describe("GET /:configId/events/:eventName", () => {
  it("returns detailed event data with metadata and timeseries", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult([{ total_count: 100, unique_visitors: 80 }]))
      .mockResolvedValueOnce(makeResult([{ meta_key: "plan", meta_value: "pro", cnt: 50 }]))
      .mockResolvedValueOnce(makeResult([{ pathname: "/pricing", cnt: 60 }]))
      .mockResolvedValueOnce(makeResult([{ bucket_start: "2024-01-01 00:00:00", count: 20 }]));

    const res = await app.fetch(req(`/${CONFIG_ID}/events/button_click`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.eventName).toBe("button_click");
    expect(body.totalCount).toBe(100);
    expect(body.uniqueVisitors).toBe(80);
    expect(Array.isArray(body.metadata)).toBe(true);
    expect(body.metadata[0].key).toBe("plan");
    expect(body.metadata[0].value).toBe("pro");
    expect(Array.isArray(body.topPages)).toBe(true);
    expect(Array.isArray(body.timeseries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UTM endpoint
// ---------------------------------------------------------------------------

describe("GET /:configId/utm", () => {
  it("returns sources, mediums, and campaigns arrays", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{
      sources_map: { google: 200, facebook: 80 },
      mediums_map: { organic: 200, cpc: 80 },
      campaigns_map: { summer_sale: 150 },
    }]));

    const res = await app.fetch(req(`/${CONFIG_ID}/utm`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
    expect(Array.isArray(body.mediums)).toBe(true);
    expect(Array.isArray(body.campaigns)).toBe(true);
  });

  it("returns empty arrays for no UTM data", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    const res = await app.fetch(req(`/${CONFIG_ID}/utm`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toEqual([]);
    expect(body.mediums).toEqual([]);
    expect(body.campaigns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Filter injection correctness
// ---------------------------------------------------------------------------

describe("filter parameter injection", () => {
  it("injects country filter as f_country query param", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    await app.fetch(req(`/${CONFIG_ID}/summary?country=DE`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].query_params).toHaveProperty("f_country", "DE");
  });

  it("injects browser filter as f_browser query param", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    await app.fetch(req(`/${CONFIG_ID}/summary?browser=Chrome`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].query_params).toHaveProperty("f_browser", "Chrome");
  });

  it("injects referrer_domain filter as f_ref query param", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    await app.fetch(req(`/${CONFIG_ID}/referrers?referrer_domain=google.com`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].query_params).toHaveProperty("f_ref", "google.com");
  });

  it("combines multiple filters in the same query", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([{}]));

    await app.fetch(req(`/${CONFIG_ID}/summary?country=US&device=mobile&browser=Safari`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    const params = calls[0][0].query_params;
    expect(params).toHaveProperty("f_country", "US");
    expect(params).toHaveProperty("f_device", "mobile");
    expect(params).toHaveProperty("f_browser", "Safari");
  });
});

// ---------------------------------------------------------------------------
// Limit parameter handling
// ---------------------------------------------------------------------------

describe("limit parameter", () => {
  it("defaults to limit 50 when not specified", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));

    await app.fetch(req(`/${CONFIG_ID}/pages`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].query_params.limit).toBe(50);
  });

  it("caps limit at 1000 when value exceeds maximum", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));

    await app.fetch(req(`/${CONFIG_ID}/pages?limit=9999`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].query_params.limit).toBe(1000);
  });

  it("enforces minimum limit of 1", async () => {
    (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));

    await app.fetch(req(`/${CONFIG_ID}/pages?limit=0`));

    const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].query_params.limit).toBe(1);
  });
});
