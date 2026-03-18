/**
 * Format a number with K/M/B suffixes for thousands, millions, billions
 */
export function formatNumber(num: number): string {
  if (num === 0) return "0";
  if (num < 1000) return num.toFixed(0);
  if (num < 1000000) return (num / 1000).toFixed(1) + "K";
  if (num < 1000000000) return (num / 1000000).toFixed(1) + "M";
  return (num / 1000000000).toFixed(1) + "B";
}

/**
 * Format bytes with B/KB/MB/GB/TB suffixes
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%";
  return ((value / total) * 100).toFixed(1) + "%";
}

/**
 * Status code color mapping
 */
export const STATUS_COLORS = {
  "2xx": "#10b981", // green-500
  "3xx": "#3b82f6", // blue-500
  "4xx": "#f59e0b", // amber-500
  "5xx": "#ef4444", // red-500
} as const;

export type StatusRange = keyof typeof STATUS_COLORS;

/**
 * Get color for a status code range
 */
export function getStatusColor(statusRange: StatusRange): string {
  return STATUS_COLORS[statusRange];
}
