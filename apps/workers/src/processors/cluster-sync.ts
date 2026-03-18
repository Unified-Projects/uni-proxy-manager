import type { Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { clusterNodes } from "@uni-proxy-manager/database/schema";
import { eq, ne } from "drizzle-orm";
import type { ClusterSyncJobData, ClusterSyncResult } from "@uni-proxy-manager/queue";

export async function processClusterSync(
  job: Job<ClusterSyncJobData>
): Promise<ClusterSyncResult> {
  const { targetNodeIds } = job.data;

  // Health-poll jobs only update node status, they don't trigger a reload
  if (job.data.reason === "health-poll") {
    const allNodes = await db.query.clusterNodes.findMany({
      where: ne(clusterNodes.isLocal, true),
    });
    await Promise.all(allNodes.map((n) => pollNodeHealth(n.id)));
    return { success: true, nodesAttempted: allNodes.length, nodesSucceeded: allNodes.length, errors: [] };
  }

  console.log(`[ClusterSync] Starting cluster sync: ${job.data.reason ?? "no reason"}`);

  // Fetch remote nodes (isLocal = false)
  let remoteNodes = await db.query.clusterNodes.findMany({
    where: ne(clusterNodes.isLocal, true),
  });

  // Filter to specific nodes if requested
  if (targetNodeIds && targetNodeIds.length > 0) {
    remoteNodes = remoteNodes.filter((n) => targetNodeIds.includes(n.id));
  }

  if (remoteNodes.length === 0) {
    console.log("[ClusterSync] No remote nodes to sync");
    return { success: true, nodesAttempted: 0, nodesSucceeded: 0, errors: [] };
  }

  const errors: Array<{ nodeId: string; error: string }> = [];
  let nodesSucceeded = 0;

  await Promise.all(
    remoteNodes.map(async (node) => {
      try {
        const response = await fetch(`${node.apiUrl}/api/haproxy/reload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${node.apiKey}`,
          },
          body: JSON.stringify({ reason: job.data.reason ?? "cluster-sync", force: false }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        await db
          .update(clusterNodes)
          .set({
            status: "online",
            lastSyncAt: new Date(),
            lastSyncError: null,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(clusterNodes.id, node.id));

        nodesSucceeded++;
        console.log(`[ClusterSync] Node ${node.name} synced successfully`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ClusterSync] Node ${node.name} sync failed:`, errorMsg);
        errors.push({ nodeId: node.id, error: errorMsg });

        await db
          .update(clusterNodes)
          .set({
            status: "error",
            lastSyncError: errorMsg,
            updatedAt: new Date(),
          })
          .where(eq(clusterNodes.id, node.id));
      }
    })
  );

  console.log(
    `[ClusterSync] Done. ${nodesSucceeded}/${remoteNodes.length} nodes synced. Errors: ${errors.length}`
  );

  // The job itself succeeded (ran to completion); per-node failures are surfaced via errors[]
  return {
    success: true,
    nodesAttempted: remoteNodes.length,
    nodesSucceeded,
    errors,
  };
}

/**
 * Health-poll a single node and update its status.
 * Called from the cluster health-check recurring job.
 */
export async function pollNodeHealth(nodeId: string): Promise<void> {
  const node = await db.query.clusterNodes.findFirst({
    where: eq(clusterNodes.id, nodeId),
  });
  if (!node) return;

  try {
    const response = await fetch(`${node.apiUrl}/health`, {
      method: "GET",
      headers: { Authorization: `Bearer ${node.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    const status = response.ok ? "online" : "offline";
    await db
      .update(clusterNodes)
      .set({ status, lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(clusterNodes.id, nodeId));
  } catch {
    await db
      .update(clusterNodes)
      .set({ status: "offline", updatedAt: new Date() })
      .where(eq(clusterNodes.id, nodeId));
  }
}
