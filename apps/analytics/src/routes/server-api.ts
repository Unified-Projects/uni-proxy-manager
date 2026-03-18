/**
 * Server-side event submission API.
 * Allows backend services to submit events programmatically using
 * an API token for authentication.
 */

import { Hono } from "hono";
import { apiRateLimit } from "../middleware/rate-limit";
import { getConfigByUuid } from "../services/config-cache";
import { ingestEvent } from "../services/ingest";
import { sanitiseString, sanitiseEventMeta, MAX_LENGTHS } from "../utils/sanitise";
import { getCountryFromTimezone } from "../utils/timezone-countries";
import crypto from "crypto";

const app = new Hono();

app.use("/:uuid/api", apiRateLimit);

/**
 * Validate an API token against the cached SHA-256 hash.
 */
function validateApiToken(storedHash: string | null, token: string): boolean {
  if (!storedHash) {
    return false;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expectedBuf = Buffer.from(storedHash, "utf-8");
  const actualBuf = Buffer.from(tokenHash, "utf-8");

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// POST /:uuid/api - Server-side event submission
app.post("/:uuid/api", async (c) => {
  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  if (!config || !config.enabled) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  // Validate API token.
  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Missing API token" } }, 401);
  }

  const token = authHeader.slice(7).trim();
  const isValid = validateApiToken(config.apiTokenSha256, token);
  if (!isValid) {
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Invalid API token" } }, 401);
  }

  // Reject oversized request bodies before parsing (max ~512KB).
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);
  if (contentLength > 512 * 1024) {
    return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 512KB limit" } }, 413);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON" } }, 400);
  }

  // Fallback size check when Content-Length header was absent or inaccurate.
  if (!contentLength) {
    const bodySize = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (bodySize > 512 * 1024) {
      return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 512KB limit" } }, 413);
    }
  }

  // Check DoNotTrack flag.
  if (body.dnt === true) {
    return c.json({ accepted: 0 }, 202);
  }

  const events = body.events as Array<Record<string, unknown>>;
  if (!Array.isArray(events) || events.length === 0) {
    return c.json({ error: { code: "INVALID_PAYLOAD", message: "events array required" } }, 400);
  }

  if (events.length > 100) {
    return c.json({ error: { code: "INVALID_PAYLOAD", message: "Maximum 100 events per request" } }, 400);
  }

  let accepted = 0;

  for (const event of events) {
    const eventType = (event.type as string) || "event";
    if (!["pageview", "event"].includes(eventType)) continue;

    const pathname = sanitiseString((event.pathname as string) || "/", MAX_LENGTHS.pathname);
    const referrer = sanitiseString((event.referrer as string) || "", MAX_LENGTHS.referrer);
    const timezone = (event.timezone as string) || "";
    const countryCode = timezone ? getCountryFromTimezone(timezone) : "Unknown";
    const eventName = eventType === "event"
      ? sanitiseString((event.name as string) || "", MAX_LENGTHS.eventName)
      : "";
    const eventMeta = event.meta && typeof event.meta === "object"
      ? sanitiseEventMeta(event.meta as Record<string, string>)
      : {};

    // Determine referrer domain.
    let referrerDomain = "(direct)";
    try {
      referrerDomain = new URL(referrer).hostname || "(direct)";
    } catch { /* use default */ }

    const isUnique = !referrerDomain || referrerDomain === "(direct)" || referrerDomain !== config.hostname;

    ingestEvent({
      configId: config.id,
      eventType: eventType as "pageview" | "event",
      eventName: eventName || undefined,
      eventMeta: Object.keys(eventMeta).length > 0 ? eventMeta : undefined,
      pathname,
      referrer,
      referrerDomain,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      isUnique,
      sessionId: `api_${crypto.randomUUID()}`,
      isBounce: false,
      isEntry: isUnique && eventType === "pageview",
      isExit: false,
      browser: "API",
      browserVersion: "",
      os: "API",
      deviceType: "other",
      screenWidth: 0,
      screenHeight: 0,
      countryCode,
      timezone,
      sessionDurationMs: 0,
      scrollDepthPct: 0,
      source: "api",
    });

    accepted++;
  }

  return c.json({ accepted }, 202);
});

export default app;
