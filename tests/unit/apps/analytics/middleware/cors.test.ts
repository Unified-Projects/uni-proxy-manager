/**
 * Analytics CORS Middleware Unit Tests
 *
 * Tests for the CORS middleware that validates request origins
 * against the analytics config's hostname and allowed origins.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetConfigByUuid = vi.fn();

vi.mock("../../../../../apps/analytics/src/services/config-cache", () => ({
  getConfigByUuid: (...args: unknown[]) => mockGetConfigByUuid(...args),
}));

import { analyticsCors } from "../../../../../apps/analytics/src/middleware/cors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockConfig = {
  id: "config-1",
  trackingUuid: "test-uuid",
  enabled: true,
  hostname: "example.com",
  allowedOrigins: [] as string[],
};

function createApp() {
  const app = new Hono();
  app.use("/:uuid/collect", analyticsCors);
  app.post("/:uuid/collect", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyticsCors middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfigByUuid.mockReturnValue({ ...mockConfig });
  });

  // =========================================================================
  // Matching origin
  // =========================================================================

  describe("Matching origin", () => {
    it("should allow requests with origin matching the config hostname", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "POST",
        headers: { Origin: "https://example.com" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    });

    it("should allow requests with origin matching an allowed origin", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        allowedOrigins: ["https://staging.example.com"],
      });
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "POST",
        headers: { Origin: "https://staging.example.com" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://staging.example.com");
    });

    it("should allow requests with origin matching a bare hostname in allowedOrigins", async () => {
      mockGetConfigByUuid.mockReturnValue({
        ...mockConfig,
        allowedOrigins: ["staging.example.com"],
      });
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "POST",
        headers: { Origin: "https://staging.example.com" },
      });

      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // Mismatched origin
  // =========================================================================

  describe("Mismatched origin", () => {
    it("should return 403 for a mismatched origin", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "POST",
        headers: { Origin: "https://evil-site.com" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("CORS_REJECTED");
    });
  });

  // =========================================================================
  // No origin header
  // =========================================================================

  describe("No origin header", () => {
    it("should allow requests without an Origin header (sendBeacon behaviour)", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Vary")).toBe("Origin");
    });
  });

  // =========================================================================
  // OPTIONS preflight
  // =========================================================================

  describe("OPTIONS preflight", () => {
    it("should return 204 for a valid preflight request", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
      expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    });

    it("should return 403 for preflight with mismatched origin", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "OPTIONS",
        headers: { Origin: "https://evil-site.com" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("CORS_REJECTED");
    });

    it("should return 404 for preflight when config is not found", async () => {
      mockGetConfigByUuid.mockReturnValue(undefined);
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("CONFIG_NOT_FOUND");
    });

    it("should return 403 for preflight without origin and without config", async () => {
      mockGetConfigByUuid.mockReturnValue(undefined);
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "OPTIONS",
      });

      expect(res.status).toBe(403);
    });

    it("should mirror the primary hostname when preflight has no origin but config exists", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "OPTIONS",
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    });
  });

  // =========================================================================
  // Vary header
  // =========================================================================

  describe("Vary header", () => {
    it("should set Vary: Origin on all responses", async () => {
      const app = createApp();

      const res = await app.request("/test-uuid/collect", {
        method: "POST",
        headers: { Origin: "https://example.com" },
      });

      expect(res.headers.get("Vary")).toBe("Origin");
    });
  });
});
