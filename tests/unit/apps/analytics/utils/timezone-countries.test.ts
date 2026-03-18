/**
 * Analytics Timezone-to-Country Mapping Unit Tests
 *
 * Tests for the static IANA timezone -> ISO country code mapping
 * used for privacy-first geolocation (no IP-based lookups).
 */

import { describe, it, expect } from "vitest";
import {
  getCountryFromTimezone,
  timezoneToCountry,
} from "../../../../../apps/analytics/src/utils/timezone-countries";

// ===========================================================================
// getCountryFromTimezone
// ===========================================================================

describe("getCountryFromTimezone", () => {
  it("should return 'GB' for Europe/London", () => {
    expect(getCountryFromTimezone("Europe/London")).toBe("GB");
  });

  it("should return 'US' for America/New_York", () => {
    expect(getCountryFromTimezone("America/New_York")).toBe("US");
  });

  it("should return 'JP' for Asia/Tokyo", () => {
    expect(getCountryFromTimezone("Asia/Tokyo")).toBe("JP");
  });

  it("should return 'DE' for Europe/Berlin", () => {
    expect(getCountryFromTimezone("Europe/Berlin")).toBe("DE");
  });

  it("should return 'AU' for Australia/Sydney", () => {
    expect(getCountryFromTimezone("Australia/Sydney")).toBe("AU");
  });

  it("should return 'FR' for Europe/Paris", () => {
    expect(getCountryFromTimezone("Europe/Paris")).toBe("FR");
  });

  it("should return 'EG' for Africa/Cairo", () => {
    expect(getCountryFromTimezone("Africa/Cairo")).toBe("EG");
  });

  it("should return 'BR' for America/Sao_Paulo", () => {
    expect(getCountryFromTimezone("America/Sao_Paulo")).toBe("BR");
  });

  it("should return 'Unknown' for an unmapped timezone", () => {
    expect(getCountryFromTimezone("Fake/Timezone")).toBe("Unknown");
  });

  it("should return 'Unknown' for an empty string", () => {
    expect(getCountryFromTimezone("")).toBe("Unknown");
  });

  it("should return 'Unknown' for a partial timezone string", () => {
    expect(getCountryFromTimezone("Europe")).toBe("Unknown");
  });

  it("should be case-sensitive", () => {
    expect(getCountryFromTimezone("europe/london")).toBe("Unknown");
  });
});

// ===========================================================================
// timezoneToCountry map
// ===========================================================================

describe("timezoneToCountry map", () => {
  it("should contain at least 100 entries", () => {
    expect(Object.keys(timezoneToCountry).length).toBeGreaterThanOrEqual(100);
  });

  it("should have all values as 2-letter ISO country codes or 'Unknown'", () => {
    for (const [tz, code] of Object.entries(timezoneToCountry)) {
      expect(code).toMatch(/^([A-Z]{2}|Unknown)$/);
    }
  });

  it("should have all keys as valid IANA timezone format or well-known abbreviations", () => {
    for (const tz of Object.keys(timezoneToCountry)) {
      // Allow Region/City format as well as well-known abbreviations like UTC, GMT, etc.
      expect(tz).toMatch(/^([A-Za-z]+(?:\/[A-Za-z_-]+)+|[A-Z]{2,5})$/);
    }
  });
});
