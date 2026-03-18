/**
 * Analytics Internal Authentication Middleware Unit Tests
 *
 * Tests for the middleware that validates X-Internal-Secret headers
 * on requests from apps/api to the internal analytics API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted above all other code, so
// any mock functions they reference must be declared via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockGetInternalSecret } = vi.hoisted(() => ({
  mockGetInternalSecret: vi.fn(),
}));

// Mock both the aliased path and the resolved path to ensure interception.
vi.mock("@uni-proxy-manager/shared/config", () => ({
  getInternalSecret: (...args: unknown[]) => mockGetInternalSecret(...args),
}));

vi.mock("../../../../../packages/shared/src/config", () => ({
  getInternalSecret: (...args: unknown[]) => mockGetInternalSecret(...args),
}));

vi.mock("../../../../../packages/shared/src/config/env", () => ({
  getInternalSecret: (...args: unknown[]) => mockGetInternalSecret(...args),
  getEnv: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORRECT_SECRET = "super-secret-internal-value";

function createApp(middleware: MiddlewareHandler) {
  const app = new Hono();
  app.use("/internal/*", middleware);
  app.get("/internal/data", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("internalAuth middleware", () => {
  let internalAuth: MiddlewareHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetInternalSecret.mockReturnValue(CORRECT_SECRET);

    vi.resetModules();
    const mod = await import("../../../../../apps/analytics/src/middleware/internal-auth");
    internalAuth = mod.internalAuth;
  });

  it("should allow requests with the correct X-Internal-Secret header", async () => {
    const app = createApp(internalAuth);

    const res = await app.request("/internal/data", {
      headers: { "X-Internal-Secret": CORRECT_SECRET },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("should return 401 when X-Internal-Secret header is missing", async () => {
    const app = createApp(internalAuth);

    const res = await app.request("/internal/data");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.message).toBe("Missing internal secret");
  });

  it("should return 401 when X-Internal-Secret header is wrong", async () => {
    const app = createApp(internalAuth);

    const res = await app.request("/internal/data", {
      headers: { "X-Internal-Secret": "wrong-secret" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.message).toBe("Invalid internal secret");
  });

  it("should return 401 when X-Internal-Secret header is empty", async () => {
    const app = createApp(internalAuth);

    const res = await app.request("/internal/data", {
      headers: { "X-Internal-Secret": "" },
    });

    expect(res.status).toBe(401);
  });

  it("should return 500 when the internal secret is not configured", async () => {
    mockGetInternalSecret.mockImplementation(() => {
      throw new Error("UNI_PROXY_MANAGER_INTERNAL_SECRET is not set");
    });

    vi.resetModules();
    const mod = await import("../../../../../apps/analytics/src/middleware/internal-auth");
    const app = createApp(mod.internalAuth);

    const res = await app.request("/internal/data", {
      headers: { "X-Internal-Secret": "any-value" },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
    expect(body.error.message).toBe("Internal secret not configured");
  });

  it("should reject secrets that are a prefix of the correct secret", async () => {
    const app = createApp(internalAuth);

    const res = await app.request("/internal/data", {
      headers: { "X-Internal-Secret": CORRECT_SECRET.slice(0, 10) },
    });

    expect(res.status).toBe(401);
  });

  it("should reject secrets that are the correct secret with extra characters", async () => {
    const app = createApp(internalAuth);

    const res = await app.request("/internal/data", {
      headers: { "X-Internal-Secret": CORRECT_SECRET + "extra" },
    });

    expect(res.status).toBe(401);
  });
});
