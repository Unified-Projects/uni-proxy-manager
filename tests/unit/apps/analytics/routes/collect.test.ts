/**
 * Beacon Collection Route Unit Tests
 *
 * Tests for the POST /:uuid/collect endpoint that receives
 * tracking beacons from the embed script.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks -- all dependencies are stubbed so the route handler runs in isolation.
// ---------------------------------------------------------------------------

vi.mock("../../../../../apps/analytics/src/middleware/cors", () => ({
  analyticsCors: vi.fn().mockImplementation(async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock("../../../../../apps/analytics/src/middleware/rate-limit", () => ({
  beaconRateLimit: vi.fn().mockImplementation(async (_c: unknown, next: () => Promise<void>) => next()),
}));

const mockConfig = {
  id: "config-1",
  domainId: "domain-1",
  trackingUuid: "test-uuid",
  enabled: true,
  hostname: "example.com",
  allowedOrigins: [],
  ignoredPaths: [] as string[],
  rawRetentionDays: 90,
  aggregateRetentionDays: 365,
  trackScrollDepth: true,
  trackSessionDuration: true,
  trackOutboundLinks: true,
  captureUtmParams: true,
};

const mockGetConfigByUuid = vi.fn<(uuid: string) => typeof mockConfig | undefined>();

vi.mock("../../../../../apps/analytics/src/services/config-cache", () => ({
  getConfigByUuid: (...args: unknown[]) => mockGetConfigByUuid(args[0] as string),
}));

const mockIngestEvent = vi.fn();

vi.mock("../../../../../apps/analytics/src/services/ingest", () => ({
  ingestEvent: (...args: unknown[]) => mockIngestEvent(...args),
}));

vi.mock("../../../../../apps/analytics/src/utils/sanitise", () => ({
  sanitiseString: vi.fn((str: string, _max: number) => str),
  sanitiseEventMeta: vi.fn((meta: Record<string, string>) => meta),
  MAX_LENGTHS: {
    pathname: 2000,
    referrer: 2000,
    utmField: 500,
    eventName: 200,
    metaValue: 500,
  },
}));

vi.mock("../../../../../apps/analytics/src/utils/ua-parser", () => ({
  parseUserAgent: vi.fn(() => ({
    browser: "Chrome",
    browserVersion: "120.0",
    os: "Windows",
    deviceType: "desktop",
  })),
}));

vi.mock("../../../../../apps/analytics/src/utils/timezone-countries", () => ({
  getCountryFromTimezone: vi.fn(() => "US"),
}));

const mockRedisEval = vi.fn<() => Promise<[number, number]>>();

vi.mock("../../../../../packages/shared/src/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    eval: (...args: unknown[]) => mockRedisEval(...(args as [])),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  uuid: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://localhost/${uuid}/collect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const validBody = { t: "pageview", p: "/", sid: "s1", v: 1 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /:uuid/collect", () => {
  let app: { request: (req: Request) => Promise<Response> };

  beforeEach(async () => {
    // Clear only test-level mocks to avoid wiping factory-created mock
    // implementations (e.g. analyticsCors calling next()).
    mockGetConfigByUuid.mockClear();
    mockIngestEvent.mockClear();
    mockRedisEval.mockClear();

    // Default mock behaviours.
    mockGetConfigByUuid.mockReturnValue({ ...mockConfig, ignoredPaths: [] });
    mockRedisEval.mockResolvedValue([1, 60]);

    // Re-import the module so the Hono app is freshly constructed with mocks.
    vi.resetModules();
    const mod = await import("../../../../../apps/analytics/src/routes/collect");
    app = mod.default;
  });

  // ==========================================================================
  // GPC header
  // ==========================================================================

  describe("GPC header", () => {
    it("should return 204 when Sec-GPC header is '1'", async () => {
      const res = await app.request(
        makeRequest("test-uuid", validBody, { "Sec-GPC": "1" }),
      );

      expect(res.status).toBe(204);
    });
  });

  // ==========================================================================
  // Bot filtering
  // ==========================================================================

  describe("Bot user-agent filtering", () => {
    const botAgents = [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingpreview/2.0)",
      "Mozilla/5.0 (compatible; YandexBot/3.0)",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0)",
      "Mozilla/5.0 HeadlessChrome/120.0",
      "ClaudeBot/1.0",
      "CCBot/2.0",
      "GPTBot/1.0",
      "Bytespider",
    ];

    for (const ua of botAgents) {
      it(`should return 204 for bot UA: ${ua}`, async () => {
        const res = await app.request(
          makeRequest("test-uuid", validBody, { "User-Agent": ua }),
        );

        expect(res.status).toBe(204);
      });
    }

    it("should NOT filter Cubot user-agent (real phone brand)", async () => {
      const res = await app.request(
        makeRequest("test-uuid", validBody, {
          "User-Agent": "Mozilla/5.0 (Linux; Android 11; Cubot X30) AppleWebKit/537.36",
        }),
      );

      // Cubot contains "bot" but the exception rule should let it through.
      expect(res.status).not.toBe(204);
    });
  });

  // ==========================================================================
  // Config lookup
  // ==========================================================================

  describe("Config lookup", () => {
    it("should return 404 for unknown UUID", async () => {
      mockGetConfigByUuid.mockReturnValue(undefined);

      const res = await app.request(
        makeRequest("unknown-uuid", validBody),
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("CONFIG_NOT_FOUND");
    });

    it("should return 404 when config is disabled", async () => {
      mockGetConfigByUuid.mockReturnValue({ ...mockConfig, enabled: false });

      const res = await app.request(
        makeRequest("test-uuid", validBody),
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("CONFIG_NOT_FOUND");
    });
  });

  // ==========================================================================
  // Body validation
  // ==========================================================================

  describe("Body validation", () => {
    it("should return 400 for invalid JSON body", async () => {
      const req = new Request("http://localhost/test-uuid/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      const res = await app.request(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_BODY");
    });

    it("should return 400 when event type is missing", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { p: "/", sid: "s1", v: 1 }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_PAYLOAD");
    });

    it("should return 400 when pathname is missing", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { t: "pageview", sid: "s1", v: 1 }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_PAYLOAD");
    });

    it("should return 400 when session ID is missing", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { t: "pageview", p: "/", v: 1 }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_PAYLOAD");
    });

    it("should return 400 when version is not 1", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { t: "pageview", p: "/", sid: "s1", v: 2 }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_PAYLOAD");
    });

    it("should return 400 for invalid event type", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { t: "click", p: "/", sid: "s1", v: 1 }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_PAYLOAD");
      expect(json.error.message).toBe("Invalid event type");
    });
  });

  // ==========================================================================
  // Per-session Redis rate limiting
  // ==========================================================================

  describe("Per-session Redis rate limiting", () => {
    it("should return 429 when session exceeds 60 events per minute", async () => {
      mockRedisEval.mockResolvedValue([61, 55]);

      const res = await app.request(
        makeRequest("test-uuid", validBody),
      );

      expect(res.status).toBe(429);
    });

    it("should allow requests at exactly 60 events", async () => {
      mockRedisEval.mockResolvedValue([60, 55]);

      const res = await app.request(
        makeRequest("test-uuid", validBody),
      );

      expect(res.status).toBe(202);
    });

    it("should allow request through when Redis fails", async () => {
      mockRedisEval.mockRejectedValue(new Error("Redis connection refused"));

      const res = await app.request(
        makeRequest("test-uuid", validBody),
      );

      // Redis failure should not block the request.
      expect(res.status).toBe(202);
    });

    it("should call redis.eval with the session rate key", async () => {
      mockRedisEval.mockResolvedValue([1, 60]);

      await app.request(makeRequest("test-uuid", validBody));

      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "analytics:rate:config-1:s1",
        60,
      );
    });
  });

  // ==========================================================================
  // Ignored paths
  // ==========================================================================

  describe("Ignored paths", () => {
    it("should return 202 with 'ignored' status for matching ignored path", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        ignoredPaths: ["/admin/*"],
      });

      const res = await app.request(
        makeRequest("test-uuid", { t: "pageview", p: "/admin/dashboard", sid: "s1", v: 1 }),
      );

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.status).toBe("ignored");
    });

    it("should not ignore paths that do not match any pattern", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        ignoredPaths: ["/admin/*"],
      });

      const res = await app.request(
        makeRequest("test-uuid", validBody),
      );

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.status).toBe("ok");
    });

    it("should return 202 with 'ignored' for exact ignored path match", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        ignoredPaths: ["/health"],
      });

      const res = await app.request(
        makeRequest("test-uuid", { t: "pageview", p: "/health", sid: "s1", v: 1 }),
      );

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.status).toBe("ignored");
    });
  });

  // ==========================================================================
  // Successful pageview
  // ==========================================================================

  describe("Successful pageview", () => {
    it("should return 202 with 'ok' status", async () => {
      const res = await app.request(
        makeRequest("test-uuid", validBody),
      );

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.status).toBe("ok");
    });

    it("should call ingestEvent with correct payload", async () => {
      await app.request(
        makeRequest("test-uuid", {
          t: "pageview",
          p: "/about",
          sid: "session-abc",
          v: 1,
          r: "https://google.com",
          tz: "America/New_York",
          sw: 1920,
          sh: 1080,
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.configId).toBe("config-1");
      expect(payload.eventType).toBe("pageview");
      expect(payload.pathname).toBe("/about");
      expect(payload.sessionId).toBe("session-abc");
      expect(payload.referrer).toBe("https://google.com");
      expect(payload.countryCode).toBe("US");
      expect(payload.browser).toBe("Chrome");
      expect(payload.os).toBe("Windows");
      expect(payload.deviceType).toBe("desktop");
      expect(payload.screenWidth).toBe(1920);
      expect(payload.screenHeight).toBe(1080);
      expect(payload.source).toBe("js");
    });
  });

  // ==========================================================================
  // UTM parameters
  // ==========================================================================

  describe("UTM parameters", () => {
    it("should pass UTM parameters when captureUtmParams is true", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        captureUtmParams: true,
      });

      await app.request(
        makeRequest("test-uuid", {
          ...validBody,
          u_source: "google",
          u_medium: "cpc",
          u_campaign: "spring_sale",
          u_term: "analytics",
          u_content: "banner_1",
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.utmSource).toBe("google");
      expect(payload.utmMedium).toBe("cpc");
      expect(payload.utmCampaign).toBe("spring_sale");
      expect(payload.utmTerm).toBe("analytics");
      expect(payload.utmContent).toBe("banner_1");
    });

    it("should strip UTM parameters when captureUtmParams is false", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        captureUtmParams: false,
      });

      await app.request(
        makeRequest("test-uuid", {
          ...validBody,
          u_source: "google",
          u_medium: "cpc",
          u_campaign: "spring_sale",
          u_term: "analytics",
          u_content: "banner_1",
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.utmSource).toBe("");
      expect(payload.utmMedium).toBe("");
      expect(payload.utmCampaign).toBe("");
      expect(payload.utmTerm).toBe("");
      expect(payload.utmContent).toBe("");
    });
  });

  // ==========================================================================
  // Session-end fields
  // ==========================================================================

  describe("Session-end fields", () => {
    it("should parse session duration, scroll depth, and bounce flag", async () => {
      await app.request(
        makeRequest("test-uuid", {
          t: "session_end",
          p: "/about",
          sid: "s1",
          v: 1,
          sd: 12500,
          sp: 75,
          ib: 1,
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.eventType).toBe("session_end");
      expect(payload.sessionDurationMs).toBe(12500);
      expect(payload.scrollDepthPct).toBe(75);
      expect(payload.isBounce).toBe(true);
    });

    it("should default session-end fields to zero for non session_end events", async () => {
      await app.request(
        makeRequest("test-uuid", {
          t: "pageview",
          p: "/",
          sid: "s1",
          v: 1,
          sd: 5000,
          sp: 50,
          ib: 1,
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.sessionDurationMs).toBe(0);
      expect(payload.scrollDepthPct).toBe(0);
      expect(payload.isBounce).toBe(false);
    });

    it("should clamp scroll depth to 0-100 range", async () => {
      await app.request(
        makeRequest("test-uuid", {
          t: "session_end",
          p: "/",
          sid: "s1",
          v: 1,
          sd: 1000,
          sp: 150,
          ib: 0,
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.scrollDepthPct).toBe(100);
    });

    it("should clamp negative scroll depth to 0", async () => {
      await app.request(
        makeRequest("test-uuid", {
          t: "session_end",
          p: "/",
          sid: "s1",
          v: 1,
          sd: 1000,
          sp: -20,
          ib: 0,
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.scrollDepthPct).toBe(0);
    });

    it("should set isBounce to false when ib is not 1", async () => {
      await app.request(
        makeRequest("test-uuid", {
          t: "session_end",
          p: "/",
          sid: "s1",
          v: 1,
          sd: 1000,
          sp: 50,
          ib: 0,
        }),
      );

      expect(mockIngestEvent).toHaveBeenCalledOnce();
      const payload = mockIngestEvent.mock.calls[0][0];

      expect(payload.isBounce).toBe(false);
    });
  });
});
