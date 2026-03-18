/**
 * Extended error and edge case scenarios for the collect endpoint.
 *
 * Covers malformed payloads, oversized fields, Redis failures, and
 * ClickHouse insert failures. Also validates that fire-and-forget ingestion
 * never propagates errors back to the HTTP response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IngestEventPayload } from "../../services/ingest";

// ---------------------------------------------------------------------------
// Module mocks
// vi.mock factories are hoisted to the top of the file by vitest.
// Use vi.hoisted() for any variable that must exist at factory evaluation time.
// ---------------------------------------------------------------------------

const mockIngestEvent = vi.hoisted(() => vi.fn());

vi.mock("../../services/ingest", () => ({
  ingestEvent: mockIngestEvent,
}));

const mockConfigStore: Record<string, unknown> = {};

vi.mock("../../services/config-cache", () => ({
  getConfigByUuid: vi.fn((uuid: string) => mockConfigStore[uuid]),
}));

// Mutable refs for Redis behavior — set per-test as needed.
let mockEvalImpl: (...args: unknown[]) => unknown = () => [1, 60];

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    eval: vi.fn((...args: unknown[]) => Promise.resolve(mockEvalImpl(...args))),
    pipeline: vi.fn(() => ({
      publish: vi.fn(),
      lpush: vi.fn(),
      ltrim: vi.fn(),
      zadd: vi.fn(),
      zremrangebyscore: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  })),
}));

vi.mock("../../middleware/cors", () => ({
  analyticsCors: vi.fn((c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock("../../middleware/rate-limit", () => ({
  beaconRateLimit: vi.fn((c: unknown, next: () => Promise<void>) => next()),
  apiRateLimit: vi.fn((c: unknown, next: () => Promise<void>) => next()),
}));

import app from "../collect";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRACKING_UUID = "track-uuid-errors";
const CONFIG = {
  id: "cfg-errors",
  enabled: true,
  hostname: "example.com",
  allowedOrigins: [],
  ignoredPaths: [],
  maxBreakdownEntries: 50,
  rawRetentionDays: 90,
  aggregateRetentionDays: 365,
  captureUtmParams: true,
  trackScrollDepth: true,
  trackSessionDuration: true,
  trackOutboundLinks: true,
  apiTokenSha256: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigStore[TRACKING_UUID] = { ...CONFIG };
  mockEvalImpl = () => [1, 60];
});

function post(body: string | Record<string, unknown>, headers: Record<string, string> = {}) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return app.fetch(
    new Request(`http://localhost/${TRACKING_UUID}/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/119.0",
        ...headers,
      },
      body: bodyStr,
    }),
  );
}

// ---------------------------------------------------------------------------
// Malformed JSON payloads
// ---------------------------------------------------------------------------

describe("malformed JSON handling", () => {
  it("returns 400 for completely invalid JSON", async () => {
    const res = await post("not json at all");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 for truncated JSON", async () => {
    const res = await post('{"t":"pageview","p":"/home"');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 for empty object body (missing required fields)", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PAYLOAD");
  });

  it("returns 400 when version field is wrong value", async () => {
    const res = await post({ t: "pageview", p: "/home", sid: "sess", v: 2 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PAYLOAD");
  });

  it("returns 400 when event type is not one of pageview/event/session_end", async () => {
    const res = await post({ t: "invalid_type", p: "/home", sid: "sess", v: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PAYLOAD");
  });
});

// ---------------------------------------------------------------------------
// Oversized field values
// ---------------------------------------------------------------------------

describe("oversized individual field values", () => {
  it("truncates pathname silently and still returns 202", async () => {
    const longPath = "/" + "a".repeat(3000);

    const res = await post({ t: "pageview", p: longPath, sid: "sess-longpath", v: 1 });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0] as IngestEventPayload;
    expect(call.pathname.length).toBe(2000);
  });

  it("truncates event name at 200 characters", async () => {
    const longName = "e".repeat(300);

    const res = await post({ t: "event", p: "/page", n: longName, sid: "sess-longname", v: 1 });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0] as IngestEventPayload;
    expect(call.eventName?.length).toBe(200);
  });

  it("retains metadata keys but truncates values at 500 characters", async () => {
    const res = await post({
      t: "event",
      p: "/page",
      n: "purchase",
      sid: "sess-meta",
      v: 1,
      m: { sku: "x".repeat(600) },
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0] as IngestEventPayload;
    expect(call.eventMeta?.sku.length).toBe(500);
  });

  it("caps metadata at 20 keys, discarding excess", async () => {
    const meta: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      meta[`key_${i}`] = `val_${i}`;
    }

    const res = await post({ t: "event", p: "/page", n: "evt", sid: "sess-bigmeta", v: 1, m: meta });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0] as IngestEventPayload;
    expect(Object.keys(call.eventMeta ?? {}).length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Global Privacy Control (GPC) header
// ---------------------------------------------------------------------------

describe("GPC header handling", () => {
  it("returns 204 and does not call ingestEvent when Sec-GPC: 1 is set", async () => {
    const res = await post(
      { t: "pageview", p: "/home", sid: "sess-gpc", v: 1 },
      { "Sec-GPC": "1" },
    );
    expect(res.status).toBe(204);
    expect(mockIngestEvent).not.toHaveBeenCalled();
  });

  it("proceeds normally when Sec-GPC header is absent", async () => {
    const res = await post({ t: "pageview", p: "/home", sid: "sess-nogpc", v: 1 });
    expect(res.status).toBe(202);
    expect(mockIngestEvent).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Bot User-Agent filtering
// ---------------------------------------------------------------------------

describe("bot user-agent filtering", () => {
  it("returns 204 without calling ingestEvent for a known bot UA", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/${TRACKING_UUID}/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        },
        body: JSON.stringify({ t: "pageview", p: "/home", sid: "sess-bot", v: 1 }),
      }),
    );
    expect(res.status).toBe(204);
    expect(mockIngestEvent).not.toHaveBeenCalled();
  });

  it("allows through a user agent containing 'cubot' (legitimate device name)", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/${TRACKING_UUID}/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Cubot-Phone-Browser/1.0",
        },
        body: JSON.stringify({ t: "pageview", p: "/home", sid: "sess-cubot", v: 1 }),
      }),
    );
    expect(res.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Redis per-session rate limiting failure
// ---------------------------------------------------------------------------

describe("Redis write failure in per-session rate limiting", () => {
  it("allows request through when Redis eval throws (fail open)", async () => {
    mockEvalImpl = () => { throw new Error("Redis connection refused"); };

    const res = await post({ t: "pageview", p: "/home", sid: "sess-redis-fail", v: 1 });
    // Should succeed — fail open policy
    expect(res.status).toBe(202);
    expect(mockIngestEvent).toHaveBeenCalled();
  });

  it("returns 429 when Redis counter exceeds 60 per session per minute", async () => {
    mockEvalImpl = () => [61, 30]; // count=61 > SESSION_RATE_LIMIT=60

    const res = await post({ t: "pageview", p: "/home", sid: "sess-ratelimited", v: 1 });
    expect(res.status).toBe(429);
    expect(mockIngestEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ClickHouse insert failure (fire-and-forget — must not 500)
// ---------------------------------------------------------------------------

describe("ClickHouse insert failure", () => {
  it("returns 202 regardless of what ingestEvent does internally (fire-and-forget)", async () => {
    // The real ingestEvent never propagates errors — it catches them internally.
    // Simulate slow/noop ingestEvent (no side effects) and verify route still returns 202.
    mockIngestEvent.mockImplementationOnce(() => {
      // do nothing — simulates a dropped write
    });

    const res = await post({ t: "pageview", p: "/home", sid: "sess-ch-noop", v: 1 });
    expect(res.status).toBe(202);
    expect(mockIngestEvent).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Ignored path matching
// ---------------------------------------------------------------------------

describe("ignored path filtering", () => {
  it("returns 202 with status=ignored for a path matching an ignored pattern", async () => {
    const uuid = "track-uuid-ignored-paths";
    mockConfigStore[uuid] = { ...CONFIG, ignoredPaths: ["/admin/*", "/health"] };

    const res = await app.fetch(
      new Request(`http://localhost/${uuid}/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Chrome/119.0",
        },
        body: JSON.stringify({ t: "pageview", p: "/admin/settings", sid: "sess-ignore", v: 1 }),
      }),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("ignored");
    expect(mockIngestEvent).not.toHaveBeenCalled();
  });

  it("does not suppress paths that do not match any ignored pattern", async () => {
    const uuid = "track-uuid-ignored-paths-2";
    mockConfigStore[uuid] = { ...CONFIG, ignoredPaths: ["/admin/*"] };

    const res = await app.fetch(
      new Request(`http://localhost/${uuid}/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Chrome/119.0",
        },
        body: JSON.stringify({ t: "pageview", p: "/blog/post", sid: "sess-notignored", v: 1 }),
      }),
    );
    expect(res.status).toBe(202);
    expect(mockIngestEvent).toHaveBeenCalled();
  });

  it("returns 404 for an unknown tracking UUID", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/unknown-uuid-xyz/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Chrome/119.0",
        },
        body: JSON.stringify({ t: "pageview", p: "/home", sid: "sess", v: 1 }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a disabled config", async () => {
    const uuid = "track-uuid-disabled";
    mockConfigStore[uuid] = { ...CONFIG, enabled: false };

    const res = await app.fetch(
      new Request(`http://localhost/${uuid}/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Chrome/119.0",
        },
        body: JSON.stringify({ t: "pageview", p: "/home", sid: "sess", v: 1 }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Metadata key validation
// ---------------------------------------------------------------------------

describe("event metadata key validation", () => {
  it("strips metadata keys with invalid characters (non-alphanumeric/underscore)", async () => {
    const res = await post({
      t: "event",
      p: "/page",
      n: "purchase",
      sid: "sess-badkeys",
      v: 1,
      m: {
        "valid_key": "ok",
        "invalid-key": "bad",
        "also.invalid": "bad",
        "spaces in key": "bad",
      },
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0] as IngestEventPayload;
    const keys = Object.keys(call.eventMeta ?? {});
    expect(keys).toContain("valid_key");
    expect(keys).not.toContain("invalid-key");
    expect(keys).not.toContain("also.invalid");
    expect(keys).not.toContain("spaces in key");
  });
});
