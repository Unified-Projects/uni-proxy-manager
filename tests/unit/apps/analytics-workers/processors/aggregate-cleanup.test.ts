/**
 * Aggregate Cleanup Processor Unit Tests
 *
 * Tests for the processor that deletes expired rows from ClickHouse
 * aggregate tables to reclaim storage. Minute aggregates older than 7 days
 * and hour aggregates older than 180 days are removed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { AnalyticsAggregateCleanupJobData } from "@uni-proxy-manager/queue";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../../../apps/analytics-workers/src/clickhouse", () => ({
  getClickHouseClient: vi.fn(() => ({
    command: mockCommand,
  })),
}));

import { processAggregateCleanup } from "../../../../../apps/analytics-workers/src/processors/aggregate-cleanup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(): Job<AnalyticsAggregateCleanupJobData> {
  return {
    name: "aggregate-cleanup",
    data: {},
  } as unknown as Job<AnalyticsAggregateCleanupJobData>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processAggregateCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should issue two DELETE commands to ClickHouse", async () => {
    await processAggregateCleanup(makeJob());

    expect(mockCommand).toHaveBeenCalledTimes(2);
  });

  it("should delete minute aggregates older than 7 days", async () => {
    await processAggregateCleanup(makeJob());

    const minuteCall = mockCommand.mock.calls[0][0];
    expect(minuteCall.query).toContain("analytics_agg_minute");
    expect(minuteCall.query).toContain("DELETE WHERE bucket <");
    expect(minuteCall.query_params).toHaveProperty("cutoff");

    // Verify the cutoff is approximately 7 days ago
    const cutoff = minuteCall.query_params.cutoff as string;
    const cutoffDate = new Date(cutoff.replace(" ", "T") + "Z");
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expectedDate = new Date(Date.now() - sevenDaysMs);
    // Allow 5 second tolerance
    expect(Math.abs(cutoffDate.getTime() - expectedDate.getTime())).toBeLessThan(5000);
  });

  it("should delete hour aggregates older than 180 days", async () => {
    await processAggregateCleanup(makeJob());

    const hourCall = mockCommand.mock.calls[1][0];
    expect(hourCall.query).toContain("analytics_agg_hour");
    expect(hourCall.query).toContain("DELETE WHERE bucket <");
    expect(hourCall.query_params).toHaveProperty("cutoff");

    // Verify the cutoff is approximately 180 days ago
    const cutoff = hourCall.query_params.cutoff as string;
    const cutoffDate = new Date(cutoff.replace(" ", "T") + "Z");
    const oneEightyDaysMs = 180 * 24 * 60 * 60 * 1000;
    const expectedDate = new Date(Date.now() - oneEightyDaysMs);
    // Allow 5 second tolerance
    expect(Math.abs(cutoffDate.getTime() - expectedDate.getTime())).toBeLessThan(5000);
  });

  it("should use parameterised queries (not string interpolation)", async () => {
    await processAggregateCleanup(makeJob());

    for (const call of mockCommand.mock.calls) {
      const { query, query_params } = call[0];
      // Query should use ClickHouse parameter syntax
      expect(query).toContain("{cutoff:DateTime}");
      expect(query_params.cutoff).toBeDefined();
    }
  });

  it("should process minute cleanup before hour cleanup", async () => {
    await processAggregateCleanup(makeJob());

    const firstQuery = mockCommand.mock.calls[0][0].query;
    const secondQuery = mockCommand.mock.calls[1][0].query;

    expect(firstQuery).toContain("analytics_agg_minute");
    expect(secondQuery).toContain("analytics_agg_hour");
  });

  it("should propagate ClickHouse errors", async () => {
    mockCommand.mockRejectedValueOnce(new Error("CH not available"));

    await expect(processAggregateCleanup(makeJob())).rejects.toThrow("CH not available");
  });

  it("should log cleanup progress", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await processAggregateCleanup(makeJob());

    const messages = consoleSpy.mock.calls.map((call) => call[0]);
    expect(messages.some((m: string) => m.includes("minute aggregates"))).toBe(true);
    expect(messages.some((m: string) => m.includes("hour aggregates"))).toBe(true);
    expect(messages.some((m: string) => m.includes("Cleanup complete"))).toBe(true);

    consoleSpy.mockRestore();
  });

  it("should format cutoff dates as YYYY-MM-DD HH:MM:SS strings", async () => {
    await processAggregateCleanup(makeJob());

    for (const call of mockCommand.mock.calls) {
      const cutoff = call[0].query_params.cutoff as string;
      // Should match format like "2026-02-15 13:45:22"
      expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });
});
