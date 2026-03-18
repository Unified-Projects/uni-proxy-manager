/**
 * Tests for ClickHouse query builder helpers in the internal API routes.
 *
 * The private helpers (getAggTable, getTimeBucketInterval, buildFilterWhere,
 * toClickHouseDate) are not exported, so correctness is verified by observing
 * what the mocked ClickHouse client receives via route requests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const INTERNAL_SECRET = "test-secret-for-ch-queries";

vi.mock("@uni-proxy-manager/shared/config", () => ({
  getInternalSecret: vi.fn(() => "test-secret-for-ch-queries"),
  getEnv: vi.fn(() => ({})),
}));

const mockConfigStore: Record<string, unknown> = {};

vi.mock("../../services/config-cache", () => ({
  getConfigById: vi.fn((id: string) => mockConfigStore[id]),
}));

function makeResult(rows: Record<string, unknown>[]) {
  return { json: vi.fn().mockResolvedValue(rows) };
}

const mockClient = {
  query: vi.fn(),
  insert: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../clickhouse/client", () => ({
  getClickHouseClient: vi.fn(() => mockClient),
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    zcard: vi.fn().mockResolvedValue(0),
    zrange: vi.fn().mockResolvedValue([]),
  })),
}));

import app from "../../routes/internal/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONFIG_ID = "cfg-chq-001";

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigStore[CONFIG_ID] = {
    id: CONFIG_ID,
    enabled: true,
    hostname: "example.com",
    rawRetentionDays: 90,
    aggregateRetentionDays: 365,
    maxBreakdownEntries: 50,
    captureUtmParams: true,
    ignoredPaths: [],
    allowedOrigins: [],
  };

  (mockClient.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeResult([]));
});

function authHeader() {
  return { "X-Internal-Secret": INTERNAL_SECRET };
}

function makeReq(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: authHeader() });
}

// ---------------------------------------------------------------------------
// Aggregate table selection (getAggTable)
// ---------------------------------------------------------------------------

describe("getAggTable — aggregate table selection", () => {
  it("uses analytics_agg_minute for ranges under 24 hours", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("analytics_agg_minute");
  });

  it("uses analytics_agg_hour for exactly 24 hours", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // exactly 24 hours

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("analytics_agg_hour");
  });

  it("uses analytics_agg_hour for 48-hour range", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("analytics_agg_hour");
  });

  it("uses analytics_agg_day for exactly 7 days (168 hours)", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // exactly 168 hours

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("analytics_agg_day");
  });

  it("uses analytics_agg_day for 30-day range", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("analytics_agg_day");
  });
});

// ---------------------------------------------------------------------------
// Time bucket interval selection (getTimeBucketInterval)
// Used in filtered queries against raw analytics_events table.
// ---------------------------------------------------------------------------

describe("getTimeBucketInterval — raw event time bucketing", () => {
  it("buckets by minute for < 24h filtered queries", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    // country filter triggers raw events query path
    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?country=US&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("toStartOfMinute");
  });

  it("buckets by hour for 24h–7d filtered queries", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 72h

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?country=US&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("toStartOfHour");
  });

  it("buckets by day for > 7d filtered queries", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?country=US&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("toStartOfDay");
  });
});

// ---------------------------------------------------------------------------
// toClickHouseDate — date formatting for query params
// ---------------------------------------------------------------------------

describe("toClickHouseDate — ClickHouse DateTime formatting", () => {
  it("formats date params without timezone suffix and with space separator", async () => {
    const now = new Date("2024-06-15T14:30:00.000Z");
    const start = new Date("2024-06-14T14:30:00.000Z");

    await app.fetch(makeReq(
      `/${CONFIG_ID}/summary?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    const params = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query_params;

    // The formatted strings should use a space separator, not 'T', and no 'Z'.
    expect(params.start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(params.end).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(params.start).toBe("2024-06-14 14:30:00");
    expect(params.end).toBe("2024-06-15 14:30:00");
  });
});

// ---------------------------------------------------------------------------
// buildFilterWhere — SQL WHERE clause construction
// ---------------------------------------------------------------------------

describe("buildFilterWhere — filter clause generation", () => {
  it("generates AND country_code clause for country filter", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary?country=JP`));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("AND country_code");
    expect(query).toContain("{f_country:String}");
  });

  it("generates AND device_type clause for device filter", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary?device=tablet`));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("AND device_type");
  });

  it("generates AND browser clause for browser filter", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary?browser=Firefox`));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("AND browser");
  });

  it("generates AND utm_source clause for utm_source filter", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary?utm_source=newsletter`));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("AND utm_source");
  });

  it("generates LIKE clause with % suffix for pathname filter", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/pages?pathname=/docs`));

    const params = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query_params;
    expect(params.f_path).toBe("/docs%");
  });

  it("does not generate filter clauses when no filters are present", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary`));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    // Without filters, the query hits aggregate tables — no f_country etc.
    expect(query).not.toContain("{f_country:String}");
    expect(query).not.toContain("{f_device:String}");
  });

  it("queries analytics_events table when any filter is active", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary?os=macOS`));

    const query: string = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query;
    expect(query).toContain("analytics_events");
  });
});

// ---------------------------------------------------------------------------
// Retention day injection
// ---------------------------------------------------------------------------

describe("retention day injection", () => {
  it("injects rawRetentionDays when querying analytics_events", async () => {
    await app.fetch(makeReq(`/${CONFIG_ID}/summary?country=US`));

    const params = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query_params;
    expect(params.retention).toBe(90);
  });

  it("injects aggregateRetentionDays when querying aggregate tables", async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    await app.fetch(makeReq(
      `/${CONFIG_ID}/timeseries?start=${encodeURIComponent(thirtyDaysAgo.toISOString())}&end=${encodeURIComponent(now.toISOString())}`,
    ));

    // First call = current period query on aggregate table.
    const params = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0][0].query_params;
    expect(params.retention).toBe(365);
  });
});
