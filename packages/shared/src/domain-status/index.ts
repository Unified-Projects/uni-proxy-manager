export type ComputedDomainStatus =
  | "active"
  | "degraded"
  | "offline"
  | "maintenance"
  | "ssl-error"
  | "ssl-expired"
  | "ssl-pending"
  | "no-backends";

export interface DomainForStatus {
  hostname: string;
  maintenanceEnabled: boolean;
  sslEnabled: boolean;
  backends?: Array<{
    enabled: boolean;
    isHealthy: boolean;
  }>;
  certificate?: {
    status: "pending" | "issuing" | "active" | "expired" | "failed" | "revoked";
    altNames?: string[] | null;
  } | null;
  hasRedirectRoutes?: boolean;
  hasPomeriumRoutes?: boolean;
}

export interface CertificateForWildcardCheck {
  status: "pending" | "issuing" | "active" | "expired" | "failed" | "revoked";
  altNames?: string[] | null;
}

/**
 * Check if a hostname matches a wildcard pattern
 * e.g., "sub.example.com" matches "*.example.com"
 */
function hostnameMatchesWildcard(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) return false;

  const wildcardBase = pattern.substring(2); // Remove "*."
  const hostParts = hostname.split(".");
  const baseParts = wildcardBase.split(".");

  // For *.example.com to match sub.example.com:
  // - hostname must have exactly one more part than the wildcard base
  // - the base parts must match
  if (hostParts.length !== baseParts.length + 1) return false;

  // Check that the base matches (e.g., "example.com" === "example.com")
  const hostBase = hostParts.slice(1).join(".");
  return hostBase.toLowerCase() === wildcardBase.toLowerCase();
}

/**
 * Check if a domain is covered by any certificate (own or wildcard from another domain)
 */
function findCoveringCertificate(
  hostname: string,
  ownCertificate: CertificateForWildcardCheck | null | undefined,
  allCertificates?: CertificateForWildcardCheck[]
): CertificateForWildcardCheck | null {
  // First check own certificate
  if (ownCertificate) {
    return ownCertificate;
  }

  // Check if any other certificate covers this hostname via wildcard
  if (allCertificates) {
    for (const cert of allCertificates) {
      if (!cert.altNames) continue;

      for (const altName of cert.altNames) {
        // Direct match
        if (altName.toLowerCase() === hostname.toLowerCase()) {
          return cert;
        }
        // Wildcard match
        if (altName.startsWith("*.") && hostnameMatchesWildcard(hostname, altName)) {
          return cert;
        }
      }
    }
  }

  return null;
}

/**
 * Computes the current status of a domain based on its configuration and state.
 *
 * Status priority (highest to lowest):
 * 1. maintenance - Domain is intentionally offline
 * 2. no-backends - No backends configured
 * 3. offline - All backends are unhealthy
 * 4. ssl-error - SSL enabled but no certificate coverage
 * 5. ssl-expired - SSL enabled but certificate expired
 * 6. ssl-pending - SSL enabled but certificate not yet active
 * 7. degraded - Some backends are unhealthy
 * 8. active - All systems operational
 *
 * @param domain - The domain to check
 * @param allCertificates - Optional list of all certificates for wildcard matching
 */
export function computeDomainStatus(
  domain: DomainForStatus,
  allCertificates?: CertificateForWildcardCheck[]
): ComputedDomainStatus {
  // Maintenance mode takes highest priority
  if (domain.maintenanceEnabled) {
    return "maintenance";
  }

  // Check if there are any backends configured
  const enabledBackends = domain.backends?.filter((b) => b.enabled) ?? [];
  if (enabledBackends.length === 0 && !domain.hasRedirectRoutes && !domain.hasPomeriumRoutes) {
    return "no-backends";
  }

  // Check backend health
  const healthyBackends = enabledBackends.filter((b) => b.isHealthy);
  if (enabledBackends.length > 0 && healthyBackends.length === 0) {
    return "offline";
  }

  // Check SSL status if enabled
  if (domain.sslEnabled) {
    const coveringCert = findCoveringCertificate(
      domain.hostname,
      domain.certificate,
      allCertificates
    );

    if (!coveringCert) {
      return "ssl-error";
    }

    const certStatus = coveringCert.status;
    if (certStatus === "expired") {
      return "ssl-expired";
    }

    if (certStatus !== "active") {
      return "ssl-pending";
    }
  }

  // Check if any backends are unhealthy (degraded state)
  if (healthyBackends.length < enabledBackends.length) {
    return "degraded";
  }

  // All checks passed
  return "active";
}

/**
 * Get a human-readable label for a computed status
 */
export function getStatusLabel(status: ComputedDomainStatus): string {
  const labels: Record<ComputedDomainStatus, string> = {
    active: "Active",
    degraded: "Degraded",
    offline: "Offline",
    maintenance: "Maintenance",
    "ssl-error": "SSL Error",
    "ssl-expired": "SSL Expired",
    "ssl-pending": "SSL Pending",
    "no-backends": "No Backends",
  };
  return labels[status];
}

/**
 * Get the color class for a computed status
 */
export function getStatusColorClass(status: ComputedDomainStatus): string {
  const colors: Record<ComputedDomainStatus, string> = {
    active: "bg-green-500/10 text-green-500 hover:bg-green-500/20",
    degraded: "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20",
    offline: "bg-red-500/10 text-red-500 hover:bg-red-500/20",
    maintenance: "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20",
    "ssl-error": "bg-red-500/10 text-red-500 hover:bg-red-500/20",
    "ssl-expired": "bg-red-500/10 text-red-500 hover:bg-red-500/20",
    "ssl-pending": "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20",
    "no-backends": "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20",
  };
  return colors[status];
}
