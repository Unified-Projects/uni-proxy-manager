/**
 * Analytics funnel definition CRUD routes.
 */

import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { analyticsFunnels, analyticsFunnelResults, analyticsConfig } from "@uni-proxy-manager/database";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Queue } from "bullmq";
import { QUEUES } from "@uni-proxy-manager/queue";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

const app = new Hono();

function validatePathPattern(pattern: string): boolean {
  if (pattern.length > 500) return false;
  return /^[a-zA-Z0-9/*\-_.]+$/.test(pattern);
}

function validateEventName(name: string): boolean {
  if (name.length > 200) return false;
  return /^[a-zA-Z0-9_]+$/.test(name);
}

function validateEventMetaMatch(meta: unknown): string | null {
  if (meta === undefined || meta === null) return null;
  if (typeof meta !== "object" || Array.isArray(meta)) {
    return "eventMetaMatch must be a plain object";
  }
  const entries = Object.entries(meta as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) {
      return `Invalid eventMetaMatch key: "${key}" (must match ^[a-zA-Z0-9_]+$)`;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return `Invalid eventMetaMatch value for key "${key}": must be a string, number, or boolean`;
    }
    if (String(value).length > 500) {
      return `eventMetaMatch value for key "${key}" exceeds 500 characters`;
    }
  }
  return null;
}

/**
 * Validates an array of funnel steps. Returns an error message string if
 * validation fails, or null when all steps are valid.
 */
function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 10) {
    return "2-10 steps required";
  }
  for (const step of steps) {
    if (!step.name || !step.type) {
      return "Each step must have name and type";
    }
    if (step.type === "pageview" && (!step.pathPattern || !validatePathPattern(String(step.pathPattern)))) {
      return "Invalid path pattern";
    }
    if (step.type === "event" && (!step.eventName || !validateEventName(String(step.eventName)))) {
      return "Invalid event name";
    }
    const metaError = validateEventMetaMatch(step.eventMetaMatch);
    if (metaError) return metaError;
  }
  return null;
}

// GET /:configId - List funnels
app.get("/:configId", async (c) => {
  const configId = c.req.param("configId");

  const funnels = await db.query.analyticsFunnels.findMany({
    where: eq(analyticsFunnels.analyticsConfigId, configId),
    orderBy: [desc(analyticsFunnels.createdAt)],
  });

  return c.json({ funnels });
});

// POST /:configId - Create funnel
app.post("/:configId", async (c) => {
  const configId = c.req.param("configId");

  const config = await db.query.analyticsConfig.findFirst({ where: eq(analyticsConfig.id, configId), columns: { id: true } });
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON" } }, 400); }

  const name = String(body.name || "");
  const description = body.description ? String(body.description) : null;
  const steps = body.steps as Array<Record<string, unknown>>;
  const windowDays = Number(body.analysisWindowDays) || 7;

  if (!name) return c.json({ error: { code: "INVALID_PAYLOAD", message: "Name is required" } }, 400);
  const stepsError = validateSteps(steps);
  if (stepsError) {
    return c.json({ error: { code: "INVALID_PAYLOAD", message: stepsError } }, 400);
  }
  if (windowDays < 1 || windowDays > 90) {
    return c.json({ error: { code: "INVALID_PAYLOAD", message: "Analysis window must be 1-90 days" } }, 400);
  }

  // Check unique name per config.
  const existing = await db.query.analyticsFunnels.findFirst({
    where: and(eq(analyticsFunnels.analyticsConfigId, configId), eq(analyticsFunnels.name, name)),
  });
  if (existing) return c.json({ error: { code: "ALREADY_EXISTS", message: "Funnel name already exists" } }, 409);

  const id = nanoid();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const [funnel] = await db.insert(analyticsFunnels).values({
    id,
    analyticsConfigId: configId,
    name,
    description,
    steps: steps as never,
    windowMs,
  }).returning();

  return c.json({ funnel }, 201);
});

// PUT /:configId/:funnelId - Update funnel
app.put("/:configId/:funnelId", async (c) => {
  const funnelId = c.req.param("funnelId");

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON" } }, 400); }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) updates.name = String(body.name);
  if (body.description !== undefined) updates.description = body.description ? String(body.description) : null;

  // Validate steps with the same rules as the create endpoint.
  if (body.steps) {
    const stepsError = validateSteps(body.steps);
    if (stepsError) {
      return c.json({ error: { code: "INVALID_PAYLOAD", message: stepsError } }, 400);
    }
    updates.steps = body.steps;
  }

  if (body.analysisWindowDays) {
    const windowDays = Number(body.analysisWindowDays);
    if (windowDays < 1 || windowDays > 90) {
      return c.json({ error: { code: "INVALID_PAYLOAD", message: "Analysis window must be 1-90 days" } }, 400);
    }
    updates.windowMs = windowDays * 24 * 60 * 60 * 1000;
  }

  if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);

  const configId = c.req.param("configId");
  const [updated] = await db.update(analyticsFunnels)
    .set(updates)
    .where(and(eq(analyticsFunnels.id, funnelId), eq(analyticsFunnels.analyticsConfigId, configId)))
    .returning();

  if (!updated) return c.json({ error: { code: "NOT_FOUND", message: "Funnel not found" } }, 404);

  // Clear cached results.
  await db.delete(analyticsFunnelResults).where(eq(analyticsFunnelResults.funnelId, funnelId));

  return c.json({ funnel: updated });
});

// DELETE /:configId/:funnelId - Delete funnel
app.delete("/:configId/:funnelId", async (c) => {
  const funnelId = c.req.param("funnelId");

  const configId = c.req.param("configId");
  const funnel = await db.query.analyticsFunnels.findFirst({
    where: and(eq(analyticsFunnels.id, funnelId), eq(analyticsFunnels.analyticsConfigId, configId)),
  });
  if (!funnel) return c.json({ error: { code: "NOT_FOUND", message: "Funnel not found" } }, 404);

  await db.delete(analyticsFunnels).where(and(eq(analyticsFunnels.id, funnelId), eq(analyticsFunnels.analyticsConfigId, configId)));

  return c.json({ success: true });
});

// GET /:configId/:funnelId/results - Get funnel results
app.get("/:configId/:funnelId/results", async (c) => {
  const funnelId = c.req.param("funnelId");
  const configId = c.req.param("configId");

  const funnel = await db.query.analyticsFunnels.findFirst({
    where: and(eq(analyticsFunnels.id, funnelId), eq(analyticsFunnels.analyticsConfigId, configId)),
  });
  if (!funnel) return c.json({ error: { code: "NOT_FOUND", message: "Funnel not found" } }, 404);

  const result = await db.query.analyticsFunnelResults.findFirst({
    where: eq(analyticsFunnelResults.funnelId, funnelId),
    orderBy: [desc(analyticsFunnelResults.computedAt)],
  });

  return c.json({ funnel, results: result || null });
});

// POST /:configId/:funnelId/recompute - Force recomputation
app.post("/:configId/:funnelId/recompute", async (c) => {
  const funnelId = c.req.param("funnelId");
  const configId = c.req.param("configId");

  const funnel = await db.query.analyticsFunnels.findFirst({
    where: and(eq(analyticsFunnels.id, funnelId), eq(analyticsFunnels.analyticsConfigId, configId)),
  });
  if (!funnel) return c.json({ error: { code: "NOT_FOUND", message: "Funnel not found" } }, 404);

  try {
    const redis = getRedisClient();
    const queue = new Queue(QUEUES.ANALYTICS_FUNNEL_COMPUTE, { connection: redis });
    const now = new Date();
    const periodStart = new Date(now.getTime() - funnel.windowMs);
    await queue.add("funnel-compute", {
      funnelId,
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
    }, { jobId: `funnel-recompute-${funnelId}-${Date.now()}` });
  } catch (err) {
    console.error("[Analytics] Failed to queue funnel recompute:", err);
  }

  return c.json({ message: "Recomputation queued" }, 202);
});

export default app;
