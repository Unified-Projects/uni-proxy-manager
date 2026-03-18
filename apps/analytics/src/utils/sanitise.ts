/**
 * Input sanitisation utilities for analytics beacon payloads.
 *
 * These functions are used server-side when processing incoming beacon data
 * to enforce length limits, strip dangerous characters, and validate metadata
 * keys before writing to ClickHouse.
 */

/** Field-specific maximum lengths. */
export const MAX_LENGTHS = {
  pathname: 2000,
  referrer: 2000,
  utmField: 500,
  eventName: 200,
  metaValue: 500,
} as const;

/** Maximum number of metadata keys retained per event. */
export const MAX_META_KEYS = 20;

/**
 * Strip control characters (0x00-0x1F) except tab (0x09) and newline (0x0A, 0x0D).
 */
export function stripControlChars(str: string): string {
  let output = "";
  for (const char of str) {
    const code = char.charCodeAt(0);
    const isControl = code <= 0x1f;
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!isControl || isAllowedWhitespace) {
      output += char;
    }
  }
  return output;
}

/**
 * Truncate a string to a maximum length.
 */
export function truncate(str: string, maxLength: number): string {
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Sanitise a string field by stripping control characters and truncating.
 */
export function sanitiseString(str: string, maxLength: number): string {
  return truncate(stripControlChars(str), maxLength);
}

/**
 * Validate that a metadata key contains only alphanumeric characters and
 * underscores. This prevents injection of special characters into ClickHouse
 * Map keys.
 */
export function isValidMetaKey(key: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(key);
}

/**
 * Sanitise event metadata. Strips invalid keys, truncates values, removes
 * control characters from values, and caps the total number of keys.
 */
export function sanitiseEventMeta(
  meta: Record<string, string>
): Record<string, string> {
  const sanitised: Record<string, string> = {};
  let keyCount = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (keyCount >= MAX_META_KEYS) break;
    if (isValidMetaKey(key)) {
      sanitised[key] = sanitiseString(String(value), MAX_LENGTHS.metaValue);
      keyCount++;
    }
  }
  return sanitised;
}
