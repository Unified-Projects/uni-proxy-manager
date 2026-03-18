/**
 * Funnel Compute Processor Unit Tests
 *
 * Tests for the funnel computation processor that evaluates funnel step
 * completion across sessions using ClickHouse event data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { AnalyticsFunnelComputeJobData } from "@uni-proxy-manager/queue";

// ---------------------------------------------------------------------------
// Interfaces mirrored from the source (not exported)
// ---------------------------------------------------------------------------

interface FunnelStep {
  name: string;
  type: "pageview" | "event";
  pathPattern?: string;
  eventName?: string;
  eventMetaMatch?: Record<string, string | number | boolean>;
}

interface RawEvent {
  session_id: string;
  event_type: string;
  event_name: string;
  pathname: string;
  event_meta: Record<string, string>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const mockValues = vi.fn().mockReturnValue({
  onConflictDoUpdate: mockOnConflictDoUpdate,
});
const mockInsert = vi.fn().mockReturnValue({
  values: mockValues,
});

vi.mock("../../../../../packages/database/src/index", () => ({
  db: {
    query: {
      analyticsFunnels: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
  },
  analyticsFunnels: { id: "id", enabled: "enabled", $inferSelect: {} as Record<string, unknown> },
  analyticsFunnelResults: {
    funnelId: "funnelId",
    periodStart: "periodStart",
    periodEnd: "periodEnd",
  },
}));

const mockClickHouseQuery = vi.fn();

vi.mock("../../../../../apps/analytics-workers/src/clickhouse", () => ({
  getClickHouseClient: vi.fn(() => ({
    query: mockClickHouseQuery,
  })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn().mockReturnValue("test-id-123"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: string, val: unknown) => ({ column: col, value: val })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClickHouseResult(events: RawEvent[]) {
  return {
    json: vi.fn().mockResolvedValue(events),
  };
}

function createMockFunnel(overrides: Record<string, unknown> = {}) {
  return {
    id: "funnel-1",
    analyticsConfigId: "config-1",
    enabled: true,
    windowMs: 86_400_000, // 24 hours
    steps: [
      { name: "Landing Page", type: "pageview", pathPattern: "/landing/**" },
      { name: "Signup Click", type: "event", eventName: "signup_click" },
      { name: "Confirmation", type: "pageview", pathPattern: "/confirm" },
    ] as FunnelStep[],
    ...overrides,
  };
}

function createMockJob(
  data: Partial<AnalyticsFunnelComputeJobData> = {},
): Job<AnalyticsFunnelComputeJobData> {
  return {
    id: "job-1",
    data: {
      funnelId: "funnel-1",
      ...data,
    },
  } as Job<AnalyticsFunnelComputeJobData>;
}

function makeEvent(partial: Partial<RawEvent>): RawEvent {
  return {
    session_id: "sess-1",
    event_type: "pageview",
    event_name: "",
    pathname: "/",
    event_meta: {},
    timestamp: "2025-01-15 10:00:00",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { processFunnelCompute } from "../../../../../apps/analytics-workers/src/processors/funnel-compute";
import { db } from "../../../../../packages/database/src/index";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Funnel Compute Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // processFunnelCompute -- routing logic
  // ==========================================================================

  describe("processFunnelCompute", () => {
    it("should process a specific funnel by funnelId", async () => {
      const funnel = createMockFunnel();
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      const job = createMockJob({ funnelId: "funnel-1" });
      await processFunnelCompute(job);

      expect(db.query.analyticsFunnels.findFirst).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("should process all enabled funnels when no funnelId is provided", async () => {
      const funnelA = createMockFunnel({ id: "funnel-a" });
      const funnelB = createMockFunnel({ id: "funnel-b" });

      vi.mocked(db.query.analyticsFunnels.findMany).mockResolvedValue([funnelA, funnelB] as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      const job = createMockJob({ funnelId: "" });
      await processFunnelCompute(job);

      expect(db.query.analyticsFunnels.findMany).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it("should skip a disabled funnel when fetched by funnelId", async () => {
      const funnel = createMockFunnel({ enabled: false });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const job = createMockJob({ funnelId: "funnel-1" });
      await processFunnelCompute(job);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });

    it("should skip funnels that are not found", async () => {
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(undefined as never);

      const job = createMockJob({ funnelId: "non-existent" });
      await processFunnelCompute(job);

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("should skip funnels with fewer than 2 steps", async () => {
      const funnel = createMockFunnel({
        steps: [{ name: "Only Step", type: "pageview" }],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const job = createMockJob({ funnelId: "funnel-1" });
      await processFunnelCompute(job);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });

    it("should skip funnels with no steps (null / undefined)", async () => {
      const funnel = createMockFunnel({ steps: null });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const job = createMockJob({ funnelId: "funnel-1" });
      await processFunnelCompute(job);

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("should pass period overrides from job data", async () => {
      const funnel = createMockFunnel();
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      const job = createMockJob({
        funnelId: "funnel-1",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-01-02T00:00:00.000Z",
      });
      await processFunnelCompute(job);

      // Verify ClickHouse was called with the overridden period boundaries
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(1);
      const queryCall = mockClickHouseQuery.mock.calls[0][0];
      expect(queryCall.query_params.start).toBe("2025-01-01 00:00:00");
      expect(queryCall.query_params.end).toBe("2025-01-02 00:00:00");
    });

    it("should continue processing remaining funnels when one fails", async () => {
      const funnelA = createMockFunnel({ id: "funnel-a" });
      const funnelB = createMockFunnel({ id: "funnel-b" });

      vi.mocked(db.query.analyticsFunnels.findMany).mockResolvedValue([funnelA, funnelB] as never);

      // First funnel query throws, second succeeds
      mockClickHouseQuery
        .mockRejectedValueOnce(new Error("ClickHouse connection lost"))
        .mockResolvedValueOnce(createMockClickHouseResult([]));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const job = createMockJob({ funnelId: "" });
      await processFunnelCompute(job);

      // The second funnel should still have been processed
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("funnel-a"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Funnel step matching logic (tested via processFunnelCompute)
  // ==========================================================================

  describe("Funnel step matching logic", () => {
    it("should match a pageview step to a pageview event", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview" },
          { name: "About", type: "pageview" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/about", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Both steps completed by session s1
      expect(insertedValues.stepCounts).toEqual([1, 1]);
      expect(insertedValues.totalEntrants).toBe(1);
    });

    it("should not match a pageview step against a custom event", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview" },
          { name: "Signup", type: "pageview" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "event", event_name: "click", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "signup", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([0, 0]);
      expect(insertedValues.totalEntrants).toBe(0);
    });

    it("should use picomatch glob matching for pathPattern", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Product Page", type: "pageview", pathPattern: "/products/**" },
          { name: "Cart", type: "pageview", pathPattern: "/cart" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/products/shoes/nike-air", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/cart", timestamp: "2025-01-15 10:01:00" }),
        // s2 visits a non-matching product path
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/blog/products", timestamp: "2025-01-15 10:00:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Only s1 enters the funnel; s2 does not match /products/**
      expect(insertedValues.stepCounts).toEqual([1, 1]);
    });

    it("should match a pageview step without pathPattern to any pageview", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Any Page", type: "pageview" },
          { name: "Specific", type: "pageview", pathPattern: "/specific" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/random-page", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/specific", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([1, 1]);
    });

    it("should match an event step by event name", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Page View", type: "pageview" },
          { name: "Button Click", type: "event", eventName: "button_click" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "button_click", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([1, 1]);
    });

    it("should not match an event step when event_name differs", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Page View", type: "pageview" },
          { name: "Purchase", type: "event", eventName: "purchase" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "add_to_cart", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Session entered step 1 but never completed step 2
      expect(insertedValues.stepCounts).toEqual([1, 0]);
    });

    it("should validate eventMetaMatch on event steps", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Page View", type: "pageview" },
          {
            name: "Premium Purchase",
            type: "event",
            eventName: "purchase",
            eventMetaMatch: { plan: "premium", amount: 99 },
          },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        // s1 -- matches metadata
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({
          session_id: "s1",
          event_type: "event",
          event_name: "purchase",
          event_meta: { plan: "premium", amount: "99" },
          timestamp: "2025-01-15 10:01:00",
        }),
        // s2 -- wrong plan value
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({
          session_id: "s2",
          event_type: "event",
          event_name: "purchase",
          event_meta: { plan: "basic", amount: "99" },
          timestamp: "2025-01-15 10:01:00",
        }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // s1 completes both steps, s2 only completes step 1
      expect(insertedValues.stepCounts).toEqual([2, 1]);
    });

    it("should require steps to be completed in order", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Landing", type: "pageview", pathPattern: "/landing" },
          { name: "Signup", type: "event", eventName: "signup" },
          { name: "Confirm", type: "pageview", pathPattern: "/confirm" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        // Session performs steps out of order: confirm before signup
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/confirm", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "signup", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/landing", timestamp: "2025-01-15 10:02:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Only the landing step is reached (at timestamp 10:02) -- nothing follows in order
      expect(insertedValues.stepCounts).toEqual([1, 0, 0]);
    });

    it("should skip events with empty session_id", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview" },
          { name: "About", type: "pageview" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "", event_type: "pageview", pathname: "/about", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([0, 0]);
      expect(insertedValues.totalEntrants).toBe(0);
    });
  });

  // ==========================================================================
  // Conversion rate calculation
  // ==========================================================================

  describe("Conversion rate calculation", () => {
    it("should produce correct stepCounts for a 3-step funnel", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Pricing", type: "pageview", pathPattern: "/pricing" },
          { name: "Purchase", type: "event", eventName: "purchase" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      // 5 sessions with different progression depths
      const events: RawEvent[] = [
        // s1: completes all 3 steps
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        // s2: completes all 3 steps
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s2", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        // s3: completes steps 1 and 2 only
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        // s4: completes step 1 only
        makeEvent({ session_id: "s4", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        // s5: completes step 1 only
        makeEvent({ session_id: "s5", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Step 1 reached by 5, step 2 reached by 3, step 3 reached by 2
      expect(insertedValues.stepCounts).toEqual([5, 3, 2]);
    });

    it("should produce correct stepDropoffs", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Pricing", type: "pageview", pathPattern: "/pricing" },
          { name: "Purchase", type: "event", eventName: "purchase" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      // stepCounts = [5, 3, 2]
      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s2", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s4", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s5", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Dropoffs: step0 = 5-3 = 2, step1 = 3-2 = 1, step2 (last) = 2
      expect(insertedValues.stepDropoffs).toEqual([2, 1, 2]);
    });

    it("should produce correct stepConversionRates", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Pricing", type: "pageview", pathPattern: "/pricing" },
          { name: "Purchase", type: "event", eventName: "purchase" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      // stepCounts = [5, 3, 2]
      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s2", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s4", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s5", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Step 0: 100 (always 100 when > 0 entrants)
      // Step 1: round((3/5)*1000)/10 = 60
      // Step 2: round((2/3)*1000)/10 = 66.7
      expect(insertedValues.stepConversionRates).toEqual([100, 60, 66.7]);
    });

    it("should compute overallConversionRate correctly", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Pricing", type: "pageview", pathPattern: "/pricing" },
          { name: "Purchase", type: "event", eventName: "purchase" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      // stepCounts = [5, 3, 2]
      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s2", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/pricing", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s4", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s5", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // overallConversionRate = round((2/5)*1000)/10 = 40
      expect(insertedValues.overallConversionRate).toBe(40);
    });

    it("should produce all zeros when there are no events", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview" },
          { name: "Signup", type: "event", eventName: "signup" },
          { name: "Confirm", type: "pageview", pathPattern: "/confirm" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([0, 0, 0]);
      expect(insertedValues.stepDropoffs).toEqual([0, 0, 0]);
      expect(insertedValues.stepConversionRates).toEqual([0, 0, 0]);
      expect(insertedValues.overallConversionRate).toBe(0);
      expect(insertedValues.totalEntrants).toBe(0);
    });

    it("should produce 100% conversion when all sessions complete every step", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Purchase", type: "event", eventName: "purchase" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s2", event_type: "event", event_name: "purchase", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([2, 2]);
      expect(insertedValues.stepConversionRates).toEqual([100, 100]);
      expect(insertedValues.overallConversionRate).toBe(100);
      expect(insertedValues.stepDropoffs).toEqual([0, 2]);
    });
  });

  // ==========================================================================
  // Database upsert
  // ==========================================================================

  describe("Database upsert", () => {
    it("should insert result with the correct shape", async () => {
      const funnel = createMockFunnel();
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      await processFunnelCompute(createMockJob());

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockValues).toHaveBeenCalledTimes(1);

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues).toEqual(
        expect.objectContaining({
          id: "test-id-123",
          funnelId: "funnel-1",
          periodStart: expect.any(Date),
          periodEnd: expect.any(Date),
          stepCounts: expect.any(Array),
          stepDropoffs: expect.any(Array),
          stepConversionRates: expect.any(Array),
          overallConversionRate: expect.any(Number),
          totalEntrants: expect.any(Number),
          computedAt: expect.any(Date),
        }),
      );
    });

    it("should call onConflictDoUpdate with upsert fields", async () => {
      const funnel = createMockFunnel();
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      await processFunnelCompute(createMockJob());

      expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
      const conflictArg = mockOnConflictDoUpdate.mock.calls[0][0];
      expect(conflictArg.target).toEqual(["funnelId", "periodStart", "periodEnd"]);
      expect(conflictArg.set).toEqual(
        expect.objectContaining({
          stepCounts: expect.any(Array),
          stepDropoffs: expect.any(Array),
          stepConversionRates: expect.any(Array),
          overallConversionRate: expect.any(Number),
          totalEntrants: expect.any(Number),
          computedAt: expect.any(Date),
        }),
      );
    });
  });

  // ==========================================================================
  // ClickHouse query construction
  // ==========================================================================

  describe("ClickHouse query construction", () => {
    it("should include eventNames param when funnel has event steps", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Page", type: "pageview" },
          { name: "Click", type: "event", eventName: "button_click" },
          { name: "Submit", type: "event", eventName: "form_submit" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      await processFunnelCompute(createMockJob());

      const queryCall = mockClickHouseQuery.mock.calls[0][0];
      expect(queryCall.query_params.eventNames).toEqual(["button_click", "form_submit"]);
      expect(queryCall.query).toContain("event_name IN");
    });

    it("should omit eventNames param when funnel has only pageview steps", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview" },
          { name: "About", type: "pageview" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      await processFunnelCompute(createMockJob());

      const queryCall = mockClickHouseQuery.mock.calls[0][0];
      expect(queryCall.query_params.eventNames).toBeUndefined();
    });

    it("should pass configId, start, and end as query params", async () => {
      const funnel = createMockFunnel({ analyticsConfigId: "my-config-42" });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult([]));

      await processFunnelCompute(
        createMockJob({
          funnelId: "funnel-1",
          periodStart: "2025-06-01T00:00:00.000Z",
          periodEnd: "2025-06-02T00:00:00.000Z",
        }),
      );

      const queryCall = mockClickHouseQuery.mock.calls[0][0];
      expect(queryCall.query_params.configId).toBe("my-config-42");
      expect(queryCall.query_params.start).toBe("2025-06-01 00:00:00");
      expect(queryCall.query_params.end).toBe("2025-06-02 00:00:00");
      expect(queryCall.format).toBe("JSONEachRow");
    });
  });

  // ==========================================================================
  // Picomatch caching
  // ==========================================================================

  describe("Picomatch caching", () => {
    it("should reuse compiled matchers for identical patterns across calls", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Product", type: "pageview", pathPattern: "/products/**" },
          { name: "Cart", type: "pageview", pathPattern: "/cart" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/products/a", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/cart", timestamp: "2025-01-15 10:01:00" }),
      ];

      // Call twice -- the second call should use the cached matcher
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));
      await processFunnelCompute(createMockJob());

      vi.clearAllMocks();
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));
      await processFunnelCompute(createMockJob());

      // Both invocations should succeed and produce identical results
      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([1, 1]);
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("Edge cases", () => {
    it("should handle multiple sessions with varied funnel progress", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Signup", type: "event", eventName: "signup" },
          { name: "Verify", type: "pageview", pathPattern: "/verify" },
          { name: "Complete", type: "event", eventName: "onboard_complete" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        // s1: all 4 steps
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "signup", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/verify", timestamp: "2025-01-15 10:02:00" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "onboard_complete", timestamp: "2025-01-15 10:03:00" }),
        // s2: 3 steps
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s2", event_type: "event", event_name: "signup", timestamp: "2025-01-15 10:01:00" }),
        makeEvent({ session_id: "s2", event_type: "pageview", pathname: "/verify", timestamp: "2025-01-15 10:02:00" }),
        // s3: 2 steps
        makeEvent({ session_id: "s3", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s3", event_type: "event", event_name: "signup", timestamp: "2025-01-15 10:01:00" }),
        // s4: 1 step
        makeEvent({ session_id: "s4", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        // s5: 0 steps (wrong page)
        makeEvent({ session_id: "s5", event_type: "pageview", pathname: "/blog", timestamp: "2025-01-15 10:00:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.stepCounts).toEqual([4, 3, 2, 1]);
      expect(insertedValues.stepDropoffs).toEqual([1, 1, 1, 1]);
      expect(insertedValues.totalEntrants).toBe(4);
      // overall = round((1/4)*1000)/10 = 25
      expect(insertedValues.overallConversionRate).toBe(25);
    });

    it("should handle a session with duplicate qualifying events", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Home", type: "pageview", pathPattern: "/" },
          { name: "Click", type: "event", eventName: "click" },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        // Multiple pageviews to / before the click
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:30" }),
        makeEvent({ session_id: "s1", event_type: "event", event_name: "click", timestamp: "2025-01-15 10:01:00" }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // The first pageview to / satisfies step 1; the click satisfies step 2
      expect(insertedValues.stepCounts).toEqual([1, 1]);
    });

    it("should handle boolean values in eventMetaMatch", async () => {
      const funnel = createMockFunnel({
        steps: [
          { name: "Page", type: "pageview" },
          {
            name: "Feature Flag",
            type: "event",
            eventName: "feature_used",
            eventMetaMatch: { enabled: true },
          },
        ],
      });
      vi.mocked(db.query.analyticsFunnels.findFirst).mockResolvedValue(funnel as never);

      const events: RawEvent[] = [
        makeEvent({ session_id: "s1", event_type: "pageview", pathname: "/", timestamp: "2025-01-15 10:00:00" }),
        makeEvent({
          session_id: "s1",
          event_type: "event",
          event_name: "feature_used",
          event_meta: { enabled: "true" },
          timestamp: "2025-01-15 10:01:00",
        }),
      ];
      mockClickHouseQuery.mockResolvedValue(createMockClickHouseResult(events));

      await processFunnelCompute(createMockJob());

      const insertedValues = mockValues.mock.calls[0][0];
      // Boolean true is compared as String("true") against event_meta value "true"
      expect(insertedValues.stepCounts).toEqual([1, 1]);
    });
  });
});
