/**
 * Analytics Pixel Tracking Route Unit Tests
 *
 * Tests for the GET /:uuid/pixel.gif endpoint that serves a 1x1
 * transparent GIF and records a pageview for noscript visitors.
 * Includes bot filtering, deterministic session IDs, and
 * referer-based hostname validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
  ignoredPaths: [],
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

vi.mock("../../../../../apps/analytics/src/utils/ua-parser", () => ({
  parseUserAgent: vi.fn(() => ({
    browser: "Chrome",
    browserVersion: "120.0",
    os: "Windows",
    deviceType: "desktop",
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /:uuid/pixel.gif", () => {
  let app: { request: (req: Request | string, init?: RequestInit) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetConfigByUuid.mockReturnValue({ ...mockConfig });

    vi.resetModules();
    const mod = await import("../../../../../apps/analytics/src/routes/pixel");
    app = mod.default;
  });

  // =========================================================================
  // Always returns pixel
  // =========================================================================

  describe("Always returns pixel", () => {
    it("should return 200 with image/gif for a valid request", async () => {
      const res = await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/page" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
    });

    it("should return 200 with image/gif for unknown UUID", async () => {
      mockGetConfigByUuid.mockReturnValue(undefined);

      const res = await app.request("/unknown-uuid/pixel.gif");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
    });

    it("should return 200 with image/gif for disabled config", async () => {
      mockGetConfigByUuid.mockReturnValue({ ...mockConfig, enabled: false });

      const res = await app.request("/test-uuid/pixel.gif");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
    });

    it("should set Cache-Control to no-cache, no-store", async () => {
      const res = await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-store");
    });

    it("should return pixel even when bot is detected", async () => {
      const res = await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": "Googlebot/2.1",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
    });
  });

  // =========================================================================
  // Ingestion conditions
  // =========================================================================

  describe("Ingestion conditions", () => {
    it("should NOT ingest when UUID is unknown", async () => {
      mockGetConfigByUuid.mockReturnValue(undefined);

      await app.request("/unknown-uuid/pixel.gif");

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest when config is disabled", async () => {
      mockGetConfigByUuid.mockReturnValue({ ...mockConfig, enabled: false });

      await app.request("/test-uuid/pixel.gif");

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest when Sec-GPC is 1", async () => {
      const res = await app.request("/test-uuid/pixel.gif", {
        headers: {
          "Sec-GPC": "1",
          Referer: "https://example.com/",
        },
      });

      expect(res.status).toBe(200);
      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest when Referer is missing", async () => {
      await app.request("/test-uuid/pixel.gif");

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest when Referer is invalid", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "not-a-url" },
      });

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest when Referer hostname does not match config", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://other-site.com/page" },
      });

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should ingest when Referer hostname matches config hostname", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/about" },
      });

      expect(mockIngestEvent).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Bot filtering
  // =========================================================================

  describe("Bot filtering", () => {
    it("should NOT ingest when User-Agent matches a known bot pattern", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest for crawler User-Agents", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": "Mozilla/5.0 (compatible; bingpreview/2.0)",
        },
      });

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest for headless chrome", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": "Mozilla/5.0 HeadlessChrome/120.0",
        },
      });

      expect(mockIngestEvent).not.toHaveBeenCalled();
    });

    it("should NOT ingest for AI crawlers (GPTBot, ClaudeBot, etc.)", async () => {
      for (const ua of ["GPTBot/1.0", "ClaudeBot/1.0", "anthropic-ai/1.0", "CCBot/2.0"]) {
        vi.clearAllMocks();
        mockGetConfigByUuid.mockReturnValue({ ...mockConfig });

        await app.request("/test-uuid/pixel.gif", {
          headers: {
            Referer: "https://example.com/",
            "User-Agent": ua,
          },
        });

        expect(mockIngestEvent).not.toHaveBeenCalled();
      }
    });

    it("should NOT ingest for SEO tool bots (semrush, ahrefs, etc.)", async () => {
      for (const ua of ["SemrushBot/7", "AhrefsBot/7.0", "MJ12bot/v1.4"]) {
        vi.clearAllMocks();
        mockGetConfigByUuid.mockReturnValue({ ...mockConfig });

        await app.request("/test-uuid/pixel.gif", {
          headers: {
            Referer: "https://example.com/",
            "User-Agent": ua,
          },
        });

        expect(mockIngestEvent).not.toHaveBeenCalled();
      }
    });

    it("should allow 'Cubot' phone User-Agent (not a bot despite containing 'bot')", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": "Mozilla/5.0 (Linux; Android 11; CUBOT P50) AppleWebKit/537.36",
        },
      });

      expect(mockIngestEvent).toHaveBeenCalledOnce();
    });

    it("should ingest for a normal browser User-Agent", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
        },
      });

      expect(mockIngestEvent).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Ingestion payload
  // =========================================================================

  describe("Ingestion payload", () => {
    it("should set source to 'pixel'", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/about" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.source).toBe("pixel");
    });

    it("should set eventType to 'pageview'", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.eventType).toBe("pageview");
    });

    it("should extract pathname from Referer URL", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/about/team" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.pathname).toBe("/about/team");
    });

    it("should set configId from config", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.configId).toBe("config-1");
    });

    it("should set isUnique to false (pixel hits are always marked as not unique)", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.isUnique).toBe(false);
    });

    it("should set screen dimensions to 0", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.screenWidth).toBe(0);
      expect(payload.screenHeight).toBe(0);
    });

    it("should set empty timezone", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.timezone).toBe("");
    });

    it("should set isBounce, isEntry, and isExit to false", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.isBounce).toBe(false);
      expect(payload.isEntry).toBe(false);
      expect(payload.isExit).toBe(false);
    });

    it("should set referrer fields from the Referer header", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/page" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.referrer).toBe("https://example.com/page");
      expect(payload.referrerDomain).toBe("example.com");
    });

    it("should set empty UTM parameters", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.utmSource).toBe("");
      expect(payload.utmMedium).toBe("");
      expect(payload.utmCampaign).toBe("");
      expect(payload.utmTerm).toBe("");
      expect(payload.utmContent).toBe("");
    });
  });

  // =========================================================================
  // Deterministic session ID
  // =========================================================================

  describe("Deterministic session ID", () => {
    it("should generate a sessionId prefixed with 'pixel_'", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.sessionId).toMatch(/^pixel_[0-9a-f]{16}$/);
    });

    it("should derive sessionId from SHA256 of date + userAgent", async () => {
      const userAgent = "Mozilla/5.0 TestBrowser";
      const today = new Date().toISOString().slice(0, 10);
      const expectedHash = crypto
        .createHash("sha256")
        .update(today + userAgent)
        .digest("hex")
        .substring(0, 16);

      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "User-Agent": userAgent,
        },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.sessionId).toBe(`pixel_${expectedHash}`);
    });

    it("should produce a 16-character hex hash portion", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: { Referer: "https://example.com/" },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      const hashPortion = payload.sessionId.replace("pixel_", "");
      expect(hashPortion).toHaveLength(16);
      expect(hashPortion).toMatch(/^[0-9a-f]+$/);
    });
  });

  // =========================================================================
  // Country from Accept-Language
  // =========================================================================

  describe("Country from Accept-Language", () => {
    it("should extract country from Accept-Language with region subtag", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "Accept-Language": "en-GB,en;q=0.9",
        },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.countryCode).toBe("GB");
    });

    it("should extract country from de-DE Accept-Language", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "Accept-Language": "de-DE",
        },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.countryCode).toBe("DE");
    });

    it("should return 'Unknown' when Accept-Language has no region subtag", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
          "Accept-Language": "en,fr;q=0.9",
        },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.countryCode).toBe("Unknown");
    });

    it("should return 'Unknown' when Accept-Language is empty", async () => {
      await app.request("/test-uuid/pixel.gif", {
        headers: {
          Referer: "https://example.com/",
        },
      });

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.countryCode).toBe("Unknown");
    });
  });
});
