/**
 * Tests for analytics worker aggregation correctness.
 *
 * Covers:
 *   - aggregate-cleanup: Correct DateTime cutoff strings sent to ClickHouse
 *   - anomaly-detection: z-score calculation and threshold detection logic
 *   - funnel-compute: Session-level funnel step evaluation and conversion rates
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

// ---------------------------------------------------------------------------
// Module mocks
// vi.mock factories are hoisted — use vi.hoisted() for shared mutable state.
// ---------------------------------------------------------------------------

const mockChCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockChQuery = vi.hoisted(() => vi.fn());

vi.mock("../clickhouse", () => ({
  getClickHouseClient: vi.fn(() => ({
    command: mockChCommand,
    query: mockChQuery,
  })),
}));

const { mockDbQuery } = vi.hoisted(() => ({
  mockDbQuery: {
    analyticsConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    analyticsFunnels: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

const mockDbInsertValues = vi.hoisted(() => vi.fn().mockReturnValue({
  onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
}));
const mockDbInsert = vi.hoisted(() => vi.fn().mockReturnValue({ values: mockDbInsertValues }));

vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: mockDbQuery,
    insert: mockDbInsert,
  },
  analyticsConfig: { id: "id", enabled: "enabled" },
  analyticsFunnels: { id: "id", enabled: "enabled" },
  analyticsFunnelResults: {
    funnelId: "funnelId",
    periodStart: "periodStart",
    periodEnd: "periodEnd",
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

// Redis state — reset per test.
let mockRedisHget = vi.fn().mockResolvedValue(null);
let mockRedisPipelineFactory = vi.fn(() => ({
  hset: vi.fn(),
  expire: vi.fn(),
  exec: vi.fn().mockResolvedValue([]),
}));
let mockRedisPublish = vi.fn().mockResolvedValue(0);
let mockRedisZadd = vi.fn().mockResolvedValue(0);
let mockRedisExpire = vi.fn().mockResolvedValue(1);

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    hget: (...args: unknown[]) => mockRedisHget(...args),
    pipeline: (...args: unknown[]) => mockRedisPipelineFactory(...args),
    publish: (...args: unknown[]) => mockRedisPublish(...args),
    zadd: (...args: unknown[]) => mockRedisZadd(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
  })),
}));

vi.mock("@uni-proxy-manager/queue", () => ({}));

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "test-nanoid-id") }));

import { processAggregateCleanup } from "../processors/aggregate-cleanup";
import { processAnomalyDetection } from "../processors/anomaly-detection";
import { processFunnelCompute } from "../processors/funnel-compute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob<T>(data: T, name = "default"): Job<T> {
  return { data, name } as Job<T>;
}

function makeQueryResult(rows: Record<string, unknown>[]) {
  return { json: vi.fn().mockResolvedValue(rows) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisHget = vi.fn().mockResolvedValue(null);
  mockRedisPublish = vi.fn().mockResolvedValue(0);
  mockRedisZadd = vi.fn().mockResolvedValue(0);
  mockRedisExpire = vi.fn().mockResolvedValue(1);
  mockRedisPipelineFactory = vi.fn(() => ({
    hset: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn().mockResolvedValue([]),
  }));

  // Reset DB mocks
  mockDbQuery.analyticsConfig.findMany.mockResolvedValue([]);
  mockDbQuery.analyticsFunnels.findMany.mockResolvedValue([]);
  mockDbQuery.analyticsFunnels.findFirst.mockResolvedValue(null);
  mockDbInsertValues.mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
  mockDbInsert.mockReturnValue({ values: mockDbInsertValues });

  // Default query result
  mockChQuery.mockResolvedValue(makeQueryResult([]));
  mockChCommand.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// aggregate-cleanup
// ---------------------------------------------------------------------------

describe("processAggregateCleanup", () => {
  it("sends two DELETE commands — one for minute table, one for hour table", async () => {
    await processAggregateCleanup(makeJob({}));

    expect(mockChCommand).toHaveBeenCalledTimes(2);

    const firstCall = mockChCommand.mock.calls[0][0];
    const secondCall = mockChCommand.mock.calls[1][0];

    expect(firstCall.query).toContain("analytics_agg_minute");
    expect(firstCall.query).toContain("DELETE WHERE bucket");
    expect(secondCall.query).toContain("analytics_agg_hour");
    expect(secondCall.query).toContain("DELETE WHERE bucket");
  });

  it("uses a cutoff 7 days ago for minute aggregates", async () => {
    const before = new Date();
    await processAggregateCleanup(makeJob({}));
    const after = new Date();

    const cutoffStr: string = mockChCommand.mock.calls[0][0].query_params.cutoff;
    const cutoffDate = new Date(cutoffStr.replace(" ", "T") + "Z");

    const expectedMin = new Date(before.getTime() - 7 * 24 * 60 * 60 * 1000);
    const expectedMax = new Date(after.getTime() - 7 * 24 * 60 * 60 * 1000);

    expect(cutoffDate.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
    expect(cutoffDate.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 1000);
  });

  it("uses a cutoff 180 days ago for hour aggregates", async () => {
    const before = new Date();
    await processAggregateCleanup(makeJob({}));
    const after = new Date();

    const cutoffStr: string = mockChCommand.mock.calls[1][0].query_params.cutoff;
    const cutoffDate = new Date(cutoffStr.replace(" ", "T") + "Z");

    const expectedMin = new Date(before.getTime() - 180 * 24 * 60 * 60 * 1000);
    const expectedMax = new Date(after.getTime() - 180 * 24 * 60 * 60 * 1000);

    expect(cutoffDate.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
    expect(cutoffDate.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 1000);
  });

  it("formats the cutoff DateTime string without timezone suffix", async () => {
    await processAggregateCleanup(makeJob({}));

    const cutoffStr: string = mockChCommand.mock.calls[0][0].query_params.cutoff;
    // Should match YYYY-MM-DD HH:MM:SS (no 'T' or 'Z')
    expect(cutoffStr).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// anomaly-detection — z-score detection
// ---------------------------------------------------------------------------

describe("processAnomalyDetection — z-score detection", () => {
  const CONFIG_ID = "cfg-anomaly-001";

  beforeEach(() => {
    mockDbQuery.analyticsConfig.findMany.mockResolvedValue([{ id: CONFIG_ID, enabled: true }]);
    mockChQuery.mockResolvedValue(makeQueryResult([{ total_pv: 100 }]));
  });

  it("does not publish anomaly when mean/stddev baseline is missing from Redis", async () => {
    mockRedisHget = vi.fn().mockResolvedValue(null);

    await processAnomalyDetection(makeJob({ analyticsConfigId: CONFIG_ID }));

    expect(mockRedisPublish).not.toHaveBeenCalledWith(
      expect.stringContaining(`analytics:anomaly:`),
      expect.anything(),
    );
  });

  it("does not publish anomaly when actual traffic is within 2 standard deviations", async () => {
    // mean=100, stddev=20 → actual=110 → z=0.5 → within threshold
    mockRedisHget = vi.fn()
      .mockResolvedValueOnce("100") // mean
      .mockResolvedValueOnce("20"); // stddev

    mockChQuery.mockResolvedValue(makeQueryResult([{ total_pv: 110 }]));

    await processAnomalyDetection(makeJob({ analyticsConfigId: CONFIG_ID }));

    expect(mockRedisPublish).not.toHaveBeenCalledWith(
      expect.stringContaining(`analytics:anomaly:${CONFIG_ID}`),
      expect.anything(),
    );
  });

  it("publishes a traffic_spike anomaly when z-score exceeds +2", async () => {
    // mean=100, stddev=10 → actual=130 → z=3 → spike
    mockRedisHget = vi.fn()
      .mockResolvedValueOnce("100") // mean
      .mockResolvedValueOnce("10"); // stddev

    mockChQuery.mockResolvedValue(makeQueryResult([{ total_pv: 130 }]));

    await processAnomalyDetection(makeJob({ analyticsConfigId: CONFIG_ID }));

    expect(mockRedisPublish).toHaveBeenCalledWith(
      `analytics:anomaly:${CONFIG_ID}`,
      expect.stringContaining("traffic_spike"),
    );

    const publishedPayload = JSON.parse(mockRedisPublish.mock.calls[0][1]);
    expect(publishedPayload.type).toBe("traffic_spike");
    expect(publishedPayload.actual).toBe(130);
    expect(publishedPayload.expected).toBe(100);
    expect(publishedPayload.zScore).toBeCloseTo(3.0, 1);
  });

  it("publishes a traffic_drop anomaly when z-score is below -2", async () => {
    // mean=100, stddev=10 → actual=70 → z=-3 → drop
    mockRedisHget = vi.fn()
      .mockResolvedValueOnce("100") // mean
      .mockResolvedValueOnce("10"); // stddev

    mockChQuery.mockResolvedValue(makeQueryResult([{ total_pv: 70 }]));

    await processAnomalyDetection(makeJob({ analyticsConfigId: CONFIG_ID }));

    expect(mockRedisPublish).toHaveBeenCalledWith(
      `analytics:anomaly:${CONFIG_ID}`,
      expect.stringContaining("traffic_drop"),
    );
  });

  it("skips anomaly check when stddev is zero (prevents division by zero)", async () => {
    mockRedisHget = vi.fn()
      .mockResolvedValueOnce("100")
      .mockResolvedValueOnce("0"); // stddev = 0

    mockChQuery.mockResolvedValue(makeQueryResult([{ total_pv: 999 }]));

    await processAnomalyDetection(makeJob({ analyticsConfigId: CONFIG_ID }));

    expect(mockRedisPublish).not.toHaveBeenCalledWith(
      expect.stringContaining(`analytics:anomaly:`),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// funnel-compute — step evaluation
// ---------------------------------------------------------------------------

describe("processFunnelCompute — funnel step evaluation", () => {
  const CONFIG_ID = "cfg-funnel-001";
  const FUNNEL_ID = "funnel-test-001";

  const TWO_STEP_FUNNEL = {
    id: FUNNEL_ID,
    analyticsConfigId: CONFIG_ID,
    enabled: true,
    windowMs: 30 * 60 * 1000, // 30 minute window
    steps: [
      { name: "Landing", type: "pageview" as const, pathPattern: "/landing" },
      { name: "Signup", type: "event" as const, eventName: "signup_complete" },
    ],
  };

  beforeEach(() => {
    mockDbQuery.analyticsFunnels.findFirst.mockResolvedValue(TWO_STEP_FUNNEL);
    mockDbQuery.analyticsFunnels.findMany.mockResolvedValue([TWO_STEP_FUNNEL]);
  });

  function getInsertedValues() {
    return mockDbInsertValues.mock.calls[0]?.[0];
  }

  it("correctly counts sessions reaching step 1 (all entrants)", async () => {
    mockChQuery.mockResolvedValue(makeQueryResult([
      { session_id: "s1", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:00:00" },
      { session_id: "s2", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:01:00" },
      { session_id: "s3", event_type: "pageview", event_name: "", pathname: "/about", event_meta: {}, timestamp: "2024-01-01 10:01:00" },
    ]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    // 2 sessions reached step 1 (/landing), 1 did not
    expect(vals.totalEntrants).toBe(2);
    expect(vals.stepCounts[0]).toBe(2);
  });

  it("correctly counts sessions completing step 2 (conversion)", async () => {
    mockChQuery.mockResolvedValue(makeQueryResult([
      { session_id: "s1", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:00:00" },
      { session_id: "s1", event_type: "event", event_name: "signup_complete", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:02:00" },
      { session_id: "s2", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:01:00" },
      // s2 never fires signup_complete
    ]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    expect(vals.stepCounts[0]).toBe(2); // 2 reached landing
    expect(vals.stepCounts[1]).toBe(1); // 1 completed signup
    expect(vals.totalEntrants).toBe(2);
    expect(vals.overallConversionRate).toBe(50); // 1/2 = 50%
  });

  it("calculates step dropoffs correctly", async () => {
    mockChQuery.mockResolvedValue(makeQueryResult([
      { session_id: "s1", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:00:00" },
      { session_id: "s1", event_type: "event", event_name: "signup_complete", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:02:00" },
      { session_id: "s2", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:01:00" },
      { session_id: "s3", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:03:00" },
    ]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    // step[0]=3 entrants, step[1]=1 conversion → dropoff[0]=2, dropoff[1]=1
    expect(vals.stepDropoffs[0]).toBe(2);
    expect(vals.stepDropoffs[1]).toBe(1);
  });

  it("calculates per-step conversion rates correctly", async () => {
    mockChQuery.mockResolvedValue(makeQueryResult([
      { session_id: "s1", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:00:00" },
      { session_id: "s1", event_type: "event", event_name: "signup_complete", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:02:00" },
      { session_id: "s2", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:01:00" },
      { session_id: "s2", event_type: "event", event_name: "signup_complete", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:03:00" },
      { session_id: "s3", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:04:00" },
      { session_id: "s3", event_type: "event", event_name: "signup_complete", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:05:00" },
      { session_id: "s4", event_type: "pageview", event_name: "", pathname: "/landing", event_meta: {}, timestamp: "2024-01-01 10:06:00" },
      // s4 drops off
    ]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    // 4 entrants, 3 converted → overall 75%
    expect(vals.overallConversionRate).toBe(75);
    // Step 0 is always 100% (first step)
    expect(vals.stepConversionRates[0]).toBe(100);
    // Step 1: 3 out of 4 who reached step 0 → 75%
    expect(vals.stepConversionRates[1]).toBe(75);
  });

  it("returns 0% overall conversion rate when zero sessions enter the funnel", async () => {
    mockChQuery.mockResolvedValue(makeQueryResult([]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    expect(vals.totalEntrants).toBe(0);
    expect(vals.overallConversionRate).toBe(0);
  });

  it("skips funnel with fewer than 2 steps (not enough to compute conversion)", async () => {
    const oneStepFunnel = { ...TWO_STEP_FUNNEL, steps: [TWO_STEP_FUNNEL.steps[0]] };
    mockDbQuery.analyticsFunnels.findFirst.mockResolvedValue(oneStepFunnel);

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    // Should not write any result for a single-step funnel
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("matches pageview steps using picomatch path patterns", async () => {
    const patternFunnel = {
      ...TWO_STEP_FUNNEL,
      steps: [
        { name: "Any Product Page", type: "pageview" as const, pathPattern: "/products/**" },
        { name: "Add to Cart", type: "event" as const, eventName: "add_to_cart" },
      ],
    };
    mockDbQuery.analyticsFunnels.findFirst.mockResolvedValue(patternFunnel);

    mockChQuery.mockResolvedValue(makeQueryResult([
      { session_id: "s1", event_type: "pageview", event_name: "", pathname: "/products/shoes/nike-air", event_meta: {}, timestamp: "2024-01-01 10:00:00" },
      { session_id: "s1", event_type: "event", event_name: "add_to_cart", pathname: "/products/shoes/nike-air", event_meta: {}, timestamp: "2024-01-01 10:01:00" },
      { session_id: "s2", event_type: "pageview", event_name: "", pathname: "/blog/post", event_meta: {}, timestamp: "2024-01-01 10:02:00" },
      // s2 visits /blog — does not match /products/**
    ]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    expect(vals.totalEntrants).toBe(1); // only s1 matched /products/**
    expect(vals.stepCounts[1]).toBe(1); // s1 also converted
  });

  it("respects event meta matching on event-type funnel steps", async () => {
    const metaMatchFunnel = {
      ...TWO_STEP_FUNNEL,
      steps: [
        { name: "Checkout", type: "pageview" as const, pathPattern: "/checkout" },
        { name: "Pro Purchase", type: "event" as const, eventName: "purchase", eventMetaMatch: { plan: "pro" } },
      ],
    };
    mockDbQuery.analyticsFunnels.findFirst.mockResolvedValue(metaMatchFunnel);

    mockChQuery.mockResolvedValue(makeQueryResult([
      { session_id: "s1", event_type: "pageview", event_name: "", pathname: "/checkout", event_meta: {}, timestamp: "2024-01-01 10:00:00" },
      { session_id: "s1", event_type: "event", event_name: "purchase", pathname: "/checkout", event_meta: { plan: "pro" }, timestamp: "2024-01-01 10:01:00" },
      { session_id: "s2", event_type: "pageview", event_name: "", pathname: "/checkout", event_meta: {}, timestamp: "2024-01-01 10:02:00" },
      { session_id: "s2", event_type: "event", event_name: "purchase", pathname: "/checkout", event_meta: { plan: "basic" }, timestamp: "2024-01-01 10:03:00" },
      // s2 purchased 'basic' not 'pro' — should not convert
    ]));

    await processFunnelCompute(makeJob({ funnelId: FUNNEL_ID }));

    const vals = getInsertedValues();
    expect(vals.totalEntrants).toBe(2); // both reached checkout
    expect(vals.stepCounts[1]).toBe(1); // only s1 matched plan=pro
    expect(vals.overallConversionRate).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// anomaly-detection — baseline recomputation
// ---------------------------------------------------------------------------

describe("processAnomalyDetection — baseline recomputation", () => {
  it("queries 30 days of hourly data per config for baseline computation", async () => {
    mockDbQuery.analyticsConfig.findMany.mockResolvedValue([
      { id: "cfg-baseline-001", enabled: true },
    ]);

    mockChQuery.mockResolvedValue(makeQueryResult([
      { day_of_week: 1, hour_of_day: 9, hourly_pv: 100 },
      { day_of_week: 1, hour_of_day: 9, hourly_pv: 120 },
      { day_of_week: 1, hour_of_day: 9, hourly_pv: 110 },
    ]));

    const pipelineMock = {
      hset: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    mockRedisPipelineFactory = vi.fn(() => pipelineMock);

    await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

    // Query should target analytics_agg_hour
    const query: string = mockChQuery.mock.calls[0][0].query;
    expect(query).toContain("analytics_agg_hour");

    // Pipeline.hset should be called with mean and stddev for the slot
    expect(pipelineMock.hset).toHaveBeenCalledWith(
      `analytics:baseline:cfg-baseline-001`,
      expect.stringContaining(":mean"),
      expect.any(String),
    );
    expect(pipelineMock.hset).toHaveBeenCalledWith(
      `analytics:baseline:cfg-baseline-001`,
      expect.stringContaining(":stddev"),
      expect.any(String),
    );
  });

  it("computes mean correctly from observations", async () => {
    mockDbQuery.analyticsConfig.findMany.mockResolvedValue([
      { id: "cfg-mean-test", enabled: true },
    ]);

    // Three observations for the same slot: 100, 200, 300 → mean=200
    mockChQuery.mockResolvedValue(makeQueryResult([
      { day_of_week: 2, hour_of_day: 14, hourly_pv: 100 },
      { day_of_week: 2, hour_of_day: 14, hourly_pv: 200 },
      { day_of_week: 2, hour_of_day: 14, hourly_pv: 300 },
    ]));

    const hsetCalls: Array<[string, string, string]> = [];
    const pipelineMock = {
      hset: vi.fn((...args: unknown[]) => hsetCalls.push(args as [string, string, string])),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    mockRedisPipelineFactory = vi.fn(() => pipelineMock);

    await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

    const meanCall = hsetCalls.find(([, key]) => key.includes(":mean"));
    expect(meanCall).toBeDefined();
    expect(parseFloat(meanCall![2])).toBeCloseTo(200, 5);
  });

  it("uses a fallback stddev (mean*0.5) when fewer than 3 observations exist", async () => {
    mockDbQuery.analyticsConfig.findMany.mockResolvedValue([
      { id: "cfg-fewobs", enabled: true },
    ]);

    // Only 2 observations — not enough for reliable stddev
    mockChQuery.mockResolvedValue(makeQueryResult([
      { day_of_week: 3, hour_of_day: 10, hourly_pv: 80 },
      { day_of_week: 3, hour_of_day: 10, hourly_pv: 120 },
    ]));

    const hsetCalls: Array<[string, string, string]> = [];
    const pipelineMock = {
      hset: vi.fn((...args: unknown[]) => hsetCalls.push(args as [string, string, string])),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    mockRedisPipelineFactory = vi.fn(() => pipelineMock);

    await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

    const meanCall = hsetCalls.find(([, key]) => key.includes(":mean"));
    const stddevCall = hsetCalls.find(([, key]) => key.includes(":stddev"));

    expect(meanCall).toBeDefined();
    expect(stddevCall).toBeDefined();

    const mean = parseFloat(meanCall![2]);
    const stddev = parseFloat(stddevCall![2]);

    // Fallback: stddev = max(mean * 0.5, 1)
    expect(stddev).toBeCloseTo(mean * 0.5, 1);
  });
});
