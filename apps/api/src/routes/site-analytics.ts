import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@uni-proxy-manager/database";
import { sites, siteAnalytics, deployments, domains } from "@uni-proxy-manager/database/schema";
import { eq, desc, gte, lte, and, sql } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

const app = new Hono();

const timeRangeSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  interval: z.enum(["1m", "5m", "1h", "1d"]).default("1h"),
});

/**
 * Helper to parse and validate date range
 */
function parseDateRange(
  start: string | undefined,
  end: string | undefined
): { startDate: Date; endDate: Date; error?: string } {
  const endDate = end ? new Date(end) : new Date();
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
function validateInterval(interval: string | undefined): interval is "1m" | "5m" | "1h" | "1d" | undefined {
  if (!interval) return true;
  return ["1m", "5m", "1h", "1d"].includes(interval);
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
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Parse and validate date range
    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
      orderBy: [desc(siteAnalytics.timestamp)],
    });

    // Aggregate summary
    const summary = analytics.reduce(
      (acc, record) => ({
        totalPageViews: acc.totalPageViews + record.pageViews,
        totalUniqueVisitors: acc.totalUniqueVisitors + record.uniqueVisitors,
        totalBytesIn: acc.totalBytesIn + record.bytesIn,
        totalBytesOut: acc.totalBytesOut + record.bytesOut,
        total2xx: acc.total2xx + record.responses2xx,
        total3xx: acc.total3xx + record.responses3xx,
        total4xx: acc.total4xx + record.responses4xx,
        total5xx: acc.total5xx + record.responses5xx,
        avgResponseTime: acc.avgResponseTime + (record.avgResponseTimeMs || 0),
      }),
      {
        totalPageViews: 0,
        totalUniqueVisitors: 0,
        totalBytesIn: 0,
        totalBytesOut: 0,
        total2xx: 0,
        total3xx: 0,
        total4xx: 0,
        total5xx: 0,
        avgResponseTime: 0,
      }
    );

    if (analytics.length > 0) {
      summary.avgResponseTime = Math.round(summary.avgResponseTime / analytics.length);
    }

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary,
      dataPoints: analytics.length,
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

        // Subscribe to real-time updates
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

        // Send initial count
        const activeVisitors = await redis.get(`site-active-visitors:${siteId}`);
        sendEvent({
          activeVisitors: parseInt(activeVisitors || "0", 10),
          timestamp: new Date().toISOString(),
        });

        // Periodic heartbeat
        const heartbeat = setInterval(() => {
          sendEvent({ type: "heartbeat", timestamp: new Date().toISOString() });
        }, 30000);

        // Cleanup on close
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

  // Validate interval
  if (!validateInterval(intervalParam)) {
    return c.json({ error: "Invalid interval. Must be one of: 1m, 5m, 1h, 1d" }, 400);
  }
  const interval = intervalParam || "1h";

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Parse and validate date range
    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
      orderBy: [siteAnalytics.timestamp],
    });

    // Group by interval
    const grouped = groupByInterval(analytics, interval);

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval,
      },
      data: grouped.map((g) => ({
        timestamp: g.timestamp,
        pageViews: g.pageViews,
        uniqueVisitors: g.uniqueVisitors,
      })),
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
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Parse and validate date range
    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
    });

    // Aggregate geo data
    const geoAggregate: Record<string, number> = {};
    for (const record of analytics) {
      const geoData = record.geoData || {};
      for (const [country, count] of Object.entries(geoData)) {
        geoAggregate[country] = (geoAggregate[country] || 0) + count;
      }
    }

    // Calculate total before limiting
    const total = Object.values(geoAggregate).reduce((sum, count) => sum + count, 0);

    // Sort by count descending and apply limit
    const sorted = Object.entries(geoAggregate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([country, count]) => ({ country, count }));

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      countries: sorted,
      total,
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
  const limit = parseInt(c.req.query("limit") || "20", 10);

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const endDate = end ? new Date(end) : new Date();
    const startDate = start ? new Date(start) : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
    });

    // Aggregate referrer data
    const referrerAggregate: Record<string, number> = {};
    for (const record of analytics) {
      const referrers = record.referrers || {};
      for (const [domain, count] of Object.entries(referrers)) {
        referrerAggregate[domain] = (referrerAggregate[domain] || 0) + count;
      }
    }

    // Sort by count descending and limit
    const sorted = Object.entries(referrerAggregate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([domain, count]) => ({ domain, count }));

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      referrers: sorted,
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
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Parse and validate date range
    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
    });

    // Aggregate path data
    const pathAggregate: Record<string, number> = {};
    for (const record of analytics) {
      const paths = record.paths || {};
      for (const [path, count] of Object.entries(paths)) {
        pathAggregate[path] = (pathAggregate[path] || 0) + count;
      }
    }

    // Sort by count descending and limit
    const sorted = Object.entries(pathAggregate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, count]) => ({ path, count }));

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      pages: sorted,
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
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const endDate = end ? new Date(end) : new Date();
    const startDate = start ? new Date(start) : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
    });

    // Aggregate device data
    const deviceAggregate = {
      desktop: 0,
      mobile: 0,
      tablet: 0,
      other: 0,
    };

    for (const record of analytics) {
      const devices = record.devices || { desktop: 0, mobile: 0, tablet: 0, other: 0 };
      deviceAggregate.desktop += devices.desktop;
      deviceAggregate.mobile += devices.mobile;
      deviceAggregate.tablet += devices.tablet;
      deviceAggregate.other += devices.other;
    }

    const total =
      deviceAggregate.desktop +
      deviceAggregate.mobile +
      deviceAggregate.tablet +
      deviceAggregate.other;

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      devices: {
        desktop: { count: deviceAggregate.desktop, percentage: total ? (deviceAggregate.desktop / total) * 100 : 0 },
        mobile: { count: deviceAggregate.mobile, percentage: total ? (deviceAggregate.mobile / total) * 100 : 0 },
        tablet: { count: deviceAggregate.tablet, percentage: total ? (deviceAggregate.tablet / total) * 100 : 0 },
        other: { count: deviceAggregate.other, percentage: total ? (deviceAggregate.other / total) * 100 : 0 },
      },
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
  const limit = parseInt(c.req.query("limit") || "10", 10);

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const endDate = end ? new Date(end) : new Date();
    const startDate = start ? new Date(start) : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
    });

    // Aggregate browser data
    const browserAggregate: Record<string, number> = {};
    for (const record of analytics) {
      const browsers = record.browsers || {};
      for (const [browser, count] of Object.entries(browsers)) {
        browserAggregate[browser] = (browserAggregate[browser] || 0) + count;
      }
    }

    // Sort by count descending and limit
    const sorted = Object.entries(browserAggregate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([browser, count]) => ({ browser, count }));

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      browsers: sorted,
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
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const endDate = end ? new Date(end) : new Date();
    const startDate = start ? new Date(start) : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.siteId, siteId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
      orderBy: [siteAnalytics.timestamp],
    });

    // Group by interval
    const grouped = groupByInterval(analytics, interval);

    return c.json({
      siteId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval,
      },
      data: grouped.map((g) => ({
        timestamp: g.timestamp,
        avgResponseTimeMs: g.avgResponseTime,
        p95ResponseTimeMs: g.p95ResponseTime,
        errorRate: g.responses5xx / (g.pageViews || 1) * 100,
      })),
    });
  } catch (error) {
    console.error("[Site Analytics] Error getting performance:", error);
    return c.json({ error: "Failed to get performance data" }, 500);
  }
});

// Helper function to group analytics by interval
function groupByInterval(
  analytics: Array<typeof siteAnalytics.$inferSelect>,
  interval: string
): Array<{
  timestamp: string;
  pageViews: number;
  uniqueVisitors: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  responses5xx: number;
}> {
  const intervalMs = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  }[interval] || 60 * 60 * 1000;

  const groups = new Map<
    string,
    {
      pageViews: number;
      uniqueVisitors: number;
      avgResponseTimeSum: number;
      p95ResponseTimeMax: number;
      responses5xx: number;
      count: number;
    }
  >();

  for (const record of analytics) {
    const timestamp = new Date(record.timestamp);
    const bucketTime = new Date(Math.floor(timestamp.getTime() / intervalMs) * intervalMs);
    const key = bucketTime.toISOString();

    const existing = groups.get(key) || {
      pageViews: 0,
      uniqueVisitors: 0,
      avgResponseTimeSum: 0,
      p95ResponseTimeMax: 0,
      responses5xx: 0,
      count: 0,
    };

    existing.pageViews += record.pageViews;
    existing.uniqueVisitors += record.uniqueVisitors;
    existing.avgResponseTimeSum += record.avgResponseTimeMs || 0;
    existing.p95ResponseTimeMax = Math.max(existing.p95ResponseTimeMax, record.p95ResponseTimeMs || 0);
    existing.responses5xx += record.responses5xx;
    existing.count++;

    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timestamp, data]) => ({
      timestamp,
      pageViews: data.pageViews,
      uniqueVisitors: data.uniqueVisitors,
      avgResponseTime: data.count ? Math.round(data.avgResponseTimeSum / data.count) : 0,
      p95ResponseTime: data.p95ResponseTimeMax,
      responses5xx: data.responses5xx,
    }));
}

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
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Parse and validate date range
    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.domainId, domainId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
      orderBy: [desc(siteAnalytics.timestamp)],
    });

    // Aggregate summary
    const summary = analytics.reduce(
      (acc, record) => ({
        totalPageViews: acc.totalPageViews + record.pageViews,
        totalUniqueVisitors: acc.totalUniqueVisitors + record.uniqueVisitors,
        totalBytesIn: acc.totalBytesIn + record.bytesIn,
        totalBytesOut: acc.totalBytesOut + record.bytesOut,
        total2xx: acc.total2xx + record.responses2xx,
        total3xx: acc.total3xx + record.responses3xx,
        total4xx: acc.total4xx + record.responses4xx,
        total5xx: acc.total5xx + record.responses5xx,
        avgResponseTime: acc.avgResponseTime + (record.avgResponseTimeMs || 0),
      }),
      {
        totalPageViews: 0,
        totalUniqueVisitors: 0,
        totalBytesIn: 0,
        totalBytesOut: 0,
        total2xx: 0,
        total3xx: 0,
        total4xx: 0,
        total5xx: 0,
        avgResponseTime: 0,
      }
    );

    if (analytics.length > 0) {
      summary.avgResponseTime = Math.round(summary.avgResponseTime / analytics.length);
    }

    return c.json({
      domainId,
      hostname: domain.hostname,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary,
      dataPoints: analytics.length,
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
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.domainId, domainId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
      orderBy: [siteAnalytics.timestamp],
    });

    const grouped = groupByInterval(analytics, interval);

    return c.json({
      domainId,
      hostname: domain.hostname,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval,
      },
      data: grouped.map((g) => ({
        timestamp: g.timestamp,
        pageViews: g.pageViews,
        uniqueVisitors: g.uniqueVisitors,
      })),
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
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const dateRange = parseDateRange(start, end);
    if (dateRange.error) {
      return c.json({ error: dateRange.error }, 400);
    }
    const { startDate, endDate } = dateRange;

    const analytics = await db.query.siteAnalytics.findMany({
      where: and(
        eq(siteAnalytics.domainId, domainId),
        gte(siteAnalytics.timestamp, startDate),
        lte(siteAnalytics.timestamp, endDate)
      ),
    });

    const geoAggregate: Record<string, number> = {};
    for (const record of analytics) {
      const geoData = record.geoData || {};
      for (const [country, count] of Object.entries(geoData)) {
        geoAggregate[country] = (geoAggregate[country] || 0) + count;
      }
    }

    const total = Object.values(geoAggregate).reduce((sum, count) => sum + count, 0);

    const sorted = Object.entries(geoAggregate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([country, count]) => ({ country, count }));

    return c.json({
      domainId,
      hostname: domain.hostname,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      countries: sorted,
      total,
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
