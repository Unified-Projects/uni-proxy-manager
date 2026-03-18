/**
 * Rate Limit Middleware Unit Tests
 *
 * Tests for the analytics service rate limiting middleware that uses
 * Redis-backed Lua scripts to enforce per-IP and per-UUID request limits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const mockRedis = {
  eval: vi.fn(),
};

vi.mock("../../../../../packages/shared/src/redis/client", () => ({
  getRedisClient: () => mockRedis,
}));

// Import the middleware *after* the mock is set up so the module-level
// `vi.mock` hoisting takes effect.
import { beaconRateLimit, apiRateLimit } from "apps/analytics/src/middleware/rate-limit";

// ---------------------------------------------------------------------------
// Environment handling
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();

  // The source checks process.env.VITEST, NODE_ENV and DISABLE_RATE_LIMIT
  // to decide whether to bypass rate limiting.  During vitest runs VITEST is
  // normally "true", so we must override these to non-bypassing values so the
  // rate limiter actually runs in these tests.
  process.env.DISABLE_RATE_LIMIT = "false";
  process.env.NODE_ENV = "production";
  process.env.VITEST = "";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Helper -- tiny Hono apps that mount the middleware under test
// ---------------------------------------------------------------------------

function createBeaconApp() {
  const app = new Hono();
  app.use("/:uuid/collect", beaconRateLimit);
  app.post("/:uuid/collect", (c) => c.json({ ok: true }));
  return app;
}

function createApiApp() {
  const app = new Hono();
  app.use("/api/*", apiRateLimit);
  app.get("/api/data", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// 1. IP Extraction
// ---------------------------------------------------------------------------

describe("getClientIp (via middleware headers)", () => {
  it("should return X-Real-IP when present", async () => {
    mockRedis.eval.mockResolvedValue([1, 60]);

    const app = createBeaconApp();

    const res = await app.request("/my-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
    // The eval call key should contain the real IP
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "rl:beacon:ip:1.2.3.4",
      60,
    );
  });

  it("should return last X-Forwarded-For entry when X-Real-IP is absent", async () => {
    mockRedis.eval.mockResolvedValue([1, 60]);

    const app = createBeaconApp();

    const res = await app.request("/my-uuid/collect", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1, 10.0.0.2, 10.0.0.3" },
    });

    expect(res.status).toBe(200);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "rl:beacon:ip:10.0.0.3",
      60,
    );
  });

  it("should return 'unknown' when no proxy headers are present", async () => {
    mockRedis.eval.mockResolvedValue([1, 60]);

    const app = createBeaconApp();

    const res = await app.request("/my-uuid/collect", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "rl:beacon:ip:unknown",
      60,
    );
  });

  it("should trim whitespace from forwarded IPs", async () => {
    mockRedis.eval.mockResolvedValue([1, 60]);

    const app = createBeaconApp();

    const res = await app.request("/my-uuid/collect", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1,  192.168.1.1  " },
    });

    expect(res.status).toBe(200);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "rl:beacon:ip:192.168.1.1",
      60,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Rate limit disabled
// ---------------------------------------------------------------------------

describe("Rate limit disabled", () => {
  it("should bypass when DISABLE_RATE_LIMIT=true", async () => {
    process.env.DISABLE_RATE_LIMIT = "true";

    const app = createBeaconApp();
    const res = await app.request("/my-uuid/collect", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("should bypass when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";

    const app = createBeaconApp();
    const res = await app.request("/my-uuid/collect", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("should bypass when VITEST=true", async () => {
    process.env.VITEST = "true";

    const app = createBeaconApp();
    const res = await app.request("/my-uuid/collect", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Beacon rate limit
// ---------------------------------------------------------------------------

describe("beaconRateLimit", () => {
  it("should allow requests under the per-IP limit", async () => {
    mockRedis.eval.mockResolvedValue([30, 45]);

    const app = createBeaconApp();

    const res = await app.request("/test-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("should return 429 when per-IP limit exceeded (> 60)", async () => {
    // First eval call (IP) returns count=61, second (UUID) returns count=1
    mockRedis.eval
      .mockResolvedValueOnce([61, 30]) // IP counter
      .mockResolvedValueOnce([1, 60]); // UUID counter

    const app = createBeaconApp();

    const res = await app.request("/test-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "1.2.3.4" },
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfter).toBe(30);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("30");
  });

  it("should return 429 when per-UUID limit exceeded (> 10,000)", async () => {
    // IP count is fine, but UUID count exceeds the limit
    mockRedis.eval
      .mockResolvedValueOnce([5, 50])      // IP counter -- well under 60
      .mockResolvedValueOnce([10_001, 42]); // UUID counter -- over 10,000

    const app = createBeaconApp();

    const res = await app.request("/test-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "1.2.3.4" },
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfter).toBe(42);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("should set X-RateLimit-Remaining and X-RateLimit-Reset headers on success", async () => {
    mockRedis.eval
      .mockResolvedValueOnce([10, 55])  // IP counter
      .mockResolvedValueOnce([500, 55]); // UUID counter

    const app = createBeaconApp();

    const res = await app.request("/test-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "5.6.7.8" },
    });

    expect(res.status).toBe(200);

    // IP remaining = 60 - 10 = 50, UUID remaining = 10000 - 500 = 9500
    // remaining = min(50, 9500) = 50
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("50");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("55");
  });

  it("should fall back to allowing the request when Redis fails", async () => {
    mockRedis.eval.mockRejectedValue(new Error("Redis connection refused"));

    const app = createBeaconApp();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await app.request("/test-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[Analytics] Rate limit Redis error:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("should use the uuid route parameter in the Redis key", async () => {
    mockRedis.eval.mockResolvedValue([1, 60]);

    const app = createBeaconApp();

    await app.request("/my-special-uuid/collect", {
      method: "POST",
      headers: { "X-Real-IP": "1.2.3.4" },
    });

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "rl:beacon:uuid:my-special-uuid",
      60,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. API rate limit
// ---------------------------------------------------------------------------

describe("apiRateLimit", () => {
  it("should allow requests under the limit (100/min)", async () => {
    mockRedis.eval.mockResolvedValue([50, 40]);

    const app = createApiApp();

    const res = await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "9.8.7.6" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("should return 429 when limit exceeded", async () => {
    mockRedis.eval.mockResolvedValue([101, 25]);

    const app = createApiApp();

    const res = await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "9.8.7.6" },
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfter).toBe(25);
    expect(res.headers.get("Retry-After")).toBe("25");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("25");
  });

  it("should set appropriate headers on allowed requests", async () => {
    mockRedis.eval.mockResolvedValue([75, 33]);

    const app = createApiApp();

    const res = await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "9.8.7.6" },
    });

    expect(res.status).toBe(200);
    // remaining = 100 - 75 = 25
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("25");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("33");
  });

  it("should fall back to allowing the request when Redis fails", async () => {
    mockRedis.eval.mockRejectedValue(new Error("Redis timeout"));

    const app = createApiApp();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "9.8.7.6" },
    });

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[Analytics] Rate limit Redis error:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. incrementCounter behaviour (via Lua script)
// ---------------------------------------------------------------------------

describe("incrementCounter via Lua script (middleware integration)", () => {
  it("should call redis.eval with the Lua script", async () => {
    mockRedis.eval.mockResolvedValue([1, 60]);

    const app = createApiApp();

    await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "1.1.1.1" },
    });

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      1,
      "rl:api:1.1.1.1",
      60,
    );
  });

  it("should return WINDOW_SECONDS (60) when TTL is 0", async () => {
    // When TTL returns 0 (key exists but no TTL), the middleware substitutes
    // WINDOW_SECONDS. We verify this by checking the X-RateLimit-Reset header.
    mockRedis.eval.mockResolvedValue([10, 0]);

    const app = createApiApp();

    const res = await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "2.2.2.2" },
    });

    expect(res.status).toBe(200);
    // When ttl <= 0, the code falls back to WINDOW_SECONDS = 60
    expect(res.headers.get("X-RateLimit-Reset")).toBe("60");
  });

  it("should return WINDOW_SECONDS (60) when TTL is negative", async () => {
    mockRedis.eval.mockResolvedValue([10, -1]);

    const app = createApiApp();

    const res = await app.request("/api/data", {
      method: "GET",
      headers: { "X-Real-IP": "3.3.3.3" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Reset")).toBe("60");
  });
});
