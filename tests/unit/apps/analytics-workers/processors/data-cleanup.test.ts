/**
 * Data Cleanup Processor Unit Tests
 *
 * Tests for the processor that deletes all ClickHouse data for a
 * removed analytics config. Queued by the API when an analytics
 * config is deleted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { AnalyticsDataCleanupJobData } from "@uni-proxy-manager/queue";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../../../apps/analytics-workers/src/clickhouse", () => ({
  getClickHouseClient: vi.fn(() => ({
    command: mockCommand,
  })),
}));

import { processDataCleanup } from "../../../../../apps/analytics-workers/src/processors/data-cleanup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(analyticsConfigId = "config-123"): Job<AnalyticsDataCleanupJobData> {
  return {
    name: "data-cleanup",
    data: { analyticsConfigId },
  } as unknown as Job<AnalyticsDataCleanupJobData>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processDataCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should issue DELETE commands for all three tables", async () => {
    await processDataCleanup(makeJob());

    expect(mockCommand).toHaveBeenCalledTimes(3);
  });

  it("should delete from analytics_events, analytics_agg_minute, and analytics_agg_hour", async () => {
    await processDataCleanup(makeJob());

    const tables = mockCommand.mock.calls.map(
      (call: unknown[]) => {
        const query = (call[0] as { query: string }).query;
        const match = query.match(/ALTER TABLE (\S+) DELETE/);
        return match?.[1];
      },
    );

    expect(tables).toContain("analytics_events");
    expect(tables).toContain("analytics_agg_minute");
    expect(tables).toContain("analytics_agg_hour");
  });

  it("should delete rows matching the given analyticsConfigId", async () => {
    await processDataCleanup(makeJob("cfg-abc-123"));

    for (const call of mockCommand.mock.calls) {
      const { query, query_params } = call[0] as { query: string; query_params: Record<string, string> };
      expect(query).toContain("analytics_config_id = {configId:String}");
      expect(query_params.configId).toBe("cfg-abc-123");
    }
  });

  it("should use parameterised queries (not string interpolation for the configId)", async () => {
    await processDataCleanup(makeJob("some-config"));

    for (const call of mockCommand.mock.calls) {
      const { query } = call[0] as { query: string };
      expect(query).toContain("{configId:String}");
      expect(query).not.toContain("some-config");
    }
  });

  it("should process tables in order: events, agg_minute, agg_hour", async () => {
    await processDataCleanup(makeJob());

    const queries = mockCommand.mock.calls.map(
      (call: unknown[]) => (call[0] as { query: string }).query,
    );

    expect(queries[0]).toContain("analytics_events");
    expect(queries[1]).toContain("analytics_agg_minute");
    expect(queries[2]).toContain("analytics_agg_hour");
  });

  it("should throw when analyticsConfigId is missing", async () => {
    const job = {
      name: "data-cleanup",
      data: { analyticsConfigId: "" },
    } as unknown as Job<AnalyticsDataCleanupJobData>;

    await expect(processDataCleanup(job)).rejects.toThrow("Missing analyticsConfigId");
  });

  it("should propagate ClickHouse errors", async () => {
    mockCommand.mockRejectedValueOnce(new Error("CH unavailable"));

    await expect(processDataCleanup(makeJob())).rejects.toThrow("CH unavailable");
  });

  it("should stop processing remaining tables if an earlier one fails", async () => {
    mockCommand
      .mockResolvedValueOnce(undefined) // analytics_events succeeds
      .mockRejectedValueOnce(new Error("CH error on agg_minute"));

    await expect(processDataCleanup(makeJob())).rejects.toThrow("CH error on agg_minute");

    // Only 2 calls: events succeeded, agg_minute failed, agg_hour was never reached
    expect(mockCommand).toHaveBeenCalledTimes(2);
  });

  it("should log progress for each table", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await processDataCleanup(makeJob("cfg-xyz"));

    const messages = consoleSpy.mock.calls.map((call) => call[0] as string);

    // Each table should produce a log line
    expect(messages.filter((m) => m.includes("Deletion queued"))).toHaveLength(3);
    expect(messages.some((m) => m.includes("analytics_events") && m.includes("cfg-xyz"))).toBe(true);
    expect(messages.some((m) => m.includes("analytics_agg_minute") && m.includes("cfg-xyz"))).toBe(true);
    expect(messages.some((m) => m.includes("analytics_agg_hour") && m.includes("cfg-xyz"))).toBe(true);

    consoleSpy.mockRestore();
  });

  it("should log a final completion message", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await processDataCleanup(makeJob("cfg-xyz"));

    const messages = consoleSpy.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.includes("All tables processed") && m.includes("cfg-xyz"))).toBe(true);

    consoleSpy.mockRestore();
  });
});
