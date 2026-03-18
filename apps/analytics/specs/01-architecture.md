# 01 - Architecture

## System Overview

The analytics extension adds a dedicated service (`apps/analytics`) that receives tracking beacons from client-side JavaScript, processes them into ClickHouse for storage and automatic aggregation, and serves both the embed script and a real-time WebSocket connection.

```
                                         +-------------------+
  Browser (tracked site)                 |   apps/analytics  |
  +-----------------------+              |                   |
  | <script src=           |  beacon     | HTTP Server       |
  |  /_upm/{uuid}/        | ----------> |  - POST /collect  |
  |  script.js">          |             |  - GET /script.js |
  +-----------------------+              |  - WS /live       |
         |                               |                   |
         | HAProxy routes                | Worker            |
         | /_upm/{uuid}/* to             |  - Funnel compute |
         | analytics backend             |                   |
         v                               +--------+----------+
  +-------------+                                 |
  |   HAProxy   |                          writes | queries
  +-------------+                            |          |
                                      +----v----------v---+
  +-------------+        +----------+ |    ClickHouse     |
  |  apps/api   | -----> | postgres | | (analytics data)  |
  +-------------+        +----------+ +-------------------+
         |                  config
         v                  tables      +------------+
  +-------------+                        |   Redis    |
  |  apps/web   |                        +------------+
  +-------------+                         (pub/sub, queues)
   (analytics dashboard)
```

## Components

### 1. Analytics HTTP Server (apps/analytics)

A Hono.js HTTP server (matching the existing API pattern) that handles:

- **`GET /_upm/{uuid}/script.js`** - Serves the tracking bootstrap script, pre-configured with the correct collection endpoint
- **`GET /_upm/{uuid}/tracker.js`** - Serves the full tracker (static file, lazy-loaded by bootstrap)
- **`POST /_upm/{uuid}/collect`** - Receives tracking beacons (pageviews, events, session data). Rate-limited (see below). Validates `Origin` header against the domain's hostname
- **`GET /_upm/{uuid}/pixel.gif`** - 1x1 transparent pixel for noscript tracking. Rate-limited (same limits as `/collect`). Responds with `Cache-Control: no-cache, no-store` to prevent browser caching. Validates `Referer` header domain and checks `Sec-GPC` header
- **`POST /_upm/{uuid}/api`** - Server-side event submission (requires API token, validated via SHA-256 fast hash)
- **`WS /_upm/{uuid}/live`** - WebSocket for real-time dashboard updates (first-message authentication, see below)

**Port**: 3003 (internal), proxied via HAProxy UUID routes per domain.

**Environment variables** (analytics service):
- `UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT` - Analytics service URL (e.g. `http://analytics:3003`). Presence of this variable enables the extension (service availability pattern)
- `UNI_PROXY_MANAGER_CLICKHOUSE_URL` - ClickHouse connection URL (e.g. `http://clickhouse:8123`). Only used by the analytics service, never by apps/api
- `UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD` - ClickHouse password. Must be explicitly set (no default)
- `UNI_PROXY_MANAGER_INTERNAL_SECRET` - Shared secret for authenticating internal API requests between apps/api and the analytics service
- `UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET` - Secret for signing public dashboard session JWTs (minimum 32 bytes, generated via `openssl rand -base64 32`). Algorithm: HS256

### 2. ClickHouse (analytics data store)

A dedicated ClickHouse instance for high-volume analytics data:

- **Raw events table**: `analytics_events` (MergeTree engine, partitioned by month, ordered by config+timestamp)
- **Materialized Views**: All three aggregate MVs (minute, hour, day) read directly from `analytics_events` -- no cascading chain. Uses `sumMap` for breakdown fields and `uniqState` for HyperLogLog visitor counts (AggregatingMergeTree targets)
- **TTL**: Global table-level TTL as a retention floor. Per-domain retention is enforced at query time via application logic
- **Compression**: Columnar storage with LZ4 compression (typically 10-20x vs row-based PostgreSQL). `LowCardinality` wrappers on low-cardinality string columns for dictionary encoding

Only deployed when the analytics extension is enabled. See [02-database.md](./02-database.md) for full schema.

**Important**: Only the analytics service (`apps/analytics`) connects to ClickHouse. The API service (`apps/api`) accesses analytics data via internal HTTP endpoints on the analytics service.

### 3. Analytics Worker (apps/analytics-workers or separate process)

Runs as a **separate process** from the HTTP server (matching the existing `apps/workers`, `apps/sites-workers`, `apps/pomerium-workers` pattern). This prevents CPU-intensive tasks from blocking beacon collection. Handles:

- **Funnel computation**: Compute funnel step counts from raw events in ClickHouse (batched by session with cursor-based pagination)
- **Anomaly detection**: Compare recent traffic against cached baseline and flag deviations

**Note**: Aggregation and retention are handled natively by ClickHouse (Materialized Views and TTL respectively), so no BullMQ workers are needed for those.

### 4. API Extension (apps/api)

New routes added to the main API (dynamically loaded like Sites/Pomerium):

- Analytics configuration CRUD (enable/disable per domain, retention settings)
- Analytics data queries -- **proxied to the analytics service** via internal HTTP (summary, visitors, geography, referrers, devices, pages, events)
- Funnel definitions and results
- Public dashboard configuration
- CSV/JSON export

The API service does **not** connect to ClickHouse directly. All analytics data queries are forwarded to the analytics service's internal API endpoints, which handle ClickHouse queries and return formatted results. This matches how the Sites extension delegates to its executor service.

### 4a. Analytics Internal API (apps/analytics)

Internal HTTP endpoints served by the analytics service for use by `apps/api`. Not exposed through HAProxy.

- **`GET /internal/analytics/:configId/summary`** - Summary statistics
- **`GET /internal/analytics/:configId/timeseries`** - Time-bucketed data
- **`GET /internal/analytics/:configId/pages`** - Top pages
- **`GET /internal/analytics/:configId/referrers`** - Top referrers
- **`GET /internal/analytics/:configId/geography`** - Country breakdown
- **`GET /internal/analytics/:configId/devices`** - Device/browser/OS breakdown
- **`GET /internal/analytics/:configId/events`** - Custom events
- **`GET /internal/analytics/:configId/utm`** - UTM breakdown
- **`GET /internal/analytics/:configId/live`** - Real-time stats (from Redis sorted sets)
- **`GET /internal/analytics/:configId/export`** - Data export (CSV/JSON)
- **`DELETE /internal/analytics/:configId/data`** - Delete analytics data (queued as background mutation, not synchronous)

These endpoints are authenticated via an internal shared secret (`UNI_PROXY_MANAGER_INTERNAL_SECRET`) to prevent external access.

All data query endpoints support **cross-dimensional filtering** -- ability to filter by multiple dimensions simultaneously (e.g. "show pages for visitors from the UK using Chrome on mobile"). This is a launch requirement.

### 5. Web UI (apps/web)

New pages integrated into the existing Next.js app:

- `/analytics` - Analytics overview (all tracked domains)
- `/analytics/[configId]` - Per-domain analytics dashboard (multi-tab)
- `/analytics/public/[token]` - Public shared dashboard

The analytics module is **separate from the existing domain detail page**. Existing server-side HAProxy metrics on `/domains/[id]` remain untouched.

## Data Flow

### Pageview Collection

1. Visitor loads a tracked page
2. Bootstrap script (`<2KB`) fires immediately:
   - Checks `navigator.doNotTrack`, `navigator.globalPrivacyControl`, and `window.upm_disable` -- aborts if any are set
   - Sends `POST /_upm/{uuid}/collect` with pageview data (includes client-generated `session_id`, timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`)
   - HAProxy routes this to the analytics backend based on the per-domain UUID ACL
3. Analytics backend:
   - Validates `Origin` header matches the domain's hostname for the given UUID
   - Validates the UUID maps to an active analytics configuration
   - Determines `is_unique` flag: checks if the `Referer` header's hostname matches the tracked domain's hostname. If referrer is empty or from a different domain, `is_unique = true`. If referrer matches the tracked domain, `is_unique = false`
   - Derives country code from timezone: maps the client-provided timezone (e.g. "Europe/London") to a country code (e.g. "GB") using a static timezone-to-country lookup table
   - Parses User-Agent to extract browser, OS, and device type
   - Writes raw event to ClickHouse `analytics_events` table
   - ClickHouse Materialized Views automatically update minute/hour/day aggregates (all three MVs read from the raw table directly)
   - Publishes to Redis pub/sub for real-time WebSocket broadcast
   - Adds to Redis sorted set `analytics:active:{configId}` (score = timestamp) for live stats
4. Bootstrap script lazy-loads full tracker (~10-15KB):
   - Attaches scroll depth, session duration, data-attribute event listeners
   - Sends additional beacons as interactions occur
   - Resets scroll depth and page timer on SPA navigation

**Privacy Note**: No visitor hash is stored. No IP addresses are processed (dropped at the edge, never logged). No consent required -- this is a design advantage. The system cannot track users across domains or sessions, and cannot identify individual visitors.

### Pathname Processing

By default, query strings are stripped from pathnames (only `location.pathname` is tracked). A configurable allowlist can be set per domain to preserve specific query parameters (e.g. `?page=`, `?id=`). All other query parameters are removed before storage.

Input sanitisation is applied at ingestion: strings are truncated to safe limits, control characters are stripped, and values are validated.

### Aggregation Pipeline

Handled entirely by ClickHouse Materialized Views (no BullMQ workers):

1. **On every INSERT** into `analytics_events`: All three Materialized Views fire and update their respective aggregate tables
2. **Minute aggregates**: `analytics_agg_minute` (AggregatingMergeTree, fed directly from `analytics_events`)
3. **Hour aggregates**: `analytics_agg_hour` (AggregatingMergeTree, fed directly from `analytics_events`)
4. **Day aggregates**: `analytics_agg_day` (AggregatingMergeTree, fed directly from `analytics_events`)

**Note**: All MVs read from the raw events table directly (no cascading chain). This avoids the problem of partial aggregate states being fed through tiers, which causes unbounded growth in `groupArray`-style columns. Using `sumMap` for breakdown fields ensures correct composability during AggregatingMergeTree background merges.

### Retention

Two-layer approach:

**Layer 1 -- ClickHouse TTL (hard floor)**:
- Raw events: TTL 90 days (global table-level setting, acts as a minimum retention floor)
- Minute aggregates: TTL 7 days
- Hour aggregates: TTL 180 days
- Day aggregates: TTL 365 days

**Layer 2 -- Query-time filtering (per-domain)**:
- Each domain's `rawRetentionDays` and `aggregateRetentionDays` settings are applied as `WHERE` clause filters at query time
- Queries add `AND timestamp >= now() - INTERVAL {retentionDays} DAY` based on the domain's configured retention
- This allows domains with shorter retention to see less data immediately, while ClickHouse TTL handles physical cleanup at the table-wide floor

**Note**: ClickHouse TTL is table-level and cannot vary per `analytics_config_id`. Per-domain retention is therefore a logical constraint enforced by the application, not a physical storage constraint.

### Real-Time Updates

1. When a raw event is written:
   - It is published to a Redis channel: `analytics:live:{analyticsConfigId}` (for WebSocket broadcast)
   - It is added to a Redis sorted set: `analytics:active:{analyticsConfigId}` (score = Unix timestamp, for live stats queries)
   - The sorted set is trimmed to the last 5 minutes on each write (ZREMRANGEBYSCORE to remove entries older than 5 min)
2. WebSocket connections subscribe to the relevant Redis channel
3. Dashboard receives live pageview/event notifications and updates counters
4. The `GET /internal/analytics/:configId/live` endpoint queries the Redis sorted set to return active visitors and active pages for the last 5 minutes
5. Redis pub/sub is fire-and-forget -- if the WebSocket server is restarting when a message is published, it is lost (acceptable for ephemeral real-time data)

### Entry/Exit Page Tracking

Each event includes `is_entry` and `is_exit` flags:
- `is_entry = true` when the event is the first pageview in a session (determined by session start time)
- `is_exit = true` when the event is the last pageview before the session ends (determined by inactivity threshold or explicit session end)

These flags enable entry page and exit page reports without requiring complex session-level queries.

### Best-Effort Delivery

Beacons are **best-effort** -- if ClickHouse is unavailable, events are dropped. There is no write buffer or retry queue. This is acceptable for analytics data, where occasional data loss during outages is preferable to the complexity of buffering.

## Extension Integration

### Extension Registry

**File to modify**: `apps/api/src/extensions/index.ts`

```typescript
export interface ExtensionStatus {
  sites: boolean;
  pomerium: boolean;
  analytics: boolean;  // NEW
}

// Follows the same service availability pattern as Sites/Pomerium
function isAnalyticsExtensionAvailable(): boolean {
  return !!process.env.UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT;
}
```

### Extension Config

```typescript
export interface ExtensionConfig {
  // ... existing
  analytics: {
    enabled: boolean;
    endpoint: string;       // analytics service URL
    clickhouseUrl: string;  // ClickHouse connection URL
  };
}
```

### Route Mounting

**File to modify**: `apps/api/src/index.ts`

```typescript
if (extensions.analytics) {
  const analyticsPromise = Promise.all([
    import("./routes/analytics"),
    import("./routes/analytics-config"),
    import("./routes/analytics-funnels"),
    import("./routes/analytics-public"),
  ]).then(([analyticsRoutes, configRoutes, funnelRoutes, publicRoutes]) => {
    app.route("/api/analytics", analyticsRoutes.default);
    app.route("/api/analytics/config", configRoutes.default);
    app.route("/api/analytics/funnels", funnelRoutes.default);
    app.route("/api/analytics/public", publicRoutes.default);
  });
}
```

## Docker Deployment

### New Services

```yaml
# docker-compose.analytics.yml (extension compose file)
services:
  # Override: pass analytics env vars to the API service
  api:
    environment:
      - UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT=http://analytics:3003
      - UNI_PROXY_MANAGER_INTERNAL_SECRET=${UNI_PROXY_MANAGER_INTERNAL_SECRET}
    depends_on:
      analytics:
        condition: service_healthy

  analytics:
    build:
      context: .
      dockerfile: docker/Dockerfile.analytics
    environment:
      - UNI_PROXY_MANAGER_DB_URL=${UNI_PROXY_MANAGER_DB_URL}
      - UNI_PROXY_MANAGER_REDIS_URL=${UNI_PROXY_MANAGER_REDIS_URL}
      - UNI_PROXY_MANAGER_CLICKHOUSE_URL=http://clickhouse:8123
      - UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD=${UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD}
      - UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT=http://analytics:3003
      - UNI_PROXY_MANAGER_INTERNAL_SECRET=${UNI_PROXY_MANAGER_INTERNAL_SECRET}
      - UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET=${UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET}
    networks:
      - uni-proxy-manager
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  analytics-workers:
    build:
      context: .
      dockerfile: docker/Dockerfile.analytics-workers
    environment:
      - UNI_PROXY_MANAGER_DB_URL=${UNI_PROXY_MANAGER_DB_URL}
      - UNI_PROXY_MANAGER_REDIS_URL=${UNI_PROXY_MANAGER_REDIS_URL}
      - UNI_PROXY_MANAGER_CLICKHOUSE_URL=http://clickhouse:8123
      - UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD=${UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD}
    networks:
      - uni-proxy-manager
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      clickhouse:
        condition: service_healthy

  clickhouse:
    image: clickhouse/clickhouse-server:24.8-alpine
    environment:
      - CLICKHOUSE_DB=analytics
      - CLICKHOUSE_USER=analytics
      - CLICKHOUSE_PASSWORD=${UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD}
    volumes:
      - clickhouse-data:/var/lib/clickhouse
      - clickhouse-logs:/var/log/clickhouse-server
    networks:
      - uni-proxy-manager
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    # Restrict to internal network only -- no published ports
    # Access via analytics service only (apps/api does NOT connect directly)

volumes:
  clickhouse-data:
  clickhouse-logs:
```

### HAProxy Integration

The analytics backend is added as a named backend in HAProxy config. Per-domain UUID routes are added as ACLs that match on `path_beg /_upm/{uuid}/` and route to the `analytics_backend`.

See [03-haproxy.md](./03-haproxy.md) for full details.

## CORS Strategy & Origin Validation

CORS must be dynamic because the analytics backend receives beacons from any domain that has analytics enabled. The analytics HTTP server handles CORS itself (not HAProxy):

1. On each request, extract the `Origin` header
2. Look up the UUID from the path to find the associated domain
3. If `Origin` matches the domain's hostname (or any configured allowed origin), set `Access-Control-Allow-Origin` to the request origin
4. Cache the UUID-to-domain mapping in memory (refreshed every 60s from PostgreSQL). Use a **stale-while-revalidate** pattern: serve from stale cache while refreshing asynchronously to avoid thundering herd on cache expiry
5. **Reject beacons with mismatched Origin**: If the `Origin` header does not match the expected domain (and is not in `allowedOrigins`), reject the request with 403. This prevents trivial analytics spam via `curl` (which sends no `Origin` header) or from unrelated domains. Note: this is a best-effort defence -- sophisticated attackers can forge headers, but it raises the bar significantly

Preflight `OPTIONS` requests are handled with a 204 response including the appropriate CORS headers.

## Rate Limiting

The beacon collection endpoint (`POST /_upm/{uuid}/collect`) and the pixel endpoint (`GET /_upm/{uuid}/pixel.gif`) are rate-limited to prevent abuse:

- **Per-IP limit**: 60 requests per minute (covers normal browsing patterns including SPA navigation)
- **Per-UUID limit**: 10,000 requests per minute (global cap per tracked domain)
- Implementation: Redis-based sliding window (matching existing `strictRateLimiter` pattern)
- Rate limit headers are included in responses (`X-RateLimit-Remaining`, `X-RateLimit-Reset`)
- Both `/collect` and `/pixel.gif` share the same rate limit counters

The server-side API endpoint (`POST /_upm/{uuid}/api`) uses a stricter per-token rate limit of 100 requests per minute. API tokens are validated using a **SHA-256 fast hash** stored alongside the bcrypt hash. The SHA-256 hash is checked first for per-request authentication (fast, constant-time). Bcrypt is only used during token generation/rotation. This prevents CPU exhaustion attacks from rapid requests with invalid tokens.

## WebSocket Authentication

The WebSocket endpoint (`WS /_upm/{uuid}/live`) is used by the dashboard to receive real-time updates. Authentication uses a **first-message pattern** to avoid leaking tokens in URLs, server logs, browser history, and referrer headers:

1. Client connects to the WebSocket endpoint without any token in the URL
2. The server accepts the connection but does **not** subscribe to any data channels yet
3. The client sends the first message containing: `{ "type": "auth", "token": "{sessionToken}" }`
4. The `sessionToken` is the same Bearer token used for the main API (existing auth middleware)
5. The analytics server validates the token against the API service
6. If valid, the server subscribes the connection to the relevant Redis pub/sub channel and sends `{ "type": "auth_ok" }`
7. If invalid, the server sends `{ "type": "auth_error" }` and closes the connection with a 1008 (Policy Violation) close frame
8. Any data messages sent before successful authentication are ignored
9. If no auth message is received within 5 seconds, the connection is closed

## Authorisation

The analytics extension inherits the existing proxy manager authorisation model:

- Domain owners can view analytics for their domains
- Organisation admins can view analytics for all domains in their organisation
- System admins can view analytics for all domains
- Public dashboard tokens provide read-only access to specific metrics for a specific domain (configurable scope)

## Technology Choices

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| HTTP server | Hono.js | Matches existing API pattern |
| Analytics storage | ClickHouse | Purpose-built for analytical queries, columnar compression, Materialized Views |
| Config storage | PostgreSQL (Drizzle) | Matches existing extension pattern, relational data |
| ClickHouse client | @clickhouse/client | Official ClickHouse JS client |
| WebSocket | ws (via Hono upgrade) | Lightweight, well-supported |
| User-Agent parsing | ua-parser-js or similar | Lightweight, no external dependencies |
| Timezone-to-country mapping | Static JSON lookup | No external dependencies, fast, accurate for most common timezones |
| Unique visitor detection | Referrer-domain matching | Privacy-first, no hashing, no storage, server-side only |
| API token fast-check | SHA-256 | Stored alongside bcrypt hash for per-request validation without CPU cost |
| Job scheduling | BullMQ | Matches existing worker pattern (funnels, anomaly). Workers in separate process |
| Real-time pub/sub | Redis pub/sub + sorted sets | Pub/sub for WebSocket broadcast (fire-and-forget), sorted sets for live stats state |
| Public dashboard sessions | JWT (HS256) | Short-lived (24h), signed with `UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET` |
