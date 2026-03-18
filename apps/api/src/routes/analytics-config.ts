/**
 * Analytics configuration CRUD routes.
 * Manages per-domain analytics configuration (enable, disable, settings).
 */

import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { analyticsConfig, domains } from "@uni-proxy-manager/database";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Queue } from "bullmq";
import { QUEUES } from "@uni-proxy-manager/queue";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const app = new Hono();

// GET / - List all analytics configs
app.get("/", async (c) => {
  const configs = await db.query.analyticsConfig.findMany({
    with: { domain: true },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  const result = configs.map((config) => ({
    id: config.id,
    domainId: config.domainId,
    domainHostname: config.domain?.hostname ?? "",
    trackingUuid: config.trackingUuid,
    enabled: config.enabled,
    rawRetentionDays: config.rawRetentionDays,
    aggregateRetentionDays: config.aggregateRetentionDays,
    maxBreakdownEntries: config.maxBreakdownEntries,
    publicDashboardEnabled: config.publicDashboardEnabled,
    publicDashboardToken: config.publicDashboardToken,
    hasPublicDashboardPassword: !!config.publicDashboardPasswordHash,
    trackScrollDepth: config.trackScrollDepth,
    trackSessionDuration: config.trackSessionDuration,
    trackOutboundLinks: config.trackOutboundLinks,
    captureUtmParams: config.captureUtmParams,
    ignoredPaths: config.ignoredPaths,
    allowedOrigins: config.allowedOrigins,
    embedSnippet: `<script src="https://${config.domain?.hostname}/_upm/${config.trackingUuid}/script.js" defer></script>`,
    createdAt: config.createdAt,
  }));

  return c.json({ configs: result });
});

// GET /:domainId - Get config for a domain
app.get("/:domainId", async (c) => {
  const domainId = c.req.param("domainId");
  const config = await db.query.analyticsConfig.findFirst({
    where: eq(analyticsConfig.domainId, domainId),
    with: { domain: true },
  });

  if (!config) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Analytics not configured for this domain" } }, 404);
  }

  const { publicDashboardPasswordHash, apiTokenHash, apiTokenSha256, ...safeConfig } = config;
  return c.json({
    config: {
      ...safeConfig,
      domainHostname: config.domain?.hostname ?? "",
      hasPublicDashboardPassword: !!publicDashboardPasswordHash,
      hasApiToken: !!apiTokenSha256,
      embedSnippet: `<script src="https://${config.domain?.hostname}/_upm/${config.trackingUuid}/script.js" defer></script>`,
    },
  });
});

// POST /:domainId/enable - Enable analytics for a domain
app.post("/:domainId/enable", async (c) => {
  const domainId = c.req.param("domainId");

  const domain = await db.query.domains.findFirst({ where: eq(domains.id, domainId) });
  if (!domain) {
    return c.json({ error: { code: "DOMAIN_NOT_FOUND", message: "Domain not found" } }, 404);
  }

  const existing = await db.query.analyticsConfig.findFirst({ where: eq(analyticsConfig.domainId, domainId) });
  if (existing) {
    return c.json({ error: { code: "ALREADY_EXISTS", message: "Analytics already configured for this domain" } }, 409);
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* use defaults */ }

  const id = nanoid();
  const trackingUuid = crypto.randomUUID();

  const [config] = await db.insert(analyticsConfig).values({
    id,
    domainId,
    trackingUuid,
    enabled: true,
    rawRetentionDays: Number(body.rawRetentionDays) || 90,
    aggregateRetentionDays: Number(body.aggregateRetentionDays) || 365,
    trackScrollDepth: body.trackScrollDepth !== false,
    trackSessionDuration: body.trackSessionDuration !== false,
    trackOutboundLinks: body.trackOutboundLinks !== false,
    captureUtmParams: body.captureUtmParams !== false,
    ignoredPaths: (body.ignoredPaths as string[]) || [],
  }).returning();

  // Queue HAProxy reload.
  try {
    const redis = getRedisClient();
    const queue = new Queue(QUEUES.HAPROXY_RELOAD, { connection: redis });
    await queue.add("haproxy-reload", {}, { jobId: `analytics-enable-${id}` });
  } catch (err) {
    console.error("[Analytics] Failed to queue HAProxy reload:", err);
  }

  return c.json({ config: { ...config, domainHostname: domain.hostname, embedSnippet: `<script src="https://${domain.hostname}/_upm/${trackingUuid}/script.js" defer></script>` } }, 201);
});

// POST /:domainId/disable - Disable analytics
app.post("/:domainId/disable", async (c) => {
  const domainId = c.req.param("domainId");

  const [updated] = await db.update(analyticsConfig)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(analyticsConfig.domainId, domainId))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  try {
    const redis = getRedisClient();
    const queue = new Queue(QUEUES.HAPROXY_RELOAD, { connection: redis });
    await queue.add("haproxy-reload", {}, { jobId: `analytics-disable-${updated.id}` });
  } catch { /* ignore */ }

  const { publicDashboardPasswordHash: _pdph2, apiTokenHash: _ath2, apiTokenSha256: _ats2, ...safeDisabled } = updated;
  return c.json({ config: { ...safeDisabled, hasPublicDashboardPassword: !!_pdph2, hasApiToken: !!_ats2 } });
});

// PUT /:domainId - Update config
app.put("/:domainId", async (c) => {
  const domainId = c.req.param("domainId");
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON" } }, 400); }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.rawRetentionDays !== undefined) updates.rawRetentionDays = Number(body.rawRetentionDays);
  if (body.aggregateRetentionDays !== undefined) updates.aggregateRetentionDays = Number(body.aggregateRetentionDays);
  if (body.maxBreakdownEntries !== undefined) updates.maxBreakdownEntries = Number(body.maxBreakdownEntries);
  if (body.trackScrollDepth !== undefined) updates.trackScrollDepth = Boolean(body.trackScrollDepth);
  if (body.trackSessionDuration !== undefined) updates.trackSessionDuration = Boolean(body.trackSessionDuration);
  if (body.trackOutboundLinks !== undefined) updates.trackOutboundLinks = Boolean(body.trackOutboundLinks);
  if (body.captureUtmParams !== undefined) updates.captureUtmParams = Boolean(body.captureUtmParams);
  if (body.ignoredPaths !== undefined) updates.ignoredPaths = body.ignoredPaths;
  if (body.allowedOrigins !== undefined) updates.allowedOrigins = body.allowedOrigins;
  if (body.publicDashboardEnabled !== undefined) updates.publicDashboardEnabled = Boolean(body.publicDashboardEnabled);

  // Auto-generate a public dashboard token when first enabled.
  if (body.publicDashboardEnabled === true) {
    const existing = await db.query.analyticsConfig.findFirst({
      where: eq(analyticsConfig.domainId, domainId),
      columns: { publicDashboardToken: true },
    });
    if (existing && !existing.publicDashboardToken) {
      updates.publicDashboardToken = crypto.randomBytes(32).toString("base64url");
    }
  }

  // Password management for the public dashboard.
  // Send a non-empty string to set/update the password, or null/empty string to remove it.
  if (body.publicDashboardPassword !== undefined) {
    const password = body.publicDashboardPassword;
    if (password && typeof password === "string" && password.length > 0) {
      updates.publicDashboardPasswordHash = await bcrypt.hash(password, 12);
    } else {
      updates.publicDashboardPasswordHash = null;
    }
  }

  const [updated] = await db.update(analyticsConfig)
    .set(updates)
    .where(eq(analyticsConfig.domainId, domainId))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  const { publicDashboardPasswordHash: _pdph, apiTokenHash: _ath, apiTokenSha256: _ats, ...safeUpdated } = updated;
  return c.json({ config: { ...safeUpdated, hasPublicDashboardPassword: !!_pdph, hasApiToken: !!_ats } });
});

// DELETE /:domainId - Delete analytics config
app.delete("/:domainId", async (c) => {
  const domainId = c.req.param("domainId");

  const config = await db.query.analyticsConfig.findFirst({ where: eq(analyticsConfig.domainId, domainId) });
  if (!config) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  await db.delete(analyticsConfig).where(eq(analyticsConfig.domainId, domainId));

  // Queue async ClickHouse data cleanup and HAProxy reload.
  try {
    const redis = getRedisClient();
    const dataQueue = new Queue(QUEUES.ANALYTICS_DATA_CLEANUP, { connection: redis });
    await dataQueue.add("data-cleanup", { analyticsConfigId: config.id }, { jobId: `analytics-data-cleanup-${config.id}` });
    const reloadQueue = new Queue(QUEUES.HAPROXY_RELOAD, { connection: redis });
    await reloadQueue.add("haproxy-reload", {}, { jobId: `analytics-delete-${config.id}` });
  } catch { /* ignore */ }

  return c.json({ success: true });
});

// POST /:domainId/regenerate-uuid - Regenerate tracking UUID
app.post("/:domainId/regenerate-uuid", async (c) => {
  const domainId = c.req.param("domainId");
  const newUuid = crypto.randomUUID();

  const [updated] = await db.update(analyticsConfig)
    .set({ trackingUuid: newUuid, updatedAt: new Date() })
    .where(eq(analyticsConfig.domainId, domainId))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  try {
    const redis = getRedisClient();
    const queue = new Queue(QUEUES.HAPROXY_RELOAD, { connection: redis });
    await queue.add("haproxy-reload", {}, { jobId: `analytics-uuid-${updated.id}` });
  } catch { /* ignore */ }

  const { publicDashboardPasswordHash: _pdph3, apiTokenHash: _ath3, apiTokenSha256: _ats3, ...safeRegenerated } = updated;
  return c.json({ config: { ...safeRegenerated, hasPublicDashboardPassword: !!_pdph3, hasApiToken: !!_ats3 } });
});

// POST /:domainId/public-dashboard/rotate - Rotate public dashboard token
app.post("/:domainId/public-dashboard/rotate", async (c) => {
  const domainId = c.req.param("domainId");

  const config = await db.query.analyticsConfig.findFirst({
    where: eq(analyticsConfig.domainId, domainId),
    with: { domain: true },
  });
  if (!config) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Analytics not configured for this domain" } }, 404);
  }

  const publicDashboardToken = crypto.randomBytes(32).toString("base64url");

  const [updated] = await db.update(analyticsConfig)
    .set({ publicDashboardToken, updatedAt: new Date() })
    .where(eq(analyticsConfig.domainId, domainId))
    .returning();

  const hostname = config.domain?.hostname ?? "unknown";
  const publicDashboardUrl = `https://${hostname}/analytics/public/${publicDashboardToken}`;

  return c.json({
    publicDashboardToken,
    publicDashboardUrl,
    message: "Public dashboard token rotated successfully. Any existing shared links will stop working.",
  });
});

// POST /:domainId/regenerate-api-token - Generate API token
app.post("/:domainId/regenerate-api-token", async (c) => {
  const domainId = c.req.param("domainId");

  const config = await db.query.analyticsConfig.findFirst({ where: eq(analyticsConfig.domainId, domainId) });
  if (!config) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  const tokenRaw = crypto.randomBytes(32).toString("hex");
  const apiToken = `upm_at_${tokenRaw}`;
  const apiTokenHash = await bcrypt.hash(apiToken, 12);
  const apiTokenSha256 = crypto.createHash("sha256").update(apiToken).digest("hex");

  await db.update(analyticsConfig)
    .set({ apiTokenHash, apiTokenSha256, updatedAt: new Date() })
    .where(eq(analyticsConfig.domainId, domainId));

  return c.json({
    apiToken,
    message: "Store this token securely. It will not be shown again.",
  });
});

export default app;
