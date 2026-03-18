import { type Context, type Next } from "hono";
import type Redis from "ioredis";

/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  /** Maximum number of requests per window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Optional key prefix for different rate limit groups */
  keyPrefix?: string;
}

const defaultConfig: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
};

/**
 * In-memory fallback store used when Redis is unavailable.
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const fallbackStore = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackStore.entries()) {
    if (entry.resetTime < now) {
      fallbackStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

/**
 * Lazy-loaded Redis client reference. We resolve it once on first use so that
 * the module can be imported before Redis is initialised.
 */
let _redis: Redis | null = null;
let _redisAvailable = true;
let _redisCheckTime = 0;
const REDIS_RECHECK_INTERVAL_MS = 30000; // Re-check Redis availability every 30s after failure

function getRedis(): Redis | null {
  if (!_redisAvailable) {
    // Periodically re-check so that if Redis comes back, we use it
    if (Date.now() - _redisCheckTime < REDIS_RECHECK_INTERVAL_MS) {
      return null;
    }
  }

  if (!_redis) {
    try {
      // Dynamic require to avoid circular dependency at module-load time
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getRedisClient } = require("@uni-proxy-manager/shared/redis");
      _redis = getRedisClient() as Redis;
      _redisAvailable = true;
    } catch {
      _redisAvailable = false;
      _redisCheckTime = Date.now();
      return null;
    }
  }

  return _redis;
}

/**
 * Lua script for atomic increment-and-get with TTL.
 * KEYS[1] = rate limit key
 * ARGV[1] = TTL in seconds
 * Returns [current_count, ttl_remaining]
 */
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local ttl_seconds = tonumber(ARGV[1])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, ttl_seconds)
end
local remaining_ttl = redis.call('TTL', key)
return {current, remaining_ttl}
`;

/**
 * Get client identifier for rate limiting
 * Uses X-Forwarded-For header if behind a proxy, otherwise remote address
 */
function getClientId(c: Context): string {
  // Prefer X-Real-IP — typically set by the reverse proxy to the actual
  // connecting client address and not spoofable by the client.
  const realIp = c.req.header("X-Real-IP");
  if (realIp) {
    return realIp;
  }

  // Fall back to the *last* entry in X-Forwarded-For. The last value is
  // the one appended by the trusted reverse proxy (HAProxy) and cannot
  // be forged by the client.
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    const parts = forwarded.split(",");
    const lastIp = parts[parts.length - 1];
    return lastIp ? lastIp.trim() : "unknown";
  }

  return "unknown";
}

/**
 * Check if rate limiting should be disabled
 */
function isRateLimitDisabled(): boolean {
  return process.env.DISABLE_RATE_LIMIT === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true";
}

/**
 * Try to perform rate limiting via Redis. Returns null if Redis is unavailable,
 * otherwise returns { count, resetSeconds }.
 */
async function redisRateLimit(
  key: string,
  windowMs: number
): Promise<{ count: number; resetSeconds: number } | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const ttlSeconds = Math.ceil(windowMs / 1000);
    const result = await redis.eval(RATE_LIMIT_LUA, 1, key, ttlSeconds) as [number, number];
    const count = result[0];
    const resetSeconds = result[1] > 0 ? result[1] : ttlSeconds;
    return { count, resetSeconds };
  } catch {
    // Redis became unavailable mid-operation; mark it and fall back
    _redisAvailable = false;
    _redisCheckTime = Date.now();
    return null;
  }
}

/**
 * Perform rate limiting via the in-memory fallback store.
 */
function inMemoryRateLimit(
  key: string,
  windowMs: number
): { count: number; resetSeconds: number } {
  const now = Date.now();
  let entry = fallbackStore.get(key);

  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + windowMs,
    };
  }

  entry.count++;
  fallbackStore.set(key, entry);

  const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);
  return { count: entry.count, resetSeconds };
}

/**
 * Create a rate limiting middleware.
 * Uses Redis when available, falls back to in-memory gracefully.
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const { maxRequests, windowMs, keyPrefix } = { ...defaultConfig, ...config };

  return async function rateLimitMiddleware(c: Context, next: Next) {
    // Skip rate limiting in test mode
    if (isRateLimitDisabled()) {
      return next();
    }

    const clientId = getClientId(c);
    const key = keyPrefix ? `ratelimit:${keyPrefix}:${clientId}` : `ratelimit:${clientId}`;

    // Try Redis first, fall back to in-memory
    let result = await redisRateLimit(key, windowMs);
    if (!result) {
      result = inMemoryRateLimit(key, windowMs);
    }

    const remaining = Math.max(0, maxRequests - result.count);

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(result.resetSeconds));

    if (result.count > maxRequests) {
      const endpoint = c.req.path;
      console.warn(
        `[RateLimit] Rate limit exceeded: ip=${clientId} endpoint=${endpoint} prefix=${keyPrefix || "default"} count=${result.count}/${maxRequests} retryAfter=${result.resetSeconds}s`
      );
      c.header("Retry-After", String(result.resetSeconds));
      return c.json(
        {
          error: "Too Many Requests",
          message: `Rate limit exceeded. Try again in ${result.resetSeconds} seconds.`,
          retryAfter: result.resetSeconds,
        },
        429
      );
    }

    return next();
  };
}

/**
 * Standalone function to check/increment a rate limit counter.
 * Useful for non-middleware contexts (e.g. auth failure tracking).
 * Returns { blocked: true, resetSeconds } if the limit is exceeded.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ count: number; blocked: boolean; resetSeconds: number }> {
  const fullKey = `ratelimit:${key}`;

  let result = await redisRateLimit(fullKey, windowMs);
  if (!result) {
    result = inMemoryRateLimit(fullKey, windowMs);
  }

  return {
    count: result.count,
    blocked: result.count > maxRequests,
    resetSeconds: result.resetSeconds,
  };
}

/**
 * Read-only check of a rate limit counter without incrementing.
 * Returns whether the key is currently blocked.
 */
export async function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ blocked: boolean; resetSeconds: number }> {
  const fullKey = `ratelimit:${key}`;

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.get(fullKey);
      if (count === null) {
        return { blocked: false, resetSeconds: 0 };
      }
      const ttl = await redis.ttl(fullKey);
      const resetSeconds = ttl > 0 ? ttl : Math.ceil(windowMs / 1000);
      return {
        blocked: parseInt(count, 10) > maxRequests,
        resetSeconds,
      };
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback (read-only)
  const entry = fallbackStore.get(fullKey);
  if (!entry || entry.resetTime < Date.now()) {
    return { blocked: false, resetSeconds: 0 };
  }

  const resetSeconds = Math.ceil((entry.resetTime - Date.now()) / 1000);
  return {
    blocked: entry.count > maxRequests,
    resetSeconds,
  };
}

/**
 * Default rate limiter (100 requests per minute)
 */
export const rateLimitMiddleware = createRateLimiter();

/**
 * Stricter rate limiter for sensitive operations (10 requests per minute)
 */
export const strictRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60000,
  keyPrefix: "strict",
});

/**
 * Very strict rate limiter for certificate operations (5 requests per 5 minutes)
 */
export const certificateRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 300000, // 5 minutes
  keyPrefix: "certificate",
});

// Re-export getClientId for use in auth failure rate limiting
export { getClientId };
