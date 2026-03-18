# 05 - API Endpoints

## Overview

Analytics API routes are added to the main `apps/api` service, dynamically loaded when the analytics extension is enabled. All routes are prefixed with `/api/analytics`.

These routes serve the **dashboard UI** and **data export**. The beacon collection endpoints live in the separate `apps/analytics` service (see [04-embed-script.md](./04-embed-script.md)).

**Important**: The API service does **not** connect to ClickHouse directly. All analytics data queries are forwarded to the analytics service's internal API endpoints (`/internal/analytics/...`), which handle ClickHouse queries and return formatted results. This matches how the Sites extension delegates to its executor service. The internal API is authenticated via a shared secret (`UNI_PROXY_MANAGER_INTERNAL_SECRET`).

## Route Files

| File | Prefix | Purpose |
|------|--------|---------|
| `apps/api/src/routes/analytics.ts` | `/api/analytics` | Data query endpoints |
| `apps/api/src/routes/analytics-config.ts` | `/api/analytics/config` | Analytics configuration CRUD |
| `apps/api/src/routes/analytics-funnels.ts` | `/api/analytics/funnels` | Funnel definition CRUD + results |
| `apps/api/src/routes/analytics-public.ts` | `/api/analytics/public` | Public dashboard data (no auth) |

---

## Configuration Endpoints

### `GET /api/analytics/config`

List all analytics configurations (one per domain).

**Response**:
```json
{
  "configs": [
    {
      "id": "abc123",
      "domainId": "dom456",
      "domainHostname": "example.com",
      "trackingUuid": "a1b2c3d4-...",
      "enabled": true,
      "rawRetentionDays": 90,
      "aggregateRetentionDays": 365,
      "maxBreakdownEntries": 100,
      "publicDashboardEnabled": false,
      "publicDashboardToken": null,
      "trackScrollDepth": true,
      "trackSessionDuration": true,
      "trackOutboundLinks": true,
      "ignoredPaths": ["/admin/*"],
      "allowedOrigins": [],
      "embedSnippet": "<script src=\"https://example.com/_upm/a1b2c3d4-.../script.js\" defer></script>",
      "createdAt": "2026-02-07T00:00:00Z"
    }
  ]
}
```

### `GET /api/analytics/config/:domainId`

Get analytics configuration for a specific domain.

### `POST /api/analytics/config/:domainId/enable`

Enable analytics for a domain. Creates the `analytics_config` record, generates a UUID, and triggers an HAProxy reload.

**Request**:
```json
{
  "rawRetentionDays": 90,
  "aggregateRetentionDays": 365,
  "trackScrollDepth": true,
  "trackSessionDuration": true,
  "trackOutboundLinks": true,
  "ignoredPaths": []
}
```

**Side effects**:
- Generates `tracking_uuid` (UUIDv4)
- Generates `current_daily_salt` (random 32-char hex)
- Queues `HAPROXY_RELOAD` job to add the analytics route

### `POST /api/analytics/config/:domainId/disable`

Disable analytics for a domain. Sets `enabled = false` and triggers HAProxy reload to remove the route.

**Note**: Does not delete data. Data is retained until manually purged or ClickHouse TTL cleans it up.

### `PUT /api/analytics/config/:domainId`

Update analytics configuration (retention settings, tracking options, ignored paths, allowed origins, breakdown cardinality cap).

### `DELETE /api/analytics/config/:domainId`

Permanently remove analytics configuration and all associated data for a domain. Triggers HAProxy reload. ClickHouse data deletion is handled asynchronously via the analytics service's internal API (`DELETE /internal/analytics/:configId/data`), which queues the `ALTER TABLE DELETE` mutation as a background operation. This avoids blocking the user-facing API with an expensive ClickHouse mutation.

**Rate limit**: 1 delete per domain per hour to prevent abuse.

### `POST /api/analytics/config/:domainId/regenerate-uuid`

Regenerate the tracking UUID for a domain. Invalidates the old embed script. Triggers HAProxy reload.

### `POST /api/analytics/config/:domainId/regenerate-api-token`

Generate or regenerate the API token for server-side event submission. Returns the plaintext token once; both a bcrypt hash and a SHA-256 hash are stored. The SHA-256 hash is used for fast per-request validation; bcrypt is retained for key rotation verification.

**Response**:
```json
{
  "apiToken": "upm_at_...",
  "message": "Store this token securely. It will not be shown again."
}
```

---

## Data Query Endpoints

All data endpoints accept query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `start` | ISO 8601 | 7 days ago | Period start |
| `end` | ISO 8601 | now | Period end |
| `granularity` | `minute\|hour\|day` | auto | Aggregate granularity |

Granularity auto-selection:
- < 24 hours: `minute`
- < 7 days: `hour`
- >= 7 days: `day`

**Data source**: These endpoints proxy to the analytics service's internal API (`/internal/analytics/...`), which queries ClickHouse aggregate tables (or raw events for detailed breakdowns). The API service does **not** connect to ClickHouse directly. Per-domain retention is enforced at query time by the analytics service.

### Cross-Dimensional Filtering

All data query endpoints (summary, timeseries, pages, referrers, utm, geography, devices, events) support the following optional filter parameters:

| Param | Type | Description | Example |
|-------|------|-------------|---------|
| `country` | string | Filter by ISO 3166-1 alpha-2 country code | `?country=GB` |
| `device` | string | Filter by device type: `desktop`, `mobile`, `tablet` | `?device=mobile` |
| `browser` | string | Filter by browser name | `?browser=Firefox` |
| `os` | string | Filter by operating system name | `?os=Windows` |
| `referrer_domain` | string | Filter by referrer domain | `?referrer_domain=google.com` |
| `utm_source` | string | Filter by UTM source parameter | `?utm_source=newsletter` |
| `utm_medium` | string | Filter by UTM medium parameter | `?utm_medium=email` |
| `utm_campaign` | string | Filter by UTM campaign parameter | `?utm_campaign=spring_sale` |
| `pathname` | string | Filter by pathname prefix match | `?pathname=/blog` |

All filters are optional and can be combined (AND logic). For example: `?country=GB&device=mobile&pathname=/blog` returns data for mobile visitors from the UK viewing pages under `/blog`.

**Note**: When filters are applied, the response includes the same data structure but filtered to matching events/sessions only.

### `GET /api/analytics/:configId/summary`

Summary statistics for the period.

**Response**:
```json
{
  "summary": {
    "pageViews": 15420,
    "uniqueVisitors": 3891,
    "sessions": 4102,
    "bounceRate": 42.5,
    "avgSessionDurationMs": 127000,
    "avgScrollDepthPct": 62,
    "customEvents": 892,
    "topPage": "/pricing",
    "topReferrer": "google.com"
  },
  "comparison": {
    "pageViewsChange": 12.3,
    "uniqueVisitorsChange": -2.1,
    "bounceRateChange": -5.0
  }
}
```

The `comparison` field compares to the equivalent previous period (e.g. if querying 7 days, compares to the 7 days before that).

**Note**: `uniqueVisitors` is an approximate count based on referrer-domain matching (similar to Simple Analytics). Counts may slightly over-count across multi-page sessions.

### `GET /api/analytics/:configId/timeseries`

Time-bucketed data for charting.

**Response**:
```json
{
  "timeseries": [
    {
      "bucketStart": "2026-02-07T10:00:00Z",
      "pageViews": 142,
      "uniqueVisitors": 89,
      "sessions": 94,
      "bounces": 38,
      "customEvents": 12
    }
  ]
}
```

### `GET /api/analytics/:configId/pages`

Top pages by pageviews, including entry and exit page data.

**Query params**: `limit` (default 20)

**Response**:
```json
{
  "pages": [
    { "pathname": "/", "pageViews": 5200, "uniqueVisitors": 2100, "avgDurationMs": 45000 },
    { "pathname": "/pricing", "pageViews": 3100, "uniqueVisitors": 1800, "avgDurationMs": 92000 }
  ],
  "entryPages": [
    { "pathname": "/", "visitors": 1200, "sessions": 1350 },
    { "pathname": "/blog/post-1", "visitors": 450, "sessions": 480 }
  ],
  "exitPages": [
    { "pathname": "/checkout", "visitors": 320, "sessions": 340 },
    { "pathname": "/", "visitors": 280, "sessions": 290 }
  ]
}
```

**Entry pages** are pages where sessions begin (first pageview in a session).
**Exit pages** are pages where sessions end (last pageview in a session).

### `GET /api/analytics/:configId/referrers`

Top referrer domains.

**Query params**: `limit` (default 20)

**Response**:
```json
{
  "referrers": [
    { "domain": "google.com", "visitors": 1200, "pageViews": 2400 },
    { "domain": "(direct)", "visitors": 800, "pageViews": 1100 },
    { "domain": "twitter.com", "visitors": 340, "pageViews": 450 }
  ]
}
```

### `GET /api/analytics/:configId/geography`

Visitors by country.

**Response**:
```json
{
  "countries": [
    { "countryCode": "GB", "visitors": 1200, "pageViews": 3400 },
    { "countryCode": "US", "visitors": 980, "pageViews": 2100 }
  ]
}
```

### `GET /api/analytics/:configId/devices`

Device, browser, and OS breakdown.

**Response**:
```json
{
  "devices": { "desktop": 2400, "mobile": 1200, "tablet": 180, "other": 30 },
  "browsers": [
    { "name": "Chrome", "count": 2100 },
    { "name": "Safari", "count": 900 }
  ],
  "os": [
    { "name": "Windows", "count": 1500 },
    { "name": "macOS", "count": 1100 }
  ]
}
```

### `GET /api/analytics/:configId/events`

Custom event summary.

**Query params**: `limit` (default 50)

**Response**:
```json
{
  "events": [
    { "name": "signup_click", "count": 342, "uniqueVisitors": 298 },
    { "name": "outbound_click", "count": 210, "uniqueVisitors": 185 }
  ]
}
```

### `GET /api/analytics/:configId/events/:eventName`

Detailed data for a specific event, including metadata breakdown, timeseries, and top pages where the event fires.

**Query params**: Same as other data endpoints (`start`, `end`, `granularity`), plus all cross-dimensional filters.

**Response**:
```json
{
  "eventName": "signup_click",
  "totalCount": 342,
  "uniqueVisitors": 298,
  "metadata": [
    { "key": "button_id", "value": "hero_cta", "count": 180 },
    { "key": "button_id", "value": "nav_signup", "count": 162 },
    { "key": "plan", "value": "premium", "count": 210 },
    { "key": "plan", "value": "starter", "count": 132 }
  ],
  "timeseries": [
    {
      "bucketStart": "2026-02-07T10:00:00Z",
      "count": 12,
      "uniqueVisitors": 11
    }
  ],
  "topPages": [
    { "pathname": "/pricing", "count": 180 },
    { "pathname": "/", "count": 120 }
  ]
}
```

The `metadata` array shows key-value pairs attached to the event, sorted by count descending. The `timeseries` shows event occurrences over time. The `topPages` shows which pages the event was fired from most frequently.

### `GET /api/analytics/:configId/utm`

UTM campaign breakdown, including sources, mediums, and campaigns.

**Response**:
```json
{
  "sources": [
    { "source": "google", "visitors": 800, "pageViews": 1600 }
  ],
  "mediums": [
    { "medium": "cpc", "visitors": 650, "percentage": 42.3 },
    { "medium": "email", "visitors": 420, "percentage": 27.4 }
  ],
  "campaigns": [
    { "campaign": "spring_sale", "visitors": 200, "pageViews": 450 }
  ]
}
```

The `mediums` array includes a `percentage` field showing the proportion of total visitors attributed to each medium.

### `GET /api/analytics/:configId/live`

Current real-time stats (last 5 minutes).

**Data source**: Redis sorted set `analytics:active:{configId}` (score = Unix timestamp). The analytics service trims entries older than 5 minutes on each write and queries the set for this endpoint. This provides real-time data without requiring ClickHouse queries, and survives brief ClickHouse unavailability.

**Response**:
```json
{
  "activeVisitors": 23,
  "activePages": [
    { "pathname": "/pricing", "visitors": 8 },
    { "pathname": "/", "visitors": 6 }
  ],
  "recentEvents": [
    { "type": "pageview", "pathname": "/blog/hello", "timestamp": "2026-02-07T14:32:01Z" },
    { "type": "event", "name": "signup_click", "timestamp": "2026-02-07T14:31:58Z" }
  ]
}
```

---

## Export Endpoints

### `GET /api/analytics/:configId/export/csv`

Export analytics data as CSV.

**Query params**:
- `start`, `end` - Date range
- `type` - `pageviews | events | summary | all` (default: `summary`)
- All cross-dimensional filter parameters are supported

**Response**: CSV file download with `Content-Disposition: attachment` header.

**CSV formula injection prevention**: Cell values that start with `=`, `+`, `-`, `@`, `\t`, `\r`, or `0x` are prefixed with a single quote (`'`) to prevent spreadsheet formula execution when opened in Excel/Google Sheets. This applies to all string fields (pathnames, event names, referrer URLs, metadata values).

**Max rows**: Exports are limited to 100,000 rows per request. If the result set exceeds this limit, only the first 100,000 rows are returned. Use date range filtering or the offset parameter (if supported) to paginate through larger datasets.

### `GET /api/analytics/:configId/export/json`

Same as CSV but returns JSON array. Useful for programmatic consumption.

**Query params**: Same as CSV export endpoint.

**Max rows**: 100,000 rows per request.

---

## Error Responses

All API endpoints return errors in a consistent JSON format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description"
  }
}
```

### HTTP Status Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_DATE_RANGE` | Start date must be before end date |
| 400 | `INVALID_GRANULARITY` | Granularity must be minute, hour, or day |
| 400 | `INVALID_FILTER_VALUE` | Filter parameter value is invalid |
| 401 | `UNAUTHENTICATED` | Missing or invalid authentication token |
| 403 | `FORBIDDEN` | User lacks permission to access this resource |
| 404 | `CONFIG_NOT_FOUND` | Analytics configuration does not exist |
| 404 | `EVENT_NOT_FOUND` | Event name does not exist in the specified period |
| 429 | `RATE_LIMITED` | Too many requests, please slow down |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `CLICKHOUSE_UNAVAILABLE` | Analytics database is temporarily unavailable |

---

## Authorisation

Analytics access inherits the existing proxy manager permission model. All authenticated users can access all analytics data for all domains.

Public dashboard endpoints (`/api/analytics/public/*`) are separately gated by token and optional password protection. These endpoints do not require the standard authentication Bearer token but instead validate the public dashboard token (UUID) and session-based password authentication if enabled.

---

## Authentication

- All `/api/analytics/*` endpoints (except public) use the existing auth middleware (Bearer token)
- Public dashboard endpoints at `/api/analytics/public/*` skip the main auth middleware but enforce their own access control (public token + optional password session)
- Internal API calls from `apps/api` to the analytics service use a shared secret (`UNI_PROXY_MANAGER_INTERNAL_SECRET`) via an `X-Internal-Secret` header
