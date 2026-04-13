import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { trafficMetrics, domains } from "@uni-proxy-manager/database/schema";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";
import { getHaproxyStats } from "@uni-proxy-manager/shared/haproxy";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

const app = new Hono();

type DashboardTrafficBucket = {
  timestamp: string;
  totalRequests: number;
  uniqueVisitors: number;
  httpRequests: number;
  httpsRequests: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  bytesIn: number;
  bytesOut: number;
  currentConnections: number;
  maxConnections: number;
};

function truncateToHour(date: Date): Date {
  const truncated = new Date(date);
  truncated.setMinutes(0, 0, 0);
  return truncated;
}

function createEmptyDashboardTrafficBucket(timestamp: Date): DashboardTrafficBucket {
  return {
    timestamp: timestamp.toISOString(),
    totalRequests: 0,
    uniqueVisitors: 0,
    httpRequests: 0,
    httpsRequests: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    bytesIn: 0,
    bytesOut: 0,
    currentConnections: 0,
    maxConnections: 0,
  };
}

type TrafficBucketRow = {
  timestamp: Date | string;
  totalRequests: number;
  uniqueVisitors: number;
  httpRequests: number;
  httpsRequests: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  bytesIn: number;
  bytesOut: number;
  currentConnections: number;
  maxConnections: number;
};

function mapTrafficBucketRow(row: TrafficBucketRow): DashboardTrafficBucket {
  const timestamp =
    row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);

  return {
    timestamp: timestamp.toISOString(),
    totalRequests: Number(row.totalRequests) || 0,
    uniqueVisitors: Number(row.uniqueVisitors) || 0,
    httpRequests: Number(row.httpRequests) || 0,
    httpsRequests: Number(row.httpsRequests) || 0,
    status2xx: Number(row.status2xx) || 0,
    status3xx: Number(row.status3xx) || 0,
    status4xx: Number(row.status4xx) || 0,
    status5xx: Number(row.status5xx) || 0,
    bytesIn: Number(row.bytesIn) || 0,
    bytesOut: Number(row.bytesOut) || 0,
    currentConnections: Number(row.currentConnections) || 0,
    maxConnections: Number(row.maxConnections) || 0,
  };
}

function buildHourlyTrafficBuckets(
  rows: TrafficBucketRow[],
  anchorHour: Date,
  bucketCount: number,
): DashboardTrafficBucket[] {
  const bucketsByHour = new Map<number, DashboardTrafficBucket>(
    rows.map((row) => {
      const timestamp =
        row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
      return [timestamp.getTime(), mapTrafficBucketRow(row)] as const;
    }),
  );

  const buckets: DashboardTrafficBucket[] = [];

  for (let hourOffset = 0; hourOffset < bucketCount; hourOffset++) {
    const bucketTime = new Date(anchorHour);
    bucketTime.setHours(anchorHour.getHours() - hourOffset);
    buckets.push(
      bucketsByHour.get(bucketTime.getTime()) ??
        createEmptyDashboardTrafficBucket(bucketTime),
    );
  }

  return buckets;
}

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
  const cacheKey = `metrics:dashboard:unique-visitors:${now.toISOString().slice(0, 16)}`;

  try {
    const cachedCount = await redis.get(cacheKey);
    if (cachedCount) {
      return parseInt(cachedCount, 10) || 0;
    }

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
    await Promise.all([
      redis.del(tempKey),
      redis.set(cacheKey, String(count), "EX", 90),
    ]);
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

  let metrics: DashboardTrafficBucket[] | Awaited<
    ReturnType<typeof db.query.trafficMetrics.findMany>
  >;

  if (interval === "day") {
    const currentHour = truncateToHour(now);
    const recentTrafficStart = new Date(currentHour);
    recentTrafficStart.setHours(recentTrafficStart.getHours() - 23);
    const nextHour = new Date(currentHour);
    nextHour.setHours(nextHour.getHours() + 1);
    const trafficBucket = sql<Date>`date_trunc('hour', ${trafficMetrics.timestamp})`;

    const rows = await db
      .select({
        timestamp: trafficBucket,
        totalRequests: sql<number>`COALESCE(SUM(${trafficMetrics.totalRequests}), 0)`,
        uniqueVisitors: sql<number>`COALESCE(SUM(${trafficMetrics.uniqueVisitors}), 0)`,
        httpRequests: sql<number>`COALESCE(SUM(${trafficMetrics.httpRequests}), 0)`,
        httpsRequests: sql<number>`COALESCE(SUM(${trafficMetrics.httpsRequests}), 0)`,
        status2xx: sql<number>`COALESCE(SUM(${trafficMetrics.status2xx}), 0)`,
        status3xx: sql<number>`COALESCE(SUM(${trafficMetrics.status3xx}), 0)`,
        status4xx: sql<number>`COALESCE(SUM(${trafficMetrics.status4xx}), 0)`,
        status5xx: sql<number>`COALESCE(SUM(${trafficMetrics.status5xx}), 0)`,
        bytesIn: sql<number>`COALESCE(SUM(${trafficMetrics.bytesIn}), 0)`,
        bytesOut: sql<number>`COALESCE(SUM(${trafficMetrics.bytesOut}), 0)`,
        currentConnections: sql<number>`COALESCE(MAX(${trafficMetrics.currentConnections}), 0)`,
        maxConnections: sql<number>`COALESCE(MAX(${trafficMetrics.maxConnections}), 0)`,
      })
      .from(trafficMetrics)
      .where(
        and(
          eq(trafficMetrics.domainId, domainId),
          gte(trafficMetrics.timestamp, recentTrafficStart),
          lt(trafficMetrics.timestamp, nextHour),
        ),
      )
      .groupBy(trafficBucket)
      .orderBy(desc(trafficBucket))
      .limit(24);

    if (rows.length === 0) {
      metrics = [];
    } else {
      const newestBucketTimestamp =
        rows[0]?.timestamp instanceof Date
          ? rows[0].timestamp
          : new Date(rows[0].timestamp);
      const newestBucketHour = truncateToHour(newestBucketTimestamp);
      const previousHour = new Date(currentHour);
      previousHour.setHours(previousHour.getHours() - 1);
      const anchorHour =
        newestBucketHour.getTime() === previousHour.getTime()
          ? newestBucketHour
          : currentHour;

      metrics = buildHourlyTrafficBuckets(rows, anchorHour, 24);
    }
  } else {
    metrics = await db.query.trafficMetrics.findMany({
      where: and(
        eq(trafficMetrics.domainId, domainId),
        gte(trafficMetrics.timestamp, startTime)
      ),
      orderBy: desc(trafficMetrics.timestamp),
      limit,
    });
  }

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

  // Get recent traffic data for the last 24 hourly buckets, zero-filling gaps.
  const currentHour = truncateToHour(new Date());
  const recentTrafficStart = new Date(currentHour);
  recentTrafficStart.setHours(recentTrafficStart.getHours() - 23);
  const nextHour = new Date(currentHour);
  nextHour.setHours(nextHour.getHours() + 1);

  const recentTrafficBucket = sql<Date>`date_trunc('hour', ${trafficMetrics.timestamp})`;
  const recentTrafficRaw = await db
    .select({
      timestamp: recentTrafficBucket,
      totalRequests: sql<number>`COALESCE(SUM(${trafficMetrics.totalRequests}), 0)`,
      uniqueVisitors: sql<number>`COALESCE(SUM(${trafficMetrics.uniqueVisitors}), 0)`,
      httpRequests: sql<number>`COALESCE(SUM(${trafficMetrics.httpRequests}), 0)`,
      httpsRequests: sql<number>`COALESCE(SUM(${trafficMetrics.httpsRequests}), 0)`,
      status2xx: sql<number>`COALESCE(SUM(${trafficMetrics.status2xx}), 0)`,
      status3xx: sql<number>`COALESCE(SUM(${trafficMetrics.status3xx}), 0)`,
      status4xx: sql<number>`COALESCE(SUM(${trafficMetrics.status4xx}), 0)`,
      status5xx: sql<number>`COALESCE(SUM(${trafficMetrics.status5xx}), 0)`,
      bytesIn: sql<number>`COALESCE(SUM(${trafficMetrics.bytesIn}), 0)`,
      bytesOut: sql<number>`COALESCE(SUM(${trafficMetrics.bytesOut}), 0)`,
      currentConnections: sql<number>`COALESCE(MAX(${trafficMetrics.currentConnections}), 0)`,
      maxConnections: sql<number>`COALESCE(MAX(${trafficMetrics.maxConnections}), 0)`,
    })
    .from(trafficMetrics)
    .where(and(
      gte(trafficMetrics.timestamp, recentTrafficStart),
      lt(trafficMetrics.timestamp, nextHour)
    ))
    .groupBy(recentTrafficBucket)
    .orderBy(desc(recentTrafficBucket))
    .limit(24);

  const recentTraffic = buildHourlyTrafficBuckets(recentTrafficRaw, currentHour, 24);

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
