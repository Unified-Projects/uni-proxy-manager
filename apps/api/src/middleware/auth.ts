import { type Context, type Next } from "hono";
import { getAuthConfig } from "@uni-proxy-manager/shared/config";
import { networkInterfaces } from "os";
import { lookup } from "dns/promises";
import { checkRateLimit, isRateLimited, getClientId } from "./rate-limit";

// Dynamic import for Bun-specific module (only works in Bun runtime)
let getConnInfo: ((c: Context) => { remote?: { address?: string } }) | null = null;
try {
  // Only import hono/bun if running in Bun
  if (typeof globalThis.Bun !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const honoBun = require("hono/bun");
    getConnInfo = honoBun.getConnInfo;
  }
} catch {
  // Not running in Bun, getConnInfo will remain null
}

// Cache for trusted IPs (resolved once at startup)
const trustedSubnets: string[] = [];
const trustedIPs: Set<string> = new Set();
let initialized = false;

/**
 * Extract /24 subnet from an IP address
 */
function getSubnet24(ip: string): string | null {
  // Handle IPv6-mapped IPv4
  const cleanIP = ip.replace(/^::ffff:/, "");
  const parts = cleanIP.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.`;
  }
  return null;
}

/**
 * Initialize trusted networks by detecting our subnet and resolving Docker service names
 */
async function initTrustedNetworks() {
  if (initialized) return;
  initialized = true;

  // Get our own IPs and subnets
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const subnet = getSubnet24(iface.address);
        if (subnet && !trustedSubnets.includes(subnet)) {
          trustedSubnets.push(subnet);
        }
      }
    }
  }

  // Resolve Docker service names to get their IPs
  const dockerServices = ["web", "dashboard-proxy", "haproxy", "workers", "sites-lookup", "sites-workers"];
  for (const service of dockerServices) {
    try {
      const result = await lookup(service);
      trustedIPs.add(result.address);
    } catch {
      // Service doesn't exist or can't be resolved - that's fine
    }
  }

  // Always trust localhost
  trustedIPs.add("127.0.0.1");
  trustedIPs.add("::1");
}

/**
 * Check if an IP is trusted (on our subnet or a known service)
 */
function isTrustedIP(ip: string | undefined): boolean {
  if (!ip) return false;

  // Clean IPv6-mapped addresses
  const cleanIP = ip.replace(/^::ffff:/, "");

  // Check explicit trusted IPs
  if (trustedIPs.has(cleanIP) || trustedIPs.has(ip)) {
    return true;
  }

  // Check if IP is on a trusted subnet
  for (const subnet of trustedSubnets) {
    if (cleanIP.startsWith(subnet)) {
      return true;
    }
  }

  return false;
}

// Initialize on module load
initTrustedNetworks().catch(err => {
  console.error("[Auth] Failed to initialize trusted networks:", err);
});

/**
 * API Key Authentication Middleware
 *
 * Validates requests have a valid API key in the Authorization header.
 * Format: Authorization: Bearer <api-key>
 *
 * Skips authentication for:
 * - /health endpoint (health checks)
 * - Requests when auth is disabled (development mode)
 * - Requests from internal Docker network (dashboard-proxy)
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

  // Skip auth for internal Docker network requests
  // Check the direct socket connection IP (not X-Forwarded-For which can be spoofed)
  if (getConnInfo) {
    try {
      const connInfo = getConnInfo(c);
      const remoteIP = connInfo?.remote?.address;
      if (isTrustedIP(remoteIP)) {
        return next();
      }
    } catch {
      // getConnInfo failed, continue with auth check
    }
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
