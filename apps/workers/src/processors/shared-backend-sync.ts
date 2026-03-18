import type { Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { domains, domainSharedBackends } from "@uni-proxy-manager/database/schema";
import { eq, inArray } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { SharedBackendSyncJobData, SharedBackendSyncResult, HaproxyReloadJobData } from "@uni-proxy-manager/queue";

export async function processSharedBackendSync(
  job: Job<SharedBackendSyncJobData>
): Promise<SharedBackendSyncResult> {
  const { sharedBackendId, reason } = job.data;

  console.log(`[SharedBackendSync] Processing sync for shared backend ${sharedBackendId}: ${reason || "no reason given"}`);

  try {
    // Find all domains linked to this shared backend
    const links = await db.query.domainSharedBackends.findMany({
      where: eq(domainSharedBackends.sharedBackendId, sharedBackendId),
      with: { domain: true },
    });

    if (links.length === 0) {
      console.log(`[SharedBackendSync] No domains linked to shared backend ${sharedBackendId}`);
      return { success: true, sharedBackendId, domainsAffected: 0 };
    }

    const domainIds = links.map((l) => l.domainId);

    // Bump configVersion on all linked domains to indicate they need a reload
    await db
      .update(domains)
      .set({
        lastConfigUpdate: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(domains.id, domainIds));

    // Enqueue a single deduplicated HAProxy reload
    try {
      const redis = getRedisClient();
      const queue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, {
        connection: redis,
      });

      await queue.add(
        "shared-backend-reload",
        {
          reason: `Shared backend ${sharedBackendId} changed`,
          triggeredBy: "backend",
          affectedDomainIds: domainIds,
        },
        {
          jobId: "shared-backend-reload",
          priority: 5,
        }
      );
    } catch (queueError) {
      console.error("[SharedBackendSync] Failed to queue HAProxy reload:", queueError);
    }

    console.log(`[SharedBackendSync] Synced shared backend ${sharedBackendId} to ${domainIds.length} domains`);

    return {
      success: true,
      sharedBackendId,
      domainsAffected: domainIds.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SharedBackendSync] Error processing sync for ${sharedBackendId}:`, error);
    return {
      success: false,
      sharedBackendId,
      domainsAffected: 0,
      error: message,
    };
  }
}
