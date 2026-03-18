import type { ComputedDomainStatus } from "./types";

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
