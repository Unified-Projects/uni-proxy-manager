/**
 * In-memory cache for analytics configuration.
 * Maps tracking UUIDs to config data for fast beacon validation.
 * Refreshed every 60 seconds from PostgreSQL.
 */

import { db } from "@uni-proxy-manager/database";

interface CachedConfig {
  id: string;
  domainId: string;
  trackingUuid: string;
  enabled: boolean;
  publicDashboardEnabled: boolean;
  hostname: string;
  allowedOrigins: string[];
  ignoredPaths: string[];
  maxBreakdownEntries: number;
  rawRetentionDays: number;
  aggregateRetentionDays: number;
  trackScrollDepth: boolean;
  trackSessionDuration: boolean;
  trackOutboundLinks: boolean;
  captureUtmParams: boolean;
  apiTokenSha256: string | null;
}

// UUID -> config mapping
let configByUuid = new Map<string, CachedConfig>();
// Config ID -> config mapping
let configById = new Map<string, CachedConfig>();

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function getConfigByUuid(uuid: string): CachedConfig | undefined {
  return configByUuid.get(uuid);
}

export function getConfigById(configId: string): CachedConfig | undefined {
  return configById.get(configId);
}

export async function refreshConfigCache(): Promise<void> {
  try {
    const configs = await db.query.analyticsConfig.findMany({
      with: {
        domain: true,
      },
    });

    // Build new maps before swapping to avoid a window where the cache
    // is empty (swap-on-success pattern).
    const newByUuid = new Map<string, CachedConfig>();
    const newById = new Map<string, CachedConfig>();

    for (const config of configs) {
      const cached: CachedConfig = {
        id: config.id,
        domainId: config.domainId,
        trackingUuid: config.trackingUuid,
        enabled: config.enabled,
        publicDashboardEnabled: config.publicDashboardEnabled,
        hostname: config.domain?.hostname ?? "",
        allowedOrigins: (config.allowedOrigins as string[]) ?? [],
        ignoredPaths: (config.ignoredPaths as string[]) ?? [],
        maxBreakdownEntries: config.maxBreakdownEntries,
        rawRetentionDays: config.rawRetentionDays,
        aggregateRetentionDays: config.aggregateRetentionDays,
        trackScrollDepth: config.trackScrollDepth,
        trackSessionDuration: config.trackSessionDuration,
        trackOutboundLinks: config.trackOutboundLinks,
        captureUtmParams: config.captureUtmParams,
        apiTokenSha256: config.apiTokenSha256 ?? null,
      };

      newByUuid.set(config.trackingUuid, cached);
      newById.set(config.id, cached);
    }

    // Atomic swap — readers always see a complete cache.
    configByUuid = newByUuid;
    configById = newById;

    console.log(`[Analytics] Config cache refreshed: ${configs.length} configs`);
  } catch (error) {
    console.error("[Analytics] Failed to refresh config cache:", error);
  }
}

export async function startConfigCache(): Promise<void> {
  // Await the initial load so the cache is populated before accepting requests.
  await refreshConfigCache();
  // Refresh every 60 seconds
  refreshInterval = setInterval(refreshConfigCache, 60_000);
}

export function stopConfigCache(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
