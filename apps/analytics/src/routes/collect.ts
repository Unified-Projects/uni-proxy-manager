/**
 * Beacon collection route.
 * Receives tracking beacons from the embed script and processes them
 * into ClickHouse events.
 */

import { Hono } from "hono";
import { analyticsCors } from "../middleware/cors";
import { beaconRateLimit } from "../middleware/rate-limit";
import { getConfigByUuid } from "../services/config-cache";
import { ingestEvent } from "../services/ingest";
import { sanitiseString, sanitiseEventMeta, MAX_LENGTHS } from "../utils/sanitise";
import { parseUserAgent } from "../utils/ua-parser";
import { getCountryFromTimezone } from "../utils/timezone-countries";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { INCR_WITH_TTL_LUA } from "../utils/redis-lua";

const app = new Hono();

/** Known bot/crawler User-Agent patterns for server-side filtering. */
const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|bingpreview|yandex|baidu|duckduckgo|sogou|exabot|ia_archiver|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|ccbot|headlesschrome/i;

/** Maximum events per session per minute before rate-limiting. */
const SESSION_RATE_LIMIT = 60;

app.use("/:uuid/collect", analyticsCors);
app.use("/:uuid/collect", beaconRateLimit);

/**
 * Simple glob matcher for ignored paths.
 * Supports * as a wildcard matching any characters.
 * Patterns are compiled once and cached to avoid repeated regex construction
 * and to reject overly complex patterns that could cause ReDoS.
 */
const patternCache = new Map<string, RegExp | null>();
const MAX_PATTERN_LENGTH = 500;

/**
 * Maximum number of consecutive wildcards allowed in a pattern.
 * Patterns like "***..." create ".*.*.*..." which can cause catastrophic
 * backtracking (ReDoS). We collapse consecutive wildcards into a single
 * wildcard and reject patterns that are still too complex.
 */
const MAX_CONSECUTIVE_WILDCARDS = 3;

function getCompiledPattern(pattern: string): RegExp | null {
  if (patternCache.has(pattern)) return patternCache.get(pattern)!;

  if (pattern.length > MAX_PATTERN_LENGTH) {
    patternCache.set(pattern, null);
    return null;
  }

  try {
    // Collapse consecutive wildcards (e.g. "***" -> "*") to prevent
    // the escaped form from generating excessive ".*.*.*" sequences
    // that can cause catastrophic backtracking.
    const collapsed = pattern.replace(/\*{2,}/g, "*");

    // After collapsing, check that the pattern does not still contain
    // too many wildcard segments (e.g. "a*b*c*d*e*f*..." is still risky).
    const wildcardCount = (collapsed.match(/\*/g) || []).length;
    if (wildcardCount > MAX_CONSECUTIVE_WILDCARDS) {
      patternCache.set(pattern, null);
      return null;
    }

    const escaped = collapsed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp("^" + escaped + "$");

    // Validate the compiled regex with a quick test against a short string
    // to confirm it does not hang. This catches edge-case patterns.
    const testString = "a".repeat(50);
    const testStart = Date.now();
    regex.test(testString);
    if (Date.now() - testStart > 10) {
      // Pattern took too long on a trivial input -- reject it
      patternCache.set(pattern, null);
      return null;
    }

    patternCache.set(pattern, regex);
    return regex;
  } catch {
    patternCache.set(pattern, null);
    return null;
  }
}

function matchesIgnoredPath(pathname: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = getCompiledPattern(pattern);
    if (regex && regex.test(pathname)) return true;
  }
  return false;
}

/**
 * Extract the hostname from a URL string using lightweight string operations.
 * Falls back to full URL parsing for non-standard schemes.
 */
function extractHostname(url: string): string {
  if (!url) return "";

  let start: number;
  if (url.startsWith("https://")) {
    start = 8;
  } else if (url.startsWith("http://")) {
    start = 7;
  } else {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  // Find the end of the hostname (port, path, query, or fragment).
  let end = url.length;
  for (let i = start; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    // '/' = 47, '?' = 63, '#' = 35, ':' = 58
    if (ch === 47 || ch === 63 || ch === 35) {
      end = i;
      break;
    }
    if (ch === 58) {
      // Port separator -- hostname ends here.
      end = i;
      break;
    }
  }

  return url.slice(start, end).toLowerCase();
}

// POST /:uuid/collect - Receive tracking beacons
app.post("/:uuid/collect", async (c) => {
  // Defence-in-depth: honour Global Privacy Control header.
  // The client JS already checks, but this catches cases where JS is bypassed.
  const gpc = c.req.header("Sec-GPC");
  if (gpc === "1") {
    return c.body(null, 204);
  }

  // Filter out bots, crawlers, and headless/automated browsers.
  const userAgent = c.req.header("User-Agent") || "";
  if (BOT_UA_PATTERN.test(userAgent) && !/cubot/i.test(userAgent)) {
    return c.body(null, 204);
  }

  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  if (!config || !config.enabled) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON" } }, 400);
  }

  // Validate required fields.
  const eventType = body.t as string;
  const pathname = body.p as string;
  const sessionId = body.sid as string;
  const version = body.v as number;

  if (!eventType || !pathname || !sessionId || version !== 1) {
    return c.json({ error: { code: "INVALID_PAYLOAD", message: "Missing required fields" } }, 400);
  }

  if (!["pageview", "event", "session_end"].includes(eventType)) {
    return c.json({ error: { code: "INVALID_PAYLOAD", message: "Invalid event type" } }, 400);
  }

  // Per-session rate limiting via Redis (sliding window: 60 events/minute).
  try {
    const redis = getRedisClient();
    const rateKey = `analytics:rate:${config.id}:${sessionId}`;
    const [count] = await redis.eval(INCR_WITH_TTL_LUA, 1, rateKey, 60) as [number, number];
    if (count > SESSION_RATE_LIMIT) return c.body(null, 429);
  } catch {
    // If Redis is unavailable, allow the request through rather than blocking.
  }

  // Sanitise fields.
  const sanitisedPathname = sanitiseString(pathname, MAX_LENGTHS.pathname);
  const sanitisedReferrer = sanitiseString((body.r as string) || "", MAX_LENGTHS.referrer);
  const sanitisedEventName = eventType === "event"
    ? sanitiseString((body.n as string) || "", MAX_LENGTHS.eventName)
    : "";
  const eventMeta = eventType === "event" && body.m && typeof body.m === "object"
    ? sanitiseEventMeta(body.m as Record<string, string>)
    : {};

  // Check ignored paths.
  if (config.ignoredPaths.length > 0 && matchesIgnoredPath(sanitisedPathname, config.ignoredPaths)) {
    return c.json({ status: "ignored" }, 202);
  }

  // Determine uniqueness via referrer-domain matching.
  const refererHeader = c.req.header("Referer") || "";
  const refererHostname = extractHostname(refererHeader);
  const isUnique = !refererHostname || refererHostname !== config.hostname;

  // Extract referrer domain from the beacon's referrer field.
  const referrerDomain = extractHostname(sanitisedReferrer);

  // Derive country from timezone.
  const timezone = (body.tz as string) || "";
  const countryCode = timezone ? getCountryFromTimezone(timezone) : "Unknown";

  // Parse User-Agent.
  const ua = parseUserAgent(c.req.header("User-Agent") || "");

  // UTM parameters -- strip if the site has disabled UTM capture.
  const utmSource = config.captureUtmParams
    ? sanitiseString((body.u_source as string) || "", MAX_LENGTHS.utmField)
    : "";
  const utmMedium = config.captureUtmParams
    ? sanitiseString((body.u_medium as string) || "", MAX_LENGTHS.utmField)
    : "";
  const utmCampaign = config.captureUtmParams
    ? sanitiseString((body.u_campaign as string) || "", MAX_LENGTHS.utmField)
    : "";
  const utmTerm = config.captureUtmParams
    ? sanitiseString((body.u_term as string) || "", MAX_LENGTHS.utmField)
    : "";
  const utmContent = config.captureUtmParams
    ? sanitiseString((body.u_content as string) || "", MAX_LENGTHS.utmField)
    : "";

  // Session-end fields.
  const sessionDurationMs = eventType === "session_end" ? Number(body.sd) || 0 : 0;
  const scrollDepthPct = eventType === "session_end" ? Math.min(100, Math.max(0, Number(body.sp) || 0)) : 0;
  const isBounce = eventType === "session_end" ? body.ib === 1 : false;

  // Determine entry status.
  const isEntry = eventType === "pageview" && isUnique;

  // Fire off ingestion (do not block the response).
  ingestEvent({
    configId: config.id,
    eventType: eventType as "pageview" | "event" | "session_end",
    eventName: sanitisedEventName || undefined,
    eventMeta: Object.keys(eventMeta).length > 0 ? eventMeta : undefined,
    pathname: sanitisedPathname,
    referrer: sanitisedReferrer,
    referrerDomain: referrerDomain || "(direct)",
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    isUnique,
    sessionId,
    isBounce,
    isEntry,
    isExit: false,
    browser: ua.browser,
    browserVersion: ua.browserVersion,
    os: ua.os,
    deviceType: ua.deviceType,
    screenWidth: Number(body.sw) || 0,
    screenHeight: Number(body.sh) || 0,
    countryCode,
    timezone,
    sessionDurationMs,
    scrollDepthPct,
    source: "js",
  });

  return c.json({ status: "ok" }, 202);
});

export default app;
