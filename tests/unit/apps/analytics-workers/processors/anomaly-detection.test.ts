/**
 * Anomaly Detection Processor Unit Tests
 *
 * Tests for the anomaly detection processor that compares recent traffic
 * against cached baselines and flags significant deviations. Baselines
 * are computed from hourly aggregates grouped by day-of-week and hour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { AnalyticsAnomalyDetectionJobData } from "@uni-proxy-manager/queue";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockFindMany = vi.fn();

vi.mock("../../../../../packages/database/src/index", () => ({
  db: {
    query: {
      analyticsConfig: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
  analyticsConfig: { id: "id", enabled: "enabled" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: string, val: unknown) => ({ column: col, value: val })),
}));

const mockClickHouseQuery = vi.fn();

vi.mock("../../../../../apps/analytics-workers/src/clickhouse", () => ({
  getClickHouseClient: vi.fn(() => ({
    query: mockClickHouseQuery,
  })),
}));

const mockHget = vi.fn();
const mockPublish = vi.fn();
const mockZadd = vi.fn();
const mockExpire = vi.fn();
const mockPipelineHset = vi.fn().mockReturnThis();
const mockPipelineExpire = vi.fn().mockReturnThis();
const mockPipelineExec = vi.fn().mockResolvedValue([]);

vi.mock("../../../../../packages/shared/src/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    hget: mockHget,
    publish: mockPublish,
    zadd: mockZadd,
    expire: mockExpire,
    pipeline: vi.fn(() => ({
      hset: mockPipelineHset,
      expire: mockPipelineExpire,
      exec: mockPipelineExec,
    })),
  })),
}));

import { processAnomalyDetection } from "../../../../../apps/analytics-workers/src/processors/anomaly-detection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(
  overrides: Partial<AnalyticsAnomalyDetectionJobData> = {},
  name = "anomaly-detect",
): Job<AnalyticsAnomalyDetectionJobData> {
  return {
    name,
    data: {
      analyticsConfigId: "config-1",
      ...overrides,
    },
  } as unknown as Job<AnalyticsAnomalyDetectionJobData>;
}

function makeConfig(id = "config-1") {
  return { id, domainId: `domain-${id}`, enabled: true, trackingUuid: `uuid-${id}` };
}

function makeClickHouseResult(totalPv: number) {
  return {
    json: vi.fn().mockResolvedValue([{ total_pv: totalPv }]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processAnomalyDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Anomaly detection
  // =========================================================================

  describe("detect anomalies", () => {
    it("should query configs filtered by specific configId when provided", async () => {
      mockFindMany.mockResolvedValue([]);
      await processAnomalyDetection(makeJob({ analyticsConfigId: "config-42" }));

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ value: "config-42" }),
        }),
      );
    });

    it("should skip configs without a cached baseline", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockHget.mockResolvedValue(null);

      await processAnomalyDetection(makeJob());

      expect(mockClickHouseQuery).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("should skip configs with zero stddev baseline", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "0",
      );

      await processAnomalyDetection(makeJob());

      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });

    it("should query recent traffic from hourly aggregates using sumMerge", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(100));

      await processAnomalyDetection(makeJob());

      expect(mockClickHouseQuery).toHaveBeenCalledOnce();
      const call = mockClickHouseQuery.mock.calls[0][0];
      expect(call.query).toContain("analytics_agg_hour");
      expect(call.query).toContain("sumMerge(page_views)");
      expect(call.query_params.configId).toBe("config-1");
    });

    it("should not publish when z-score is within threshold", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      // mean=100, stddev=30, actual=100 => z-score=0
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(100));

      await processAnomalyDetection(makeJob());

      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("should publish traffic_spike when z-score exceeds +2", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      // mean=100, stddev=30, actual=200 => z-score=3.33
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(200));

      await processAnomalyDetection(makeJob());

      expect(mockPublish).toHaveBeenCalledWith(
        "analytics:anomaly:config-1",
        expect.any(String),
      );

      const published = JSON.parse(mockPublish.mock.calls[0][1]);
      expect(published.type).toBe("traffic_spike");
      expect(published.actual).toBe(200);
      expect(published.expected).toBe(100);
      expect(published.zScore).toBeGreaterThan(2);
    });

    it("should publish traffic_drop when z-score is below -2", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      // mean=100, stddev=30, actual=10 => z-score=-3
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(10));

      await processAnomalyDetection(makeJob());

      const published = JSON.parse(mockPublish.mock.calls[0][1]);
      expect(published.type).toBe("traffic_drop");
      expect(published.actual).toBe(10);
    });

    it("should store anomaly in sorted set with 24h TTL", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(200));

      await processAnomalyDetection(makeJob());

      expect(mockZadd).toHaveBeenCalledWith(
        "analytics:anomalies:config-1",
        expect.any(Number),
        expect.any(String),
      );
      expect(mockExpire).toHaveBeenCalledWith("analytics:anomalies:config-1", 86400);
    });

    it("should handle zero traffic gracefully", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      // mean=100, stddev=30, actual=0 => z-score=-3.33
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(0));

      await processAnomalyDetection(makeJob());

      expect(mockPublish).toHaveBeenCalled();
      const published = JSON.parse(mockPublish.mock.calls[0][1]);
      expect(published.type).toBe("traffic_drop");
      expect(published.actual).toBe(0);
    });

    it("should handle empty ClickHouse result", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "50" : "20",
      );
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      // actual defaults to 0 => z-score = -2.5
      await processAnomalyDetection(makeJob());

      expect(mockPublish).toHaveBeenCalled();
    });

    it("should process multiple configs independently", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1"), makeConfig("cfg-2")]);
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      // First config: normal traffic; second: spike
      mockClickHouseQuery
        .mockResolvedValueOnce(makeClickHouseResult(100))
        .mockResolvedValueOnce(makeClickHouseResult(250));

      await processAnomalyDetection(makeJob());

      // Only second config should trigger an anomaly
      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalledWith(
        "analytics:anomaly:cfg-2",
        expect.any(String),
      );
    });

    it("should continue processing other configs when one errors", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-err"), makeConfig("cfg-ok")]);
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // First query fails, second shows spike
      mockClickHouseQuery
        .mockRejectedValueOnce(new Error("CH timeout"))
        .mockResolvedValueOnce(makeClickHouseResult(250));

      await processAnomalyDetection(makeJob());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("cfg-err"),
        expect.any(Error),
      );
      expect(mockPublish).toHaveBeenCalledWith(
        "analytics:anomaly:cfg-ok",
        expect.any(String),
      );

      consoleSpy.mockRestore();
    });

    it("should round z-score to 2 decimal places", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      // mean=100, stddev=30, actual=170 => z-score=2.333...
      mockHget.mockImplementation((_key: string, field: string) =>
        field.includes("mean") ? "100" : "30",
      );
      mockClickHouseQuery.mockResolvedValue(makeClickHouseResult(170));

      await processAnomalyDetection(makeJob());

      const published = JSON.parse(mockPublish.mock.calls[0][1]);
      expect(published.zScore).toBe(2.33);
    });
  });

  // =========================================================================
  // Baseline recomputation
  // =========================================================================

  describe("recompute baselines", () => {
    it("should fetch all enabled configs", async () => {
      mockFindMany.mockResolvedValue([]);

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ value: true }),
        }),
      );
    });

    it("should query hourly aggregates from ClickHouse using sumMerge", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1")]);
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      expect(mockClickHouseQuery).toHaveBeenCalledOnce();
      const call = mockClickHouseQuery.mock.calls[0][0];
      expect(call.query).toContain("analytics_agg_hour");
      expect(call.query).toContain("sumMerge(page_views)");
      expect(call.query).toContain("toDayOfWeek");
      expect(call.query).toContain("toHour");
      expect(call.query_params.configId).toBe("cfg-1");
    });

    it("should compute real mean and stddev from observations per slot", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1")]);
      // Provide multiple observations for the same (dow, hour) slot.
      // ClickHouse toDayOfWeek: 1=Mon => JS day 1
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 1, hour_of_day: 10, hourly_pv: 100 },
          { day_of_week: 1, hour_of_day: 10, hourly_pv: 120 },
          { day_of_week: 1, hour_of_day: 10, hourly_pv: 80 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      // mean = (100 + 120 + 80) / 3 = 100
      // variance = ((0)^2 + (20)^2 + (-20)^2) / 3 = 800/3
      // stddev = sqrt(800/3) ~ 16.33
      const meanCalls = mockPipelineHset.mock.calls.filter(
        (call: unknown[]) => (call[1] as string) === "1:10:mean",
      );
      expect(meanCalls).toHaveLength(1);
      expect(parseFloat(meanCalls[0][2] as string)).toBe(100);

      const stddevCalls = mockPipelineHset.mock.calls.filter(
        (call: unknown[]) => (call[1] as string) === "1:10:stddev",
      );
      expect(stddevCalls).toHaveLength(1);
      expect(parseFloat(stddevCalls[0][2] as string)).toBeCloseTo(16.33, 1);
    });

    it("should use fallback stddev when fewer than 3 observations", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1")]);
      // Only 2 observations for the slot
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 2, hour_of_day: 14, hourly_pv: 80 },
          { day_of_week: 2, hour_of_day: 14, hourly_pv: 120 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      // mean = (80 + 120) / 2 = 100
      // n < 3 => fallback: max(mean * 0.5, 1) = max(50, 1) = 50
      const meanCalls = mockPipelineHset.mock.calls.filter(
        (call: unknown[]) => (call[1] as string) === "2:14:mean",
      );
      expect(parseFloat(meanCalls[0][2] as string)).toBe(100);

      const stddevCalls = mockPipelineHset.mock.calls.filter(
        (call: unknown[]) => (call[1] as string) === "2:14:stddev",
      );
      expect(parseFloat(stddevCalls[0][2] as string)).toBe(50);
    });

    it("should set 48h TTL on baseline keys", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1")]);
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 1, hour_of_day: 0, hourly_pv: 100 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      expect(mockPipelineExpire).toHaveBeenCalledWith(
        "analytics:baseline:cfg-1",
        172800,
      );
    });

    it("should convert ClickHouse toDayOfWeek 7 (Sunday) to JS 0", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 7, hour_of_day: 12, hourly_pv: 50 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      // All hset calls should use JS day 0 for Sunday
      const hsetKeys = mockPipelineHset.mock.calls.map((call: unknown[]) => call[1] as string);
      expect(hsetKeys.every((k: string) => k.startsWith("0:"))).toBe(true);
    });

    it("should guard stddev to minimum of 1 even with enough data", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      // All identical values => variance = 0 => stddev = 0 => guarded to 1
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 3, hour_of_day: 5, hourly_pv: 10 },
          { day_of_week: 3, hour_of_day: 5, hourly_pv: 10 },
          { day_of_week: 3, hour_of_day: 5, hourly_pv: 10 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      const stddevCalls = mockPipelineHset.mock.calls.filter(
        (call: unknown[]) => (call[1] as string).includes(":stddev"),
      );
      expect(stddevCalls.every((call: unknown[]) => parseFloat(call[2] as string) >= 1)).toBe(true);
    });

    it("should use fallback stddev of 1 when mean is zero with few observations", async () => {
      mockFindMany.mockResolvedValue([makeConfig()]);
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 1, hour_of_day: 3, hourly_pv: 0 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      // n=1 < 3 => fallback: max(0 * 0.5, 1) = 1
      const stddevCalls = mockPipelineHset.mock.calls.filter(
        (call: unknown[]) => (call[1] as string).includes(":stddev"),
      );
      expect(stddevCalls.every((call: unknown[]) => parseFloat(call[2] as string) === 1)).toBe(true);
    });

    it("should continue processing other configs when one errors", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-err"), makeConfig("cfg-ok")]);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockClickHouseQuery
        .mockRejectedValueOnce(new Error("CH error"))
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue([
            { day_of_week: 1, hour_of_day: 0, hourly_pv: 100 },
          ]),
        });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("cfg-err"),
        expect.any(Error),
      );
      // Second config should still be processed
      expect(mockPipelineHset).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should log success for each config", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1")]);
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 3, hour_of_day: 10, hourly_pv: 50 },
        ]),
      });

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Baseline recomputed for config cfg-1"),
      );

      consoleSpy.mockRestore();
    });

    it("should handle multiple slots across different days and hours", async () => {
      mockFindMany.mockResolvedValue([makeConfig("cfg-1")]);
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          { day_of_week: 1, hour_of_day: 10, hourly_pv: 100 },
          { day_of_week: 1, hour_of_day: 11, hourly_pv: 200 },
          { day_of_week: 2, hour_of_day: 10, hourly_pv: 150 },
        ]),
      });

      await processAnomalyDetection(makeJob({}, "anomaly-baseline-recompute"));

      // Should have 3 slots x 2 fields (mean + stddev) = 6 hset calls
      expect(mockPipelineHset).toHaveBeenCalledTimes(6);

      // Verify each slot has both mean and stddev
      const keys = mockPipelineHset.mock.calls.map((call: unknown[]) => call[1] as string);
      expect(keys).toContain("1:10:mean");
      expect(keys).toContain("1:10:stddev");
      expect(keys).toContain("1:11:mean");
      expect(keys).toContain("1:11:stddev");
      expect(keys).toContain("2:10:mean");
      expect(keys).toContain("2:10:stddev");
    });
  });
});
