# 02 - Database Schema

Analytics uses a **dual storage** model:

- **PostgreSQL** (via Drizzle ORM): Configuration, funnel definitions, public dashboard settings. These are small, relational tables that follow the existing extension pattern.
- **ClickHouse**: Raw events, aggregated metrics. High-volume, time-series data stored in columnar format with automatic aggregation via Materialised Views and automatic retention via TTL.

---

## PostgreSQL Tables (Drizzle ORM)

**File**: `packages/database/src/schema/analytics.ts`

**Export from**: `packages/database/src/schema/index.ts` (add `export * from "./analytics";`)

### `analytics_config`

Per-domain analytics configuration. Created when a domain owner enables analytics.

```typescript
export const analyticsConfig = pgTable("analytics_config", {
  id: text("id").primaryKey(),                          // nanoid
  domainId: text("domain_id").notNull().unique()
    .references(() => domains.id, { onDelete: "cascade" }),

  // UUID for the /_upm/{uuid}/ route
  trackingUuid: text("tracking_uuid").notNull().unique(),

  // Toggle
  enabled: boolean("enabled").notNull().default(true),

  // Optional API token for server-side event submission
  apiTokenHash: text("api_token_hash"),           // bcrypt hash (for generation/rotation)
  apiTokenSha256: text("api_token_sha256"),       // SHA-256 hash (for fast per-request validation)

  // Retention settings (days) -- applied as ClickHouse TTL
  rawRetentionDays: integer("raw_retention_days").notNull().default(90),
  aggregateRetentionDays: integer("aggregate_retention_days").notNull().default(365),

  // Breakdown cardinality cap (max entries in Map fields per aggregate row)
  maxBreakdownEntries: integer("max_breakdown_entries").notNull().default(100),
  // Global maximum enforced regardless of per-domain setting: 500

  // Public dashboard
  publicDashboardEnabled: boolean("public_dashboard_enabled").notNull().default(false),
  publicDashboardToken: text("public_dashboard_token"),  // random 32-byte base64url token
  publicDashboardPasswordHash: text("public_dashboard_password_hash"), // bcrypt hash, null = no password

  // Settings
  trackScrollDepth: boolean("track_scroll_depth").notNull().default(true),
  trackSessionDuration: boolean("track_session_duration").notNull().default(true),
  trackOutboundLinks: boolean("track_outbound_links").notNull().default(true),
  ignoredPaths: jsonb("ignored_paths").$type<string[]>().default([]),  // glob patterns to exclude
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().default([]),  // extra CORS origins

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  trackingUuidIdx: uniqueIndex("analytics_config_tracking_uuid_idx").on(table.trackingUuid),
  domainIdIdx: uniqueIndex("analytics_config_domain_id_idx").on(table.domainId),
}));
```

**Schema Changes Applied**:
- **Removed** `currentDailySalt` and `saltRotatedAt` columns -- no longer needed (no salt rotation, no visitor hash)

### `analytics_funnels`

Funnel definitions for conversion tracking. Stored in PostgreSQL because they are relational config data, not high-volume.

```typescript
export const analyticsFunnels = pgTable("analytics_funnels", {
  id: text("id").primaryKey(),                          // nanoid
  analyticsConfigId: text("analytics_config_id").notNull()
    .references(() => analyticsConfig.id, { onDelete: "cascade" }),

  name: text("name").notNull(),
  description: text("description"),

  // Ordered array of funnel steps
  steps: jsonb("steps").$type<AnalyticsFunnelStep[]>().notNull(),

  // Time window between consecutive steps (milliseconds)
  // Each step must occur within windowMs of the previous step
  windowMs: bigint("window_ms", { mode: "number" }).notNull().default(86400000), // 24h default

  enabled: boolean("enabled").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  configIdx: index("analytics_funnels_config_idx").on(table.analyticsConfigId),
  uniqueNamePerConfig: uniqueIndex("analytics_funnels_name_config_idx").on(
    table.analyticsConfigId,
    table.name,
  ),
}));

// TypeScript interface for funnel steps
export interface AnalyticsFunnelStep {
  name: string;                          // Display name, e.g. "View pricing"
  type: "pageview" | "event";            // Match type
  // For pageview: match against pathname (supports glob patterns)
  pathPattern?: string;                  // e.g. "/pricing", "/signup/*"
  // For event: match against event name
  eventName?: string;                    // e.g. "signup_click"
  // Optional metadata match (for events)
  eventMetaMatch?: Record<string, string | number | boolean>;
}
```

### `analytics_funnel_results`

Cached funnel computation results (recomputed periodically by BullMQ worker).

```typescript
export const analyticsFunnelResults = pgTable("analytics_funnel_results", {
  id: text("id").primaryKey(),
  funnelId: text("funnel_id").notNull()
    .references(() => analyticsFunnels.id, { onDelete: "cascade" }),

  // Period this result covers
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),

  // Per-step counts (ordered array matching funnel steps)
  stepCounts: jsonb("step_counts").$type<number[]>().notNull(),

  // Per-step conversion rates (percentage, ordered)
  stepConversionRates: jsonb("step_conversion_rates").$type<number[]>().notNull(),

  // Overall conversion rate (first step to last, percentage with 1 decimal)
  overallConversionRate: real("overall_conversion_rate").notNull().default(0),

  // Total visitors who entered the funnel
  totalEntrants: integer("total_entrants").notNull().default(0),

  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (table) => ({
  funnelPeriodIdx: uniqueIndex("analytics_funnel_results_funnel_period_idx").on(
    table.funnelId,
    table.periodStart,
    table.periodEnd,
  ),
}));
```

### Relations

```typescript
export const analyticsConfigRelations = relations(analyticsConfig, ({ one, many }) => ({
  domain: one(domains, {
    fields: [analyticsConfig.domainId],
    references: [domains.id],
  }),
  funnels: many(analyticsFunnels),
}));

export const analyticsFunnelsRelations = relations(analyticsFunnels, ({ one, many }) => ({
  config: one(analyticsConfig, {
    fields: [analyticsFunnels.analyticsConfigId],
    references: [analyticsConfig.id],
  }),
  results: many(analyticsFunnelResults),
}));

export const analyticsFunnelResultsRelations = relations(analyticsFunnelResults, ({ one }) => ({
  funnel: one(analyticsFunnels, {
    fields: [analyticsFunnelResults.funnelId],
    references: [analyticsFunnels.id],
  }),
}));
```

---

## ClickHouse Tables

ClickHouse schema is managed via raw SQL migrations in `apps/analytics/src/clickhouse/migrations/`. The analytics service runs these on startup (idempotent `CREATE TABLE IF NOT EXISTS`).

**Client**: `@clickhouse/client` (official ClickHouse JS client)

**Connection**: `UNI_PROXY_MANAGER_CLICKHOUSE_URL` (e.g. `http://clickhouse:8123`)

### `analytics_events` (raw events)

The primary event table. Every pageview, custom event, or session end is one row. MergeTree engine with monthly partitioning.

```sql
CREATE TABLE IF NOT EXISTS analytics_events (
  -- Identity
  analytics_config_id LowCardinality(String),

  -- Event type
  event_type Enum8('pageview' = 1, 'event' = 2, 'session_end' = 3),
  event_name LowCardinality(String) DEFAULT '',     -- empty string when not applicable
  event_meta Map(String, String),                    -- custom event metadata (keys: alphanumeric + underscore only)

  -- Page data
  pathname String,                                    -- location.pathname only (no query string)
  referrer String DEFAULT '',
  referrer_domain LowCardinality(String) DEFAULT '',

  -- UTM parameters
  utm_source LowCardinality(String) DEFAULT '',
  utm_medium LowCardinality(String) DEFAULT '',
  utm_campaign LowCardinality(String) DEFAULT '',
  utm_term String DEFAULT '',
  utm_content String DEFAULT '',

  -- Visitor identification (privacy-first)
  is_unique UInt8 DEFAULT 0,                         -- 1 if Referer hostname does not match tracked domain, 0 otherwise

  -- Session identification
  session_id String DEFAULT '',                      -- Client-generated in-memory session ID (not persisted to storage)
  is_bounce UInt8 DEFAULT 0,                         -- 1 if session had exactly one pageview (set on session_end events)
  is_entry UInt8 DEFAULT 0,                          -- 1 if this is the first pageview in the session
  is_exit UInt8 DEFAULT 0,                           -- 1 if this is the last pageview in the session

  -- Device/browser (parsed from User-Agent server-side)
  browser LowCardinality(String) DEFAULT 'Unknown',
  browser_version LowCardinality(String) DEFAULT '',
  os LowCardinality(String) DEFAULT 'Unknown',
  device_type LowCardinality(String) DEFAULT 'other', -- desktop, mobile, tablet, other

  screen_width UInt16 DEFAULT 0,
  screen_height UInt16 DEFAULT 0,

  -- Geography (derived from browser timezone, not GeoIP)
  country_code LowCardinality(String) DEFAULT 'Unknown', -- ISO 3166-1 alpha-2, derived from tz field
  tz LowCardinality(String) DEFAULT '',                  -- Browser timezone (e.g. "Europe/London")

  -- Session data (set on session_end events)
  session_duration_ms UInt64 DEFAULT 0,              -- Changed from UInt32 to avoid ~71 minute overflow
  scroll_depth_pct UInt8 DEFAULT 0,                  -- 0-100

  -- Source
  source LowCardinality(String) DEFAULT 'js',        -- 'js' | 'pixel' | 'api'

  -- Timestamp
  timestamp DateTime CODEC(Delta, ZSTD(1)) DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (analytics_config_id, timestamp)
TTL timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- Data skipping indexes for common filter patterns
ALTER TABLE analytics_events ADD INDEX idx_pathname pathname TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE analytics_events ADD INDEX idx_event_type event_type TYPE set(3) GRANULARITY 1;
ALTER TABLE analytics_events ADD INDEX idx_event_name event_name TYPE bloom_filter(0.01) GRANULARITY 4;
```

**Schema Changes Applied**:
- **Removed** `visitor_hash FixedString(64)` column entirely -- no visitor hash is stored
- **Replaced** `is_unique_visitor UInt8` with `is_unique UInt8` -- now determined by referrer-domain matching (if Referer hostname matches tracked domain = 0, otherwise = 1)
- **Added** `is_entry UInt8 DEFAULT 0` -- 1 if this is the first pageview in the session
- **Added** `is_exit UInt8 DEFAULT 0` -- 1 if this is the last pageview in the session (set retroactively or on session_end)
- **Added** `tz LowCardinality(String)` -- browser timezone for country detection
- **Changed** `session_duration_ms` from `UInt32` to `UInt64` -- avoids ~71 minute overflow limitation
- **Updated** `ORDER BY` clause to remove `visitor_hash` (now just `analytics_config_id, timestamp`)
- **Documented** that `pathname` now contains only `location.pathname` (no query string)
- **Documented** that `country_code` is derived from the browser timezone (`tz` field) via static timezone-to-country lookup, NOT from GeoIP/IP address

**Notes**:
- The TTL of 90 days is a global table-level floor. Per-domain retention is enforced at query time by adding `AND timestamp >= now() - INTERVAL {retentionDays} DAY` based on the domain's configured retention in PostgreSQL. ClickHouse TTL is table-level and cannot vary per `analytics_config_id`.
- `event_meta` uses ClickHouse's native `Map(String, String)` type. Values are stored as strings; numeric/boolean values are coerced to strings at insert time. **Keys must match `^[a-zA-Z0-9_]+$`** -- the analytics service validates and rejects keys with special characters to prevent query injection and XSS.
- `Nullable` is avoided throughout -- empty strings and zero values are used as sentinels instead. This improves compression and query performance (avoids the bitmask overhead of Nullable columns).
- `LowCardinality` is used on all low-cardinality string columns for dictionary encoding (5-10x storage reduction).
- `is_unique` is set by the analytics service at insert time by comparing the Referer header hostname to the tracked domain. If they match (internal navigation), `is_unique = 0`. If they differ or Referer is empty (external/direct), `is_unique = 1`. This is an approximation, similar to Simple Analytics.
- `is_bounce` is set on `session_end` events when the session had exactly one pageview (determined by the client tracker).
- `session_id` is a client-generated in-memory random ID (not persisted to cookies/storage). Used for accurate session counting via `uniqState(session_id)` in aggregates.
- The `ORDER BY` clause defines the primary key and determines data layout on disk. Queries filtering by `analytics_config_id` + time range are optimally served.
- Data skipping indexes on `pathname`, `event_type`, and `event_name` speed up filtered queries without changing the primary sort order.

### Input Validation at Ingestion

All string fields are validated and sanitised at ingestion:

- **Maximum string lengths**:
  - `pathname`: 2000 characters
  - `referrer`: 2000 characters
  - `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`: 500 characters each
  - `event_name`: 200 characters
  - `event_meta` values: 500 characters each
- **Control character stripping**: Control characters (0x00-0x1F except tab/newline) are stripped from all string fields at ingestion to prevent binary injection and terminal escape sequences.
- **Truncation**: Strings exceeding maximum length are truncated, not rejected. This ensures events are not lost due to malformed data.

### Materialised Views and Aggregate Tables

ClickHouse Materialised Views trigger on INSERT and populate target aggregate tables automatically. No cron jobs or BullMQ workers needed for aggregation.

**Important**: All three MVs (minute, hour, day) read **directly from `analytics_events`**. There is no cascading chain (minute->hour->day). This avoids the problem of partial aggregate states being fed through tiers, which causes unbounded growth in array-based columns. Each MV independently aggregates from the raw data.

Breakdown fields use `sumMap` instead of `groupArray`. `sumMap` natively merges maps by summing values for matching keys, producing compact `Map(String, UInt64)` results rather than unbounded arrays. This is the idiomatic ClickHouse pattern for top-N breakdown aggregation.

#### Minute Aggregates

```sql
-- Target table for minute-level aggregates
CREATE TABLE IF NOT EXISTS analytics_agg_minute (
  analytics_config_id LowCardinality(String),
  bucket DateTime,                                  -- toStartOfMinute(timestamp)

  -- Traffic counters
  page_views SimpleAggregateFunction(sum, UInt64),
  unique_visitors SimpleAggregateFunction(sum, UInt64),  -- Sum of is_unique flags
  sessions AggregateFunction(uniq, String),          -- HyperLogLog for session_id
  bounces SimpleAggregateFunction(sum, UInt64),
  custom_events SimpleAggregateFunction(sum, UInt64),

  -- Session metrics (for averaging)
  total_session_duration_ms SimpleAggregateFunction(sum, UInt64),
  session_count SimpleAggregateFunction(sum, UInt64),
  total_scroll_depth SimpleAggregateFunction(sum, UInt64),
  scroll_count SimpleAggregateFunction(sum, UInt64),

  -- Breakdown maps (sumMap merges by key, summing values)
  top_paths SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  top_referrers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  geo_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  devices SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  browsers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  os_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_sources SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_mediums SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_campaigns SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  entry_pages SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  exit_pages SimpleAggregateFunction(sumMap, Map(String, UInt64))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (analytics_config_id, bucket)
TTL bucket + INTERVAL 7 DAY
SETTINGS index_granularity = 512;

-- Materialised View: auto-populates minute aggregates on INSERT to analytics_events
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_events_to_minute_mv
TO analytics_agg_minute
AS SELECT
  analytics_config_id,
  toStartOfMinute(timestamp) AS bucket,

  countIf(event_type = 'pageview') AS page_views,
  sumIf(is_unique, event_type = 'pageview') AS unique_visitors,
  uniqStateIf(session_id, session_id != '') AS sessions,
  countIf(event_type = 'session_end' AND is_bounce = 1) AS bounces,
  countIf(event_type = 'event') AS custom_events,

  sumIf(session_duration_ms, event_type = 'session_end') AS total_session_duration_ms,
  countIf(event_type = 'session_end' AND session_duration_ms > 0) AS session_count,
  sumIf(scroll_depth_pct, event_type = 'session_end') AS total_scroll_depth,
  countIf(event_type = 'session_end' AND scroll_depth_pct > 0) AS scroll_count,

  sumMap(map(pathname, toUInt64(1))) AS top_paths,
  sumMap(map(if(referrer_domain = '', '(direct)', referrer_domain), toUInt64(1))) AS top_referrers,
  sumMap(map(country_code, toUInt64(1))) AS geo_data,
  sumMap(map(device_type, toUInt64(1))) AS devices,
  sumMap(map(browser, toUInt64(1))) AS browsers,
  sumMap(map(os, toUInt64(1))) AS os_data,
  sumMap(map(if(utm_source = '', '(none)', utm_source), toUInt64(1))) AS utm_sources,
  sumMap(map(if(utm_medium = '', '(none)', utm_medium), toUInt64(1))) AS utm_mediums,
  sumMap(map(if(utm_campaign = '', '(none)', utm_campaign), toUInt64(1))) AS utm_campaigns,
  sumMap(map(if(is_entry = 1, pathname, ''), toUInt64(if(is_entry = 1, 1, 0)))) AS entry_pages,
  sumMap(map(if(is_exit = 1, pathname, ''), toUInt64(if(is_exit = 1, 1, 0)))) AS exit_pages
FROM analytics_events
WHERE event_type IN ('pageview', 'event', 'session_end')
GROUP BY analytics_config_id, bucket;
```

**Schema Changes Applied**:
- **Changed** TTL from 90 days to 7 days
- **Changed** `unique_visitors` from `AggregateFunction(uniq, String)` to `SimpleAggregateFunction(sum, UInt64)` -- now sums the `is_unique` flag instead of deduplicating visitor_hash
- **Changed** MV to use `sumIf(is_unique, event_type = 'pageview')` instead of `uniqState(visitor_hash)`
- **Added** `utm_mediums` as `SimpleAggregateFunction(sumMap, Map(String, UInt64))`
- **Added** `entry_pages` as `SimpleAggregateFunction(sumMap, Map(String, UInt64))`
- **Added** `exit_pages` as `SimpleAggregateFunction(sumMap, Map(String, UInt64))`
- **Kept** `sessions` as `uniqState(session_id)` since session_id is still generated client-side

#### Hour Aggregates

```sql
CREATE TABLE IF NOT EXISTS analytics_agg_hour (
  analytics_config_id LowCardinality(String),
  bucket DateTime,

  page_views SimpleAggregateFunction(sum, UInt64),
  unique_visitors SimpleAggregateFunction(sum, UInt64),
  sessions AggregateFunction(uniq, String),
  bounces SimpleAggregateFunction(sum, UInt64),
  custom_events SimpleAggregateFunction(sum, UInt64),

  total_session_duration_ms SimpleAggregateFunction(sum, UInt64),
  session_count SimpleAggregateFunction(sum, UInt64),
  total_scroll_depth SimpleAggregateFunction(sum, UInt64),
  scroll_count SimpleAggregateFunction(sum, UInt64),

  top_paths SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  top_referrers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  geo_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  devices SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  browsers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  os_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_sources SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_mediums SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_campaigns SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  entry_pages SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  exit_pages SimpleAggregateFunction(sumMap, Map(String, UInt64))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (analytics_config_id, bucket)
TTL bucket + INTERVAL 180 DAY
SETTINGS index_granularity = 512;

-- Reads directly from analytics_events (NOT from minute table)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_events_to_hour_mv
TO analytics_agg_hour
AS SELECT
  analytics_config_id,
  toStartOfHour(timestamp) AS bucket,

  countIf(event_type = 'pageview') AS page_views,
  sumIf(is_unique, event_type = 'pageview') AS unique_visitors,
  uniqStateIf(session_id, session_id != '') AS sessions,
  countIf(event_type = 'session_end' AND is_bounce = 1) AS bounces,
  countIf(event_type = 'event') AS custom_events,

  sumIf(session_duration_ms, event_type = 'session_end') AS total_session_duration_ms,
  countIf(event_type = 'session_end' AND session_duration_ms > 0) AS session_count,
  sumIf(scroll_depth_pct, event_type = 'session_end') AS total_scroll_depth,
  countIf(event_type = 'session_end' AND scroll_depth_pct > 0) AS scroll_count,

  sumMap(map(pathname, toUInt64(1))) AS top_paths,
  sumMap(map(if(referrer_domain = '', '(direct)', referrer_domain), toUInt64(1))) AS top_referrers,
  sumMap(map(country_code, toUInt64(1))) AS geo_data,
  sumMap(map(device_type, toUInt64(1))) AS devices,
  sumMap(map(browser, toUInt64(1))) AS browsers,
  sumMap(map(os, toUInt64(1))) AS os_data,
  sumMap(map(if(utm_source = '', '(none)', utm_source), toUInt64(1))) AS utm_sources,
  sumMap(map(if(utm_medium = '', '(none)', utm_medium), toUInt64(1))) AS utm_mediums,
  sumMap(map(if(utm_campaign = '', '(none)', utm_campaign), toUInt64(1))) AS utm_campaigns,
  sumMap(map(if(is_entry = 1, pathname, ''), toUInt64(if(is_entry = 1, 1, 0)))) AS entry_pages,
  sumMap(map(if(is_exit = 1, pathname, ''), toUInt64(if(is_exit = 1, 1, 0)))) AS exit_pages
FROM analytics_events
WHERE event_type IN ('pageview', 'event', 'session_end')
GROUP BY analytics_config_id, bucket;
```

**Schema Changes Applied**:
- Same changes as minute aggregates (unique_visitors, utm_mediums, entry_pages, exit_pages)

#### Day Aggregates

```sql
CREATE TABLE IF NOT EXISTS analytics_agg_day (
  analytics_config_id LowCardinality(String),
  bucket Date,

  page_views SimpleAggregateFunction(sum, UInt64),
  unique_visitors SimpleAggregateFunction(sum, UInt64),
  sessions AggregateFunction(uniq, String),
  bounces SimpleAggregateFunction(sum, UInt64),
  custom_events SimpleAggregateFunction(sum, UInt64),

  total_session_duration_ms SimpleAggregateFunction(sum, UInt64),
  session_count SimpleAggregateFunction(sum, UInt64),
  total_scroll_depth SimpleAggregateFunction(sum, UInt64),
  scroll_count SimpleAggregateFunction(sum, UInt64),

  top_paths SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  top_referrers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  geo_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  devices SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  browsers SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  os_data SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_sources SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_mediums SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  utm_campaigns SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  entry_pages SimpleAggregateFunction(sumMap, Map(String, UInt64)),
  exit_pages SimpleAggregateFunction(sumMap, Map(String, UInt64))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYear(bucket)
ORDER BY (analytics_config_id, bucket)
TTL bucket + INTERVAL 365 DAY
SETTINGS index_granularity = 256;

-- Reads directly from analytics_events (NOT from hour table)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_events_to_day_mv
TO analytics_agg_day
AS SELECT
  analytics_config_id,
  toDate(timestamp) AS bucket,

  countIf(event_type = 'pageview') AS page_views,
  sumIf(is_unique, event_type = 'pageview') AS unique_visitors,
  uniqStateIf(session_id, session_id != '') AS sessions,
  countIf(event_type = 'session_end' AND is_bounce = 1) AS bounces,
  countIf(event_type = 'event') AS custom_events,

  sumIf(session_duration_ms, event_type = 'session_end') AS total_session_duration_ms,
  countIf(event_type = 'session_end' AND session_duration_ms > 0) AS session_count,
  sumIf(scroll_depth_pct, event_type = 'session_end') AS total_scroll_depth,
  countIf(event_type = 'session_end' AND scroll_depth_pct > 0) AS scroll_count,

  sumMap(map(pathname, toUInt64(1))) AS top_paths,
  sumMap(map(if(referrer_domain = '', '(direct)', referrer_domain), toUInt64(1))) AS top_referrers,
  sumMap(map(country_code, toUInt64(1))) AS geo_data,
  sumMap(map(device_type, toUInt64(1))) AS devices,
  sumMap(map(browser, toUInt64(1))) AS browsers,
  sumMap(map(os, toUInt64(1))) AS os_data,
  sumMap(map(if(utm_source = '', '(none)', utm_source), toUInt64(1))) AS utm_sources,
  sumMap(map(if(utm_medium = '', '(none)', utm_medium), toUInt64(1))) AS utm_mediums,
  sumMap(map(if(utm_campaign = '', '(none)', utm_campaign), toUInt64(1))) AS utm_campaigns,
  sumMap(map(if(is_entry = 1, pathname, ''), toUInt64(if(is_entry = 1, 1, 0)))) AS entry_pages,
  sumMap(map(if(is_exit = 1, pathname, ''), toUInt64(if(is_exit = 1, 1, 0)))) AS exit_pages
FROM analytics_events
WHERE event_type IN ('pageview', 'event', 'session_end')
GROUP BY analytics_config_id, bucket;
```

**Schema Changes Applied**:
- Same changes as minute and hour aggregates

**Note on unique visitors**: Because `is_unique` is an approximation based on referrer matching (not true visitor deduplication), summing `is_unique` across multi-day periods will count unique visitors as "visitors arriving from external sources" rather than truly unique individuals. This is consistent with how privacy-focused analytics tools like Simple Analytics operate. True cross-day unique visitor counting is not possible without persistent visitor identification.

---

## Redis Data Structures

Redis is used for rate limiting, live analytics, and caching.

**Connection**: `UNI_PROXY_MANAGER_REDIS_URL`

### Rate Limiting

- **Key**: `analytics:ratelimit:{ip}:{configId}`
- **Type**: String (counter)
- **TTL**: 60 seconds (sliding window)
- **Purpose**: Prevent abuse by limiting events per IP per config to 100/minute

### Live Analytics Channel

- **Key**: `analytics:live:{configId}`
- **Type**: Pub/Sub channel
- **Purpose**: Real-time event broadcasting for live dashboard

### Active Visitors Tracking

- **Key**: `analytics:active:{configId}`
- **Type**: Sorted Set
- **Members**: Session IDs
- **Scores**: Unix timestamp of last activity
- **TTL**: Members older than 5 minutes are removed
- **Purpose**: Count active visitors in real-time

### Anomaly Detection Baselines

- **Key**: `analytics:baseline:{configId}:{metric}:{period}`
- **Type**: String (JSON)
- **TTL**: 7 days
- **Purpose**: Store rolling averages for anomaly detection

### Funnel Results Cache

- **Key**: `analytics:funnel:{funnelId}:{periodStart}:{periodEnd}`
- **Type**: String (JSON)
- **TTL**: 5 minutes
- **Purpose**: Cache expensive funnel computation results

**Schema Changes Applied**:
- **Removed** `analytics:visitors:{configId}:{date}` sets -- no longer needed (no visitor hash deduplication)
- **Removed** `analytics:salt:{configId}` and `analytics:prev-salt:{configId}` -- no longer needed (no salt rotation)

---

## ClickHouse Migration Management

**Directory**: `apps/analytics/src/clickhouse/migrations/`

```
migrations/
├── 001_create_events.sql
├── 002_create_agg_minute.sql
├── 003_create_agg_hour.sql
├── 004_create_agg_day.sql
├── 005_create_mv_events_to_minute.sql
├── 006_create_mv_events_to_hour.sql
├── 007_create_mv_events_to_day.sql
└── 008_add_data_skipping_indexes.sql
```

The analytics service runs migrations on startup:

```typescript
// apps/analytics/src/clickhouse/migrate.ts

import { createClient } from "@clickhouse/client";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

export async function runClickHouseMigrations(client: ClickHouseClient): Promise<void> {
  // Create migrations tracking table
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS _migrations (
      name String,
      applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY name`,
  });

  // Get already-applied migrations
  const applied = await client.query({
    query: "SELECT name FROM _migrations",
    format: "JSONEachRow",
  });
  const appliedSet = new Set((await applied.json<{ name: string }[]>()).map(r => r.name));

  // Read and apply pending migrations in order
  const migrationsDir = join(__dirname, "migrations");
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(join(migrationsDir, file), "utf-8");

    // Split on semicolons to handle multi-statement files
    const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await client.command({ query: stmt });
    }

    await client.insert({
      table: "_migrations",
      values: [{ name: file }],
      format: "JSONEachRow",
    });
  }
}
```

### Schema Evolution Strategy

ClickHouse migrations use `CREATE TABLE IF NOT EXISTS` for initial creation, but schema evolution requires a different approach:

- **Adding columns**: Use `ALTER TABLE ... ADD COLUMN` in a new migration file (e.g., `009_add_new_column.sql`). ClickHouse supports adding columns to MergeTree tables without downtime.
- **Modifying columns**: Use `ALTER TABLE ... MODIFY COLUMN`. Supported for type changes that are compatible (e.g., widening a UInt16 to UInt32).
- **Dropping columns**: Use `ALTER TABLE ... DROP COLUMN`. Data is not physically removed until parts are merged.
- **Modifying Materialised Views**: Drop and recreate the MV. Existing data in the target table is not affected. New data will be processed by the new MV definition. Historical data can be backfilled with `INSERT INTO ... SELECT FROM analytics_events WHERE ...`.
- **Breaking changes**: Create a new target table, create a new MV pointing to it, backfill from the raw events table, then drop the old MV and table.

All migration files must be idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS` guards). The `_migrations` tracking table prevents re-execution of already-applied migrations.

---

## Query Patterns

### Summary Query (from aggregates)

```sql
-- Get summary for a config over a time range (uses day aggregates for 7d+ ranges)
-- Note: per-domain retention filtering applied via the AND bucket >= ... clause
SELECT
  sum(page_views) AS total_page_views,
  sum(unique_visitors) AS total_unique_visitors,
  uniqMerge(sessions) AS total_sessions,
  sum(bounces) AS total_bounces,
  sum(custom_events) AS total_custom_events,
  sum(total_session_duration_ms) / greatest(sum(session_count), 1) AS avg_session_duration_ms,
  sum(total_scroll_depth) / greatest(sum(scroll_count), 1) AS avg_scroll_depth_pct
FROM analytics_agg_day
WHERE analytics_config_id = {configId:String}
  AND bucket BETWEEN {start:Date} AND {end:Date};
```

**Schema Changes Applied**:
- Changed `uniqMerge(unique_visitors)` to `sum(unique_visitors)` -- now sums the `is_unique` flag totals

### Timeseries Query

```sql
-- Hourly timeseries for charting
SELECT
  bucket,
  sum(page_views) AS page_views,
  sum(unique_visitors) AS unique_visitors,
  uniqMerge(sessions) AS sessions,
  sum(bounces) AS bounces,
  sum(custom_events) AS custom_events
FROM analytics_agg_hour
WHERE analytics_config_id = {configId:String}
  AND bucket BETWEEN {start:DateTime} AND {end:DateTime}
GROUP BY bucket
ORDER BY bucket ASC;
```

**Schema Changes Applied**:
- Changed `uniqMerge(unique_visitors)` to `sum(unique_visitors)`

### Top Pages Query (from aggregates via sumMap)

```sql
-- Extract top pages from pre-aggregated sumMap breakdown
-- This avoids scanning the raw events table
SELECT
  key AS pathname,
  value AS page_views
FROM (
  SELECT
    sumMap(top_paths) AS merged
  FROM analytics_agg_day
  WHERE analytics_config_id = {configId:String}
    AND bucket BETWEEN {start:Date} AND {end:Date}
)
ARRAY JOIN
  mapKeys(merged) AS key,
  mapValues(merged) AS value
ORDER BY page_views DESC
LIMIT {limit:UInt32};
```

For detailed per-page metrics (unique visitors, avg duration), fall back to the raw events table:

```sql
SELECT
  pathname,
  count() AS page_views,
  sum(is_unique) AS unique_visitors
FROM analytics_events
WHERE analytics_config_id = {configId:String}
  AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
  AND event_type = 'pageview'
GROUP BY pathname
ORDER BY page_views DESC
LIMIT {limit:UInt32};
```

**Schema Changes Applied**:
- Changed `uniq(visitor_hash)` to `sum(is_unique)` for unique visitor counting

**Note**: `sum(is_unique)` provides an approximation of unique visitors based on external vs internal referrers, not true visitor deduplication. This is consistent with privacy-focused analytics tools.

### Cross-Dimensional Filtering Query

```sql
-- Example: Get page views for mobile users from GB
SELECT
  pathname,
  count() AS page_views,
  sum(is_unique) AS unique_visitors
FROM analytics_events
WHERE analytics_config_id = {configId:String}
  AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
  AND event_type = 'pageview'
  AND country_code = 'GB'
  AND device_type = 'mobile'
GROUP BY pathname
ORDER BY page_views DESC
LIMIT 50;
```

### Entry and Exit Pages Query

```sql
-- Top entry pages
SELECT
  key AS pathname,
  value AS entries
FROM (
  SELECT
    sumMap(entry_pages) AS merged
  FROM analytics_agg_day
  WHERE analytics_config_id = {configId:String}
    AND bucket BETWEEN {start:Date} AND {end:Date}
)
ARRAY JOIN
  mapKeys(merged) AS key,
  mapValues(merged) AS value
WHERE key != ''  -- Filter out empty keys
ORDER BY entries DESC
LIMIT {limit:UInt32};

-- Top exit pages
SELECT
  key AS pathname,
  value AS exits
FROM (
  SELECT
    sumMap(exit_pages) AS merged
  FROM analytics_agg_day
  WHERE analytics_config_id = {configId:String}
    AND bucket BETWEEN {start:Date} AND {end:Date}
)
ARRAY JOIN
  mapKeys(merged) AS key,
  mapValues(merged) AS value
WHERE key != ''  -- Filter out empty keys
ORDER BY exits DESC
LIMIT {limit:UInt32};
```

### Funnel Query (from raw events)

See [09-funnels.md](./09-funnels.md) for the full funnel computation algorithm. Funnel queries run against the raw `analytics_events` table since they need per-visitor event sequences.

---

## Cardinality Caps

Breakdown fields (top_paths, top_referrers, geo_data, browsers, os_data, utm_sources, utm_mediums, utm_campaigns, entry_pages, exit_pages) use `sumMap` which naturally aggregates by key. Caps prevent unbounded map growth both in storage and query results:

- **Per-domain cap**: Configurable via `analytics_config.max_breakdown_entries` (default: 100)
- **Global maximum**: 500 entries per field (enforced regardless of per-domain setting)
- **Enforcement at query time**: The merged `sumMap` result is sorted by value descending and truncated to the configured limit. Entries beyond the cap are grouped into an `(other)` bucket
- **Enforcement at ingestion time**: Before inserting an event, the analytics service checks if the key count for a given aggregate row already exceeds the `maxBreakdownEntries` cap. If so, new low-count keys are dropped. This prevents unbounded `sumMap` growth in the aggregate tables.
- **Storage note**: `sumMap` in `AggregatingMergeTree` stores one entry per unique key (not one per event), so storage growth is bounded by the number of distinct values rather than event volume. For most analytics dimensions (browsers, countries, devices), this is naturally small. For high-cardinality dimensions (pathnames), storage may grow but is still far more compact than the previous `groupArray` approach

---

## Migration Notes

- PostgreSQL tables use Drizzle ORM with standard `drizzle-kit` migrations
- ClickHouse tables use raw SQL migrations managed by the analytics service on startup
- All PostgreSQL tables use `text` primary keys with nanoid generation (matching existing pattern)
- Foreign key constraints with `onDelete: "cascade"` ensure cleanup when parent records are deleted
- ClickHouse tables have no foreign keys (ClickHouse does not support them). Referential integrity between PostgreSQL config and ClickHouse events is maintained at the application level
- The `publicDashboardPasswordHash` field stores bcrypt hashes (not plaintext). Comparison uses timing-safe equality via bcrypt's built-in compare
- API tokens store both a bcrypt hash (`apiTokenHash`, for generation/rotation) and a SHA-256 hash (`apiTokenSha256`, for fast per-request validation). This prevents CPU exhaustion from bcrypt verification on every request
- `Nullable` columns are avoided in ClickHouse -- empty strings and zero values are used as sentinels. This improves compression and query performance
- `LowCardinality` wrappers are used on all low-cardinality string columns for dictionary encoding
- All three ClickHouse Materialised Views read directly from `analytics_events` (no cascading chain). Breakdown fields use `sumMap` which natively merges by key
