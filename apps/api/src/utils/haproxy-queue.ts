import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, type HaproxyReloadJobData } from "@uni-proxy-manager/queue";

/**
 * Queue HAProxy config regeneration and reload
 */
export async function queueHaproxyReload(
  reason: string,
  triggeredBy: HaproxyReloadJobData["triggeredBy"] = "domain",
  affectedDomainIds?: string[]
): Promise<void> {
  try {
    const redis = getRedisClient();
    const queue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, {
      connection: redis,
    });

    await queue.add(
      `reload-${Date.now()}`,
      {
        reason,
        triggeredBy,
        affectedDomainIds,
      },
      { jobId: `haproxy-reload-${Date.now()}` }
    );
  } catch (error) {
    console.error("[HAProxy Queue] Failed to queue reload:", error);
  }
}
