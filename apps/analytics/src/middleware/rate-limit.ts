/**
 * Redis-based sliding window rate limiting middleware for the analytics service.
 *
 * Uses Redis INCR with a 60-second TTL for a simple fixed-window approach
 * that matches the existing rate limiter pattern in apps/api.
 *
 * Limits:
 *   - beaconRateLimit: 60 req/min per IP + 10,000 req/min per tracking UUID
 *   - apiRateLimit: 100 req/min per client IP
 */

import { createMiddleware } from "hono/factory";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { INCR_WITH_TTL_LUA } from "../utils/redis-lua";

const WINDOW_SECONDS = 60;

/**
 * Extract the client IP from proxy headers, falling back to "unknown".
 */
function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  // Prefer X-Real-IP — set by the reverse proxy, not spoofable by the client.
  const realIp = c.req.header("X-Real-IP");
  if (realIp) {
    return realIp;
  }

  // Fall back to the last entry in X-Forwarded-For (appended by the trusted proxy).
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    const parts = forwarded.split(",");
    const lastIp = parts[parts.length - 1];
    return lastIp ? lastIp.trim() : "unknown";
  }

  return "unknown";
}

/**
 * Check whether rate limiting should be bypassed entirely (tests, local dev).
 */
function isRateLimitDisabled(): boolean {
  return (
    process.env.DISABLE_RATE_LIMIT === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true"
  );
}

/**
 * Increment a Redis counter and return the current count plus the TTL.
 * Uses a Lua script to perform INCR + conditional EXPIRE + TTL in a
 * single round-trip instead of three.
 */
async function incrementCounter(key: string): Promise<{ count: number; ttl: number }> {
  const redis = getRedisClient();

  const result = await redis.eval(
    INCR_WITH_TTL_LUA,
    1,
    key,
    WINDOW_SECONDS,
  ) as [number, number];

  const [count, ttl] = result;
  return { count, ttl: ttl > 0 ? ttl : WINDOW_SECONDS };
}

/**
 * Send a 429 response with appropriate rate-limit headers.
 */
function tooManyRequests(
  c: { header: (name: string, value: string) => void; json: (data: unknown, status: number) => Response },
  remaining: number,
  resetSeconds: number,
) {
  c.header("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  c.header("X-RateLimit-Reset", String(resetSeconds));
  c.header("Retry-After", String(resetSeconds));

  return c.json(
    {
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${resetSeconds} seconds.`,
      retryAfter: resetSeconds,
    },
    429,
  );
}

/**
 * Beacon rate limiter.
 *
 * Enforces two limits simultaneously:
 *   1. Per-IP: 60 requests per minute
 *   2. Per-UUID: 10,000 requests per minute (global cap per tracked domain)
 */
export const beaconRateLimit = createMiddleware(async (c, next) => {
  if (isRateLimitDisabled()) {
    return next();
  }

  const ip = getClientIp(c);
  const uuid = c.req.param("uuid") || "unknown";

  const PER_IP_LIMIT = 60;
  const PER_UUID_LIMIT = 10_000;

  let ipResult: { count: number; ttl: number };
  let uuidResult: { count: number; ttl: number };

  try {
    [ipResult, uuidResult] = await Promise.all([
      incrementCounter(`rl:beacon:ip:${ip}`),
      incrementCounter(`rl:beacon:uuid:${uuid}`),
    ]);
  } catch (error) {
    // If Redis is unavailable, allow the request through rather than
    // blocking all beacon collection.
    console.error("[Analytics] Rate limit Redis error:", error);
    return next();
  }

  // Check per-IP limit.
  if (ipResult.count > PER_IP_LIMIT) {
    return tooManyRequests(c as never, PER_IP_LIMIT - ipResult.count, ipResult.ttl);
  }

  // Check per-UUID limit.
  if (uuidResult.count > PER_UUID_LIMIT) {
    return tooManyRequests(c as never, PER_UUID_LIMIT - uuidResult.count, uuidResult.ttl);
  }

  // Set informational headers (use the more restrictive remaining value).
  const ipRemaining = PER_IP_LIMIT - ipResult.count;
  const uuidRemaining = PER_UUID_LIMIT - uuidResult.count;
  const remaining = Math.min(ipRemaining, uuidRemaining);

  c.header("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  c.header("X-RateLimit-Reset", String(ipResult.ttl));

  return next();
});

/**
 * API rate limiter.
 *
 * Enforces 100 requests per minute per client IP (for server-side API endpoints).
 */
export const apiRateLimit = createMiddleware(async (c, next) => {
  if (isRateLimitDisabled()) {
    return next();
  }

  const ip = getClientIp(c);
  const PER_IP_LIMIT = 100;

  let result: { count: number; ttl: number };

  try {
    result = await incrementCounter(`rl:api:${ip}`);
  } catch (error) {
    // If Redis is unavailable, allow the request through.
    console.error("[Analytics] Rate limit Redis error:", error);
    return next();
  }

  if (result.count > PER_IP_LIMIT) {
    return tooManyRequests(c as never, PER_IP_LIMIT - result.count, result.ttl);
  }

  c.header("X-RateLimit-Remaining", String(Math.max(0, PER_IP_LIMIT - result.count)));
  c.header("X-RateLimit-Reset", String(result.ttl));

  return next();
});
