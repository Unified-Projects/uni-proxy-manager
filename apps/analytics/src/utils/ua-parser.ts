import { UAParser } from "ua-parser-js";

export interface ParsedUA {
  browser: string;
  browserVersion: string;
  os: string;
  deviceType: string;
}

type UAParseResult = {
  browser: { name?: string; version?: string };
  os: { name?: string };
  device: { type?: string };
};

const UA_CACHE_MAX_SIZE = 1000;
const uaCache = new Map<string, ParsedUA>();

export function parseUserAgent(ua: string): ParsedUA {
  const cached = uaCache.get(ua);
  if (cached) {
    // Move to end (most recently used) by deleting and re-inserting.
    uaCache.delete(ua);
    uaCache.set(ua, cached);
    return cached;
  }

  const parseUa = UAParser as unknown as (ua?: string) => UAParseResult;
  const result = parseUa(ua);

  const parsed: ParsedUA = {
    browser: result.browser.name || "Unknown",
    browserVersion: result.browser.version || "",
    os: result.os.name || "Unknown",
    deviceType: result.device.type || "desktop", // ua-parser-js returns undefined for desktop
  };

  // Evict the oldest entry if the cache is full.
  if (uaCache.size >= UA_CACHE_MAX_SIZE) {
    const oldestKey = uaCache.keys().next().value;
    if (oldestKey !== undefined) {
      uaCache.delete(oldestKey);
    }
  }

  uaCache.set(ua, parsed);
  return parsed;
}

/** Exposed for testing only. */
export function clearUaCache(): void {
  uaCache.clear();
}
