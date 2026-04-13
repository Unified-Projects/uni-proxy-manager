import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@uni-proxy-manager/database";
import { sites, siteAnalytics, domains } from "@uni-proxy-manager/database/schema";
import { eq, gte, lte, and, sql } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

const app = new Hono();

const timeRangeSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  interval: z.enum(["1m", "5m", "1h", "1d"]).default("1h"),
});

type Interval = "1m" | "5m" | "1h" | "1d";
type AnalyticsScope =
  | { kind: "site"; id: string }
  | { kind: "domain"; id: string };
type SiteAnalyticsRecord = typeof siteAnalytics.$inferSelect;
const DEFAULT_END_DATE_GRACE_MS = 60 * 1000;

/**
 * Helper to parse and validate date range
 */
function parseDateRange(
  start: string | undefined,
  end: string | undefined
): { startDate: Date; endDate: Date; error?: string } {
  // Allow the next minute bucket when callers rely on the default range so
  // freshly aggregated records are not dropped by small writer/API clock skew.
  const endDate = end ? new Date(end) : new Date(Date.now() + DEFAULT_END_DATE_GRACE_MS);
  const startDate = start
    ? new Date(start)
    : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

  if (isNaN(startDate.getTime())) {
    return { startDate, endDate, error: "Invalid start date" };
  }
  if (isNaN(endDate.getTime())) {
    return { startDate, endDate, error: "Invalid end date" };
  }
  if (startDate > endDate) {
    return { startDate, endDate, error: "Start date must be before end date" };
  }

  return { startDate, endDate };
}

/**
 * Parse and validate limit parameter
 */
function parseLimit(limitStr: string | undefined, defaultValue = 10, maxValue = 1000): number | { error: string } {
  if (!limitStr) return defaultValue;
  const limit = parseInt(limitStr, 10);
  if (isNaN(limit)) return { error: "Invalid limit parameter" };
  if (limit < 0) return { error: "Limit must be non-negative" };
  return Math.min(limit, maxValue);
}

/**
 * Validate interval parameter
 */
function validateInterval(interval: string | undefined): interval is Interval | undefined {
  if (!interval) return true;
  return ["1m", "5m", "1h", "1d"].includes(interval);
}

function normalizeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return new Date(0).toISOString();
}

function getScopeCondition(scope: AnalyticsScope) {
  return scope.kind === "site"
    ? eq(siteAnalytics.siteId, scope.id)
    : eq(siteAnalytics.domainId, scope.id);
}

function getScopeWhere(scope: AnalyticsScope, startDate: Date, endDate: Date) {
  return and(
    getScopeCondition(scope),
    gte(siteAnalytics.timestamp, startDate),
    lte(siteAnalytics.timestamp, endDate)
  );
}

async function getScopedAnalyticsRecords(
  scope: AnalyticsScope,
  startDate: Date,
  endDate: Date
): Promise<SiteAnalyticsRecord[]> {
  return db.query.siteAnalytics.findMany({
    where: getScopeWhere(scope, startDate, endDate),
    orderBy: [siteAnalytics.timestamp],
  });
}

function getBucketStart(timestamp: Date, interval: Interval): string {
  const bucket = new Date(timestamp);

  if (interval === "1d") {
    bucket.setUTCHours(0, 0, 0, 0);
    return bucket.toISOString();
  }

  bucket.setUTCSeconds(0, 0);

  if (interval === "1h") {
    bucket.setUTCMinutes(0, 0, 0);
    return bucket.toISOString();
  }

  if (interval === "5m") {
    bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5, 0, 0);
    return bucket.toISOString();
  }

  return bucket.toISOString();
}

function groupAnalyticsByInterval(records: SiteAnalyticsRecord[], interval: Interval) {
  const buckets = new Map<string, {
    pageViews: number;
    uniqueVisitors: number;
    avgResponseTimeSum: number;
    p95ResponseTimeMs: number;
    responses5xx: number;
    responseTimeCount: number;
  }>();

  for (const record of records) {
    const bucket = getBucketStart(record.timestamp, interval);
    const current = buckets.get(bucket) || {
      pageViews: 0,
      uniqueVisitors: 0,
      avgResponseTimeSum: 0,
      p95ResponseTimeMs: 0,
      responses5xx: 0,
      responseTimeCount: 0,
    };

    current.pageViews += normalizeNumber(record.pageViews);
    current.uniqueVisitors += normalizeNumber(record.uniqueVisitors);
    current.responses5xx += normalizeNumber(record.responses5xx);

    if (record.avgResponseTimeMs !== null && record.avgResponseTimeMs !== undefined) {
      current.avgResponseTimeSum += normalizeNumber(record.avgResponseTimeMs);
      current.responseTimeCount += 1;
    }

    current.p95ResponseTimeMs = Math.max(
      current.p95ResponseTimeMs,
      normalizeNumber(record.p95ResponseTimeMs)
    );

    buckets.set(bucket, current);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([timestamp, value]) => ({
      timestamp,
      pageViews: value.pageViews,
      uniqueVisitors: value.uniqueVisitors,
      avgResponseTimeMs: value.responseTimeCount
        ? Math.round(value.avgResponseTimeSum / value.responseTimeCount)
        : 0,
      p95ResponseTimeMs: value.p95ResponseTimeMs,
      responses5xx: value.responses5xx,
    }));
}

function aggregateJsonCounts(
  records: SiteAnalyticsRecord[],
  selector: (record: SiteAnalyticsRecord) => Record<string, number> | null | undefined,
  limit: number,
  includeTotal = false
) {
  const counts = new Map<string, number>();

  for (const record of records) {
    const data = selector(record) || {};
    for (const [label, rawCount] of Object.entries(data)) {
      counts.set(label, (counts.get(label) || 0) + normalizeNumber(rawCount));
    }
  }

  const sorted = Array.from(counts.entries())
    .sort((left, right) => {
      const countDiff = right[1] - left[1];
      return countDiff !== 0 ? countDiff : left[0].localeCompare(right[0]);
    });

  return {
    items: sorted.slice(0, limit).map(([label, count]) => ({ label, count })),
    total: includeTotal
      ? sorted.reduce((sum, [, count]) => sum + count, 0)
      : undefined,
  };
}

async function getAnalyticsSummary(scope: AnalyticsScope, startDate: Date, endDate: Date) {
  const whereClause = getScopeWhere(scope, startDate, endDate);
  const [row] = await db
    .select({
      totalPageViews: sql<number>`COALESCE(SUM(${siteAnalytics.pageViews}), 0)`,
      totalUniqueVisitors: sql<number>`COALESCE(SUM(${siteAnalytics.uniqueVisitors}), 0)`,
      totalBytesIn: sql<number>`COALESCE(SUM(${siteAnalytics.bytesIn}), 0)`,
      totalBytesOut: sql<number>`COALESCE(SUM(${siteAnalytics.bytesOut}), 0)`,
      total2xx: sql<number>`COALESCE(SUM(${siteAnalytics.responses2xx}), 0)`,
      total3xx: sql<number>`COALESCE(SUM(${siteAnalytics.responses3xx}), 0)`,
      total4xx: sql<number>`COALESCE(SUM(${siteAnalytics.responses4xx}), 0)`,
      total5xx: sql<number>`COALESCE(SUM(${siteAnalytics.responses5xx}), 0)`,
      avgResponseTime: sql<number>`COALESCE(ROUND(AVG(${siteAnalytics.avgResponseTimeMs})), 0)`,
      dataPoints: sql<number>`COUNT(*)`,
    })
    .from(siteAnalytics)
    .where(whereClause);

  return {
    summary: {
      totalPageViews: normalizeNumber(row?.totalPageViews),
      totalUniqueVisitors: normalizeNumber(row?.totalUniqueVisitors),
      totalBytesIn: normalizeNumber(row?.totalBytesIn),
      totalBytesOut: normalizeNumber(row?.totalBytesOut),
      total2xx: normalizeNumber(row?.total2xx),
      total3xx: normalizeNumber(row?.total3xx),
      total4xx: normalizeNumber(row?.total4xx),
      total5xx: normalizeNumber(row?.total5xx),
      avgResponseTime: normalizeNumber(row?.avgResponseTime),
    },
    dataPoints: normalizeNumber(row?.dataPoints),
  };
}

async function getVisitorSeries(scope: AnalyticsScope, startDate: Date, endDate: Date, interval: Interval) {
  const records = await getScopedAnalyticsRecords(scope, startDate, endDate);
  const grouped = groupAnalyticsByInterval(records, interval);

  return grouped.map((row) => ({
    timestamp: normalizeTimestamp(row.timestamp),
    pageViews: row.pageViews,
    uniqueVisitors: row.uniqueVisitors,
  }));
}

async function getPerformanceSeries(scope: AnalyticsScope, startDate: Date, endDate: Date, interval: Interval) {
  const records = await getScopedAnalyticsRecords(scope, startDate, endDate);
  const grouped = groupAnalyticsByInterval(records, interval);

  return grouped.map((row) => {
    const pageViews = row.pageViews;
    const responses5xx = row.responses5xx;
    return {
      timestamp: normalizeTimestamp(row.timestamp),
      avgResponseTimeMs: row.avgResponseTimeMs,
      p95ResponseTimeMs: row.p95ResponseTimeMs,
      errorRate: (responses5xx / (pageViews || 1)) * 100,
    };
  });
}

async function getJsonRanking(
  field: typeof siteAnalytics.geoData | typeof siteAnalytics.referrers | typeof siteAnalytics.paths | typeof siteAnalytics.browsers,
  scope: AnalyticsScope,
  startDate: Date,
  endDate: Date,
  limit: number,
  includeTotal = false
) {
  const records = await getScopedAnalyticsRecords(scope, startDate, endDate);
  return aggregateJsonCounts(
    records,
    (record) => {
      if (field === siteAnalytics.geoData) return record.geoData;
      if (field === siteAnalytics.referrers) return record.referrers;
      if (field === siteAnalytics.paths) return record.paths;
      return record.browsers;
    },
    limit,
    includeTotal
  );
}

async function getDeviceBreakdown(scope: AnalyticsScope, startDate: Date, endDate: Date) {
  const whereClause = getScopeWhere(scope, startDate, endDate);
  const [row] = await db
    .select({
      desktop: sql<number>`COALESCE(SUM(COALESCE((${siteAnalytics.devices}->>'desktop')::int, 0)), 0)`,
      mobile: sql<number>`COALESCE(SUM(COALESCE((${siteAnalytics.devices}->>'mobile')::int, 0)), 0)`,
      tablet: sql<number>`COALESCE(SUM(COALESCE((${siteAnalytics.devices}->>'tablet')::int, 0)), 0)`,
      other: sql<number>`COALESCE(SUM(COALESCE((${siteAnalytics.devices}->>'other')::int, 0)), 0)`,
    })
    .from(siteAnalytics)
    .where(whereClause);

  const desktop = normalizeNumber(row?.desktop);
  const mobile = normalizeNumber(row?.mobile);
  const tablet = normalizeNumber(row?.tablet);
  const other = normalizeNumber(row?.other);
  const total = desktop + mobile + tablet + other;

  return {
    devices: {
      desktop: { count: desktop, percentage: total ? (desktop / total) * 100 : 0 },
      mobile: { count: mobile, percentage: total ? (mobile / total) * 100 : 0 },
      tablet: { count: tablet, percentage: total ? (tablet / total) * 100 : 0 },
      other: { count: other, percentage: total ? (other / total) * 100 : 0 },
    },
    total,
  };
}

/**
 * GET /api/site-analytics/:siteId
 * Get analytics summary for a site
 */
app.get("/:siteId", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { summary, dataPoints } = await getAnalyticsSummary(
      { kind: "site", id: siteId },
      startDate,
      endDate
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary,
      dataPoints,
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting summary:", error);
    return c.json({ error: "Failed to get analytics" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/realtime
 * SSE endpoint for real-time visitor count
 */
app.get("/:siteId/realtime", async (c) => {
  const { siteId } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const stream = new ReadableStream({
      async start(controller) {
        const redis = getRedisClient();
        const channel = `site-realtime:${siteId}`;

        const sendEvent = (data: unknown) => {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        const subscriber = redis.duplicate();
        await subscriber.connect();

        subscriber.subscribe(channel, (message) => {
          try {
            if (typeof message === "string") {
              const data = JSON.parse(message);
              sendEvent(data);
            }
          } catch {
            // Ignore invalid messages
          }
        });

        const activeVisitors = await redis.get(`site-active-visitors:${siteId}`);
        sendEvent({
          activeVisitors: parseInt(activeVisitors || "0", 10),
          timestamp: new Date().toISOString(),
        });

        const heartbeat = setInterval(() => {
          sendEvent({ type: "heartbeat", timestamp: new Date().toISOString() });
        }, 30000);

        c.req.raw.signal.addEventListener("abort", async () => {
          clearInterval(heartbeat);
          try {
            await subscriber.unsubscribe(channel);
            await subscriber.quit();
          } catch (cleanupError) {
            console.warn("[Site Analytics] Error during SSE realtime subscriber cleanup:", cleanupError);
          }
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Site Analytics] Error streaming realtime:", error);
    return c.json({ error: "Failed to start realtime stream" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/visitors
 * Get visitor time series data
 */
app.get("/:siteId/visitors", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const intervalParam = c.req.query("interval");

  if (!validateInterval(intervalParam)) {
    return c.json({ error: "Invalid interval. Must be one of: 1m, 5m, 1h, 1d" }, 400);
  }
  const interval = intervalParam || "1h";

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const data = await getVisitorSeries(
      { kind: "site", id: siteId },
      startDate,
      endDate,
      interval
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval,
      },
      data,
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting visitors:", error);
    return c.json({ error: "Failed to get visitor data" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/geography
 * Get geographic breakdown of visitors
 */
app.get("/:siteId/geography", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limitParam = c.req.query("limit");
  const limitResult = parseLimit(limitParam, 100, 1000);
  if (typeof limitResult === "object") {
    return c.json({ error: limitResult.error }, 400);
  }
  const limit = limitResult;

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { items, total } = await getJsonRanking(
      siteAnalytics.geoData,
      { kind: "site", id: siteId },
      startDate,
      endDate,
      limit,
      true
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      countries: items.map(({ label, count }) => ({ country: label, count })),
      total: total ?? 0,
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting geography:", error);
    return c.json({ error: "Failed to get geographic data" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/referrers
 * Get top referrers
 */
app.get("/:siteId/referrers", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limitResult = parseLimit(c.req.query("limit"), 20, 1000);
  if (typeof limitResult === "object") {
    return c.json({ error: limitResult.error }, 400);
  }
  const limit = limitResult;

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { items } = await getJsonRanking(
      siteAnalytics.referrers,
      { kind: "site", id: siteId },
      startDate,
      endDate,
      limit
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      referrers: items.map(({ label, count }) => ({ domain: label, count })),
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting referrers:", error);
    return c.json({ error: "Failed to get referrer data" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/pages
 * Get top pages
 */
app.get("/:siteId/pages", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limitParam = c.req.query("limit");
  const limitResult = parseLimit(limitParam, 20, 1000);
  if (typeof limitResult === "object") {
    return c.json({ error: limitResult.error }, 400);
  }
  const limit = limitResult;

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { items } = await getJsonRanking(
      siteAnalytics.paths,
      { kind: "site", id: siteId },
      startDate,
      endDate,
      limit
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      pages: items.map(({ label, count }) => ({ path: label, count })),
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting pages:", error);
    return c.json({ error: "Failed to get page data" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/devices
 * Get device breakdown
 */
app.get("/:siteId/devices", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { devices, total } = await getDeviceBreakdown(
      { kind: "site", id: siteId },
      startDate,
      endDate
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      devices,
      total,
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting devices:", error);
    return c.json({ error: "Failed to get device data" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/browsers
 * Get browser breakdown
 */
app.get("/:siteId/browsers", async (c) => {
  const { siteId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limitResult = parseLimit(c.req.query("limit"), 10, 1000);
  if (typeof limitResult === "object") {
    return c.json({ error: limitResult.error }, 400);
  }
  const limit = limitResult;

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { items } = await getJsonRanking(
      siteAnalytics.browsers,
      { kind: "site", id: siteId },
      startDate,
      endDate,
      limit
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      browsers: items.map(({ label, count }) => ({ browser: label, count })),
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting browsers:", error);
    return c.json({ error: "Failed to get browser data" }, 500);
  }
});

/**
 * GET /api/site-analytics/:siteId/performance
 * Get performance metrics over time
 */
app.get("/:siteId/performance", zValidator("query", timeRangeSchema), async (c) => {
  const { siteId } = c.req.param();
  const { start, end, interval } = c.req.valid("query");

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const data = await getPerformanceSeries(
      { kind: "site", id: siteId },
      startDate,
      endDate,
      interval
    );

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval,
      },
      data,
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting performance:", error);
    return c.json({ error: "Failed to get performance data" }, 500);
  }
});

/**
 * GET /api/domains/:domainId/analytics
 * Get analytics summary for a domain
 */
app.get("/domains/:domainId", async (c) => {
  const { domainId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
      columns: { id: true, hostname: true },
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { summary, dataPoints } = await getAnalyticsSummary(
      { kind: "domain", id: domainId },
      startDate,
      endDate
    );

    return c.json({
      domainId,
      hostname: domain.hostname,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary,
      dataPoints,
    });
  } catch (error) {
    console.error("[Domain Analytics] Error getting summary:", error);
    return c.json({ error: "Failed to get domain analytics" }, 500);
  }
});

/**
 * GET /api/domains/:domainId/analytics/visitors
 * Get visitor time series data for a domain
 */
app.get("/domains/:domainId/visitors", async (c) => {
  const { domainId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const intervalParam = c.req.query("interval");

  if (!validateInterval(intervalParam)) {
    return c.json({ error: "Invalid interval. Must be one of: 1m, 5m, 1h, 1d" }, 400);
  }
  const interval = intervalParam || "1h";

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
      columns: { id: true, hostname: true },
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const data = await getVisitorSeries(
      { kind: "domain", id: domainId },
      startDate,
      endDate,
      interval
    );

    return c.json({
      domainId,
      hostname: domain.hostname,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval,
      },
      data,
    });
  } catch (error) {
    console.error("[Domain Analytics] Error getting visitors:", error);
    return c.json({ error: "Failed to get visitor data" }, 500);
  }
});

/**
 * GET /api/domains/:domainId/analytics/geography
 * Get geographic breakdown for a domain
 */
app.get("/domains/:domainId/geography", async (c) => {
  const { domainId } = c.req.param();
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limitParam = c.req.query("limit");
  const limitResult = parseLimit(limitParam, 100, 1000);
  if (typeof limitResult === "object") {
    return c.json({ error: limitResult.error }, 400);
  }
  const limit = limitResult;

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
      columns: { id: true, hostname: true },
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const { items, total } = await getJsonRanking(
      siteAnalytics.geoData,
      { kind: "domain", id: domainId },
      startDate,
      endDate,
      limit,
      true
    );

    return c.json({
      domainId,
      hostname: domain.hostname,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      countries: items.map(({ label, count }) => ({ country: label, count })),
      total: total ?? 0,
    });
  } catch (error) {
    console.error("[Domain Analytics] Error getting geography:", error);
    return c.json({ error: "Failed to get geographic data" }, 500);
  }
});

/**
 * GET /api/domains/:domainId/analytics/realtime
 * SSE endpoint for real-time visitor count for a domain
 */
app.get("/domains/:domainId/realtime", async (c) => {
  const { domainId } = c.req.param();

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
      columns: { id: true, hostname: true },
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const stream = new ReadableStream({
      async start(controller) {
        const redis = getRedisClient();
        const channel = `site-realtime:domain:${domainId}`;

        const sendEvent = (data: unknown) => {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        const subscriber = redis.duplicate();
        await subscriber.connect();

        subscriber.subscribe(channel, (message) => {
          try {
            if (typeof message === "string") {
              const data = JSON.parse(message);
              sendEvent(data);
            }
          } catch {
            // Ignore invalid messages
          }
        });

        const activeVisitorsKey = `site-active-visitors:domain:${domainId}`;
        const activeVisitors = await redis.get(activeVisitorsKey);
        sendEvent({
          activeVisitors: parseInt(activeVisitors || "0", 10),
          domainId,
          hostname: domain.hostname,
          timestamp: new Date().toISOString(),
        });

        const heartbeat = setInterval(() => {
          sendEvent({ type: "heartbeat", timestamp: new Date().toISOString() });
        }, 30000);

        c.req.raw.signal.addEventListener("abort", async () => {
          clearInterval(heartbeat);
          try {
            await subscriber.unsubscribe(channel);
            await subscriber.quit();
          } catch (cleanupError) {
            console.warn("[Domain Analytics] Error during SSE realtime subscriber cleanup:", cleanupError);
          }
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Domain Analytics] Error streaming realtime:", error);
    return c.json({ error: "Failed to start realtime stream" }, 500);
  }
});

export default app;
