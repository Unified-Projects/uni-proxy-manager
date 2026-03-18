/**
 * Internal authentication middleware.
 *
 * Validates requests from apps/api by checking the X-Internal-Secret header
 * against the shared secret (UNI_PROXY_MANAGER_INTERNAL_SECRET).
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */

import { createMiddleware } from "hono/factory";
import crypto from "crypto";
import { getInternalSecret } from "@uni-proxy-manager/shared/config";

/**
 * Perform a constant-time comparison of two strings.
 * Returns false immediately only when the lengths differ (which is
 * unavoidable), but never leaks information about matching prefixes.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

export const internalAuth = createMiddleware(async (c, next) => {
  const provided = c.req.header("X-Internal-Secret");

  if (!provided) {
    return c.json(
      { error: { code: "UNAUTHENTICATED", message: "Missing internal secret" } },
      401,
    );
  }

  let expected: string;
  try {
    expected = getInternalSecret();
  } catch {
    return c.json(
      { error: { code: "SERVER_ERROR", message: "Internal secret not configured" } },
      500,
    );
  }

  if (!timingSafeCompare(provided, expected)) {
    return c.json(
      { error: { code: "UNAUTHENTICATED", message: "Invalid internal secret" } },
      401,
    );
  }

  await next();
});
