import { type Context, type Next } from "hono";
import { getAuthConfig } from "@uni-proxy-manager/shared/config";
import { checkRateLimit, isRateLimited, getClientId } from "./rate-limit";

/**
 * API Key Authentication Middleware
 *
 * Validates requests have a valid API key in the Authorization header.
 * Format: Authorization: Bearer <api-key>
 *
 * Skips authentication for:
 * - /health endpoint (health checks)
 * - Requests when auth is explicitly disabled
 * - Public analytics dashboard routes (they use their own token auth)
 */
export async function authMiddleware(c: Context, next: Next) {
  const authConfig = getAuthConfig();

  // Skip auth if disabled (development mode)
  if (!authConfig.enabled) {
    return next();
  }

  const path = c.req.path;

  // Skip auth for health check endpoint
  if (path === "/health") {
    return next();
  }

  // Skip auth for public analytics dashboard routes (they use their own token auth)
  if (path.startsWith("/api/analytics-public/")) {
    return next();
  }

  // Check if this IP is currently blocked due to too many auth failures.
  // Allow 5 failed attempts per 15-minute window before blocking.
  // The initial check is read-only (does not increment); only actual failures
  // call checkRateLimit to increment the counter.
  const AUTH_FAIL_MAX = 5;
  const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const clientIp = getClientId(c);
  const authFailKey = `auth-fail:${clientIp}`;

  try {
    const failStatus = await isRateLimited(authFailKey, AUTH_FAIL_MAX, AUTH_FAIL_WINDOW_MS);
    if (failStatus.blocked) {
      c.header("Retry-After", String(failStatus.resetSeconds));
      return c.json(
        {
          error: "Too Many Requests",
          message: `Too many failed authentication attempts. Try again in ${failStatus.resetSeconds} seconds.`,
          retryAfter: failStatus.resetSeconds,
        },
        429
      );
    }
  } catch {
    // If rate limit check fails, allow the request through rather than blocking
  }

  // Get the Authorization header
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    // Count missing auth header as a failure
    try { await checkRateLimit(authFailKey, AUTH_FAIL_MAX, AUTH_FAIL_WINDOW_MS); } catch { /* allow through */ }
    return c.json(
      {
        error: "Unauthorized",
        message: "Missing Authorization header. Use: Authorization: Bearer <api-key>"
      },
      401
    );
  }

  // Parse Bearer token
  const parts = authHeader.split(" ");
  const tokenType = parts[0];
  const apiKey = parts[1];
  if (parts.length !== 2 || !tokenType || tokenType.toLowerCase() !== "bearer" || !apiKey) {
    // Count malformed auth as a failure
    try { await checkRateLimit(authFailKey, AUTH_FAIL_MAX, AUTH_FAIL_WINDOW_MS); } catch { /* allow through */ }
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid Authorization header format. Use: Authorization: Bearer <api-key>"
      },
      401
    );
  }

  // Validate API key using timing-safe comparison
  if (!timingSafeEqual(apiKey, authConfig.apiKey)) {
    // Count invalid API key as a failure
    try { await checkRateLimit(authFailKey, AUTH_FAIL_MAX, AUTH_FAIL_WINDOW_MS); } catch { /* allow through */ }
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid API key"
      },
      401
    );
  }

  // API key is valid, continue
  return next();
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain consistent timing
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
