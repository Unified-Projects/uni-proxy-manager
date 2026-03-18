import type { Redis } from "ioredis";

export interface PageViewData {
  path: string;
  domain: string;
  referrer?: string;
  userAgent?: string;
  country?: string;
  responseCode: number;
  responseTimeMs: number;
  bytesIn: number;
  bytesOut: number;
  visitorId: string;
}

function getMinuteBucket(date: Date): number {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.getTime();
}

function parseDeviceType(userAgent: string): "desktop" | "mobile" | "tablet" | "other" {
  const ua = userAgent.toLowerCase();
  if (ua.includes("tablet") || ua.includes("ipad")) {
    return "tablet";
  }
  if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) {
    return "mobile";
  }
  if (ua.includes("windows") || ua.includes("macintosh") || ua.includes("linux")) {
    return "desktop";
  }
  return "other";
}

/**
 * Track a page view for analytics (called from request middleware)
 * Stores metrics in Redis for periodic aggregation into the database
 */
export async function trackPageView(
  redis: Redis,
  siteId: string,
  data: PageViewData
): Promise<void> {
  const timestamp = new Date();
  const minuteBucket = getMinuteBucket(timestamp);
  const domain = data.domain;

  // Site-level metrics (for backward compatibility and aggregate view)
  const siteMetricsKey = `site-metrics:${siteId}:${minuteBucket}`;
  // Domain-specific metrics
  const domainMetricsKey = `site-metrics:${siteId}:${domain}:${minuteBucket}`;

  // Use pipeline for efficiency
  const pipeline = redis.pipeline();

  // Increment page views and bytes for both site and domain
  pipeline.hincrby(siteMetricsKey, "page_views", 1);
  pipeline.hincrby(siteMetricsKey, "bytes_in", data.bytesIn);
  pipeline.hincrby(siteMetricsKey, "bytes_out", data.bytesOut);
  pipeline.hincrby(domainMetricsKey, "page_views", 1);
  pipeline.hincrby(domainMetricsKey, "bytes_in", data.bytesIn);
  pipeline.hincrby(domainMetricsKey, "bytes_out", data.bytesOut);

  // Track response codes for both
  if (data.responseCode >= 200 && data.responseCode < 300) {
    pipeline.hincrby(siteMetricsKey, "responses_2xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_2xx", 1);
  } else if (data.responseCode >= 300 && data.responseCode < 400) {
    pipeline.hincrby(siteMetricsKey, "responses_3xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_3xx", 1);
  } else if (data.responseCode >= 400 && data.responseCode < 500) {
    pipeline.hincrby(siteMetricsKey, "responses_4xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_4xx", 1);
  } else if (data.responseCode >= 500) {
    pipeline.hincrby(siteMetricsKey, "responses_5xx", 1);
    pipeline.hincrby(domainMetricsKey, "responses_5xx", 1);
  }

  // Track unique visitors - both site and domain level
  const siteUniqueKey = `site-unique-visitors:${siteId}:${minuteBucket}`;
  const domainUniqueKey = `site-unique-visitors:${siteId}:${domain}:${minuteBucket}`;
  pipeline.sadd(siteUniqueKey, data.visitorId);
  pipeline.sadd(domainUniqueKey, data.visitorId);
  pipeline.expire(siteUniqueKey, 120);
  pipeline.expire(domainUniqueKey, 120);

  // Track paths - both levels
  const sitePathsKey = `site-paths:${siteId}:${minuteBucket}`;
  const domainPathsKey = `site-paths:${siteId}:${domain}:${minuteBucket}`;
  pipeline.hincrby(sitePathsKey, data.path, 1);
  pipeline.hincrby(domainPathsKey, data.path, 1);
  pipeline.expire(sitePathsKey, 120);
  pipeline.expire(domainPathsKey, 120);

  // Track referrers - both levels
  if (data.referrer) {
    try {
      const referrerDomain = new URL(data.referrer).hostname;
      const siteReferrersKey = `site-referrers:${siteId}:${minuteBucket}`;
      const domainReferrersKey = `site-referrers:${siteId}:${domain}:${minuteBucket}`;
      pipeline.hincrby(siteReferrersKey, referrerDomain, 1);
      pipeline.hincrby(domainReferrersKey, referrerDomain, 1);
      pipeline.expire(siteReferrersKey, 120);
      pipeline.expire(domainReferrersKey, 120);
    } catch {
      // Invalid referrer URL
    }
  }

  // Track devices - both levels
  const device = parseDeviceType(data.userAgent || "");
  const siteDevicesKey = `site-devices:${siteId}:${minuteBucket}`;
  const domainDevicesKey = `site-devices:${siteId}:${domain}:${minuteBucket}`;
  pipeline.hincrby(siteDevicesKey, device, 1);
  pipeline.hincrby(domainDevicesKey, device, 1);
  pipeline.expire(siteDevicesKey, 120);
  pipeline.expire(domainDevicesKey, 120);

  // Track geo - both levels
  if (data.country) {
    const siteGeoKey = `site-geo:${siteId}:${minuteBucket}`;
    const domainGeoKey = `site-geo:${siteId}:${domain}:${minuteBucket}`;
    pipeline.hincrby(siteGeoKey, data.country, 1);
    pipeline.hincrby(domainGeoKey, data.country, 1);
    pipeline.expire(siteGeoKey, 120);
    pipeline.expire(domainGeoKey, 120);
  }

  // Track active visitors - both site and domain level
  const siteActiveVisitorsKey = `site-active-visitors:${siteId}`;
  const domainActiveVisitorsKey = `site-active-visitors:${siteId}:${domain}`;
  pipeline.pfadd(siteActiveVisitorsKey, data.visitorId);
  pipeline.pfadd(domainActiveVisitorsKey, data.visitorId);
  pipeline.expire(siteActiveVisitorsKey, 300);
  pipeline.expire(domainActiveVisitorsKey, 300);

  // Set TTL on metrics keys
  pipeline.expire(siteMetricsKey, 120);
  pipeline.expire(domainMetricsKey, 120);

  await pipeline.exec();

  // Update unique visitors count (need to do this after sadd to check if new)
  const siteIsNewVisitor = await redis.sismember(siteUniqueKey, data.visitorId);
  const domainIsNewVisitor = await redis.sismember(domainUniqueKey, data.visitorId);
  if (siteIsNewVisitor) {
    await redis.hincrby(siteMetricsKey, "unique_visitors", 1);
  }
  if (domainIsNewVisitor) {
    await redis.hincrby(domainMetricsKey, "unique_visitors", 1);
  }

  // Update response time average for both
  const currentSiteAvg = parseInt(await redis.hget(siteMetricsKey, "avg_response_time_ms") || "0", 10);
  const currentSiteCount = parseInt(await redis.hget(siteMetricsKey, "page_views") || "1", 10);
  const newSiteAvg = Math.round((currentSiteAvg * (currentSiteCount - 1) + data.responseTimeMs) / currentSiteCount);
  await redis.hset(siteMetricsKey, "avg_response_time_ms", newSiteAvg.toString());

  const currentDomainAvg = parseInt(await redis.hget(domainMetricsKey, "avg_response_time_ms") || "0", 10);
  const currentDomainCount = parseInt(await redis.hget(domainMetricsKey, "page_views") || "1", 10);
  const newDomainAvg = Math.round((currentDomainAvg * (currentDomainCount - 1) + data.responseTimeMs) / currentDomainCount);
  await redis.hset(domainMetricsKey, "avg_response_time_ms", newDomainAvg.toString());
}
