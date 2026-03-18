/**
 * CORS middleware for analytics beacon collection.
 *
 * Validates the request Origin against the domain's configured hostname
 * and any additional allowed origins. Rejects mismatched origins with
 * 403 to prevent trivial analytics spam.
 *
 * Requests with no Origin header are permitted because sendBeacon
 * sometimes omits it.
 */

import { createMiddleware } from "hono/factory";
import { getConfigByUuid } from "../services/config-cache";

/**
 * Check whether the given origin matches the config's hostname or any
 * of its explicitly allowed origins.
 */
function isOriginAllowed(origin: string, hostname: string, allowedOrigins: string[]): boolean {
  let originHostname: string;
  try {
    originHostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  // Match the primary hostname.
  if (originHostname === hostname) {
    return true;
  }

  // Match any explicitly allowed origins.
  for (const allowed of allowedOrigins) {
    try {
      if (new URL(allowed).hostname === originHostname) {
        return true;
      }
    } catch {
      // If the allowed origin is a bare hostname (not a full URL), compare directly.
      if (allowed === originHostname) {
        return true;
      }
    }
  }

  return false;
}

export const analyticsCors = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin");

  // Handle preflight OPTIONS requests.
  if (c.req.method === "OPTIONS") {
    const uuid = c.req.param("uuid");
    const config = uuid ? getConfigByUuid(uuid) : undefined;

    // For preflight, honour the origin check if a config is found.
    if (origin && config) {
      if (!isOriginAllowed(origin, config.hostname, config.allowedOrigins)) {
        return c.json({ error: { code: "CORS_REJECTED", message: "Origin not allowed" } }, 403);
      }
      c.header("Access-Control-Allow-Origin", origin);
    } else if (!origin && config) {
      // No origin on preflight but config exists -- mirror the primary hostname
      // rather than issuing a wildcard.
      c.header("Access-Control-Allow-Origin", `https://${config.hostname}`);
    } else if (!origin) {
      // No origin and no config -- reject.
      return c.json({ error: { code: "CORS_REJECTED", message: "Origin not allowed" } }, 403);
    } else {
      // Origin present but no config found -- reject.
      return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
    }

    c.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    c.header("Access-Control-Max-Age", "86400");
    c.header("Vary", "Origin");

    return c.body(null, 204);
  }

  // Allow requests with no Origin header (sendBeacon sometimes omits it).
  if (!origin) {
    await next();
    c.header("Vary", "Origin");
    return;
  }

  // Validate origin against the domain config.
  const uuid = c.req.param("uuid");
  const config = uuid ? getConfigByUuid(uuid) : undefined;

  if (config) {
    if (!isOriginAllowed(origin, config.hostname, config.allowedOrigins)) {
      return c.json({ error: { code: "CORS_REJECTED", message: "Origin not allowed" } }, 403);
    }

    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }

  await next();
});
