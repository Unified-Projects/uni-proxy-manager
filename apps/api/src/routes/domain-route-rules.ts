import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import {
  domainRouteRules,
  domains,
  backends,
} from "@uni-proxy-manager/database/schema";
import { eq, and, asc } from "drizzle-orm";
import { queueHaproxyReload } from "../utils/haproxy-queue";

const app = new Hono();

// Validation schemas
const routeActionTypeSchema = z.enum(["backend", "redirect"]);

const createRouteRuleSchema = z.object({
  domainId: z.string().min(1),
  name: z.string().min(1).max(100),
  pathPattern: z.string().min(1).max(500),
  actionType: routeActionTypeSchema.default("backend"),
  // Backend routing (required when actionType is "backend")
  backendId: z.string().min(1).optional(),
  // Redirect options (required when actionType is "redirect")
  redirectUrl: z.string().url().max(2000).optional(),
  redirectStatusCode: z.number().min(300).max(399).default(302),
  redirectPreservePath: z.boolean().default(false),
  redirectPreserveQuery: z.boolean().default(true),
  priority: z.number().min(0).max(10000).default(100),
  enabled: z.boolean().default(true),
  description: z.string().nullable().optional(),
}).refine(
  (data) => {
    if (data.actionType === "backend") {
      return !!data.backendId;
    }
    if (data.actionType === "redirect") {
      return !!data.redirectUrl;
    }
    return true;
  },
  {
    message: "backendId is required for backend action, redirectUrl is required for redirect action",
  }
);

const updateRouteRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pathPattern: z.string().min(1).max(500).optional(),
  actionType: routeActionTypeSchema.optional(),
  backendId: z.string().min(1).nullable().optional(),
  redirectUrl: z.string().url().max(2000).nullable().optional(),
  redirectStatusCode: z.number().min(300).max(399).optional(),
  redirectPreservePath: z.boolean().optional(),
  redirectPreserveQuery: z.boolean().optional(),
  priority: z.number().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

const reorderSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string().min(1),
      priority: z.number().min(0).max(10000),
    })
  ),
});

// List route rules (with optional domain filter)
app.get("/", async (c) => {
  const domainId = c.req.query("domainId");

  try {
    const rules = await db.query.domainRouteRules.findMany({
      where: domainId ? eq(domainRouteRules.domainId, domainId) : undefined,
      with: {
        backend: true,
        domain: true,
      },
      orderBy: [asc(domainRouteRules.priority), asc(domainRouteRules.createdAt)],
    });

    return c.json({ routeRules: rules });
  } catch (error) {
    console.error("[Domain Route Rules] Error listing route rules:", error);
    return c.json({ error: "Failed to list route rules" }, 500);
  }
});

// Get single route rule
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const rule = await db.query.domainRouteRules.findFirst({
      where: eq(domainRouteRules.id, id),
      with: {
        backend: true,
        domain: true,
      },
    });

    if (!rule) {
      return c.json({ error: "Route rule not found" }, 404);
    }

    return c.json({ routeRule: rule });
  } catch (error) {
    console.error("[Domain Route Rules] Error getting route rule:", error);
    return c.json({ error: "Failed to get route rule" }, 500);
  }
});

// Create route rule
app.post("/", zValidator("json", createRouteRuleSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, data.domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // For backend action type, validate backend exists and belongs to the same domain
    if (data.actionType === "backend" && data.backendId) {
      const backend = await db.query.backends.findFirst({
        where: eq(backends.id, data.backendId),
      });

      if (!backend) {
        return c.json({ error: "Backend not found" }, 404);
      }

      if (backend.domainId !== data.domainId) {
        return c.json(
          { error: "Backend does not belong to the specified domain" },
          400
        );
      }
    }

    // Check for duplicate path pattern on same domain
    const existing = await db.query.domainRouteRules.findFirst({
      where: and(
        eq(domainRouteRules.domainId, data.domainId),
        eq(domainRouteRules.pathPattern, data.pathPattern)
      ),
    });

    if (existing) {
      return c.json(
        { error: "A route rule with this path pattern already exists for this domain" },
        409
      );
    }

    const id = nanoid();
    const [newRule] = await db
      .insert(domainRouteRules)
      .values({
        id,
        domainId: data.domainId,
        name: data.name,
        pathPattern: data.pathPattern,
        actionType: data.actionType,
        backendId: data.actionType === "backend" ? data.backendId : null,
        redirectUrl: data.actionType === "redirect" ? data.redirectUrl : null,
        redirectStatusCode: data.actionType === "redirect" ? data.redirectStatusCode : null,
        redirectPreservePath: data.actionType === "redirect" ? data.redirectPreservePath : false,
        redirectPreserveQuery: data.actionType === "redirect" ? data.redirectPreserveQuery : true,
        priority: data.priority,
        enabled: data.enabled,
        description: data.description,
      })
      .returning();

    // Queue HAProxy reload
    await queueHaproxyReload("Route rule created");

    // Fetch with relations
    const ruleWithRelations = await db.query.domainRouteRules.findFirst({
      where: eq(domainRouteRules.id, id),
      with: {
        backend: true,
        domain: true,
      },
    });

    return c.json({ routeRule: ruleWithRelations }, 201);
  } catch (error) {
    console.error("[Domain Route Rules] Error creating route rule:", error);
    return c.json({ error: "Failed to create route rule" }, 500);
  }
});

// Update route rule
app.put("/:id", zValidator("json", updateRouteRuleSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.domainRouteRules.findFirst({
      where: eq(domainRouteRules.id, id),
    });

    if (!existing) {
      return c.json({ error: "Route rule not found" }, 404);
    }

    // Validate backend if being changed and action type is backend
    const effectiveActionType = data.actionType ?? existing.actionType;
    if (effectiveActionType === "backend" && data.backendId) {
      const backend = await db.query.backends.findFirst({
        where: eq(backends.id, data.backendId),
      });

      if (!backend) {
        return c.json({ error: "Backend not found" }, 404);
      }

      if (backend.domainId !== existing.domainId) {
        return c.json(
          { error: "Backend does not belong to the same domain" },
          400
        );
      }
    }

    // Check for duplicate path pattern if being changed
    if (data.pathPattern && data.pathPattern !== existing.pathPattern) {
      const duplicate = await db.query.domainRouteRules.findFirst({
        where: and(
          eq(domainRouteRules.domainId, existing.domainId),
          eq(domainRouteRules.pathPattern, data.pathPattern)
        ),
      });

      if (duplicate) {
        return c.json(
          { error: "A route rule with this path pattern already exists" },
          409
        );
      }
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.pathPattern !== undefined) updateData.pathPattern = data.pathPattern;
    if (data.actionType !== undefined) updateData.actionType = data.actionType;
    if (data.backendId !== undefined) updateData.backendId = data.backendId;
    if (data.redirectUrl !== undefined) updateData.redirectUrl = data.redirectUrl;
    if (data.redirectStatusCode !== undefined) updateData.redirectStatusCode = data.redirectStatusCode;
    if (data.redirectPreservePath !== undefined) updateData.redirectPreservePath = data.redirectPreservePath;
    if (data.redirectPreserveQuery !== undefined) updateData.redirectPreserveQuery = data.redirectPreserveQuery;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.description !== undefined) updateData.description = data.description;

    // Clear redirect fields when switching to backend, and vice versa
    if (data.actionType === "backend") {
      updateData.redirectUrl = null;
      updateData.redirectStatusCode = null;
      updateData.redirectPreservePath = false;
      updateData.redirectPreserveQuery = true;
    } else if (data.actionType === "redirect") {
      updateData.backendId = null;
    }

    await db
      .update(domainRouteRules)
      .set(updateData)
      .where(eq(domainRouteRules.id, id));

    // Queue HAProxy reload
    await queueHaproxyReload("Route rule updated");

    // Fetch with relations
    const ruleWithRelations = await db.query.domainRouteRules.findFirst({
      where: eq(domainRouteRules.id, id),
      with: {
        backend: true,
        domain: true,
      },
    });

    return c.json({ routeRule: ruleWithRelations });
  } catch (error) {
    console.error("[Domain Route Rules] Error updating route rule:", error);
    return c.json({ error: "Failed to update route rule" }, 500);
  }
});

// Delete route rule
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.domainRouteRules.findFirst({
      where: eq(domainRouteRules.id, id),
    });

    if (!existing) {
      return c.json({ error: "Route rule not found" }, 404);
    }

    await db.delete(domainRouteRules).where(eq(domainRouteRules.id, id));

    // Queue HAProxy reload
    await queueHaproxyReload("Route rule deleted");

    return c.json({ success: true });
  } catch (error) {
    console.error("[Domain Route Rules] Error deleting route rule:", error);
    return c.json({ error: "Failed to delete route rule" }, 500);
  }
});

// Toggle route rule enabled/disabled
app.post("/:id/toggle", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.domainRouteRules.findFirst({
      where: eq(domainRouteRules.id, id),
    });

    if (!existing) {
      return c.json({ error: "Route rule not found" }, 404);
    }

    const [updated] = await db
      .update(domainRouteRules)
      .set({
        enabled: !existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(domainRouteRules.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Failed to update route rule" }, 500);
    }

    // Queue HAProxy reload
    await queueHaproxyReload("Route rule toggled");

    return c.json({ routeRule: updated, enabled: updated.enabled });
  } catch (error) {
    console.error("[Domain Route Rules] Error toggling route rule:", error);
    return c.json({ error: "Failed to toggle route rule" }, 500);
  }
});

// Bulk update priorities (for drag-and-drop reordering)
app.put("/reorder", zValidator("json", reorderSchema), async (c) => {
  const { rules } = c.req.valid("json");

  try {
    // Update each rule's priority in a transaction
    await db.transaction(async (tx) => {
      for (const rule of rules) {
        await tx
          .update(domainRouteRules)
          .set({
            priority: rule.priority,
            updatedAt: new Date(),
          })
          .where(eq(domainRouteRules.id, rule.id));
      }
    });

    // Queue HAProxy reload
    await queueHaproxyReload("Route rules reordered");

    return c.json({ success: true });
  } catch (error) {
    console.error("[Domain Route Rules] Error reordering route rules:", error);
    return c.json({ error: "Failed to reorder route rules" }, 500);
  }
});

export default app;
