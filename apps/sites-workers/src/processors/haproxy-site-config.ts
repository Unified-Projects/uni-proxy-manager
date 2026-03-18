import { type Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { siteDomains, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import type { HaproxySiteConfigJobData } from "@uni-proxy-manager/queue";

/**
 * Process site config changes by invalidating the route cache.
 * Since sites-lookup does dynamic database lookups, we only need to
 * invalidate the cache when site domains change - no HAProxy reload needed.
 */
export async function processHaproxySiteConfig(
  job: Job<HaproxySiteConfigJobData>
): Promise<void> {
  const { siteId, action } = job.data;
  const redis = getRedisClient();

  try {
    console.log(`[HAProxy Site Config] Processing ${action} for site ${siteId}`);

    // Get all hostnames associated with this site
    const siteHostnames = await db
      .select({ hostname: domains.hostname })
      .from(siteDomains)
      .innerJoin(domains, eq(domains.id, siteDomains.domainId))
      .where(eq(siteDomains.siteId, siteId));

    if (siteHostnames.length === 0) {
      console.log(`[HAProxy Site Config] No domains found for site ${siteId}`);
      return;
    }

    // Bust route cache so sites-lookup hits the DB for fresh data
    const cacheKeys = siteHostnames.map(h => `sites:route:${h.hostname}`);
    await redis.del(...cacheKeys);

    console.log(`[HAProxy Site Config] Invalidated ${cacheKeys.length} route cache entries for site ${siteId}`);
  } catch (error) {
    console.error(`[HAProxy Site Config] Error:`, error);
    throw error;
  }
}
