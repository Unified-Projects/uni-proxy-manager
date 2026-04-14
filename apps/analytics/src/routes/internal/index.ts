/**
 * Internal analytics API endpoints.
 *
 * Accessed by apps/api via HTTP, authenticated with a shared secret.
 * Queries ClickHouse aggregate tables and returns formatted JSON for
 * the dashboard.
 */

import { Hono } from "hono";
import { internalAuth } from "../../middleware/internal-auth";
import { getClickHouseClient } from "../../clickhouse/client";
import { getConfigById } from "../../services/config-cache";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";

const app = new Hono();

// Apply internal auth to all routes.
app.use("*", internalAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine the appropriate aggregate table based on period duration. */
function getAggTable(startDate: Date, endDate: Date): string {
  const durationMs = endDate.getTime() - startDate.getTime();
  const hours = durationMs / (1000 * 60 * 60);
  if (hours < 24) return "analytics_agg_minute";
  if (hours < 168) return "analytics_agg_hour"; // 7 days
  return "analytics_agg_day";
}

/** Parse and validate common query parameters. */
function parseQueryParams(c: { req: { query: (key: string) => string | undefined } }) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startStr = c.req.query("start");
  const endStr = c.req.query("end");
  const startParsed = startStr ? new Date(startStr) : sevenDaysAgo;
  const endParsed = endStr ? new Date(endStr) : now;
  const start = isNaN(startParsed.getTime()) ? sevenDaysAgo : startParsed;
  const end = isNaN(endParsed.getTime()) ? now : endParsed;
  const limit = Math.min(1000, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

  // Cross-dimensional filters.
  const filters = {
    country: c.req.query("country") || "",
    device: c.req.query("device") || "",
    browser: c.req.query("browser") || "",
    os: c.req.query("os") || "",
    referrer_domain: c.req.query("referrer_domain") || "",
    utm_source: c.req.query("utm_source") || "",
    utm_medium: c.req.query("utm_medium") || "",
    utm_campaign: c.req.query("utm_campaign") || "",
    pathname: c.req.query("pathname") || "",
  };

  return { start, end, limit, filters };
}

/** Check if any cross-dimensional filters are active. */
function hasFilters(filters: Record<string, string>): boolean {
  return Object.values(filters).some((v) => v.length > 0);
}

/** Build WHERE clause fragments for raw events table filtering. */
function buildFilterWhere(filters: Record<string, string>): { clauses: string[]; params: Record<string, string> } {
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (filters.country) { clauses.push("AND country_code = {f_country:String}"); params.f_country = filters.country; }
  if (filters.device) { clauses.push("AND device_type = {f_device:String}"); params.f_device = filters.device; }
  if (filters.browser) { clauses.push("AND browser = {f_browser:String}"); params.f_browser = filters.browser; }
  if (filters.os) { clauses.push("AND os = {f_os:String}"); params.f_os = filters.os; }
  if (filters.referrer_domain) { clauses.push("AND referrer_domain = {f_ref:String}"); params.f_ref = filters.referrer_domain; }
  if (filters.utm_source) { clauses.push("AND utm_source = {f_usrc:String}"); params.f_usrc = filters.utm_source; }
  if (filters.utm_medium) { clauses.push("AND utm_medium = {f_umed:String}"); params.f_umed = filters.utm_medium; }
  if (filters.utm_campaign) { clauses.push("AND utm_campaign = {f_ucam:String}"); params.f_ucam = filters.utm_campaign; }
  if (filters.pathname) { clauses.push("AND pathname LIKE {f_path:String}"); params.f_path = filters.pathname + "%"; }

  return { clauses, params };
}

/** Format a Date to ClickHouse DateTime string. */
function toClickHouseDate(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

/** Sort a map by values descending and take top N. */
function topN<T extends { count: number }>(items: T[], n: number): T[] {
  return items.sort((a, b) => b.count - a.count).slice(0, n);
}

/** Determine the appropriate time bucketing interval for raw event queries. */
function getTimeBucketInterval(startDate: Date, endDate: Date): string {
  const durationMs = endDate.getTime() - startDate.getTime();
  const hours = durationMs / (1000 * 60 * 60);
  if (hours < 24) return "toStartOfMinute(timestamp)";
  if (hours < 168) return "toStartOfHour(timestamp)"; // 7 days
  return "toStartOfDay(timestamp)";
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

app.get("/:configId/summary", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  // Current period.
  const durationMs = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - durationMs);
  const prevEnd = start;
  const retentionDays = config.rawRetentionDays;

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");

    const query = `
      SELECT
        countIf(event_type = 'pageview') AS page_views,
        sumIf(is_unique, event_type = 'pageview') AS unique_visitors,
        uniq(session_id) AS sessions,
        countIf(event_type = 'session_end' AND is_bounce = 1) AS bounces,
        sumIf(session_duration_ms, event_type = 'session_end') AS total_duration,
        countIf(event_type = 'session_end' AND session_duration_ms > 0) AS session_count,
        sumIf(scroll_depth_pct, event_type = 'session_end') AS total_scroll,
        countIf(event_type = 'session_end' AND scroll_depth_pct > 0) AS scroll_count,
        countIf(event_type = 'event') AS custom_events
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: retentionDays, ...params },
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, number>>();
    const r = rows[0] || {};

    const sessions = Number(r.sessions) || 1;
    return c.json({
      summary: {
        pageViews: Number(r.page_views) || 0,
        uniqueVisitors: Number(r.unique_visitors) || 0,
        sessions: Number(r.sessions) || 0,
        bounceRate: sessions > 0 ? Math.round((Number(r.bounces) / sessions) * 1000) / 10 : 0,
        avgSessionDurationMs: Number(r.session_count) > 0 ? Math.round(Number(r.total_duration) / Number(r.session_count)) : 0,
        avgScrollDepthPct: Number(r.scroll_count) > 0 ? Math.round(Number(r.total_scroll) / Number(r.scroll_count)) : 0,
        customEvents: Number(r.custom_events) || 0,
      },
      comparison: null,
    });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);
  const bucketCol = "bucket";

  const currentQuery = `
    SELECT
      sum(page_views) AS page_views,
      sum(unique_visitors) AS unique_visitors,
      uniqMerge(sessions) AS sessions,
      sum(bounces) AS bounces,
      sum(total_session_duration_ms) AS total_duration,
      sum(session_count) AS session_count,
      sum(total_scroll_depth) AS total_scroll,
      sum(scroll_count) AS scroll_count,
      sum(custom_events) AS custom_events,
      sumMap(top_paths) AS paths_map,
      sumMap(top_referrers) AS refs_map
    FROM ${table}
    WHERE analytics_config_id = {configId:String}
      AND ${bucketCol} >= {start:DateTime}
      AND ${bucketCol} <= {end:DateTime}
      AND ${bucketCol} >= now() - INTERVAL {retention:UInt32} DAY
  `;

  const prevQuery = `
    SELECT
      sum(page_views) AS page_views,
      sum(unique_visitors) AS unique_visitors,
      sum(bounces) AS bounces
    FROM ${table}
    WHERE analytics_config_id = {configId:String}
      AND ${bucketCol} >= {prevStart:DateTime}
      AND ${bucketCol} <= {prevEnd:DateTime}
      AND ${bucketCol} >= now() - INTERVAL {retention:UInt32} DAY
  `;

  const [currentResult, prevResult] = await Promise.all([
    client.query({
      query: currentQuery,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: retentionDays },
      format: "JSONEachRow",
    }),
    client.query({
      query: prevQuery,
      query_params: { configId, prevStart: toClickHouseDate(prevStart), prevEnd: toClickHouseDate(prevEnd), retention: retentionDays },
      format: "JSONEachRow",
    }),
  ]);

  const curr = (await currentResult.json<Record<string, unknown>>())[0] || {};
  const prev = (await prevResult.json<Record<string, number>>())[0] || {};

  const sessions = Number(curr.sessions) || 1;
  const prevSessions = Number(prev.sessions) || 1;

  // Extract top page and referrer from maps.
  const pathsMap = (curr.paths_map || {}) as Record<string, number>;
  const refsMap = (curr.refs_map || {}) as Record<string, number>;
  const topPage = Object.entries(pathsMap).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const topReferrer = Object.entries(refsMap).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  const currPv = Number(curr.page_views) || 0;
  const prevPv = Number(prev.page_views) || 0;
  const currUv = Number(curr.unique_visitors) || 0;
  const prevUv = Number(prev.unique_visitors) || 0;
  const currBounceRate = sessions > 0 ? (Number(curr.bounces) / sessions) * 100 : 0;
  const prevBounceRate = prevSessions > 0 ? (Number(prev.bounces) / prevSessions) * 100 : 0;

  return c.json({
    summary: {
      pageViews: currPv,
      uniqueVisitors: currUv,
      sessions: Number(curr.sessions) || 0,
      bounceRate: Math.round(currBounceRate * 10) / 10,
      avgSessionDurationMs: Number(curr.session_count) > 0 ? Math.round(Number(curr.total_duration) / Number(curr.session_count)) : 0,
      avgScrollDepthPct: Number(curr.scroll_count) > 0 ? Math.round(Number(curr.total_scroll) / Number(curr.scroll_count)) : 0,
      customEvents: Number(curr.custom_events) || 0,
      topPage,
      topReferrer,
    },
    comparison: {
      pageViewsChange: prevPv > 0 ? Math.round(((currPv - prevPv) / prevPv) * 1000) / 10 : 0,
      uniqueVisitorsChange: prevUv > 0 ? Math.round(((currUv - prevUv) / prevUv) * 1000) / 10 : 0,
      bounceRateChange: Math.round((currBounceRate - prevBounceRate) * 10) / 10,
    },
  });
});

// ---------------------------------------------------------------------------
// Timeseries
// ---------------------------------------------------------------------------

app.get("/:configId/timeseries", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");
    const bucketExpr = getTimeBucketInterval(start, end);

    const query = `
      SELECT
        ${bucketExpr} AS bucket_start,
        countIf(event_type = 'pageview') AS page_views,
        sumIf(is_unique, event_type = 'pageview') AS unique_visitors,
        uniq(session_id) AS sessions,
        countIf(event_type = 'session_end' AND is_bounce = 1) AS bounces,
        countIf(event_type = 'event') AS custom_events
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, ...params },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();

    return c.json({
      timeseries: rows.map((r) => ({
        bucketStart: r.bucket_start,
        pageViews: Number(r.page_views) || 0,
        uniqueVisitors: Number(r.unique_visitors) || 0,
        sessions: Number(r.sessions) || 0,
        bounces: Number(r.bounces) || 0,
        customEvents: Number(r.custom_events) || 0,
      })),
    });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);

  const query = `
    SELECT
      bucket AS bucket_start,
      sum(page_views) AS page_views,
      sum(unique_visitors) AS unique_visitors,
      uniqMerge(sessions) AS sessions,
      sum(bounces) AS bounces,
      sum(custom_events) AS custom_events
    FROM ${table}
    WHERE analytics_config_id = {configId:String}
      AND bucket >= {start:DateTime}
      AND bucket <= {end:DateTime}
      AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
    format: "JSONEachRow",
  });

  const rows = await result.json<Record<string, unknown>>();

  return c.json({
    timeseries: rows.map((r) => ({
      bucketStart: r.bucket_start,
      pageViews: Number(r.page_views) || 0,
      uniqueVisitors: Number(r.unique_visitors) || 0,
      sessions: Number(r.sessions) || 0,
      bounces: Number(r.bounces) || 0,
      customEvents: Number(r.custom_events) || 0,
    })),
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

app.get("/:configId/pages", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, limit, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");

    const pagesQuery = `
      SELECT
        pathname,
        countIf(event_type = 'pageview') AS pv,
        uniq(session_id) AS unique_visitors,
        avgIf(session_duration_ms, event_type = 'session_end' AND session_duration_ms > 0) AS avg_duration,
        avgIf(scroll_depth_pct, event_type = 'session_end' AND scroll_depth_pct > 0) AS avg_scroll
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY pathname
      ORDER BY pv DESC
      LIMIT {limit:UInt32}
    `;

    const entryQuery = `
      SELECT pathname, count() AS cnt
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND event_type = 'pageview'
        AND is_entry = 1
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY pathname
      ORDER BY cnt DESC
      LIMIT {limit:UInt32}
    `;

    const exitQuery = `
      SELECT pathname, count() AS cnt
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND event_type = 'session_end'
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY pathname
      ORDER BY cnt DESC
      LIMIT {limit:UInt32}
    `;

    const outboundQuery = `
      SELECT
        event_meta['url'] AS destination,
        pathname AS source_page,
        count() AS clicks
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND event_type = 'event'
        AND event_name = 'outbound_click'
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY destination, source_page
      ORDER BY clicks DESC
      LIMIT {limit:UInt32}
    `;

    const queryParams = { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, limit, ...params };

    const [pagesResult, entryResult, exitResult, outboundResult] = await Promise.all([
      client.query({ query: pagesQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: entryQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: exitQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: outboundQuery, query_params: queryParams, format: "JSONEachRow" }),
    ]);

    const pages = await pagesResult.json<{ pathname: string; pv: number; unique_visitors: number; avg_duration: number; avg_scroll: number }>();
    const entries = await entryResult.json<{ pathname: string; cnt: number }>();
    const exits = await exitResult.json<{ pathname: string; cnt: number }>();
    const outbound = await outboundResult.json<{ destination: string; source_page: string; clicks: number }>();

    return c.json({
      pages: pages.map((p) => ({
        pathname: p.pathname,
        pageViews: Number(p.pv) || 0,
        uniqueVisitors: Number(p.unique_visitors) || 0,
        avgDurationMs: Math.round(Number(p.avg_duration) || 0),
        avgScrollDepthPct: Math.round(Number(p.avg_scroll) || 0),
      })),
      entryPages: entries.map((p) => ({ pathname: p.pathname, visitors: Number(p.cnt) || 0, sessions: Number(p.cnt) || 0 })),
      exitPages: exits.map((p) => ({ pathname: p.pathname, visitors: Number(p.cnt) || 0, sessions: Number(p.cnt) || 0 })),
      outboundLinks: outbound.map((o) => ({ destination: o.destination, sourcePage: o.source_page, clicks: Number(o.clicks) || 0 })),
    });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);

  // Top pages from aggregate map.
  const pagesQuery = `
    SELECT pathname, pv
    FROM (
      SELECT sumMap(top_paths) AS m
      FROM ${table}
      WHERE analytics_config_id = {configId:String}
        AND bucket >= {start:DateTime}
        AND bucket <= {end:DateTime}
        AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    )
    ARRAY JOIN mapKeys(m) AS pathname, mapValues(m) AS pv
    ORDER BY pv DESC
    LIMIT {limit:UInt32}
  `;

  // Unique visitors, average duration, and scroll depth per page from raw events table.
  const pageStatsQuery = `
    SELECT
      pathname,
      uniq(session_id) AS unique_visitors,
      avgIf(session_duration_ms, event_type = 'session_end' AND session_duration_ms > 0) AS avg_duration,
      avgIf(scroll_depth_pct, event_type = 'session_end' AND scroll_depth_pct > 0) AS avg_scroll
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY pathname
  `;

  // Entry pages.
  const entryQuery = `
    SELECT pathname, cnt
    FROM (
      SELECT sumMap(entry_pages) AS m
      FROM ${table}
      WHERE analytics_config_id = {configId:String}
        AND bucket >= {start:DateTime}
        AND bucket <= {end:DateTime}
        AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    )
    ARRAY JOIN mapKeys(m) AS pathname, mapValues(m) AS cnt
    WHERE pathname != ''
    ORDER BY cnt DESC
    LIMIT {limit:UInt32}
  `;

  // Exit pages.
  const exitQuery = `
    SELECT pathname, cnt
    FROM (
      SELECT sumMap(exit_pages) AS m
      FROM ${table}
      WHERE analytics_config_id = {configId:String}
        AND bucket >= {start:DateTime}
        AND bucket <= {end:DateTime}
        AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    )
    ARRAY JOIN mapKeys(m) AS pathname, mapValues(m) AS cnt
    WHERE pathname != ''
    ORDER BY cnt DESC
    LIMIT {limit:UInt32}
  `;

  // Outbound links from raw events table.
  const outboundQuery = `
    SELECT
      event_meta['url'] AS destination,
      pathname AS source_page,
      count() AS clicks
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND event_type = 'event'
      AND event_name = 'outbound_click'
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY destination, source_page
    ORDER BY clicks DESC
    LIMIT {limit:UInt32}
  `;

  const aggParams = { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays, limit };
  const rawParams = { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, limit };

  const [pagesResult, pageStatsResult, entryResult, exitResult, outboundResult] = await Promise.all([
    client.query({ query: pagesQuery, query_params: aggParams, format: "JSONEachRow" }),
    client.query({ query: pageStatsQuery, query_params: rawParams, format: "JSONEachRow" }),
    client.query({ query: entryQuery, query_params: aggParams, format: "JSONEachRow" }),
    client.query({ query: exitQuery, query_params: aggParams, format: "JSONEachRow" }),
    client.query({ query: outboundQuery, query_params: rawParams, format: "JSONEachRow" }),
  ]);

  const pages = await pagesResult.json<{ pathname: string; pv: number }>();
  const pageStats = await pageStatsResult.json<{ pathname: string; unique_visitors: number; avg_duration: number; avg_scroll: number }>();
  const entries = await entryResult.json<{ pathname: string; cnt: number }>();
  const exits = await exitResult.json<{ pathname: string; cnt: number }>();
  const outbound = await outboundResult.json<{ destination: string; source_page: string; clicks: number }>();

  // Build a lookup map for page-level stats (unique visitors, avg duration, scroll depth).
  const statsMap = new Map<string, { uniqueVisitors: number; avgDurationMs: number; avgScrollDepthPct: number }>();
  for (const ps of pageStats) {
    statsMap.set(ps.pathname, {
      uniqueVisitors: Number(ps.unique_visitors) || 0,
      avgDurationMs: Math.round(Number(ps.avg_duration) || 0),
      avgScrollDepthPct: Math.round(Number(ps.avg_scroll) || 0),
    });
  }

  return c.json({
    pages: pages.map((p) => {
      const stats = statsMap.get(p.pathname);
      return {
        pathname: p.pathname,
        pageViews: Number(p.pv) || 0,
        uniqueVisitors: stats?.uniqueVisitors ?? 0,
        avgDurationMs: stats?.avgDurationMs ?? 0,
        avgScrollDepthPct: stats?.avgScrollDepthPct ?? 0,
      };
    }),
    entryPages: entries.map((p) => ({ pathname: p.pathname, visitors: Number(p.cnt) || 0, sessions: Number(p.cnt) || 0 })),
    exitPages: exits.map((p) => ({ pathname: p.pathname, visitors: Number(p.cnt) || 0, sessions: Number(p.cnt) || 0 })),
    outboundLinks: outbound.map((o) => ({ destination: o.destination, sourcePage: o.source_page, clicks: Number(o.clicks) || 0 })),
  });
});

// ---------------------------------------------------------------------------
// Referrers
// ---------------------------------------------------------------------------

app.get("/:configId/referrers", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, limit, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");

    const query = `
      SELECT
        referrer_domain AS domain,
        uniq(session_id) AS visitors,
        countIf(event_type = 'pageview') AS page_views
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        AND referrer_domain != ''
        ${filterWhere}
      GROUP BY referrer_domain
      ORDER BY visitors DESC
      LIMIT {limit:UInt32}
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, limit, ...params },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ domain: string; visitors: number; page_views: number }>();

    return c.json({
      referrers: rows.map((r) => ({ domain: r.domain, visitors: Number(r.visitors) || 0, pageViews: Number(r.page_views) || 0 })),
    });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);

  const query = `
    SELECT domain, cnt
    FROM (
      SELECT sumMap(top_referrers) AS m
      FROM ${table}
      WHERE analytics_config_id = {configId:String}
        AND bucket >= {start:DateTime}
        AND bucket <= {end:DateTime}
        AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    )
    ARRAY JOIN mapKeys(m) AS domain, mapValues(m) AS cnt
    ORDER BY cnt DESC
    LIMIT {limit:UInt32}
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays, limit },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ domain: string; cnt: number }>();

  return c.json({
    referrers: rows.map((r) => ({ domain: r.domain, visitors: Number(r.cnt) || 0, pageViews: Number(r.cnt) || 0 })),
  });
});

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

app.get("/:configId/geography", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");

    const query = `
      SELECT
        country_code,
        uniq(session_id) AS visitors,
        countIf(event_type = 'pageview') AS page_views
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY country_code
      ORDER BY visitors DESC
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, ...params },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ country_code: string; visitors: number; page_views: number }>();

    return c.json({
      countries: rows.map((r) => ({ countryCode: r.country_code, visitors: Number(r.visitors) || 0, pageViews: Number(r.page_views) || 0 })),
    });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);

  const query = `
    SELECT country_code, cnt
    FROM (
      SELECT sumMap(geo_data) AS m
      FROM ${table}
      WHERE analytics_config_id = {configId:String}
        AND bucket >= {start:DateTime}
        AND bucket <= {end:DateTime}
        AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    )
    ARRAY JOIN mapKeys(m) AS country_code, mapValues(m) AS cnt
    ORDER BY cnt DESC
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ country_code: string; cnt: number }>();

  return c.json({
    countries: rows.map((r) => ({ countryCode: r.country_code, visitors: Number(r.cnt) || 0, pageViews: Number(r.cnt) || 0 })),
  });
});

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

app.get("/:configId/devices", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");

    const devicesQuery = `
      SELECT device_type, count() AS cnt
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND event_type = 'pageview'
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY device_type
    `;

    const browsersQuery = `
      SELECT browser AS name, count() AS cnt
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND event_type = 'pageview'
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY browser
      ORDER BY cnt DESC
    `;

    const osQuery = `
      SELECT os AS name, count() AS cnt
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND event_type = 'pageview'
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        ${filterWhere}
      GROUP BY os
      ORDER BY cnt DESC
    `;

    const queryParams = { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, ...params };

    const [devicesResult, browsersResult, osResult] = await Promise.all([
      client.query({ query: devicesQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: browsersQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: osQuery, query_params: queryParams, format: "JSONEachRow" }),
    ]);

    const devicesRows = await devicesResult.json<{ device_type: string; cnt: number }>();
    const browsersRows = await browsersResult.json<{ name: string; cnt: number }>();
    const osRows = await osResult.json<{ name: string; cnt: number }>();

    // Build devices breakdown from raw rows.
    const devicesMap: Record<string, number> = {};
    for (const row of devicesRows) {
      devicesMap[row.device_type] = Number(row.cnt) || 0;
    }

    return c.json({
      devices: {
        desktop: devicesMap["desktop"] || 0,
        mobile: devicesMap["mobile"] || 0,
        tablet: devicesMap["tablet"] || 0,
        other: devicesMap["other"] || 0,
      },
      browsers: browsersRows.map((r) => ({ name: r.name, count: Number(r.cnt) || 0 })),
      os: osRows.map((r) => ({ name: r.name, count: Number(r.cnt) || 0 })),
    });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);

  const query = `
    SELECT
      sumMap(devices) AS devices_map,
      sumMap(browsers) AS browsers_map,
      sumMap(os_data) AS os_map
    FROM ${table}
    WHERE analytics_config_id = {configId:String}
      AND bucket >= {start:DateTime}
      AND bucket <= {end:DateTime}
      AND bucket >= now() - INTERVAL {retention:UInt32} DAY
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
    format: "JSONEachRow",
  });

  const rows = await result.json<Record<string, unknown>>();
  const r = rows[0] || {};

  const devicesMap = (r.devices_map || {}) as Record<string, number>;
  const browsersMap = (r.browsers_map || {}) as Record<string, number>;
  const osMap = (r.os_map || {}) as Record<string, number>;

  return c.json({
    devices: {
      desktop: Number(devicesMap["desktop"]) || 0,
      mobile: Number(devicesMap["mobile"]) || 0,
      tablet: Number(devicesMap["tablet"]) || 0,
      other: Number(devicesMap["other"]) || 0,
    },
    browsers: Object.entries(browsersMap)
      .map(([name, count]) => ({ name, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count),
    os: Object.entries(osMap)
      .map(([name, count]) => ({ name, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count),
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

app.get("/:configId/events", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, limit } = parseQueryParams(c);
  const client = getClickHouseClient();

  const query = `
    SELECT
      event_name AS name,
      count() AS count,
      uniq(session_id) AS unique_visitors
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND event_type = 'event'
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY event_name
    ORDER BY count DESC
    LIMIT {limit:UInt32}
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, limit },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ name: string; count: number; unique_visitors: number }>();

  return c.json({
    events: rows.map((r) => ({ name: r.name, count: Number(r.count) || 0, uniqueVisitors: Number(r.unique_visitors) || 0 })),
  });
});

// Detailed event endpoint.
app.get("/:configId/events/:eventName", async (c) => {
  const configId = c.req.param("configId");
  const eventName = c.req.param("eventName");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end } = parseQueryParams(c);
  const client = getClickHouseClient();

  // Summary.
  const summaryQuery = `
    SELECT count() AS total_count, uniq(session_id) AS unique_visitors
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND event_type = 'event'
      AND event_name = {eventName:String}
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
  `;

  // Metadata breakdown.
  const metaQuery = `
    SELECT meta_key, meta_value, count() AS cnt
    FROM analytics_events
    ARRAY JOIN mapKeys(event_meta) AS meta_key, mapValues(event_meta) AS meta_value
    WHERE analytics_config_id = {configId:String}
      AND event_type = 'event'
      AND event_name = {eventName:String}
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY meta_key, meta_value
    ORDER BY cnt DESC
    LIMIT 100
  `;

  // Top pages.
  const pagesQuery = `
    SELECT pathname, count() AS cnt
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND event_type = 'event'
      AND event_name = {eventName:String}
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY pathname
    ORDER BY cnt DESC
    LIMIT 20
  `;

  // Timeseries for this specific event.
  const bucketExpr = getTimeBucketInterval(start, end);
  const timeseriesQuery = `
    SELECT
      ${bucketExpr} AS bucket_start,
      count() AS count
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND event_type = 'event'
      AND event_name = {eventName:String}
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    GROUP BY bucket_start
    ORDER BY bucket_start ASC
  `;

  const params = { configId, eventName, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays };

  const [summaryResult, metaResult, pagesResult, timeseriesResult] = await Promise.all([
    client.query({ query: summaryQuery, query_params: params, format: "JSONEachRow" }),
    client.query({ query: metaQuery, query_params: params, format: "JSONEachRow" }),
    client.query({ query: pagesQuery, query_params: params, format: "JSONEachRow" }),
    client.query({ query: timeseriesQuery, query_params: params, format: "JSONEachRow" }),
  ]);

  const summary = (await summaryResult.json<Record<string, number>>())[0] || {};
  const meta = await metaResult.json<{ meta_key: string; meta_value: string; cnt: number }>();
  const pages = await pagesResult.json<{ pathname: string; cnt: number }>();
  const timeseries = await timeseriesResult.json<{ bucket_start: string; count: number }>();

  return c.json({
    eventName,
    totalCount: Number(summary.total_count) || 0,
    uniqueVisitors: Number(summary.unique_visitors) || 0,
    metadata: meta.map((m) => ({ key: m.meta_key, value: m.meta_value, count: Number(m.cnt) || 0 })),
    topPages: pages.map((p) => ({ pathname: p.pathname, count: Number(p.cnt) || 0 })),
    timeseries: timeseries.map((t) => ({ bucketStart: t.bucket_start, count: Number(t.count) || 0 })),
  });
});

// ---------------------------------------------------------------------------
// UTM
// ---------------------------------------------------------------------------

app.get("/:configId/utm", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end, filters } = parseQueryParams(c);
  const client = getClickHouseClient();

  if (hasFilters(filters)) {
    // Filtered query against raw events table.
    const { clauses, params } = buildFilterWhere(filters);
    const filterWhere = clauses.join(" ");

    const sourcesQuery = `
      SELECT utm_source AS source, uniq(session_id) AS visitors, countIf(event_type = 'pageview') AS page_views
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        AND utm_source != '' AND utm_source != '(none)'
        ${filterWhere}
      GROUP BY utm_source
      ORDER BY visitors DESC
    `;

    const mediumsQuery = `
      SELECT utm_medium AS medium, uniq(session_id) AS visitors
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        AND utm_medium != '' AND utm_medium != '(none)'
        ${filterWhere}
      GROUP BY utm_medium
      ORDER BY visitors DESC
    `;

    const campaignsQuery = `
      SELECT utm_campaign AS campaign, uniq(session_id) AS visitors, countIf(event_type = 'pageview') AS page_views
      FROM analytics_events
      WHERE analytics_config_id = {configId:String}
        AND timestamp >= {start:DateTime}
        AND timestamp <= {end:DateTime}
        AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
        AND utm_campaign != '' AND utm_campaign != '(none)'
        ${filterWhere}
      GROUP BY utm_campaign
      ORDER BY visitors DESC
    `;

    const queryParams = { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays, ...params };

    const [sourcesResult, mediumsResult, campaignsResult] = await Promise.all([
      client.query({ query: sourcesQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: mediumsQuery, query_params: queryParams, format: "JSONEachRow" }),
      client.query({ query: campaignsQuery, query_params: queryParams, format: "JSONEachRow" }),
    ]);

    const sourcesRows = await sourcesResult.json<{ source: string; visitors: number; page_views: number }>();
    const mediumsRows = await mediumsResult.json<{ medium: string; visitors: number }>();
    const campaignsRows = await campaignsResult.json<{ campaign: string; visitors: number; page_views: number }>();

    const sources = sourcesRows.map((r) => ({ source: r.source, visitors: Number(r.visitors) || 0, pageViews: Number(r.page_views) || 0 }));

    const totalMediumVisitors = mediumsRows.reduce((sum, r) => sum + (Number(r.visitors) || 0), 0);
    const mediums = mediumsRows.map((r) => ({
      medium: r.medium,
      visitors: Number(r.visitors) || 0,
      percentage: totalMediumVisitors > 0 ? Math.round((Number(r.visitors) / totalMediumVisitors) * 1000) / 10 : 0,
    }));

    const campaigns = campaignsRows.map((r) => ({ campaign: r.campaign, visitors: Number(r.visitors) || 0, pageViews: Number(r.page_views) || 0 }));

    return c.json({ sources, mediums, campaigns });
  }

  // Unfiltered query against aggregate table.
  const table = getAggTable(start, end);

  const query = `
    SELECT
      sumMap(utm_sources) AS sources_map,
      sumMap(utm_mediums) AS mediums_map,
      sumMap(utm_campaigns) AS campaigns_map
    FROM ${table}
    WHERE analytics_config_id = {configId:String}
      AND bucket >= {start:DateTime}
      AND bucket <= {end:DateTime}
      AND bucket >= now() - INTERVAL {retention:UInt32} DAY
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
    format: "JSONEachRow",
  });

  const rows = await result.json<Record<string, unknown>>();
  const r = rows[0] || {};

  const sourcesMap = (r.sources_map || {}) as Record<string, number>;
  const mediumsMap = (r.mediums_map || {}) as Record<string, number>;
  const campaignsMap = (r.campaigns_map || {}) as Record<string, number>;

  // Filter out "(none)" entries.
  const filterNone = (entries: [string, number][]) => entries.filter(([k]) => k !== "(none)");

  const sources = filterNone(Object.entries(sourcesMap))
    .map(([source, count]) => ({ source, visitors: Number(count) || 0, pageViews: Number(count) || 0 }))
    .sort((a, b) => b.visitors - a.visitors);

  const totalMediumVisitors = filterNone(Object.entries(mediumsMap)).reduce((sum, [, c]) => sum + Number(c), 0);
  const mediums = filterNone(Object.entries(mediumsMap))
    .map(([medium, count]) => ({
      medium,
      visitors: Number(count) || 0,
      percentage: totalMediumVisitors > 0 ? Math.round((Number(count) / totalMediumVisitors) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.visitors - a.visitors);

  const campaigns = filterNone(Object.entries(campaignsMap))
    .map(([campaign, count]) => ({ campaign, visitors: Number(count) || 0, pageViews: Number(count) || 0 }))
    .sort((a, b) => b.visitors - a.visitors);

  return c.json({ sources, mediums, campaigns });
});

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function emptyLiveSnapshot() {
  return {
    activeVisitors: 0,
    activePages: [] as { pathname: string; visitors: number }[],
    recentEvents: [] as unknown[],
  };
}

app.get("/:configId/live", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const redis = getRedisClient();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fiveMinAgo = nowSeconds - 5 * 60;

  const activeKey = `analytics:active:${configId}`;
  const activePagesKey = `analytics:active_pages:${configId}`;
  const recentEventsKey = `analytics:recent_events:${configId}`;

  let activeVisitors: number;
  let activePagesRaw: string[];
  let recentEventsRaw: string[];

  try {
    // Run all three Redis queries in parallel.
    [activeVisitors, activePagesRaw, recentEventsRaw] = await Promise.all([
      // 1. Active visitor count from sorted set (score = timestamp).
      redis.zcount(activeKey, fiveMinAgo, "+inf"),
      // 2. Active pages in the last 5 minutes (value = pathname, score = timestamp).
      redis.zrangebyscore(activePagesKey, fiveMinAgo, nowSeconds),
      // 3. Recent events stored as JSON strings in a list.
      redis.lrange(recentEventsKey, 0, 49),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Analytics] Live snapshot unavailable | configId=${configId} | error=${message}`);
    return c.json(emptyLiveSnapshot());
  }

  // Aggregate active pages by pathname and count occurrences.
  const pageCounts = new Map<string, number>();
  for (const entry of activePagesRaw) {
    const colonIdx = entry.indexOf(":");
    const pathname = colonIdx >= 0 ? entry.substring(colonIdx + 1) : entry;
    pageCounts.set(pathname, (pageCounts.get(pathname) || 0) + 1);
  }
  const activePages = Array.from(pageCounts.entries())
    .map(([pathname, visitors]) => ({ pathname, visitors }))
    .sort((a, b) => b.visitors - a.visitors);

  // Parse recent events from JSON strings, skipping any malformed entries.
  const recentEvents: unknown[] = [];
  for (const raw of recentEventsRaw) {
    try {
      recentEvents.push(JSON.parse(raw));
    } catch {
      // Skip malformed entries.
    }
  }

  return c.json({
    activeVisitors,
    activePages,
    recentEvents,
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

app.get("/:configId/export", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  const { start, end } = parseQueryParams(c);
  const format = c.req.query("format") || "json";
  const type = c.req.query("type") || "raw";
  const client = getClickHouseClient();

  /** Escape CSV formula injection. */
  const escapeCSV = (val: string): string => {
    const str = String(val);
    const dangerous = ["=", "+", "-", "@", "\t", "\r"];
    if (dangerous.some((ch) => str.startsWith(ch)) || str.startsWith("0x")) {
      return `"'${str.replace(/"/g, '""')}"`;
    }
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  /** Format rows as CSV text response. */
  const toCSV = (headers: string[], rows: Record<string, unknown>[]): Response => {
    const csvLines = [headers.join(",")];
    for (const row of rows) {
      csvLines.push(headers.map((h) => escapeCSV(String(row[h] ?? ""))).join(","));
    }
    return c.text(csvLines.join("\n"), 200, {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="analytics-export-${configId}-${type}.csv"`,
    });
  };

  if (type === "summary") {
    // Aggregated summary data.
    const table = getAggTable(start, end);
    const query = `
      SELECT
        sum(page_views) AS page_views,
        sum(unique_visitors) AS unique_visitors,
        uniqMerge(sessions) AS sessions,
        sum(bounces) AS bounces,
        sum(total_session_duration_ms) AS total_duration,
        sum(session_count) AS session_count,
        sum(custom_events) AS custom_events
      FROM ${table}
      WHERE analytics_config_id = {configId:String}
        AND bucket >= {start:DateTime}
        AND bucket <= {end:DateTime}
        AND bucket >= now() - INTERVAL {retention:UInt32} DAY
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const r = rows[0] || {};
    const sessions = Number(r.sessions) || 1;
    const summaryData = [{
      page_views: Number(r.page_views) || 0,
      unique_visitors: Number(r.unique_visitors) || 0,
      sessions: Number(r.sessions) || 0,
      bounce_rate: sessions > 0 ? Math.round(((Number(r.bounces) || 0) / sessions) * 1000) / 10 : 0,
      avg_session_duration_ms: Number(r.session_count) > 0 ? Math.round(Number(r.total_duration) / Number(r.session_count)) : 0,
      custom_events: Number(r.custom_events) || 0,
    }];

    if (format === "csv") {
      return toCSV(["page_views", "unique_visitors", "sessions", "bounce_rate", "avg_session_duration_ms", "custom_events"], summaryData);
    }
    return c.json({ data: summaryData });
  }

  if (type === "pages") {
    // Top pages data.
    const table = getAggTable(start, end);
    const query = `
      SELECT pathname, page_views
      FROM (
        SELECT sumMap(top_paths) AS m
        FROM ${table}
        WHERE analytics_config_id = {configId:String}
          AND bucket >= {start:DateTime}
          AND bucket <= {end:DateTime}
          AND bucket >= now() - INTERVAL {retention:UInt32} DAY
      )
      ARRAY JOIN mapKeys(m) AS pathname, mapValues(m) AS page_views
      ORDER BY page_views DESC
      LIMIT 10000
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();

    if (format === "csv") {
      return toCSV(["pathname", "page_views"], rows);
    }
    return c.json({ data: rows });
  }

  if (type === "referrers") {
    // Referrer data.
    const table = getAggTable(start, end);
    const query = `
      SELECT domain, visitors
      FROM (
        SELECT sumMap(top_referrers) AS m
        FROM ${table}
        WHERE analytics_config_id = {configId:String}
          AND bucket >= {start:DateTime}
          AND bucket <= {end:DateTime}
          AND bucket >= now() - INTERVAL {retention:UInt32} DAY
      )
      ARRAY JOIN mapKeys(m) AS domain, mapValues(m) AS visitors
      ORDER BY visitors DESC
      LIMIT 10000
    `;

    const result = await client.query({
      query,
      query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.aggregateRetentionDays },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();

    if (format === "csv") {
      return toCSV(["domain", "visitors"], rows);
    }
    return c.json({ data: rows });
  }

  // Default: type=raw -- raw events export.
  const query = `
    SELECT
      timestamp,
      event_type,
      event_name,
      pathname,
      referrer_domain,
      country_code,
      browser,
      os,
      device_type,
      is_unique,
      session_duration_ms,
      scroll_depth_pct,
      utm_source,
      utm_medium,
      utm_campaign
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND timestamp >= {start:DateTime}
      AND timestamp <= {end:DateTime}
      AND timestamp >= now() - INTERVAL {retention:UInt32} DAY
    ORDER BY timestamp DESC
    LIMIT 100000
  `;

  const result = await client.query({
    query,
    query_params: { configId, start: toClickHouseDate(start), end: toClickHouseDate(end), retention: config.rawRetentionDays },
    format: "JSONEachRow",
  });

  const rows = await result.json<Record<string, unknown>>();

  if (format === "csv") {
    const headers = ["timestamp", "event_type", "event_name", "pathname", "referrer_domain", "country_code", "browser", "os", "device_type", "is_unique", "session_duration_ms", "scroll_depth_pct", "utm_source", "utm_medium", "utm_campaign"];
    return toCSV(headers, rows);
  }

  return c.json({ data: rows });
});

// ---------------------------------------------------------------------------
// Data Deletion
// ---------------------------------------------------------------------------

app.delete("/:configId/data", async (c) => {
  const configId = c.req.param("configId");
  const config = getConfigById(configId);
  if (!config) return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);

  // Rate limit: 1 deletion request per hour per config.
  const redis = getRedisClient();
  const rateLimitKey = `rl:delete:${configId}`;
  const existing = await redis.exists(rateLimitKey);
  if (existing) {
    const ttl = await redis.ttl(rateLimitKey);
    return c.json({
      error: {
        code: "RATE_LIMITED",
        message: "Data deletion is limited to 1 request per hour per configuration.",
        retryAfterSeconds: ttl > 0 ? ttl : 3600,
      },
    }, 429);
  }

  // Set the rate limit key with a 1-hour TTL before proceeding.
  await redis.set(rateLimitKey, "1", "EX", 3600);

  const client = getClickHouseClient();

  // Queue async deletion mutations.
  const tables = ["analytics_events", "analytics_agg_minute", "analytics_agg_hour", "analytics_agg_day"];

  const requestedBy = c.req.header("X-Requested-By") || "unknown";
  console.log(
    `[Analytics] Data deletion requested | configId=${configId} | requestedBy=${requestedBy} | timestamp=${new Date().toISOString()}`,
  );

  for (const table of tables) {
    try {
      await client.command({
        query: `ALTER TABLE ${table} DELETE WHERE analytics_config_id = {configId:String}`,
        query_params: { configId },
      });
      console.log(`[Analytics] Data deletion queued | table=${table} | configId=${configId}`);
    } catch (error) {
      console.error(`[Analytics] Failed to delete data from ${table} | configId=${configId}:`, error instanceof Error ? error.message : error);
    }
  }

  return c.json({ message: "Data deletion queued" }, 202);
});

export default app;
