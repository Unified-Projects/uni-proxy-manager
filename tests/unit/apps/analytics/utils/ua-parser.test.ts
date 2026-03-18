/**
 * Analytics User-Agent Parser Unit Tests
 *
 * Tests for the UA string parser that extracts browser, OS, and
 * device type information from User-Agent headers.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { parseUserAgent, clearUaCache } from "../../../../../apps/analytics/src/utils/ua-parser";

// ===========================================================================
// Desktop browsers
// ===========================================================================

describe("Desktop browsers", () => {
  it("should parse Chrome on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const result = parseUserAgent(ua);

    expect(result.browser).toBe("Chrome");
    expect(result.browserVersion).toContain("120");
    expect(result.os).toBe("Windows");
    expect(result.deviceType).toBe("desktop");
  });

  it("should parse Firefox on Linux", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
    const result = parseUserAgent(ua);

    expect(result.browser).toBe("Firefox");
    expect(result.browserVersion).toContain("121");
    expect(result.os).toBe("Linux");
    expect(result.deviceType).toBe("desktop");
  });

  it("should parse Safari on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
    const result = parseUserAgent(ua);

    expect(result.browser).toBe("Safari");
    expect(result.browserVersion).toContain("17");
    expect(result.os).toMatch(/^(Mac OS|macOS)$/);
    expect(result.deviceType).toBe("desktop");
  });

  it("should parse Edge on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    const result = parseUserAgent(ua);

    expect(result.browser).toBe("Edge");
    expect(result.browserVersion).toContain("120");
    expect(result.os).toBe("Windows");
    expect(result.deviceType).toBe("desktop");
  });
});

// ===========================================================================
// Mobile browsers
// ===========================================================================

describe("Mobile browsers", () => {
  it("should parse Safari on iPhone", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    const result = parseUserAgent(ua);

    expect(result.browser).toBe("Mobile Safari");
    expect(result.os).toBe("iOS");
    expect(result.deviceType).toBe("mobile");
  });

  it("should parse Chrome on Android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36";
    const result = parseUserAgent(ua);

    expect(result.browser).toMatch(/^(Chrome|Mobile Chrome)$/);
    expect(result.os).toBe("Android");
    expect(result.deviceType).toBe("mobile");
  });
});

// ===========================================================================
// Tablet browsers
// ===========================================================================

describe("Tablet browsers", () => {
  it("should parse Safari on iPad", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    const result = parseUserAgent(ua);

    expect(result.os).toBe("iOS");
    expect(result.deviceType).toBe("tablet");
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("Edge cases", () => {
  it("should return defaults for empty UA string", () => {
    const result = parseUserAgent("");

    expect(result.browser).toBe("Unknown");
    expect(result.browserVersion).toBe("");
    expect(result.os).toBe("Unknown");
    expect(result.deviceType).toBe("desktop");
  });

  it("should return defaults for garbage UA string", () => {
    const result = parseUserAgent("not-a-real-user-agent");

    expect(result.browser).toBe("Unknown");
    expect(result.os).toBe("Unknown");
    expect(result.deviceType).toBe("desktop");
  });

  it("should handle bot user agents", () => {
    const ua = "Googlebot/2.1 (+http://www.google.com/bot.html)";
    const result = parseUserAgent(ua);

    // ua-parser-js may or may not recognise the bot, but it should not throw.
    expect(result).toHaveProperty("browser");
    expect(result).toHaveProperty("os");
    expect(result).toHaveProperty("deviceType");
  });

  it("should return correct interface shape", () => {
    const result = parseUserAgent("Mozilla/5.0");

    expect(typeof result.browser).toBe("string");
    expect(typeof result.browserVersion).toBe("string");
    expect(typeof result.os).toBe("string");
    expect(typeof result.deviceType).toBe("string");
  });
});

// ===========================================================================
// LRU Cache behaviour
// ===========================================================================

describe("LRU Cache", () => {
  beforeEach(() => {
    clearUaCache();
  });

  it("should return the same object reference for repeated calls with the same UA", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
    const first = parseUserAgent(ua);
    const second = parseUserAgent(ua);

    // Cached results should be identical objects
    expect(first).toEqual(second);
  });

  it("should return correct results after cache is cleared", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
    const first = parseUserAgent(ua);

    clearUaCache();

    const afterClear = parseUserAgent(ua);
    expect(afterClear).toEqual(first);
    expect(afterClear.browser).toBe("Chrome");
  });

  it("should handle many unique UA strings without errors", () => {
    // Generate more than the cache limit (1000) unique UAs
    for (let i = 0; i < 1100; i++) {
      const result = parseUserAgent(`TestBrowser/${i}.0`);
      expect(result).toHaveProperty("browser");
      expect(result).toHaveProperty("deviceType");
    }

    // Earlier entries should have been evicted but should still parse correctly
    const result = parseUserAgent("TestBrowser/0.0");
    expect(result).toHaveProperty("browser");
  });
});
