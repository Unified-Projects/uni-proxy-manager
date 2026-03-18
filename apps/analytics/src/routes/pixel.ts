/**
 * Noscript pixel tracking endpoint.
 * Returns a 1x1 transparent GIF and records a pageview for visitors
 * who have JavaScript disabled.
 */

import { Hono } from "hono";
import crypto from "crypto";
import { beaconRateLimit } from "../middleware/rate-limit";
import { getConfigByUuid } from "../services/config-cache";
import { ingestEvent } from "../services/ingest";
import { parseUserAgent } from "../utils/ua-parser";

const app = new Hono();

// 1x1 transparent GIF
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/** Known bot/crawler User-Agent patterns for server-side filtering. */
const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|bingpreview|yandex|baidu|duckduckgo|sogou|exabot|ia_archiver|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|ccbot|headlesschrome/i;

app.use("/:uuid/pixel.gif", beaconRateLimit);

// GET /:uuid/pixel.gif - Noscript pixel tracking
app.get("/:uuid/pixel.gif", async (c) => {
  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  // Always return the pixel to avoid broken images.
  const pixelResponse = () =>
    c.body(PIXEL_GIF, 200, {
      "Content-Type": "image/gif",
      "Cache-Control": "no-cache, no-store",
    });

  if (!config || !config.enabled) {
    return pixelResponse();
  }

  // Honour Global Privacy Control.
  const gpc = c.req.header("Sec-GPC");
  if (gpc === "1") {
    return pixelResponse();
  }

  // Filter out bots, crawlers, and headless/automated browsers.
  const userAgent = c.req.header("User-Agent") || "";
  if (BOT_UA_PATTERN.test(userAgent) && !/cubot/i.test(userAgent)) {
    return pixelResponse();
  }

  // Validate Referer header.
  const referer = c.req.header("Referer") || "";
  let refUrl: URL;

  try {
    refUrl = new URL(referer);
  } catch {
    // No valid referer -- return pixel without tracking.
    return pixelResponse();
  }

  const refererHostname = refUrl.hostname;
  if (refererHostname !== config.hostname) {
    return pixelResponse();
  }

  // Parse User-Agent.
  const ua = parseUserAgent(userAgent);

  // Derive a deterministic session ID from non-PII data.
  // Hash the date + user agent to roughly group requests from the same
  // browser on the same day, without tracking individuals.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const hash = crypto
    .createHash("sha256")
    .update(today + userAgent)
    .digest("hex")
    .substring(0, 16);
  const sessionId = `pixel_${hash}`;

  // All pixel hits that reach this point are same-origin (referer matches
  // config hostname). Since we cannot determine whether this is the visitor's
  // first page without cookies or JS, and the referer being same-site means
  // internal navigation, mark as not unique.
  const isUnique = false;

  // Country detection -- for noscript, we cannot get timezone from the client.
  // Best-effort fallback: infer country from Accept-Language header.
  let countryCode = "Unknown";
  const acceptLang = c.req.header("Accept-Language") || "";
  if (acceptLang) {
    // Extract the primary language tag (e.g. "en-GB" from "en-GB,en;q=0.9")
    const primaryTag = acceptLang.split(",")[0]?.trim() || "";
    // Look for a regional subtag (e.g. "GB" from "en-GB", "DE" from "de-DE")
    const regionMatch = primaryTag.match(/^[a-zA-Z]{2,3}-([A-Z]{2})$/);
    if (regionMatch) {
      countryCode = regionMatch[1] ?? countryCode;
    }
  }

  // Fire off ingestion.
  ingestEvent({
    configId: config.id,
    eventType: "pageview",
    pathname: refUrl.pathname,
    referrer: referer,
    referrerDomain: refererHostname,
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmTerm: "",
    utmContent: "",
    isUnique,
    sessionId,
    isBounce: false,
    isEntry: false,
    isExit: false,
    browser: ua.browser,
    browserVersion: ua.browserVersion,
    os: ua.os,
    deviceType: ua.deviceType,
    screenWidth: 0,
    screenHeight: 0,
    countryCode,
    timezone: "",
    sessionDurationMs: 0,
    scrollDepthPct: 0,
    source: "pixel",
  });

  return pixelResponse();
});

export default app;
