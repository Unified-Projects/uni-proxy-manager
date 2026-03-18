import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { trafficMetrics, domains } from "@uni-proxy-manager/database/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { getHaproxyStats } from "@uni-proxy-manager/shared/haproxy";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

const app = new Hono();

/**
 * Calculate deduplicated unique visitors across a time range
 */
async function getUniqueVisitorsForPeriod(
  domainId: string,
  interval: "hour" | "day" | "week"
): Promise<number> {
  const redis = getRedisClient();
  const now = new Date();

  try {
    if (interval === "hour") {
      // Get current hour's unique visitors
      const hourKey = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      const key = `visitors:hourly:${domainId}:${hourKey}`;
      return await redis.scard(key);
    } else if (interval === "day") {
      // Union all hourly sets from last 24 hours
      const keys: string[] = [];
      for (let i = 0; i < 24; i++) {
        const date = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hourKey = date.toISOString().slice(0, 13);
        keys.push(`visitors:hourly:${domainId}:${hourKey}`);
      }

      if (keys.length === 0) return 0;

      // Use temporary key for union
      const tempKey = `visitors:temp:${domainId}:${Date.now()}`;
      await redis.sunionstore(tempKey, ...keys);
      const count = await redis.scard(tempKey);
      await redis.del(tempKey);
      return count;
    } else if (interval === "week") {
      // Union all daily sets from last 7 days
      const keys: string[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dayKey = date.toISOString().slice(0, 10);
        keys.push(`visitors:daily:${domainId}:${dayKey}`);
      }

      if (keys.length === 0) return 0;

      // Use temporary key for union
      const tempKey = `visitors:temp:${domainId}:${Date.now()}`;
      await redis.sunionstore(tempKey, ...keys);
      const count = await redis.scard(tempKey);
      await redis.del(tempKey);
      return count;
    }

    return 0;
  } catch (error) {
    console.error("[Metrics] Error calculating unique visitors:", error);
    return 0;
  }
}

/**
 * Calculate deduplicated unique visitors across all domains for last 24 hours
 */
async function getTotalUniqueVisitorsToday(domainIds: string[]): Promise<number> {
  if (domainIds.length === 0) return 0;

  const redis = getRedisClient();
  const now = new Date();

  try {
    // Union all hourly sets from last 24 hours across all domains
    const keys: string[] = [];
    for (const domainId of domainIds) {
      for (let i = 0; i < 24; i++) {
        const date = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hourKey = date.toISOString().slice(0, 13);
        keys.push(`visitors:hourly:${domainId}:${hourKey}`);
      }
    }

    if (keys.length === 0) return 0;

    // Use temporary key for union
    const tempKey = `visitors:temp:all:${Date.now()}`;
    await redis.sunionstore(tempKey, ...keys);
    const count = await redis.scard(tempKey);
    await redis.del(tempKey);
    return count;
  } catch (error) {
    console.error("[Metrics] Error calculating total unique visitors:", error);
    return 0;
  }
}

// GET /live - Real-time stats from HAProxy
app.get("/live", async (c) => {
  try {
    const allDomains = await db.query.domains.findMany();

    let stats;
    try {
      stats = await getHaproxyStats();
    } catch (haproxyError) {
      // HAProxy not available, return zero stats
      console.warn("[Metrics] HAProxy stats unavailable:", haproxyError);
      return c.json({
        domains: allDomains.map(domain => ({
          domainId: domain.id,
          hostname: domain.hostname,
          currentConnections: 0,
          requestRate: 0,
        })),
      });
    }

    const domainStats = allDomains.map(domain => {
      const frontend = stats.frontends.find(f =>
        f.name === domain.hostname || f.name.includes(domain.hostname)
      );

      return {
        domainId: domain.id,
        hostname: domain.hostname,
        currentConnections: frontend?.current_sessions || 0,
        requestRate: frontend?.http_requests_rate || 0,
      };
    });

    return c.json({ domains: domainStats });
  } catch (error) {
    console.error("[Metrics] Error getting live stats:", error);
    return c.json({ error: "Failed to get live stats" }, 500);
  }
});

// GET /domain/:domainId - Historical metrics for a specific domain
app.get("/domain/:domainId", async (c) => {
  const { domainId } = c.req.param();
  const interval = c.req.query("interval") || "hour"; // hour, day, week
  const limit = parseInt(c.req.query("limit") || "100");

  const now = new Date();
  const startTime = new Date();

  switch (interval) {
    case "hour":
      startTime.setHours(now.getHours() - 1);
      break;
    case "day":
      startTime.setDate(now.getDate() - 1);
      break;
    case "week":
      startTime.setDate(now.getDate() - 7);
      break;
  }

  const metrics = await db.query.trafficMetrics.findMany({
    where: and(
      eq(trafficMetrics.domainId, domainId),
      gte(trafficMetrics.timestamp, startTime)
    ),
    orderBy: desc(trafficMetrics.timestamp),
    limit,
  });

  // Get deduplicated unique visitors for the period
  const uniqueVisitorsTotal = await getUniqueVisitorsForPeriod(
    domainId,
    interval as "hour" | "day" | "week"
  );

  return c.json({ metrics, uniqueVisitorsTotal });
});

// GET /dashboard - Aggregated stats for dashboard
app.get("/dashboard", async (c) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get stats for today
  const todayMetrics = await db
    .select({
      totalRequests: sql<number>`COALESCE(SUM(${trafficMetrics.totalRequests}), 0)`,
      totalBytes: sql<number>`COALESCE(SUM(${trafficMetrics.bytesIn} + ${trafficMetrics.bytesOut}), 0)`,
    })
    .from(trafficMetrics)
    .where(gte(trafficMetrics.timestamp, today));

  // Get top domains by traffic today
  const topDomainsRaw = await db
    .select({
      domainId: trafficMetrics.domainId,
      totalRequests: sql<number>`SUM(${trafficMetrics.totalRequests})`,
    })
    .from(trafficMetrics)
    .where(gte(trafficMetrics.timestamp, today))
    .groupBy(trafficMetrics.domainId)
    .orderBy(desc(sql`SUM(${trafficMetrics.totalRequests})`))
    .limit(5);

  const topDomains = topDomainsRaw.map(d => ({
    domainId: d.domainId,
    totalRequests: Number(d.totalRequests) || 0,
  }));

  // Get recent traffic data for the last 24 hours (for graphing)
  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);

  const recentTraffic = await db.query.trafficMetrics.findMany({
    where: gte(trafficMetrics.timestamp, oneDayAgo),
    orderBy: desc(trafficMetrics.timestamp),
    limit: 1500, // 24 hours * 60 minutes = 1440, plus buffer
  });

  // Get all domain IDs for unique visitor calculation
  const allDomains = await db.query.domains.findMany({
    columns: { id: true },
  });
  const domainIds = allDomains.map(d => d.id);

  // Calculate deduplicated unique visitors across all domains
  const uniqueVisitorsToday = await getTotalUniqueVisitorsToday(domainIds);

  return c.json({
    totalRequestsToday: Number(todayMetrics[0]?.totalRequests) || 0,
    totalBytesToday: Number(todayMetrics[0]?.totalBytes) || 0,
    uniqueVisitorsToday,
    topDomains,
    recentTraffic,
  });
});

export default app;
