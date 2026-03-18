/**
 * Analytics Event Ingestion Service Unit Tests
 *
 * Tests for the fire-and-forget ingestion pipeline that writes
 * events to ClickHouse and publishes real-time data to Redis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockClickHouseInsert = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../../../apps/analytics/src/clickhouse/client", () => ({
  getClickHouseClient: vi.fn(() => ({
    insert: (...args: unknown[]) => mockClickHouseInsert(...args),
  })),
}));

const mockPipelinePublish = vi.fn().mockReturnThis();
const mockPipelineZadd = vi.fn().mockReturnThis();
const mockPipelineZremrangebyscore = vi.fn().mockReturnThis();
const mockPipelineLpush = vi.fn().mockReturnThis();
const mockPipelineLtrim = vi.fn().mockReturnThis();
const mockPipelineExec = vi.fn().mockResolvedValue([]);

vi.mock("../../../../../packages/shared/src/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    pipeline: vi.fn(() => ({
      publish: mockPipelinePublish,
      zadd: mockPipelineZadd,
      zremrangebyscore: mockPipelineZremrangebyscore,
      lpush: mockPipelineLpush,
      ltrim: mockPipelineLtrim,
      exec: mockPipelineExec,
    })),
  })),
}));

import { ingestEvent, type IngestEventPayload } from "../../../../../apps/analytics/src/services/ingest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides: Partial<IngestEventPayload> = {}): IngestEventPayload {
  return {
    configId: "config-1",
    eventType: "pageview",
    pathname: "/",
    referrer: "",
    referrerDomain: "(direct)",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmTerm: "",
    utmContent: "",
    isUnique: true,
    sessionId: "session-123",
    isBounce: false,
    isEntry: true,
    isExit: false,
    browser: "Chrome",
    browserVersion: "120.0",
    os: "Windows",
    deviceType: "desktop",
    screenWidth: 1920,
    screenHeight: 1080,
    countryCode: "US",
    timezone: "America/New_York",
    sessionDurationMs: 0,
    scrollDepthPct: 0,
    source: "js",
    ...overrides,
  };
}

/** Wait for fire-and-forget promises to settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingestEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // ClickHouse writes
  // =========================================================================

  describe("ClickHouse writes", () => {
    it("should insert into analytics_events table", async () => {
      ingestEvent(makePayload());
      await flush();

      expect(mockClickHouseInsert).toHaveBeenCalledOnce();
      const call = mockClickHouseInsert.mock.calls[0][0];
      expect(call.table).toBe("analytics_events");
      expect(call.format).toBe("JSONEachRow");
    });

    it("should map payload fields to ClickHouse column names", async () => {
      const payload = makePayload({
        configId: "cfg-42",
        eventType: "event",
        eventName: "signup",
        pathname: "/pricing",
        browser: "Firefox",
        os: "Linux",
        deviceType: "desktop",
        countryCode: "GB",
        timezone: "Europe/London",
        screenWidth: 1440,
        screenHeight: 900,
      });

      ingestEvent(payload);
      await flush();

      const row = mockClickHouseInsert.mock.calls[0][0].values[0];
      expect(row.analytics_config_id).toBe("cfg-42");
      expect(row.event_type).toBe("event");
      expect(row.event_name).toBe("signup");
      expect(row.pathname).toBe("/pricing");
      expect(row.browser).toBe("Firefox");
      expect(row.os).toBe("Linux");
      expect(row.device_type).toBe("desktop");
      expect(row.country_code).toBe("GB");
      expect(row.tz).toBe("Europe/London");
      expect(row.screen_width).toBe(1440);
      expect(row.screen_height).toBe(900);
    });

    it("should map boolean fields to 0/1 integers", async () => {
      ingestEvent(makePayload({
        isUnique: true,
        isBounce: true,
        isEntry: false,
        isExit: true,
      }));
      await flush();

      const row = mockClickHouseInsert.mock.calls[0][0].values[0];
      expect(row.is_unique).toBe(1);
      expect(row.is_bounce).toBe(1);
      expect(row.is_entry).toBe(0);
      expect(row.is_exit).toBe(1);
    });

    it("should default eventName to empty string when undefined", async () => {
      ingestEvent(makePayload({ eventName: undefined }));
      await flush();

      const row = mockClickHouseInsert.mock.calls[0][0].values[0];
      expect(row.event_name).toBe("");
    });

    it("should default eventMeta to empty object when undefined", async () => {
      ingestEvent(makePayload({ eventMeta: undefined }));
      await flush();

      const row = mockClickHouseInsert.mock.calls[0][0].values[0];
      expect(row.event_meta).toEqual({});
    });
  });

  // =========================================================================
  // Redis updates
  // =========================================================================

  describe("Redis updates", () => {
    it("should publish to the correct live channel", async () => {
      ingestEvent(makePayload({ configId: "config-xyz" }));
      await flush();

      expect(mockPipelinePublish).toHaveBeenCalledWith(
        "analytics:live:config-xyz",
        expect.any(String),
      );
    });

    it("should include event data in the live channel payload", async () => {
      ingestEvent(makePayload({
        configId: "cfg-1",
        eventType: "pageview",
        pathname: "/about",
        browser: "Chrome",
        countryCode: "US",
      }));
      await flush();

      const publishedJson = mockPipelinePublish.mock.calls[0][1];
      const published = JSON.parse(publishedJson);

      expect(published.eventType).toBe("pageview");
      expect(published.pathname).toBe("/about");
      expect(published.browser).toBe("Chrome");
      expect(published.countryCode).toBe("US");
      expect(published.timestamp).toBeDefined();
    });

    it("should zadd to the active visitors sorted set", async () => {
      ingestEvent(makePayload({ configId: "cfg-1", sessionId: "sess-abc" }));
      await flush();

      expect(mockPipelineZadd).toHaveBeenCalledWith(
        "analytics:active:cfg-1",
        expect.any(String),
        "sess-abc",
      );
    });

    it("should zadd to the active pages sorted set", async () => {
      ingestEvent(makePayload({ configId: "cfg-1", sessionId: "sess-abc", pathname: "/docs" }));
      await flush();

      expect(mockPipelineZadd).toHaveBeenCalledWith(
        "analytics:active_pages:cfg-1",
        expect.any(String),
        "sess-abc:/docs",
      );
    });

    it("should zremrangebyscore to clean up old active entries", async () => {
      ingestEvent(makePayload({ configId: "cfg-1" }));
      await flush();

      // Should clean up both active visitors and active pages sets
      expect(mockPipelineZremrangebyscore).toHaveBeenCalledTimes(2);
      expect(mockPipelineZremrangebyscore).toHaveBeenCalledWith(
        "analytics:active:cfg-1",
        "-inf",
        expect.any(String),
      );
      expect(mockPipelineZremrangebyscore).toHaveBeenCalledWith(
        "analytics:active_pages:cfg-1",
        "-inf",
        expect.any(String),
      );
    });

    it("should lpush to the recent events list", async () => {
      ingestEvent(makePayload({ configId: "cfg-1" }));
      await flush();

      expect(mockPipelineLpush).toHaveBeenCalledWith(
        "analytics:recent_events:cfg-1",
        expect.any(String),
      );
    });

    it("should ltrim the recent events list to 50 entries", async () => {
      ingestEvent(makePayload({ configId: "cfg-1" }));
      await flush();

      expect(mockPipelineLtrim).toHaveBeenCalledWith(
        "analytics:recent_events:cfg-1",
        0,
        49,
      );
    });

    it("should execute the Redis pipeline", async () => {
      ingestEvent(makePayload());
      await flush();

      expect(mockPipelineExec).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Session ID sanitisation
  // =========================================================================

  describe("Session ID sanitisation", () => {
    it("should strip non-alphanumeric, non-hyphen, non-underscore characters from sessionId in Redis keys", async () => {
      ingestEvent(makePayload({ configId: "cfg-1", sessionId: "sess/id@with!special#chars" }));
      await flush();

      // The sanitised version should only contain allowed chars
      expect(mockPipelineZadd).toHaveBeenCalledWith(
        "analytics:active:cfg-1",
        expect.any(String),
        "sessidwithspecialchars",
      );
    });

    it("should strip dots and spaces from sessionId in active pages key", async () => {
      ingestEvent(makePayload({ configId: "cfg-1", sessionId: "sess.id with spaces", pathname: "/page" }));
      await flush();

      expect(mockPipelineZadd).toHaveBeenCalledWith(
        "analytics:active_pages:cfg-1",
        expect.any(String),
        "sessidwithspaces:/page",
      );
    });

    it("should truncate sessionId to 128 characters in Redis keys", async () => {
      const longSessionId = "a".repeat(200);
      ingestEvent(makePayload({ configId: "cfg-1", sessionId: longSessionId }));
      await flush();

      const truncated = "a".repeat(128);
      expect(mockPipelineZadd).toHaveBeenCalledWith(
        "analytics:active:cfg-1",
        expect.any(String),
        truncated,
      );
    });

    it("should preserve hyphens and underscores in sessionId", async () => {
      ingestEvent(makePayload({ configId: "cfg-1", sessionId: "sess_abc-def_123" }));
      await flush();

      expect(mockPipelineZadd).toHaveBeenCalledWith(
        "analytics:active:cfg-1",
        expect.any(String),
        "sess_abc-def_123",
      );
    });

    it("should not affect the ClickHouse insert (raw sessionId is written to ClickHouse)", async () => {
      ingestEvent(makePayload({ sessionId: "sess/id@special" }));
      await flush();

      const row = mockClickHouseInsert.mock.calls[0][0].values[0];
      expect(row.session_id).toBe("sess/id@special");
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("Error handling", () => {
    it("should log ClickHouse errors without throwing", async () => {
      mockClickHouseInsert.mockRejectedValueOnce(new Error("CH connection refused"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      ingestEvent(makePayload());
      await flush();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Analytics] ClickHouse insert error:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("should log Redis errors without throwing", async () => {
      mockPipelineExec.mockRejectedValueOnce(new Error("Redis timeout"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      ingestEvent(makePayload());
      await flush();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Analytics] Redis update error:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("should log both errors when both ClickHouse and Redis fail", async () => {
      mockClickHouseInsert.mockRejectedValueOnce(new Error("CH down"));
      mockPipelineExec.mockRejectedValueOnce(new Error("Redis down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      ingestEvent(makePayload());
      await flush();

      const errorMessages = consoleSpy.mock.calls.map((call) => call[0]);
      expect(errorMessages).toContain("[Analytics] ClickHouse insert error:");
      expect(errorMessages).toContain("[Analytics] Redis update error:");

      consoleSpy.mockRestore();
    });
  });
});
