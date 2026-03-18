import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import {
  pomeriumRoutes,
  pomeriumIdentityProviders,
  domains,
} from "@uni-proxy-manager/database/schema";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { PomeriumConfigJobData } from "@uni-proxy-manager/queue";

const app = new Hono();

// Policy config schema
const policyConfigSchema = z.object({
  allowedUsers: z.array(z.string().email()).optional(),
  allowedGroups: z.array(z.string()).optional(),
  allowedDomains: z.array(z.string()).optional(),
  allowedEmailPatterns: z.array(z.string()).optional(),
  corsAllowPreflight: z.boolean().optional(),
  passIdentityHeaders: z.boolean().optional(),
  setRequestHeaders: z.record(z.string()).optional(),
  removeRequestHeaders: z.array(z.string()).optional(),
  timeout: z.number().min(1).max(3600).optional(),
  idleTimeout: z.number().min(1).max(3600).optional(),
  websocketsEnabled: z.boolean().optional(),
  preserveHostHeader: z.boolean().optional(),
  tlsSkipVerify: z.boolean().optional(),
});

const createRouteSchema = z.object({
  name: z.string().min(1).max(100),
  domainId: z.string().min(1),
  pathPattern: z.string().min(1).default("/*"),
  protection: z.enum(["protected", "public", "passthrough"]).default("protected"),
  identityProviderId: z.string().nullable().optional(),
  policyConfig: policyConfigSchema.optional(),
  priority: z.number().min(0).max(1000).default(100),
  enabled: z.boolean().default(true),
  description: z.string().nullable().optional(),
});

const updateRouteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pathPattern: z.string().min(1).optional(),
  protection: z.enum(["protected", "public", "passthrough"]).optional(),
  identityProviderId: z.string().nullable().optional(),
  policyConfig: policyConfigSchema.optional(),
  priority: z.number().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

// Helper to queue config regeneration with deduplication
async function queueConfigRegeneration(reason: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const queue = new Queue<PomeriumConfigJobData>(QUEUES.POMERIUM_CONFIG, {
      connection: redis,
    });
    // Use static job ID for deduplication - only one pending job at a time
    // Add 2 second delay to batch rapid changes
    await queue.add(
      "pomerium-config-regenerate",
      { reason, triggeredBy: "route" },
      {
        jobId: "pomerium-config-pending",
        delay: 2000,
        removeOnComplete: true,
        removeOnFail: 5,
      }
    );
  } catch (error) {
    // Job already exists with same ID - that's fine, it will pick up our changes
    if (!(error instanceof Error && error.message.includes("already exists"))) {
      console.error("[Pomerium Routes] Failed to queue config regeneration:", error);
    }
  }
}

// List all routes (with optional domain filter)
app.get("/", async (c) => {
  const domainId = c.req.query("domainId");

  try {
    const routes = await db.query.pomeriumRoutes.findMany({
      where: domainId ? eq(pomeriumRoutes.domainId, domainId) : undefined,
      with: {
        identityProvider: true,
        domain: true,
      },
      orderBy: (t, { asc }) => [asc(t.priority), asc(t.createdAt)],
    });

    // Mask IdP credentials in response
    const safeRoutes = routes.map((route) => ({
      ...route,
      identityProvider: route.identityProvider
        ? {
            ...route.identityProvider,
            credentials: undefined,
            hasCredentials: true,
          }
        : null,
    }));

    return c.json({ routes: safeRoutes });
  } catch (error) {
    console.error("[Pomerium Routes] Error listing routes:", error);
    return c.json({ error: "Failed to list routes" }, 500);
  }
});

// Get single route
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const route = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.id, id),
      with: {
        identityProvider: true,
        domain: true,
      },
    });

    if (!route) {
      return c.json({ error: "Route not found" }, 404);
    }

    // Mask IdP credentials
    const safeRoute = {
      ...route,
      identityProvider: route.identityProvider
        ? {
            ...route.identityProvider,
            credentials: undefined,
            hasCredentials: true,
          }
        : null,
    };

    return c.json({ route: safeRoute });
  } catch (error) {
    console.error("[Pomerium Routes] Error getting route:", error);
    return c.json({ error: "Failed to get route" }, 500);
  }
});

// Create route
app.post("/", zValidator("json", createRouteSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, data.domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Validate IdP if provided
    if (data.identityProviderId) {
      const idp = await db.query.pomeriumIdentityProviders.findFirst({
        where: eq(pomeriumIdentityProviders.id, data.identityProviderId),
      });

      if (!idp) {
        return c.json({ error: "Identity provider not found" }, 404);
      }
    }

    // Check for duplicate path pattern on same domain
    const existing = await db.query.pomeriumRoutes.findFirst({
      where: and(
        eq(pomeriumRoutes.domainId, data.domainId),
        eq(pomeriumRoutes.pathPattern, data.pathPattern)
      ),
    });

    if (existing) {
      return c.json(
        {
          error: "A route with this path pattern already exists for this domain",
        },
        409
      );
    }

    const id = nanoid();
    const [newRoute] = await db
      .insert(pomeriumRoutes)
      .values({
        id,
        name: data.name,
        domainId: data.domainId,
        pathPattern: data.pathPattern,
        protection: data.protection,
        identityProviderId: data.identityProviderId,
        policyConfig: data.policyConfig || {},
        priority: data.priority,
        enabled: data.enabled,
        description: data.description,
      })
      .returning();

    // Queue config regeneration
    await queueConfigRegeneration("Route created");

    // Fetch with relations for response
    const routeWithRelations = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.id, id),
      with: {
        identityProvider: true,
        domain: true,
      },
    });

    const safeRoute = {
      ...routeWithRelations,
      identityProvider: routeWithRelations?.identityProvider
        ? {
            ...routeWithRelations.identityProvider,
            credentials: undefined,
            hasCredentials: true,
          }
        : null,
    };

    return c.json({ route: safeRoute }, 201);
  } catch (error) {
    console.error("[Pomerium Routes] Error creating route:", error);
    return c.json({ error: "Failed to create route" }, 500);
  }
});

// Update route
app.put("/:id", zValidator("json", updateRouteSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.id, id),
    });

    if (!existing) {
      return c.json({ error: "Route not found" }, 404);
    }

    // Validate IdP if being changed
    if (data.identityProviderId) {
      const idp = await db.query.pomeriumIdentityProviders.findFirst({
        where: eq(pomeriumIdentityProviders.id, data.identityProviderId),
      });

      if (!idp) {
        return c.json({ error: "Identity provider not found" }, 404);
      }
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.pathPattern !== undefined) updateData.pathPattern = data.pathPattern;
    if (data.protection !== undefined) updateData.protection = data.protection;
    if (data.identityProviderId !== undefined)
      updateData.identityProviderId = data.identityProviderId;
    if (data.policyConfig !== undefined) updateData.policyConfig = data.policyConfig;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.description !== undefined) updateData.description = data.description;

    const [updated] = await db
      .update(pomeriumRoutes)
      .set(updateData)
      .where(eq(pomeriumRoutes.id, id))
      .returning();

    // Queue config regeneration
    await queueConfigRegeneration("Route updated");

    // Fetch with relations
    const routeWithRelations = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.id, id),
      with: {
        identityProvider: true,
        domain: true,
      },
    });

    const safeRoute = {
      ...routeWithRelations,
      identityProvider: routeWithRelations?.identityProvider
        ? {
            ...routeWithRelations.identityProvider,
            credentials: undefined,
            hasCredentials: true,
          }
        : null,
    };

    return c.json({ route: safeRoute });
  } catch (error) {
    console.error("[Pomerium Routes] Error updating route:", error);
    return c.json({ error: "Failed to update route" }, 500);
  }
});

// Delete route
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.id, id),
    });

    if (!existing) {
      return c.json({ error: "Route not found" }, 404);
    }

    await db.delete(pomeriumRoutes).where(eq(pomeriumRoutes.id, id));

    // Queue config regeneration
    await queueConfigRegeneration("Route deleted");

    return c.json({ success: true });
  } catch (error) {
    console.error("[Pomerium Routes] Error deleting route:", error);
    return c.json({ error: "Failed to delete route" }, 500);
  }
});

// Toggle route enabled/disabled
app.post("/:id/toggle", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.id, id),
    });

    if (!existing) {
      return c.json({ error: "Route not found" }, 404);
    }

    const [updated] = await db
      .update(pomeriumRoutes)
      .set({
        enabled: !existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(pomeriumRoutes.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Failed to toggle route" }, 500);
    }

    // Queue config regeneration
    await queueConfigRegeneration("Route toggled");

    return c.json({ route: updated, enabled: updated.enabled });
  } catch (error) {
    console.error("[Pomerium Routes] Error toggling route:", error);
    return c.json({ error: "Failed to toggle route" }, 500);
  }
});

// Get routes for a specific domain
app.get("/domain/:domainId", async (c) => {
  const { domainId } = c.req.param();

  try {
    const routes = await db.query.pomeriumRoutes.findMany({
      where: eq(pomeriumRoutes.domainId, domainId),
      with: {
        identityProvider: true,
      },
      orderBy: (t, { asc }) => [asc(t.priority)],
    });

    const safeRoutes = routes.map((route) => ({
      ...route,
      identityProvider: route.identityProvider
        ? {
            ...route.identityProvider,
            credentials: undefined,
            hasCredentials: true,
          }
        : null,
    }));

    return c.json({ routes: safeRoutes });
  } catch (error) {
    console.error("[Pomerium Routes] Error getting routes by domain:", error);
    return c.json({ error: "Failed to get routes" }, 500);
  }
});

export default app;
