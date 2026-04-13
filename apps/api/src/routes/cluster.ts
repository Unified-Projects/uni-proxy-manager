import { Hono } from "hono";
import { lookup } from "dns/promises";
import { isIP } from "net";
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
const ALLOWED_CLUSTER_PROTOCOLS = new Set(["http:", "https:"]);
const INVALID_CLUSTER_DESTINATION_MESSAGE =
  "Cluster node API URL must resolve to a private or loopback address before credentials are forwarded.";
const CLUSTER_URL_VALIDATION_ERROR_PREFIX = "Cluster node API URL";

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

function sanitizeClusterNodeResponse<T extends { apiKey?: string | null }>(
  node: T
): Omit<T, "apiKey"> {
  const { apiKey: _apiKey, ...sanitized } = node;
  return sanitized;
}

function normalizeClusterApiUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  if (!ALLOWED_CLUSTER_PROTOCOLS.has(url.protocol)) {
    throw new Error("Cluster node API URL must use http or https.");
  }

  if (url.username || url.password) {
    throw new Error("Cluster node API URL must not include embedded credentials.");
  }

  if (url.search || url.hash) {
    throw new Error("Cluster node API URL must not include query strings or fragments.");
  }

  if (url.pathname && url.pathname !== "/") {
    throw new Error("Cluster node API URL must be a base origin without a path.");
  }

  return url.origin;
}

function isClusterUrlValidationError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(CLUSTER_URL_VALIDATION_ERROR_PREFIX);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }

  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) {
    return false;
  }

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
}

async function resolveClusterDestinationHost(hostname: string): Promise<string> {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "127.0.0.1";
  }

  if (isIP(hostname)) {
    return hostname;
  }

  const result = await lookup(hostname, { verbatim: true });
  return result.address;
}

export async function validateClusterApiDestination(rawUrl: string): Promise<
  { ok: true; baseUrl: string } | { ok: false; message: string }
> {
  try {
    const baseUrl = normalizeClusterApiUrl(rawUrl);
    const { hostname } = new URL(baseUrl);
    const resolvedAddress = await resolveClusterDestinationHost(hostname);

    if (
      (isIP(resolvedAddress) === 4 && isPrivateIpv4(resolvedAddress)) ||
      (isIP(resolvedAddress) === 6 && isPrivateIpv6(resolvedAddress))
    ) {
      return { ok: true, baseUrl };
    }

    return { ok: false, message: INVALID_CLUSTER_DESTINATION_MESSAGE };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : INVALID_CLUSTER_DESTINATION_MESSAGE,
    };
  }
}

// GET / — list all nodes
app.get("/", async (c) => {
  try {
    const nodes = await db.query.clusterNodes.findMany({
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
    return c.json({ nodes: nodes.map(sanitizeClusterNodeResponse) });
  } catch (error) {
    console.error("[Cluster] Error listing nodes:", error);
    return c.json({ error: "Failed to list cluster nodes" }, 500);
  }
});

// POST / — register a node
app.post("/", zValidator("json", createNodeSchema), async (c) => {
  const data = c.req.valid("json");
  try {
    const normalizedUrl = normalizeClusterApiUrl(data.apiUrl);
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
    if (!node) {
      throw new Error("Cluster node insert did not return a row.");
    }
    return c.json({ node: sanitizeClusterNodeResponse(node) }, 201);
  } catch (error) {
    console.error("[Cluster] Error creating node:", error);
    if (isClusterUrlValidationError(error)) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid cluster node API URL" }, 400);
    }
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
    return c.json({ node: sanitizeClusterNodeResponse(node) });
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
    if (data.apiUrl !== undefined) updateData.apiUrl = normalizeClusterApiUrl(data.apiUrl);
    if (data.apiKey !== undefined) updateData.apiKey = data.apiKey;

    const [node] = await db
      .update(clusterNodes)
      .set(updateData as never)
      .where(eq(clusterNodes.id, id))
      .returning();
    if (!node) {
      throw new Error("Cluster node update did not return a row.");
    }
    return c.json({ node: sanitizeClusterNodeResponse(node) });
  } catch (error) {
    console.error("[Cluster] Error updating node:", error);
    if (isClusterUrlValidationError(error)) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid cluster node API URL" }, 400);
    }
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

    const destination = await validateClusterApiDestination(node.apiUrl);
    if (!destination.ok) {
      await db
        .update(clusterNodes)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(clusterNodes.id, id));
      return c.json({ nodeId: id, status: "error", error: destination.message }, 400);
    }

    try {
      const response = await fetch(`${destination.baseUrl}/health`, {
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
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to check node status" },
      500
    );
  }
});

export default app;
