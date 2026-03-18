import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { domainBlockedRoutes, domains } from "@uni-proxy-manager/database/schema";
import { eq, and, asc } from "drizzle-orm";
import { queueHaproxyReload } from "../utils/haproxy-queue";

const app = new Hono();

// Validation schemas
const createBlockedRouteSchema = z.object({
  domainId: z.string().min(1),
  pathPattern: z.string().min(1).max(500),
  enabled: z.boolean().default(true),
  httpStatusCode: z.number().min(400).max(599).default(403),
  customResponseBody: z.string().max(10000).nullable().optional(),
  description: z.string().nullable().optional(),
});

const updateBlockedRouteSchema = z.object({
  pathPattern: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  httpStatusCode: z.number().min(400).max(599).optional(),
  customResponseBody: z.string().max(10000).nullable().optional(),
  description: z.string().nullable().optional(),
});

// List blocked routes (with optional domain filter)
app.get("/", async (c) => {
  const domainId = c.req.query("domainId");

  try {
    const routes = await db.query.domainBlockedRoutes.findMany({
      where: domainId ? eq(domainBlockedRoutes.domainId, domainId) : undefined,
      with: {
        domain: true,
      },
      orderBy: [asc(domainBlockedRoutes.createdAt)],
    });

    return c.json({ blockedRoutes: routes });
  } catch (error) {
    console.error("[Domain Blocked Routes] Error listing blocked routes:", error);
    return c.json({ error: "Failed to list blocked routes" }, 500);
  }
});

// Get single blocked route
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const route = await db.query.domainBlockedRoutes.findFirst({
      where: eq(domainBlockedRoutes.id, id),
      with: {
        domain: true,
      },
    });

    if (!route) {
      return c.json({ error: "Blocked route not found" }, 404);
    }

    return c.json({ blockedRoute: route });
  } catch (error) {
    console.error("[Domain Blocked Routes] Error getting blocked route:", error);
    return c.json({ error: "Failed to get blocked route" }, 500);
  }
});

// Create blocked route
app.post("/", zValidator("json", createBlockedRouteSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, data.domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Check for duplicate path pattern on same domain
    const existing = await db.query.domainBlockedRoutes.findFirst({
      where: and(
        eq(domainBlockedRoutes.domainId, data.domainId),
        eq(domainBlockedRoutes.pathPattern, data.pathPattern)
      ),
    });

    if (existing) {
      return c.json(
        { error: "A blocked route with this path pattern already exists for this domain" },
        409
      );
    }

    const id = nanoid();
    const [newRoute] = await db
      .insert(domainBlockedRoutes)
      .values({
        id,
        domainId: data.domainId,
        pathPattern: data.pathPattern,
        enabled: data.enabled,
        httpStatusCode: data.httpStatusCode,
        customResponseBody: data.customResponseBody,
        description: data.description,
      })
      .returning();

    // Queue HAProxy reload
    await queueHaproxyReload("Blocked route created", "domain", [data.domainId]);

    // Fetch with relations
    const routeWithRelations = await db.query.domainBlockedRoutes.findFirst({
      where: eq(domainBlockedRoutes.id, id),
      with: {
        domain: true,
      },
    });

    return c.json({ blockedRoute: routeWithRelations }, 201);
  } catch (error) {
    console.error("[Domain Blocked Routes] Error creating blocked route:", error);
    return c.json({ error: "Failed to create blocked route" }, 500);
  }
});

// Update blocked route
app.put("/:id", zValidator("json", updateBlockedRouteSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.domainBlockedRoutes.findFirst({
      where: eq(domainBlockedRoutes.id, id),
    });

    if (!existing) {
      return c.json({ error: "Blocked route not found" }, 404);
    }

    // Check for duplicate path pattern if being changed
    if (data.pathPattern && data.pathPattern !== existing.pathPattern) {
      const duplicate = await db.query.domainBlockedRoutes.findFirst({
        where: and(
          eq(domainBlockedRoutes.domainId, existing.domainId),
          eq(domainBlockedRoutes.pathPattern, data.pathPattern)
        ),
      });

      if (duplicate) {
        return c.json(
          { error: "A blocked route with this path pattern already exists" },
          409
        );
      }
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.pathPattern !== undefined) updateData.pathPattern = data.pathPattern;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.httpStatusCode !== undefined) updateData.httpStatusCode = data.httpStatusCode;
    if (data.customResponseBody !== undefined) updateData.customResponseBody = data.customResponseBody;
    if (data.description !== undefined) updateData.description = data.description;

    await db
      .update(domainBlockedRoutes)
      .set(updateData)
      .where(eq(domainBlockedRoutes.id, id));

    // Queue HAProxy reload
    await queueHaproxyReload("Blocked route updated", "domain", [existing.domainId]);

    // Fetch with relations
    const routeWithRelations = await db.query.domainBlockedRoutes.findFirst({
      where: eq(domainBlockedRoutes.id, id),
      with: {
        domain: true,
      },
    });

    return c.json({ blockedRoute: routeWithRelations });
  } catch (error) {
    console.error("[Domain Blocked Routes] Error updating blocked route:", error);
    return c.json({ error: "Failed to update blocked route" }, 500);
  }
});

// Delete blocked route
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.domainBlockedRoutes.findFirst({
      where: eq(domainBlockedRoutes.id, id),
    });

    if (!existing) {
      return c.json({ error: "Blocked route not found" }, 404);
    }

    await db.delete(domainBlockedRoutes).where(eq(domainBlockedRoutes.id, id));

    // Queue HAProxy reload
    await queueHaproxyReload("Blocked route deleted", "domain", [existing.domainId]);

    return c.json({ success: true });
  } catch (error) {
    console.error("[Domain Blocked Routes] Error deleting blocked route:", error);
    return c.json({ error: "Failed to delete blocked route" }, 500);
  }
});

// Toggle blocked route enabled/disabled
app.post("/:id/toggle", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.domainBlockedRoutes.findFirst({
      where: eq(domainBlockedRoutes.id, id),
    });

    if (!existing) {
      return c.json({ error: "Blocked route not found" }, 404);
    }

    const [updated] = await db
      .update(domainBlockedRoutes)
      .set({
        enabled: !existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(domainBlockedRoutes.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Blocked route not found" }, 404);
    }

    // Queue HAProxy reload
    await queueHaproxyReload("Blocked route toggled", "domain", [existing.domainId]);

    return c.json({ blockedRoute: updated, enabled: updated.enabled });
  } catch (error) {
    console.error("[Domain Blocked Routes] Error toggling blocked route:", error);
    return c.json({ error: "Failed to toggle blocked route" }, 500);
  }
});

export default app;
