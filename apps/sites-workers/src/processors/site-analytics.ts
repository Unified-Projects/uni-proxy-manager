import { type Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { sites, siteAnalytics, deployments, domains, siteDomains } from "@uni-proxy-manager/database/schema";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import type { SiteAnalyticsJobData } from "@uni-proxy-manager/queue";
import type { GeoData, ReferrerData, DeviceData, PathData } from "@uni-proxy-manager/database/schema";

export async function processSiteAnalytics(
  job: Job<SiteAnalyticsJobData>
): Promise<void> {
  const { siteId, timestamp } = job.data;
  const redis = getRedisClient();

  try {
    // If siteId is "*", process all sites
    const sitesToProcess = siteId === "*"
      ? await db.query.sites.findMany({ where: eq(sites.status, "active") })
      : [await db.query.sites.findFirst({ where: eq(sites.id, siteId) })].filter(Boolean);

    for (const site of sitesToProcess) {
      if (!site) continue;

      // Collect site-level analytics
      await collectSiteAnalytics(site.id, new Date(timestamp), redis);

      // Collect domain-specific analytics for all active domains on this site
      const siteDomainRecords = await db.query.siteDomains.findMany({
        where: and(
          eq(siteDomains.siteId, site.id),
          eq(siteDomains.isActive, true)
        ),
      });

      for (const siteDomain of siteDomainRecords) {
        const domain = await db.query.domains.findFirst({
          where: eq(domains.id, siteDomain.domainId),
        });
        if (domain) {
          await collectDomainAnalytics(site.id, domain.id, domain.hostname, new Date(timestamp), redis);
        }
      }
    }
  } catch (error) {
    console.error(`[Site Analytics] Error processing analytics:`, error);
    throw error;
  }
}

async function collectSiteAnalytics(
  siteId: string,
  timestamp: Date,
  redis: ReturnType<typeof getRedisClient>
): Promise<void> {
  try {
    // Get the active deployment
    const activeDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.siteId, siteId),
      orderBy: [desc(deployments.deployedAt)],
    });

    // Collect metrics from Redis (site-level, no domain prefix)
    const metricsKey = `site-metrics:${siteId}:${getMinuteBucket(timestamp)}`;
    const metricsData = await redis.hgetall(metricsKey);

    if (!metricsData || Object.keys(metricsData).length === 0) {
      // No metrics for this period
      return;
    }

    // Parse metrics
    const pageViews = parseInt(metricsData.page_views || "0", 10);
    const uniqueVisitors = parseInt(metricsData.unique_visitors || "0", 10);
    const bytesIn = parseInt(metricsData.bytes_in || "0", 10);
    const bytesOut = parseInt(metricsData.bytes_out || "0", 10);
    const responses2xx = parseInt(metricsData.responses_2xx || "0", 10);
    const responses3xx = parseInt(metricsData.responses_3xx || "0", 10);
    const responses4xx = parseInt(metricsData.responses_4xx || "0", 10);
    const responses5xx = parseInt(metricsData.responses_5xx || "0", 10);
    const avgResponseTimeMs = parseInt(metricsData.avg_response_time_ms || "0", 10);
    const p95ResponseTimeMs = parseInt(metricsData.p95_response_time_ms || "0", 10);

    // Parse aggregated data
    let geoData: GeoData = {};
    let referrers: ReferrerData = {};
    let devices: DeviceData = { desktop: 0, mobile: 0, tablet: 0, other: 0 };
    let paths: PathData = {};
    let browsers: Record<string, number> = {};

    try {
      if (metricsData.geo_data) geoData = JSON.parse(metricsData.geo_data);
      if (metricsData.referrers) referrers = JSON.parse(metricsData.referrers);
      if (metricsData.devices) devices = JSON.parse(metricsData.devices);
      if (metricsData.paths) paths = JSON.parse(metricsData.paths);
      if (metricsData.browsers) browsers = JSON.parse(metricsData.browsers);
    } catch (parseError) {
      console.warn(`[Site Analytics] Failed to parse aggregated data for ${siteId}:`, parseError);
    }

    // Insert analytics record (site-level, no domainId)
    await db.insert(siteAnalytics).values({
      id: nanoid(),
      siteId,
      deploymentId: activeDeployment?.id,
      timestamp: new Date(getMinuteBucket(timestamp)),
      pageViews,
      uniqueVisitors,
      bytesIn,
      bytesOut,
      responses2xx,
      responses3xx,
      responses4xx,
      responses5xx,
      avgResponseTimeMs,
      p95ResponseTimeMs,
      geoData,
      referrers,
      devices,
      paths,
      browsers,
    });

    // Update real-time visitor count in Redis
    const activeVisitorsKey = `site-active-visitors:${siteId}`;
    const realtimeChannel = `site-realtime:${siteId}`;
    const activeVisitors = await redis.get(activeVisitorsKey);

    await redis.publish(realtimeChannel, JSON.stringify({
      activeVisitors: parseInt(activeVisitors || "0", 10),
      pageViews,
      timestamp: timestamp.toISOString(),
    }));

    // Clean up processed metrics
    await redis.del(metricsKey);

    console.log(`[Site Analytics] Collected analytics for site ${siteId}: ${pageViews} page views`);
  } catch (error) {
    console.error(`[Site Analytics] Error collecting analytics for site ${siteId}:`, error);
    throw error;
  }
}

async function collectDomainAnalytics(
  siteId: string,
  domainId: string,
  domainHostname: string,
  timestamp: Date,
  redis: ReturnType<typeof getRedisClient>
): Promise<void> {
  try {
    // Get the active deployment
    const activeDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.siteId, siteId),
      orderBy: [desc(deployments.deployedAt)],
    });

    // Collect domain-specific metrics from Redis (with domain prefix)
    const metricsKey = `site-metrics:${siteId}:${domainHostname}:${getMinuteBucket(timestamp)}`;
    const metricsData = await redis.hgetall(metricsKey);

    if (!metricsData || Object.keys(metricsData).length === 0) {
      // No metrics for this period
      return;
    }

    // Parse metrics
    const pageViews = parseInt(metricsData.page_views || "0", 10);
    const uniqueVisitors = parseInt(metricsData.unique_visitors || "0", 10);
    const bytesIn = parseInt(metricsData.bytes_in || "0", 10);
    const bytesOut = parseInt(metricsData.bytes_out || "0", 10);
    const responses2xx = parseInt(metricsData.responses_2xx || "0", 10);
    const responses3xx = parseInt(metricsData.responses_3xx || "0", 10);
    const responses4xx = parseInt(metricsData.responses_4xx || "0", 10);
    const responses5xx = parseInt(metricsData.responses_5xx || "0", 10);
    const avgResponseTimeMs = parseInt(metricsData.avg_response_time_ms || "0", 10);
    const p95ResponseTimeMs = parseInt(metricsData.p95_response_time_ms || "0", 10);

    // Parse aggregated data
    let geoData: GeoData = {};
    let referrers: ReferrerData = {};
    let devices: DeviceData = { desktop: 0, mobile: 0, tablet: 0, other: 0 };
    let paths: PathData = {};
    let browsers: Record<string, number> = {};

    try {
      if (metricsData.geo_data) geoData = JSON.parse(metricsData.geo_data);
      if (metricsData.referrers) referrers = JSON.parse(metricsData.referrers);
      if (metricsData.devices) devices = JSON.parse(metricsData.devices);
      if (metricsData.paths) paths = JSON.parse(metricsData.paths);
      if (metricsData.browsers) browsers = JSON.parse(metricsData.browsers);
    } catch (parseError) {
      console.warn(`[Site Analytics] Failed to parse aggregated data for domain ${domainHostname}:`, parseError);
    }

    // Insert analytics record (with domainId)
    await db.insert(siteAnalytics).values({
      id: nanoid(),
      siteId,
      domainId,
      deploymentId: activeDeployment?.id,
      timestamp: new Date(getMinuteBucket(timestamp)),
      pageViews,
      uniqueVisitors,
      bytesIn,
      bytesOut,
      responses2xx,
      responses3xx,
      responses4xx,
      responses5xx,
      avgResponseTimeMs,
      p95ResponseTimeMs,
      geoData,
      referrers,
      devices,
      paths,
      browsers,
    });

    // Update real-time visitor count for domain in Redis
    const domainActiveVisitorsKey = `site-active-visitors:${siteId}:${domainHostname}`;
    const realtimeChannel = `site-realtime:${siteId}:${domainHostname}`;
    const activeVisitors = await redis.get(domainActiveVisitorsKey);

    await redis.publish(realtimeChannel, JSON.stringify({
      activeVisitors: parseInt(activeVisitors || "0", 10),
      pageViews,
      timestamp: timestamp.toISOString(),
      domainId,
      domainHostname,
    }));

    // Clean up processed metrics
    await redis.del(metricsKey);

    console.log(`[Site Analytics] Collected domain analytics for ${domainHostname} (${domainId}): ${pageViews} page views`);
  } catch (error) {
    console.error(`[Site Analytics] Error collecting domain analytics for ${domainId}:`, error);
    throw error;
  }
}

function getMinuteBucket(date: Date): number {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.getTime();
}
