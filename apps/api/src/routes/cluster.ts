import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { clusterNodes } from "@uni-proxy-manager/database/schema";
import { eq, ne } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { ClusterSyncJobData } from "@uni-proxy-manager/queue";
import { nanoid } from "nanoid";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = new Hono();

const createNodeSchema = z.object({
  name: z.string().min(1).max(100),
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
  isLocal: z.boolean().optional().default(false),
});

const updateNodeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  apiUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
});

// GET / — list all nodes
app.get("/", async (c) => {
  try {
    const nodes = await db.query.clusterNodes.findMany({
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
    return c.json({ nodes });
  } catch (error) {
    console.error("[Cluster] Error listing nodes:", error);
    return c.json({ error: "Failed to list cluster nodes" }, 500);
  }
});

// POST / — register a node
app.post("/", zValidator("json", createNodeSchema), async (c) => {
  const data = c.req.valid("json");
  const normalizedUrl = data.apiUrl.replace(/\/$/, "");
  try {
    const existing = await db.query.clusterNodes.findFirst({
      where: eq(clusterNodes.apiUrl, normalizedUrl),
    });
    if (existing) {
      return c.json({ error: "A node with this API URL already exists" }, 409);
    }

    const id = nanoid();
    const [node] = await db
      .insert(clusterNodes)
      .values({
        id,
        name: data.name,
        apiUrl: normalizedUrl,
        apiKey: data.apiKey,
        isLocal: data.isLocal ?? false,
        status: "unknown",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return c.json({ node }, 201);
  } catch (error) {
    console.error("[Cluster] Error creating node:", error);
    return c.json({ error: "Failed to create cluster node" }, 500);
  }
});

// GET /:id — get node detail
app.get("/:id", async (c) => {
  const { id } = c.req.param();
  try {
    const node = await db.query.clusterNodes.findFirst({
      where: eq(clusterNodes.id, id),
    });
    if (!node) return c.json({ error: "Node not found" }, 404);
    return c.json({ node });
  } catch (error) {
    console.error("[Cluster] Error fetching node:", error);
    return c.json({ error: "Failed to fetch cluster node" }, 500);
  }
});

// PUT /:id — update node
app.put("/:id", zValidator("json", updateNodeSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");
  try {
    const existing = await db.query.clusterNodes.findFirst({
      where: eq(clusterNodes.id, id),
    });
    if (!existing) return c.json({ error: "Node not found" }, 404);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.apiUrl !== undefined) updateData.apiUrl = data.apiUrl.replace(/\/$/, "");
    if (data.apiKey !== undefined) updateData.apiKey = data.apiKey;

    const [node] = await db
      .update(clusterNodes)
      .set(updateData as never)
      .where(eq(clusterNodes.id, id))
      .returning();
    return c.json({ node });
  } catch (error) {
    console.error("[Cluster] Error updating node:", error);
    return c.json({ error: "Failed to update cluster node" }, 500);
  }
});

// DELETE /:id — remove node
app.delete("/:id", async (c) => {
  const { id } = c.req.param();
  try {
    const existing = await db.query.clusterNodes.findFirst({
      where: eq(clusterNodes.id, id),
    });
    if (!existing) return c.json({ error: "Node not found" }, 404);

    await db.delete(clusterNodes).where(eq(clusterNodes.id, id));
    return c.json({ success: true });
  } catch (error) {
    console.error("[Cluster] Error deleting node:", error);
    return c.json({ error: "Failed to delete cluster node" }, 500);
  }
});

// POST /:id/sync — force sync to one node
app.post("/:id/sync", async (c) => {
  const { id } = c.req.param();
  try {
    const node = await db.query.clusterNodes.findFirst({
      where: eq(clusterNodes.id, id),
    });
    if (!node) return c.json({ error: "Node not found" }, 404);

    const redis = getRedisClient();
    const queue = new Queue<ClusterSyncJobData>(QUEUES.CLUSTER_SYNC, { connection: redis });
    const job = await queue.add(
      "cluster-sync-single",
      { reason: "Manual sync", triggeredBy: "manual", targetNodeIds: [id] },
      { jobId: `cluster-sync-${id}-${Date.now()}` }
    );

    return c.json({ queued: true, jobId: job.id });
  } catch (error) {
    console.error("[Cluster] Error syncing node:", error);
    return c.json({ error: "Failed to queue sync" }, 500);
  }
});

// POST /sync-all — enqueue CLUSTER_SYNC for all remote nodes
app.post("/sync-all", async (c) => {
  try {
    const remoteNodes = await db.query.clusterNodes.findMany({
      where: ne(clusterNodes.isLocal, true),
    });

    if (remoteNodes.length === 0) {
      return c.json({ success: true, nodesQueued: 0, message: "No remote nodes to sync", jobId: null });
    }

    const redis = getRedisClient();
    const queue = new Queue<ClusterSyncJobData>(QUEUES.CLUSTER_SYNC, { connection: redis });
    const job = await queue.add(
      "cluster-sync-all",
      { reason: "Manual sync-all", triggeredBy: "manual" },
      { jobId: `cluster-sync-all-${Date.now()}` }
    );

    return c.json({ success: true, nodesQueued: remoteNodes.length, jobId: job.id });
  } catch (error) {
    console.error("[Cluster] Error queuing sync-all:", error);
    return c.json({ error: "Failed to queue sync-all" }, 500);
  }
});

// GET /:id/status — proxy GET /health to the remote node
app.get("/:id/status", async (c) => {
  const { id } = c.req.param();
  try {
    const node = await db.query.clusterNodes.findFirst({
      where: eq(clusterNodes.id, id),
    });
    if (!node) return c.json({ error: "Node not found" }, 404);

    try {
      const response = await fetch(`${node.apiUrl}/health`, {
        method: "GET",
        headers: { Authorization: `Bearer ${node.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });

      const health = await response.json().catch(() => ({}));

      // Update node status based on health response
      const newStatus = response.ok ? "online" : "offline";
      await db
        .update(clusterNodes)
        .set({ status: newStatus, lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(clusterNodes.id, id));

      return c.json({ nodeId: id, status: newStatus, health });
    } catch (fetchError) {
      await db
        .update(clusterNodes)
        .set({ status: "offline", updatedAt: new Date() })
        .where(eq(clusterNodes.id, id));
      return c.json({ nodeId: id, status: "offline", error: "Node unreachable" });
    }
  } catch (error) {
    console.error("[Cluster] Error checking node status:", error);
    return c.json({ error: "Failed to check node status" }, 500);
  }
});

export default app;
