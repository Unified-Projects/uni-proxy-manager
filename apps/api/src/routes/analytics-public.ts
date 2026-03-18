/**
 * Public analytics dashboard routes.
 * No standard API auth required -- access is gated by public dashboard token
 * and optional password protection via JWT sessions.
 */

import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { analyticsConfig } from "@uni-proxy-manager/database";
import { eq } from "drizzle-orm";
import { getInternalSecret, getAnalyticsEndpoint, getAnalyticsJwtSecret } from "@uni-proxy-manager/shared/config";
import * as jose from "jose";
import bcrypt from "bcryptjs";
import { strictRateLimiter } from "../middleware/rate-limit";

const app = new Hono();

async function proxyToAnalytics(path: string, queryString: string): Promise<Response> {
  const endpoint = getAnalyticsEndpoint();
  const secret = getInternalSecret();
  const url = queryString
    ? `${endpoint}/internal/analytics${path}?${queryString}`
    : `${endpoint}/internal/analytics${path}`;
  return fetch(url, { headers: { "X-Internal-Secret": secret } });
}

async function getConfigByToken(token: string) {
  return db.query.analyticsConfig.findFirst({
    where: eq(analyticsConfig.publicDashboardToken, token),
    with: { domain: true },
  });
}

/**
 * Validate public access for a request. Checks token validity and optional
 * password-based JWT session.
 */
async function validatePublicAccess(
  token: string,
  authHeader?: string,
): Promise<{ valid: boolean; config?: typeof analyticsConfig.$inferSelect & { domain?: { hostname: string } }; error?: string }> {
  const config = await getConfigByToken(token);
  if (!config || !config.publicDashboardEnabled) {
    return { valid: false, error: "Dashboard not found" };
  }

  // If password-protected, validate JWT.
  if (config.publicDashboardPasswordHash) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { valid: false, error: "Authentication required" };
    }

    const jwt = authHeader.slice(7).trim();
    try {
      const secret = new TextEncoder().encode(getAnalyticsJwtSecret());
      const { payload } = await jose.jwtVerify(jwt, secret);
      if (payload.token !== token) {
        return { valid: false, error: "Invalid session" };
      }
    } catch {
      return { valid: false, error: "Invalid or expired session" };
    }
  }

  return { valid: true, config };
}

// GET /:token/verify - Verify public dashboard token
app.get("/:token/verify", async (c) => {
  const token = c.req.param("token");
  const config = await getConfigByToken(token);

  if (!config || !config.publicDashboardEnabled) {
    return c.json({ valid: false });
  }

  return c.json({
    valid: true,
    domainHostname: config.domain?.hostname ?? "",
    requiresPassword: !!config.publicDashboardPasswordHash,
    dashboardName: `${config.domain?.hostname ?? "Unknown"} Analytics`,
  });
});

// POST /:token/auth - Authenticate with password
// Strict rate limiting to prevent brute-force attacks (10 requests per minute per IP)
app.post("/:token/auth", strictRateLimiter, async (c) => {
  const token = c.req.param("token");
  const config = await getConfigByToken(token);

  if (!config || !config.publicDashboardEnabled || !config.publicDashboardPasswordHash) {
    return c.json({ error: { code: "NOT_FOUND", message: "Dashboard not found" } }, 404);
  }

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON" } }, 400); }

  const password = String(body.password || "");
  const isValid = await bcrypt.compare(password, config.publicDashboardPasswordHash);

  if (!isValid) {
    return c.json({ error: { code: "INVALID_PASSWORD", message: "Incorrect password" } }, 401);
  }

  // Sign JWT.
  const secret = new TextEncoder().encode(getAnalyticsJwtSecret());
  const sessionToken = await new jose.SignJWT({ configId: config.id, token })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(secret);

  return c.json({
    authenticated: true,
    sessionToken,
    expiresIn: 86400,
  });
});

// Public data endpoints.
const dataEndpoints = ["summary", "timeseries", "pages", "referrers", "geography", "devices", "utm"] as const;

for (const endpoint of dataEndpoints) {
  app.get(`/:token/${endpoint}`, async (c) => {
    const token = c.req.param("token");
    const { valid, config, error } = await validatePublicAccess(token, c.req.header("Authorization"));
    if (!valid || !config) {
      return c.json({ error: { code: "FORBIDDEN", message: error || "Access denied" } }, 403);
    }
    const url = new URL(c.req.url);
    let resp: Response;
    try {
      resp = await proxyToAnalytics(`/${config.id}/${endpoint}`, url.searchParams.toString());
    } catch {
      return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analytics service unreachable" } }, 502);
    }
    try {
      const data = await resp.json();
      return c.json(data, resp.status as 200);
    } catch {
      return c.json({ error: { code: "BAD_GATEWAY", message: "Invalid response from analytics service" } }, 502);
    }
  });
}

// Public CSV export.
app.get("/:token/export/csv", async (c) => {
  const token = c.req.param("token");
  const { valid, config, error } = await validatePublicAccess(token, c.req.header("Authorization"));
  if (!valid || !config) {
    return c.json({ error: { code: "FORBIDDEN", message: error || "Access denied" } }, 403);
  }
  const url = new URL(c.req.url);
  url.searchParams.set("format", "csv");
  let resp: Response;
  try {
    resp = await proxyToAnalytics(`/${config.id}/export`, url.searchParams.toString());
  } catch {
    return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analytics service unreachable" } }, 502);
  }
  const text = await resp.text();
  return c.text(text, resp.status as 200, {
    "Content-Type": "text/csv",
    "Content-Disposition": resp.headers.get("Content-Disposition") || `attachment; filename="analytics-export.csv"`,
  });
});

export default app;
