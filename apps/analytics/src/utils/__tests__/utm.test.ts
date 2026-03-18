/**
 * Tests for UTM parameter extraction and referrer domain parsing in the
 * collect route.
 *
 * UTM fields are extracted inline in collect.ts and conditionally suppressed
 * when captureUtmParams is false. These tests verify that behavior via
 * the mocked ingestEvent function.
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
// Fixtures
// ---------------------------------------------------------------------------

const TRACKING_UUID = "track-uuid-utm";
const BASE_CONFIG = {
  id: "cfg-utm-test",
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
  mockConfigStore[TRACKING_UUID] = { ...BASE_CONFIG };
});

function postCollect(body: Record<string, unknown>, configUuid = TRACKING_UUID) {
  return app.fetch(
    new Request(`http://localhost/${configUuid}/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0",
      },
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// UTM extraction
// ---------------------------------------------------------------------------

describe("UTM parameter extraction", () => {
  it("extracts all five UTM fields from beacon body", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/landing",
      sid: "sess-utm-full",
      v: 1,
      u_source: "google",
      u_medium: "cpc",
      u_campaign: "summer_sale",
      u_term: "analytics+tool",
      u_content: "hero_button",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.utmSource).toBe("google");
    expect(call.utmMedium).toBe("cpc");
    expect(call.utmCampaign).toBe("summer_sale");
    expect(call.utmTerm).toBe("analytics+tool");
    expect(call.utmContent).toBe("hero_button");
  });

  it("sets all UTM fields to empty string when fields are absent", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-noutm",
      v: 1,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.utmSource).toBe("");
    expect(call.utmMedium).toBe("");
    expect(call.utmCampaign).toBe("");
    expect(call.utmTerm).toBe("");
    expect(call.utmContent).toBe("");
  });

  it("strips all UTM fields when captureUtmParams is false on the config", async () => {
    const noUtmUuid = "track-uuid-noutm";
    mockConfigStore[noUtmUuid] = { ...BASE_CONFIG, captureUtmParams: false };

    const res = await postCollect({
      t: "pageview",
      p: "/landing",
      sid: "sess-noutm2",
      v: 1,
      u_source: "email",
      u_medium: "newsletter",
      u_campaign: "onboarding",
    }, noUtmUuid);
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.utmSource).toBe("");
    expect(call.utmMedium).toBe("");
    expect(call.utmCampaign).toBe("");
  });

  it("sanitises UTM fields by truncating at 500 characters", async () => {
    const longValue = "x".repeat(600);

    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-longutm",
      v: 1,
      u_source: longValue,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.utmSource.length).toBe(500);
  });

  it("handles special characters in UTM parameter values", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-specialutm",
      v: 1,
      u_source: "google",
      u_campaign: "sale-2024/q1&discount=10%",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.utmSource).toBe("google");
    // Special characters in campaign are retained (sanitiseString only strips control chars)
    expect(call.utmCampaign).toBe("sale-2024/q1&discount=10%");
  });
});

// ---------------------------------------------------------------------------
// Referrer domain parsing
// ---------------------------------------------------------------------------

describe("referrer domain parsing and classification", () => {
  it("extracts domain from a well-formed https referrer URL", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-ref1",
      v: 1,
      r: "https://google.com/search?q=analytics",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrerDomain).toBe("google.com");
    expect(call.referrer).toBe("https://google.com/search?q=analytics");
  });

  it("extracts domain from an http referrer URL", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-ref2",
      v: 1,
      r: "http://reddit.com/r/programming",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrerDomain).toBe("reddit.com");
  });

  it("uses (direct) when referrer field is empty", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-direct",
      v: 1,
      r: "",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrerDomain).toBe("(direct)");
  });

  it("uses (direct) when referrer field is absent", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-noref",
      v: 1,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrerDomain).toBe("(direct)");
  });

  it("extracts subdomain correctly (keeps full hostname)", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-subdomain",
      v: 1,
      r: "https://news.ycombinator.com/item?id=12345",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrerDomain).toBe("news.ycombinator.com");
  });

  it("handles referrer URL with a port number", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-port",
      v: 1,
      r: "http://localhost:3000/dashboard",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrerDomain).toBe("localhost");
  });

  it("sanitises referrer by truncating at 2000 characters", async () => {
    const longReferrer = "https://example.com/" + "a".repeat(2100);

    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-longref",
      v: 1,
      r: longReferrer,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.referrer.length).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Country code derivation from timezone
// ---------------------------------------------------------------------------

describe("country code from timezone", () => {
  it("maps Europe/London timezone to GB", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-tz-gb",
      v: 1,
      tz: "Europe/London",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.countryCode).toBe("GB");
  });

  it("maps America/New_York timezone to US", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-tz-us",
      v: 1,
      tz: "America/New_York",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.countryCode).toBe("US");
  });

  it("returns Unknown for an unrecognised timezone", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-tz-bad",
      v: 1,
      tz: "Mars/Olympus_Mons",
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.countryCode).toBe("Unknown");
  });

  it("returns Unknown when timezone field is absent", async () => {
    const res = await postCollect({
      t: "pageview",
      p: "/home",
      sid: "sess-tz-absent",
      v: 1,
    });
    expect(res.status).toBe(202);

    const call = mockIngestEvent.mock.calls[0][0];
    expect(call.countryCode).toBe("Unknown");
  });
});
