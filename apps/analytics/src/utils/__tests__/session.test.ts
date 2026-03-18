/**
 * Tests for session tracking logic embedded in the collect route.
 *
 * Session decisions (isEntry, isUnique, isBounce, scrollDepthPct,
 * sessionDurationMs) are validated by inspecting the payload passed to the
 * mocked ingestEvent function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    eval: vi.fn().mockResolvedValue([1, 60]),
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

import app from "../../routes/collect";

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

const TRACKING_UUID = "track-uuid-session";
const CONFIG = {
  id: "cfg-session-test",
  domainId: "dom-session",
  trackingUuid: TRACKING_UUID,
  enabled: true,
  hostname: "mysite.com",
  allowedOrigins: ["https://mysite.com"],
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

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigStore[TRACKING_UUID] = { ...CONFIG };
});

function postCollect(uuid: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://localhost/${uuid}/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

const VALID_PAGEVIEW = {
  t: "pageview",
  p: "/home",
  sid: "sess-abc123",
  v: 1,
};

// ---------------------------------------------------------------------------
// isUnique / isEntry detection
// ---------------------------------------------------------------------------

describe("session uniqueness and entry detection", () => {
  it("marks a visit as unique and entry when Referer header is absent", async () => {
    const res = await postCollect(TRACKING_UUID, VALID_PAGEVIEW);
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isUnique).toBe(true);
    expect(call.isEntry).toBe(true);
  });

  it("marks a visit as unique and entry when Referer is from a different domain", async () => {
    const res = await postCollect(TRACKING_UUID, VALID_PAGEVIEW, {
      Referer: "https://google.com/search?q=test",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isUnique).toBe(true);
    expect(call.isEntry).toBe(true);
  });

  it("marks a visit as NOT unique when Referer domain matches site hostname", async () => {
    const res = await postCollect(TRACKING_UUID, VALID_PAGEVIEW, {
      Referer: "https://mysite.com/about",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isUnique).toBe(false);
    expect(call.isEntry).toBe(false);
  });

  it("marks a non-pageview event as isEntry=false even when unique", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "event",
      p: "/home",
      n: "button_click",
      sid: "sess-xyz",
      v: 1,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isEntry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bounce detection
// ---------------------------------------------------------------------------

describe("bounce detection", () => {
  it("records isBounce=true when session_end event has ib=1", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-bounce",
      v: 1,
      ib: 1,
      sd: 5000,
      sp: 20,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isBounce).toBe(true);
    expect(call.eventType).toBe("session_end");
  });

  it("records isBounce=false when session_end event has ib=0", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-nobounce",
      v: 1,
      ib: 0,
      sd: 120000,
      sp: 80,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isBounce).toBe(false);
  });

  it("records isBounce=false for non-session_end events even with ib=1 in body", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "pageview",
      p: "/home",
      sid: "sess-page",
      v: 1,
      ib: 1,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.isBounce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session duration
// ---------------------------------------------------------------------------

describe("session duration accumulation", () => {
  it("passes sessionDurationMs from sd field on session_end events", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-dur",
      v: 1,
      sd: 180000,
      sp: 50,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.sessionDurationMs).toBe(180000);
  });

  it("sets sessionDurationMs=0 for pageview events", async () => {
    const res = await postCollect(TRACKING_UUID, VALID_PAGEVIEW);
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.sessionDurationMs).toBe(0);
  });

  it("sets sessionDurationMs=0 when sd field is missing from session_end", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-nosd",
      v: 1,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.sessionDurationMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scroll depth
// ---------------------------------------------------------------------------

describe("scroll depth calculation", () => {
  it("passes scrollDepthPct from sp field on session_end events", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-scroll",
      v: 1,
      sd: 60000,
      sp: 75,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.scrollDepthPct).toBe(75);
  });

  it("caps scrollDepthPct at 100", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-maxscroll",
      v: 1,
      sd: 60000,
      sp: 150,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.scrollDepthPct).toBe(100);
  });

  it("clamps scrollDepthPct to 0 for negative values", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "session_end",
      p: "/home",
      sid: "sess-negscroll",
      v: 1,
      sd: 60000,
      sp: -10,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.scrollDepthPct).toBe(0);
  });

  it("sets scrollDepthPct=0 for non-session_end events", async () => {
    const res = await postCollect(TRACKING_UUID, VALID_PAGEVIEW);
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.scrollDepthPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Session ID pass-through
// ---------------------------------------------------------------------------

describe("session ID handling", () => {
  it("passes the sessionId from the beacon body to ingestEvent", async () => {
    const res = await postCollect(TRACKING_UUID, {
      ...VALID_PAGEVIEW,
      sid: "deterministic-session-id-xyz",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.sessionId).toBe("deterministic-session-id-xyz");
  });

  it("rejects beacons where sid is missing", async () => {
    const res = await postCollect(TRACKING_UUID, {
      t: "pageview",
      p: "/home",
      v: 1,
      // no sid field
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PAYLOAD");
  });
});
