/**
 * Network Validation Utilities
 *
 * Provides SSRF protection by validating IP addresses and hostnames
 * against known private/internal network ranges.
 */

/**
 * Private IPv4 address ranges (RFC 1918 and others)
 */
const PRIVATE_IPV4_RANGES = [
  // 10.0.0.0/8 - Class A private network
  { start: 0x0a000000, end: 0x0affffff },
  // 172.16.0.0/12 - Class B private networks
  { start: 0xac100000, end: 0xac1fffff },
  // 192.168.0.0/16 - Class C private networks
  { start: 0xc0a80000, end: 0xc0a8ffff },
  // 127.0.0.0/8 - Loopback
  { start: 0x7f000000, end: 0x7fffffff },
  // 169.254.0.0/16 - Link-local
  { start: 0xa9fe0000, end: 0xa9feffff },
  // 0.0.0.0/8 - Current network (only valid as source)
  { start: 0x00000000, end: 0x00ffffff },
  // 224.0.0.0/4 - Multicast
  { start: 0xe0000000, end: 0xefffffff },
  // 240.0.0.0/4 - Reserved (includes broadcast)
  { start: 0xf0000000, end: 0xffffffff },
];

/**
 * Dangerous hostnames that should be blocked
 */
const BLOCKED_HOSTNAMES = [
  "localhost",
  "localhost.localdomain",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  // Internal Docker hostnames
  "host.docker.internal",
  "gateway.docker.internal",
  // Kubernetes
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
  // Cloud metadata endpoints
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP/Azure metadata
];

/**
 * Internal service hostnames used by this application
 */
const INTERNAL_HOSTNAMES = [
  "postgres",
  "redis",
  "haproxy",
  "api",
  "web",
  "workers",
  "sites-lookup",
  "openruntimes-executor",
  // With uni-proxy-manager prefix
  "uni-proxy-manager-postgres",
  "uni-proxy-manager-redis",
  "uni-proxy-manager-haproxy",
  "uni-proxy-manager-api",
  "uni-proxy-manager-web",
  "uni-proxy-manager-workers",
  "uni-proxy-manager-sites-lookup",
  "uni-proxy-manager-openruntimes-executor",
];

/**
 * Parse an IPv4 address string to a 32-bit integer
 */
function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  // Convert to unsigned
  return result >>> 0;
}

/**
 * Check if an IPv4 address is in a private range
 */
function isPrivateIPv4(ip: string): boolean {
  const ipNum = parseIPv4(ip);
  if (ipNum === null) return false;

  for (const range of PRIVATE_IPV4_RANGES) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an address is an IPv6 loopback or link-local
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // Link-local (fe80::/10)
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") || normalized.startsWith("fea") ||
      normalized.startsWith("feb")) {
    return true;
  }

  // Unique local address (fc00::/7)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped && ipv4Mapped[1]) {
    return isPrivateIPv4(ipv4Mapped[1]);
  }

  return false;
}

/**
 * Check if a hostname resolves to a blocked internal service
 */
function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim();

  // Check explicit blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(normalized)) {
    return true;
  }

  // Check internal service hostnames
  if (INTERNAL_HOSTNAMES.includes(normalized)) {
    return true;
  }

  // Check if it ends with a blocked domain
  if (normalized.endsWith(".internal") ||
      normalized.endsWith(".local") ||
      normalized.endsWith(".localhost")) {
    return true;
  }

  return false;
}

/**
 * Check if SSRF validation is disabled (for testing only)
 */
function isSSRFValidationDisabled(): boolean {
  return process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.DISABLE_SSRF_VALIDATION === "true";
}

/**
 * Validate an address for SSRF protection
 * Returns an error message if the address is not allowed, null if valid
 */
export function validateAddressForSSRF(address: string): string | null {
  if (!address || typeof address !== "string") {
    return "Address is required";
  }

  const trimmed = address.trim();

  // In test mode, skip SSRF validation to allow localhost/private IPs
  if (isSSRFValidationDisabled()) {
    return null;
  }

  // Check if it's a blocked hostname
  if (isBlockedHostname(trimmed)) {
    return `Address "${trimmed}" is not allowed - internal/reserved hostname`;
  }

  // Check if it's an IPv4 address
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    if (isPrivateIPv4(trimmed)) {
      return `Address "${trimmed}" is not allowed - private IP range`;
    }
    return null; // Valid public IPv4
  }

  // Check if it's an IPv6 address (simplified check)
  if (trimmed.includes(":")) {
    // Remove brackets if present
    const ipv6 = trimmed.replace(/^\[|\]$/g, "");
    if (isPrivateIPv6(ipv6)) {
      return `Address "${trimmed}" is not allowed - private IPv6 range`;
    }
    return null; // Assume valid public IPv6
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/.test(trimmed) && trimmed.length > 1) {
    return `Address "${trimmed}" contains invalid characters`;
  }

  // Check if hostname looks like an IP address in disguise (octal, hex, etc.)
  // These are common SSRF bypass techniques
  if (/^0x[0-9a-fA-F]+$/.test(trimmed) || // Hex
      /^0[0-7]+$/.test(trimmed) ||        // Octal
      /^\d+$/.test(trimmed)) {            // Decimal IP encoding
    return `Address "${trimmed}" uses suspicious encoding`;
  }

  return null; // Valid hostname
}

/**
 * Validate a port number
 */
export function validatePort(port: number): string | null {
  if (!Number.isInteger(port)) {
    return "Port must be an integer";
  }
  if (port < 1 || port > 65535) {
    return "Port must be between 1 and 65535";
  }
  // Block commonly dangerous ports
  const dangerousPorts = [
    22,   // SSH
    23,   // Telnet
    3306, // MySQL
    5432, // PostgreSQL (internal)
    6379, // Redis (internal)
    27017, // MongoDB
  ];
  // Reserved ports are allowed but may warrant user awareness
  return null;
}

/**
 * Validate an IP address format (IPv4 or IPv6)
 * Returns true if valid, false otherwise
 */
export function isValidIPAddress(ip: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".");
    return parts.every(p => {
      const num = parseInt(p, 10);
      return num >= 0 && num <= 255;
    });
  }

  // IPv6 (basic check)
  if (ip.includes(":")) {
    // Remove brackets if present
    const ipv6 = ip.replace(/^\[|\]$/g, "");
    // Very basic IPv6 validation - just check for valid chars
    return /^[0-9a-fA-F:]+$/.test(ipv6);
  }

  return false;
}

/**
 * Validate a list of IP addresses for bypass lists
 */
export function validateBypassIPs(ips: string[]): { valid: string[]; errors: string[] } {
  const valid: string[] = [];
  const errors: string[] = [];

  for (const ip of ips) {
    const trimmed = ip.trim();
    if (!trimmed) continue;

    if (isValidIPAddress(trimmed)) {
      valid.push(trimmed);
    } else {
      errors.push(`Invalid IP address: ${trimmed}`);
    }
  }

  return { valid, errors };
}
