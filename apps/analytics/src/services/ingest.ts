// Event ingestion -- writes to ClickHouse and pushes to Redis for live updates.
// Fire-and-forget so HTTP responses return immediately.

import { getClickHouseClient } from "../clickhouse/client";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

export interface IngestEventPayload {
  configId: string;
  eventType: "pageview" | "event" | "session_end";
  eventName?: string;
  eventMeta?: Record<string, string>;
  pathname: string;
  referrer: string;
  referrerDomain: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  isUnique: boolean;
  sessionId: string;
  isBounce: boolean;
  isEntry: boolean;
  isExit: boolean;
  browser: string;
  browserVersion: string;
  os: string;
  deviceType: string;
  screenWidth: number;
  screenHeight: number;
  countryCode: string;
  timezone: string;
  sessionDurationMs: number;
  scrollDepthPct: number;
  source: string;
}

/** How long (in seconds) active-visitor entries are kept in Redis. */
const ACTIVE_WINDOW_SECONDS = 5 * 60;

/** Ingest a single event. Not awaited -- runs in the background. */
export function ingestEvent(payload: IngestEventPayload): void {
  // Fire-and-forget -- errors are logged but never propagated.
  processEvent(payload).catch((err) => {
    console.error("[Analytics] Ingestion error:", err);
  });
}

async function processEvent(payload: IngestEventPayload): Promise<void> {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);

  // ------------------------------------------------------------------
  // 1. Write to ClickHouse (async insert -- the client is configured
  //    with async_insert = 1 and wait_for_async_insert = 0).
  // ------------------------------------------------------------------
  const clickhouseWrite = writeToClickHouse(payload);

  // ------------------------------------------------------------------
  // 2. Publish to Redis for live features.
  // ------------------------------------------------------------------
  const redisUpdates = updateRedis(payload, now, nowSeconds);

  // Await both in parallel so we capture any errors.
  await Promise.all([clickhouseWrite, redisUpdates]);
}

async function writeToClickHouse(payload: IngestEventPayload): Promise<void> {
  try {
    const client = getClickHouseClient();

    await client.insert({
      table: "analytics_events",
      values: [
        {
          analytics_config_id: payload.configId,
          event_type: payload.eventType,
          event_name: payload.eventName ?? "",
          event_meta: payload.eventMeta ?? {},
          pathname: payload.pathname,
          referrer: payload.referrer,
          referrer_domain: payload.referrerDomain,
          utm_source: payload.utmSource,
          utm_medium: payload.utmMedium,
          utm_campaign: payload.utmCampaign,
          utm_term: payload.utmTerm,
          utm_content: payload.utmContent,
          is_unique: payload.isUnique ? 1 : 0,
          session_id: payload.sessionId,
          is_bounce: payload.isBounce ? 1 : 0,
          is_entry: payload.isEntry ? 1 : 0,
          is_exit: payload.isExit ? 1 : 0,
          browser: payload.browser,
          browser_version: payload.browserVersion,
          os: payload.os,
          device_type: payload.deviceType,
          screen_width: payload.screenWidth,
          screen_height: payload.screenHeight,
          country_code: payload.countryCode,
          tz: payload.timezone,
          session_duration_ms: payload.sessionDurationMs,
          scroll_depth_pct: payload.scrollDepthPct,
          source: payload.source,
        },
      ],
      format: "JSONEachRow",
    });
  } catch (err) {
    console.error("[Analytics] ClickHouse insert error:", err);
  }
}

async function updateRedis(
  payload: IngestEventPayload,
  nowMs: number,
  nowSeconds: number,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const cutoff = nowSeconds - ACTIVE_WINDOW_SECONDS;

    // Sanitise sessionId for use in Redis keys (alphanumeric, hyphens, underscores only, max 128 chars).
    const safeSessionId = payload.sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);

    // Publish the event to the live channel for WebSocket broadcast.
    const liveChannel = `analytics:live:${payload.configId}`;
    const livePayload = JSON.stringify({
      eventType: payload.eventType,
      eventName: payload.eventName,
      pathname: payload.pathname,
      referrer: payload.referrer,
      referrerDomain: payload.referrerDomain,
      browser: payload.browser,
      os: payload.os,
      deviceType: payload.deviceType,
      countryCode: payload.countryCode,
      isUnique: payload.isUnique,
      timestamp: nowMs,
    });

    // Use a pipeline to batch the Redis commands.
    const pipeline = redis.pipeline();

    // Publish event for live WebSocket consumers.
    pipeline.publish(liveChannel, livePayload);

    // Store in recent events list for the /live REST endpoint.
    const recentEventsKey = `analytics:recent_events:${payload.configId}`;
    pipeline.lpush(recentEventsKey, livePayload);
    pipeline.ltrim(recentEventsKey, 0, 49);

    // Track active visitors in a sorted set (score = unix timestamp).
    const activeKey = `analytics:active:${payload.configId}`;
    pipeline.zadd(activeKey, nowSeconds.toString(), safeSessionId);
    pipeline.zremrangebyscore(activeKey, "-inf", cutoff.toString());

    // Track active pages in a secondary sorted set.
    const activePagesKey = `analytics:active_pages:${payload.configId}`;
    pipeline.zadd(activePagesKey, nowSeconds.toString(), `${safeSessionId}:${payload.pathname}`);
    pipeline.zremrangebyscore(activePagesKey, "-inf", cutoff.toString());

    await pipeline.exec();
  } catch (err) {
    console.error("[Analytics] Redis update error:", err);
  }
}
