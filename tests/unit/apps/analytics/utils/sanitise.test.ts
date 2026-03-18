/**
 * Analytics Sanitisation Utilities Unit Tests
 *
 * Tests for input sanitisation functions used when processing
 * incoming beacon payloads before writing to ClickHouse.
 */

import { describe, it, expect } from "vitest";
import {
  stripControlChars,
  truncate,
  sanitiseString,
  isValidMetaKey,
  sanitiseEventMeta,
  MAX_LENGTHS,
  MAX_META_KEYS,
} from "../../../../../apps/analytics/src/utils/sanitise";

// ===========================================================================
// stripControlChars
// ===========================================================================

describe("stripControlChars", () => {
  it("should strip null bytes", () => {
    expect(stripControlChars("hello\x00world")).toBe("helloworld");
  });

  it("should strip control characters 0x01-0x08", () => {
    expect(stripControlChars("a\x01b\x02c\x03d\x04e\x05f\x06g\x07h\x08i")).toBe("abcdefghi");
  });

  it("should strip 0x0B (vertical tab)", () => {
    expect(stripControlChars("hello\x0Bworld")).toBe("helloworld");
  });

  it("should strip 0x0C (form feed)", () => {
    expect(stripControlChars("hello\x0Cworld")).toBe("helloworld");
  });

  it("should strip 0x0E-0x1F", () => {
    expect(stripControlChars("a\x0Eb\x0Fc\x10d\x1Fe")).toBe("abcde");
  });

  it("should preserve tab (0x09)", () => {
    expect(stripControlChars("hello\tworld")).toBe("hello\tworld");
  });

  it("should preserve newline (0x0A)", () => {
    expect(stripControlChars("hello\nworld")).toBe("hello\nworld");
  });

  it("should preserve carriage return (0x0D)", () => {
    expect(stripControlChars("hello\rworld")).toBe("hello\rworld");
  });

  it("should preserve normal printable ASCII", () => {
    const input = "Hello, World! 123 @#$%";
    expect(stripControlChars(input)).toBe(input);
  });

  it("should preserve unicode characters", () => {
    const input = "Héllo Wörld 日本語 🌍";
    expect(stripControlChars(input)).toBe(input);
  });

  it("should return empty string for empty input", () => {
    expect(stripControlChars("")).toBe("");
  });
});

// ===========================================================================
// truncate
// ===========================================================================

describe("truncate", () => {
  it("should truncate a string longer than maxLength", () => {
    expect(truncate("hello world", 5)).toBe("hello");
  });

  it("should return the string unchanged when shorter than maxLength", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });

  it("should return the string unchanged when exactly maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("should return empty string when maxLength is 0", () => {
    expect(truncate("hello", 0)).toBe("");
  });

  it("should handle empty string input", () => {
    expect(truncate("", 10)).toBe("");
  });
});

// ===========================================================================
// sanitiseString
// ===========================================================================

describe("sanitiseString", () => {
  it("should strip control characters and truncate", () => {
    const input = "hello\x00world\x01test";
    expect(sanitiseString(input, 10)).toBe("helloworld");
  });

  it("should handle a clean string under the limit", () => {
    expect(sanitiseString("hello", 100)).toBe("hello");
  });

  it("should strip first, then truncate", () => {
    // "ab\x00cd" -> "abcd" -> truncate to 3 -> "abc"
    expect(sanitiseString("ab\x00cd", 3)).toBe("abc");
  });
});

// ===========================================================================
// isValidMetaKey
// ===========================================================================

describe("isValidMetaKey", () => {
  it("should accept lowercase alphanumeric keys", () => {
    expect(isValidMetaKey("button_click")).toBe(true);
  });

  it("should accept uppercase alphanumeric keys", () => {
    expect(isValidMetaKey("ButtonClick")).toBe(true);
  });

  it("should accept numeric keys", () => {
    expect(isValidMetaKey("123")).toBe(true);
  });

  it("should accept keys with underscores", () => {
    expect(isValidMetaKey("my_key_123")).toBe(true);
  });

  it("should reject keys with spaces", () => {
    expect(isValidMetaKey("my key")).toBe(false);
  });

  it("should reject keys with hyphens", () => {
    expect(isValidMetaKey("my-key")).toBe(false);
  });

  it("should reject keys with dots", () => {
    expect(isValidMetaKey("my.key")).toBe(false);
  });

  it("should reject keys with special characters", () => {
    expect(isValidMetaKey("key@value")).toBe(false);
    expect(isValidMetaKey("key=value")).toBe(false);
    expect(isValidMetaKey("key;DROP")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(isValidMetaKey("")).toBe(false);
  });

  it("should reject keys with unicode characters", () => {
    expect(isValidMetaKey("clé")).toBe(false);
  });
});

// ===========================================================================
// sanitiseEventMeta
// ===========================================================================

describe("sanitiseEventMeta", () => {
  it("should pass through valid key-value pairs", () => {
    const meta = { button_id: "cta_1", plan: "pro" };
    const result = sanitiseEventMeta(meta);
    expect(result).toEqual({ button_id: "cta_1", plan: "pro" });
  });

  it("should strip keys with invalid characters", () => {
    const meta = { valid_key: "ok", "bad-key": "skip", "also.bad": "skip" };
    const result = sanitiseEventMeta(meta);
    expect(result).toEqual({ valid_key: "ok" });
  });

  it("should truncate values to MAX_LENGTHS.metaValue", () => {
    const longValue = "x".repeat(MAX_LENGTHS.metaValue + 100);
    const result = sanitiseEventMeta({ key: longValue });
    expect(result.key.length).toBe(MAX_LENGTHS.metaValue);
  });

  it("should strip control characters from values", () => {
    const result = sanitiseEventMeta({ key: "hello\x00world" });
    expect(result.key).toBe("helloworld");
  });

  it("should cap at MAX_META_KEYS entries", () => {
    const meta: Record<string, string> = {};
    for (let i = 0; i < MAX_META_KEYS + 5; i++) {
      meta[`key_${i}`] = `value_${i}`;
    }

    const result = sanitiseEventMeta(meta);
    expect(Object.keys(result).length).toBe(MAX_META_KEYS);
  });

  it("should return empty object for empty input", () => {
    expect(sanitiseEventMeta({})).toEqual({});
  });

  it("should return empty object when all keys are invalid", () => {
    const meta = { "bad-key": "a", "also.bad": "b", "no way": "c" };
    expect(sanitiseEventMeta(meta)).toEqual({});
  });

  it("should convert non-string values to strings before sanitising", () => {
    const meta = { count: 42 as unknown as string };
    const result = sanitiseEventMeta(meta);
    expect(result.count).toBe("42");
  });
});

// ===========================================================================
// MAX_LENGTHS constants
// ===========================================================================

describe("MAX_LENGTHS", () => {
  it("should have expected field limits", () => {
    expect(MAX_LENGTHS.pathname).toBe(2000);
    expect(MAX_LENGTHS.referrer).toBe(2000);
    expect(MAX_LENGTHS.utmField).toBe(500);
    expect(MAX_LENGTHS.eventName).toBe(200);
    expect(MAX_LENGTHS.metaValue).toBe(500);
  });
});
