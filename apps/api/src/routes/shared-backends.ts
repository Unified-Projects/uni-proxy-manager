import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import {
  sharedBackends,
  domainSharedBackends,
  domains,
} from "@uni-proxy-manager/database/schema";
import { eq, count, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { SharedBackendSyncJobData } from "@uni-proxy-manager/queue";

const app = new Hono();

const createSharedBackendSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  address: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(80),
  protocol: z.enum(["http", "https"]).default("http"),
  weight: z.number().int().min(1).max(256).default(100),
  maxConnections: z.number().int().min(1).optional(),
  loadBalanceMethod: z.enum(["roundrobin", "leastconn", "source", "first"]).default("roundrobin"),
  healthCheckEnabled: z.boolean().default(true),
  healthCheckPath: z.string().default("/"),
  healthCheckInterval: z.number().int().min(1).default(5),
  healthCheckTimeout: z.number().int().min(1).default(2),
  healthCheckFall: z.number().int().min(1).default(3),
  healthCheckRise: z.number().int().min(1).default(2),
  enabled: z.boolean().default(true),
  isBackup: z.boolean().default(false),
  hostRewrite: z.string().optional(),
  pathPrefixAdd: z.string().optional(),
  pathPrefixStrip: z.string().optional(),
});

const updateSharedBackendSchema = createSharedBackendSchema.partial().omit({ name: true }).extend({
  name: z.string().min(1).max(100).optional(),
});

async function enqueueSync(sharedBackendId: string, reason?: string) {
  try {
    const redis = getRedisClient();
    const queue = new Queue<SharedBackendSyncJobData>(QUEUES.SHARED_BACKEND_SYNC, {
      connection: redis,
    });
    await queue.add(
      `sync-${sharedBackendId}-${Date.now()}`,
      { sharedBackendId, reason },
      { jobId: `shared-backend-sync-${sharedBackendId}` }
    );
  } catch (err) {
    console.error("[SharedBackends] Failed to enqueue sync:", err);
  }
}

// List all shared backends with domain usage count
app.get("/", async (c) => {
  try {
    const all = await db.query.sharedBackends.findMany({
      orderBy: (t, { asc }) => [asc(t.name)],
    });

    // Get usage counts per shared backend
    const usageCounts = await db
      .select({
        sharedBackendId: domainSharedBackends.sharedBackendId,
        count: count(),
      })
      .from(domainSharedBackends)
      .groupBy(domainSharedBackends.sharedBackendId);

    const countMap = new Map(usageCounts.map((u) => [u.sharedBackendId, Number(u.count)]));

    return c.json({
      sharedBackends: all.map((b) => ({
        ...b,
        domainCount: countMap.get(b.id) ?? 0,
      })),
    });
  } catch (error) {
    console.error("[SharedBackends] Error listing:", error);
    return c.json({ error: "Failed to list shared backends" }, 500);
  }
});

// Create shared backend
app.post("/", zValidator("json", createSharedBackendSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    const existing = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.name, data.name),
    });

    if (existing) {
      return c.json({ error: "A shared backend with this name already exists" }, 409);
    }

    const id = nanoid();
    const [created] = await db
      .insert(sharedBackends)
      .values({ ...data, id })
      .returning();

    return c.json({ sharedBackend: created }, 201);
  } catch (error) {
    console.error("[SharedBackends] Error creating:", error);
    return c.json({ error: "Failed to create shared backend" }, 500);
  }
});

// Get single shared backend with linked domains
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const backend = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.id, id),
    });

    if (!backend) {
      return c.json({ error: "Shared backend not found" }, 404);
    }

    const links = await db.query.domainSharedBackends.findMany({
      where: eq(domainSharedBackends.sharedBackendId, id),
      with: { domain: true },
    });

    return c.json({
      sharedBackend: {
        ...backend,
        linkedDomains: links.map((l) => l.domain),
      },
    });
  } catch (error) {
    console.error("[SharedBackends] Error getting:", error);
    return c.json({ error: "Failed to get shared backend" }, 500);
  }
});

// Update shared backend
app.put("/:id", zValidator("json", updateSharedBackendSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.id, id),
    });

    if (!existing) {
      return c.json({ error: "Shared backend not found" }, 404);
    }

    if (data.name && data.name !== existing.name) {
      const nameConflict = await db.query.sharedBackends.findFirst({
        where: eq(sharedBackends.name, data.name),
      });
      if (nameConflict) {
        return c.json({ error: "A shared backend with this name already exists" }, 409);
      }
    }

    const [updated] = await db
      .update(sharedBackends)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sharedBackends.id, id))
      .returning();

    // Propagate changes to all linked domains
    await enqueueSync(id, "shared backend updated");

    return c.json({ sharedBackend: updated });
  } catch (error) {
    console.error("[SharedBackends] Error updating:", error);
    return c.json({ error: "Failed to update shared backend" }, 500);
  }
});

// Delete shared backend
app.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const force = c.req.query("force") === "true";

  try {
    const existing = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.id, id),
    });

    if (!existing) {
      return c.json({ error: "Shared backend not found" }, 404);
    }

    // Check for linked domains
    const links = await db.query.domainSharedBackends.findMany({
      where: eq(domainSharedBackends.sharedBackendId, id),
    });

    if (links.length > 0 && !force) {
      return c.json({
        error: `Shared backend is linked to ${links.length} domain(s). Use ?force=true to unlink and delete.`,
        linkedCount: links.length,
      }, 409);
    }

    // force=true: delete links first (cascade will handle it, but be explicit)
    if (links.length > 0) {
      await db
        .delete(domainSharedBackends)
        .where(eq(domainSharedBackends.sharedBackendId, id));
    }

    await db.delete(sharedBackends).where(eq(sharedBackends.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[SharedBackends] Error deleting:", error);
    return c.json({ error: "Failed to delete shared backend" }, 500);
  }
});

// List linked domains
app.get("/:id/domains", async (c) => {
  const { id } = c.req.param();

  try {
    const links = await db.query.domainSharedBackends.findMany({
      where: eq(domainSharedBackends.sharedBackendId, id),
      with: { domain: true },
    });

    return c.json({ domains: links.map((l) => l.domain) });
  } catch (error) {
    console.error("[SharedBackends] Error listing linked domains:", error);
    return c.json({ error: "Failed to list linked domains" }, 500);
  }
});

// Link domain to shared backend
app.post("/:id/domains", zValidator("json", z.object({ domainId: z.string() })), async (c) => {
  const { id } = c.req.param();
  const { domainId } = c.req.valid("json");

  try {
    const backend = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.id, id),
    });
    if (!backend) {
      return c.json({ error: "Shared backend not found" }, 404);
    }

    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });
    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Check existing link
    const existing = await db.query.domainSharedBackends.findFirst({
      where: (t) => sql`${t.domainId} = ${domainId} AND ${t.sharedBackendId} = ${id}`,
    });
    if (existing) {
      return c.json({ error: "Domain is already linked to this shared backend" }, 409);
    }

    const linkId = nanoid();
    const [link] = await db
      .insert(domainSharedBackends)
      .values({ id: linkId, domainId, sharedBackendId: id })
      .returning();

    // Trigger reload for the domain
    await enqueueSync(id, "domain linked");

    return c.json({ link }, 201);
  } catch (error) {
    console.error("[SharedBackends] Error linking domain:", error);
    return c.json({ error: "Failed to link domain" }, 500);
  }
});

// Unlink domain from shared backend
app.delete("/:id/domains/:domainId", async (c) => {
  const { id, domainId } = c.req.param();

  try {
    await db
      .delete(domainSharedBackends)
      .where(
        sql`${domainSharedBackends.sharedBackendId} = ${id} AND ${domainSharedBackends.domainId} = ${domainId}`
      );

    // Trigger reload for the affected domain
    await enqueueSync(id, "domain unlinked");

    return c.json({ success: true });
  } catch (error) {
    console.error("[SharedBackends] Error unlinking domain:", error);
    return c.json({ error: "Failed to unlink domain" }, 500);
  }
});

// Toggle enabled
app.patch("/:id/toggle", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.id, id),
    });
    if (!existing) {
      return c.json({ error: "Shared backend not found" }, 404);
    }

    const [updated] = await db
      .update(sharedBackends)
      .set({ enabled: !existing.enabled, updatedAt: new Date() })
      .where(eq(sharedBackends.id, id))
      .returning();

    await enqueueSync(id, "enabled toggled");

    return c.json({ sharedBackend: updated });
  } catch (error) {
    console.error("[SharedBackends] Error toggling:", error);
    return c.json({ error: "Failed to toggle shared backend" }, 500);
  }
});

// Toggle isBackup
app.patch("/:id/backup", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.sharedBackends.findFirst({
      where: eq(sharedBackends.id, id),
    });
    if (!existing) {
      return c.json({ error: "Shared backend not found" }, 404);
    }

    const [updated] = await db
      .update(sharedBackends)
      .set({ isBackup: !existing.isBackup, updatedAt: new Date() })
      .where(eq(sharedBackends.id, id))
      .returning();

    await enqueueSync(id, "backup toggled");

    return c.json({ sharedBackend: updated });
  } catch (error) {
    console.error("[SharedBackends] Error toggling backup:", error);
    return c.json({ error: "Failed to toggle backup status" }, 500);
  }
});

export default app;
