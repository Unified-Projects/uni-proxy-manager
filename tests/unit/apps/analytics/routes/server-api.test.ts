/**
 * Analytics Server-Side API Route Unit Tests
 *
 * Tests for the POST /:uuid/api endpoint that allows backend
 * services to submit events programmatically via Bearer token auth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../../../apps/analytics/src/middleware/rate-limit", () => ({
  apiRateLimit: vi.fn().mockImplementation(async (_c: unknown, next: () => Promise<void>) => next()),
}));

// The SHA-256 hash of "valid-api-token" -- computed once for the mock config
import crypto from "crypto";
const VALID_TOKEN = "valid-api-token";
const VALID_TOKEN_HASH = crypto.createHash("sha256").update(VALID_TOKEN).digest("hex");

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
  apiTokenSha256: VALID_TOKEN_HASH,
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

vi.mock("../../../../../apps/analytics/src/utils/timezone-countries", () => ({
  getCountryFromTimezone: vi.fn(() => "US"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  uuid: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://localhost/${uuid}/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /:uuid/api", () => {
  let app: { request: (req: Request) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetConfigByUuid.mockReturnValue({ ...mockConfig });

    vi.resetModules();
    const mod = await import("../../../../../apps/analytics/src/routes/server-api");
    app = mod.default;
  });

  // =========================================================================
  // Config lookup
  // =========================================================================

  describe("Config lookup", () => {
    it("should return 404 for unknown UUID", async () => {
      mockGetConfigByUuid.mockReturnValue(undefined);

      const res = await app.request(
        makeRequest("unknown-uuid", { events: [] }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("CONFIG_NOT_FOUND");
    });

    it("should return 404 for disabled config", async () => {
      mockGetConfigByUuid.mockReturnValue({ ...mockConfig, enabled: false });

      const res = await app.request(
        makeRequest("test-uuid", { events: [] }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Authentication
  // =========================================================================

  describe("Authentication", () => {
    it("should return 401 when Authorization header is missing", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { events: [{ type: "pageview", pathname: "/" }] }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(body.error.message).toBe("Missing API token");
    });

    it("should return 401 when Authorization header is not a Bearer token", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { events: [] }, { Authorization: "Basic dXNlcjpwYXNz" }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.message).toBe("Missing API token");
    });

    it("should return 401 when Bearer token is invalid", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { events: [] }, { Authorization: "Bearer wrong-token" }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(body.error.message).toBe("Invalid API token");
    });

    it("should return 401 when no API token hash is stored", async () => {
      mockGetConfigByUuid.mockReturnValue({ ...mockConfig, apiTokenSha256: null });

      const res = await app.request(
        makeRequest("test-uuid", { events: [] }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Body validation
  // =========================================================================

  describe("Body validation", () => {
    it("should return 400 for invalid JSON body", async () => {
      const req = new Request("http://localhost/test-uuid/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_TOKEN}`,
        },
        body: "not-json",
      });

      const res = await app.request(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_BODY");
    });

    it("should return 400 when events array is missing", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { data: "no events" }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_PAYLOAD");
    });

    it("should return 400 when events array is empty", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { events: [] }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_PAYLOAD");
    });

    it("should return 400 when events array has more than 100 items", async () => {
      const events = Array.from({ length: 101 }, () => ({
        type: "pageview",
        pathname: "/",
      }));

      const res = await app.request(
        makeRequest("test-uuid", { events }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toBe("Maximum 100 events per request");
    });

    it("should return 413 for oversized body (>512KB)", async () => {
      const largeEvents = [
        {
          type: "pageview",
          pathname: "/",
          meta: { data: "x".repeat(600 * 1024) },
        },
      ];

      const res = await app.request(
        makeRequest("test-uuid", { events: largeEvents }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  // =========================================================================
  // DoNotTrack
  // =========================================================================

  describe("DoNotTrack", () => {
    it("should return 202 with accepted: 0 when dnt is true", async () => {
      const res = await app.request(
        makeRequest("test-uuid", { dnt: true, events: [{ type: "pageview" }] }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.accepted).toBe(0);
      expect(mockIngestEvent).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Successful events
  // =========================================================================

  describe("Successful events", () => {
    it("should accept a valid pageview event", async () => {
      const res = await app.request(
        makeRequest(
          "test-uuid",
          { events: [{ type: "pageview", pathname: "/about" }] },
          { Authorization: `Bearer ${VALID_TOKEN}` },
        ),
      );

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.accepted).toBe(1);
      expect(mockIngestEvent).toHaveBeenCalledOnce();

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.eventType).toBe("pageview");
      expect(payload.pathname).toBe("/about");
      expect(payload.source).toBe("api");
      expect(payload.browser).toBe("API");
      expect(payload.os).toBe("API");
      expect(payload.deviceType).toBe("other");
    });

    it("should accept a valid custom event with name and meta", async () => {
      const res = await app.request(
        makeRequest(
          "test-uuid",
          {
            events: [
              {
                type: "event",
                pathname: "/pricing",
                name: "signup_click",
                meta: { plan: "pro" },
              },
            ],
          },
          { Authorization: `Bearer ${VALID_TOKEN}` },
        ),
      );

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.accepted).toBe(1);

      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.eventType).toBe("event");
      expect(payload.eventName).toBe("signup_click");
      expect(payload.eventMeta).toEqual({ plan: "pro" });
    });

    it("should accept a batch of valid events", async () => {
      const events = [
        { type: "pageview", pathname: "/" },
        { type: "pageview", pathname: "/about" },
        { type: "event", pathname: "/pricing", name: "cta_click" },
      ];

      const res = await app.request(
        makeRequest("test-uuid", { events }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.accepted).toBe(3);
      expect(mockIngestEvent).toHaveBeenCalledTimes(3);
    });

    it("should skip invalid event types (not pageview/event)", async () => {
      const events = [
        { type: "pageview", pathname: "/" },
        { type: "session_end", pathname: "/" },
        { type: "click", pathname: "/" },
        { type: "event", pathname: "/", name: "test" },
      ];

      const res = await app.request(
        makeRequest("test-uuid", { events }, { Authorization: `Bearer ${VALID_TOKEN}` }),
      );

      expect(res.status).toBe(202);
      const body = await res.json();
      // Only "pageview" and "event" should be accepted
      expect(body.accepted).toBe(2);
      expect(mockIngestEvent).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Default pathname
  // =========================================================================

  describe("Default pathname", () => {
    it("should default pathname to '/' when not provided", async () => {
      const res = await app.request(
        makeRequest(
          "test-uuid",
          { events: [{ type: "pageview" }] },
          { Authorization: `Bearer ${VALID_TOKEN}` },
        ),
      );

      expect(res.status).toBe(202);
      const payload = mockIngestEvent.mock.calls[0][0];
      expect(payload.pathname).toBe("/");
    });
  });
});
