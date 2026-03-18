/**
 * Domain utility functions for working with hostnames and root domains
 */

/**
 * Extract the root domain from a hostname
 * Examples:
 *   - ical.varalign.co.uk → varalign.co.uk
 *   - status.varalign.co.uk → varalign.co.uk
 *   - varalign.co.uk → varalign.co.uk
 *   - localhost → localhost
 *   - 192.168.1.1 → 192.168.1.1
 *
 * @param hostname - The full hostname to extract root domain from
 * @returns The root domain
 */
export function getRootDomain(hostname: string): string {
  // Handle IP addresses and local hostnames
  if (
    hostname === "localhost" ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.includes("::")
  ) {
    return hostname;
  }

  const parts = hostname.split(".");

  // If fewer than 2 parts, it's already a root domain (e.g., "localhost", "local")
  if (parts.length < 2) {
    return hostname;
  }

  // Common second-level domains that should be treated as root
  const slds = [
    "co.uk",
    "co.jp",
    "co.nz",
    "co.za",
    "co.in",
    "co.kr",
    "co.id",
    "co.th",
    "com.au",
    "com.br",
    "com.cn",
    "com.mx",
    "com.sg",
    "com.tw",
    "com.hk",
    "net.au",
    "org.uk",
    "org.au",
    "org.nz",
    "org.cn",
    "ac.uk",
    "gov.uk",
    "nic.uk",
    "nhs.uk",
    "police.uk",
    "mod.uk",
    "gov.au",
    "govt.nz",
    "edu.au",
    "edu.cn",
    "edu.sg",
  ];

  // Check if the last two parts form an SLD
  const lastTwo = parts.slice(-2).join(".");
  if (slds.includes(lastTwo)) {
    return parts.slice(-3).join(".");
  }

  // Default: return the last two parts as the root domain
  return parts.slice(-2).join(".");
}

/**
 * Group domains by their root domain
 *
 * @param domains - Array of domains with hostname and optional displayName
 * @returns Map of root domain to group info
 */
export interface DomainGroup {
  rootDomain: string;
  displayName: string;
  domains: Array<{
    hostname: string;
    displayName: string | null;
  }>;
}

export function groupDomainsByRoot<T extends { hostname: string; displayName?: string | null }>(
  domains: T[]
): Map<string, DomainGroup> {
  const groups = new Map<string, DomainGroup>();

  for (const domain of domains) {
    const rootDomain = getRootDomain(domain.hostname);

    if (!groups.has(rootDomain)) {
      // Use the first domain's displayName for the group, or fall back to root domain
      const groupDisplayName =
        domain.displayName || rootDomain.charAt(0).toUpperCase() + rootDomain.slice(1);

      groups.set(rootDomain, {
        rootDomain,
        displayName: groupDisplayName,
        domains: [],
      });
    }

    const group = groups.get(rootDomain)!;
    group.domains.push({
      hostname: domain.hostname,
      displayName: domain.displayName || null,
    });
  }

  return groups;
}
