# Analytics Module - Implementation Progress

Tracks implementation status across sessions. Updated: 2026-02-08 (all gaps resolved)

---

## Phase 1: Foundation

| Task | Status | Files |
|------|--------|-------|
| PostgreSQL schema (analytics_config, analytics_funnels, analytics_funnel_results) | done | `packages/database/src/schema/analytics.ts` |
| Export from schema barrel | done | `packages/database/src/schema/index.ts` |
| Shared config env vars (ClickHouse, analytics endpoint, internal secret, JWT) | done | `packages/shared/src/config/env.ts` |
| Queue definitions (funnel-compute, anomaly-detection, aggregate-cleanup) | done | `packages/queue/src/queues.ts`, `types.ts`, `index.ts` |
| Analytics service package setup | done | `apps/analytics/package.json`, `tsconfig.json` |

## Phase 2: ClickHouse & Extension Registry

| Task | Status | Files |
|------|--------|-------|
| ClickHouse client wrapper | done | `apps/analytics/src/clickhouse/client.ts` |
| ClickHouse migrations (8 SQL files) | done | `apps/analytics/src/clickhouse/migrations/001-008` |
| Migration runner | done | `apps/analytics/src/clickhouse/migrate.ts` |
| Extension registry update | done | `apps/api/src/extensions/index.ts` |
| Route mounting in API entry point | done | `apps/api/src/index.ts` |

## Phase 3: Embed Scripts

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Bootstrap script (<2KB) | done | `apps/analytics/src/scripts/bootstrap.js` | 4.4KB unminified; needs minification verification for <2KB target |
| Full tracker (~10-15KB) | done | `apps/analytics/src/scripts/tracker.js` | 9KB unminified, within target |
| Timezone-to-country lookup | done | `apps/analytics/src/utils/timezone-countries.ts` | |
| Input sanitisation | done | `apps/analytics/src/utils/sanitise.ts` | |
| Hash-change tracking for hash-based SPAs | done | `apps/analytics/src/scripts/tracker.js` | hashchange event listener added |
| Device type detection from viewport width | done | `apps/analytics/src/scripts/bootstrap.js` | Sends computed `dt` field (mobile/tablet/desktop) based on viewport width |

## Phase 4: Analytics HTTP Service

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Hono server entry point | done | `apps/analytics/src/index.ts` | |
| Beacon collection (POST /collect) | done | `apps/analytics/src/routes/collect.ts` | |
| Script serving (GET /script.js, /tracker.js) | done | `apps/analytics/src/routes/scripts.ts` | |
| Pixel endpoint (GET /pixel.gif) | done | `apps/analytics/src/routes/pixel.ts` | Accept-Language country fallback for noscript visitors |
| Server-side API (POST /api) | done | `apps/analytics/src/routes/server-api.ts` | |
| WebSocket live endpoint | done | `apps/analytics/src/routes/live.ts` | Integrated into index.ts; Bun.serve websocket handler exported |
| CORS middleware | done | `apps/analytics/src/middleware/cors.ts` | |
| Rate limiting middleware | done | `apps/analytics/src/middleware/rate-limit.ts` | |
| Internal auth middleware | done | `apps/analytics/src/middleware/internal-auth.ts` | |
| Domain config cache | done | `apps/analytics/src/services/config-cache.ts` | |
| Event ingestion service | done | `apps/analytics/src/services/ingest.ts` | |
| User-Agent parser | done | `apps/analytics/src/utils/ua-parser.ts` | |
| WebSocket token validation | done | `apps/analytics/src/routes/live.ts` | Timing-safe comparison against internal secret |

## Phase 5: Analytics Internal API

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Internal API router | done | `apps/analytics/src/routes/internal/index.ts` | |
| Summary endpoint | done | | Cross-dimensional filters work |
| Timeseries endpoint | done | | Filters applied; falls back to raw events table when filtered |
| Pages endpoint | done | | Real uniqueVisitors and avgDurationMs from raw events |
| Referrers endpoint | done | | Filters applied |
| Geography endpoint | done | | Filters applied |
| Devices endpoint | done | | Filters applied |
| Events endpoint | done | | Default limit 50; filters applied |
| Event detail endpoint | done | | Includes timeseries field in response |
| UTM endpoint | done | | Filters applied |
| Live endpoint | done | | Redis query implementation |
| Export endpoint | done | | `type` parameter implemented (summary/pages/referrers/raw) with CSV support |
| Data deletion endpoint | done | | Redis-based rate limiting (1 request/hour per config) |

## Phase 6: API Routes (apps/api)

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Analytics config CRUD routes | done | `apps/api/src/routes/analytics-config.ts` | Includes password management and token rotation |
| Analytics data proxy routes | done | `apps/api/src/routes/analytics.ts` | Includes WebSocket info endpoint for live tab |
| Analytics funnel routes | done | `apps/api/src/routes/analytics-funnels.ts` | PUT validates steps and eventMetaMatch |
| Analytics public dashboard routes | done | `apps/api/src/routes/analytics-public.ts` | strictRateLimiter on auth endpoint (10/min) |
| Mount routes in API entry point | done | `apps/api/src/index.ts` | |

## Phase 7: HAProxy Integration

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Analytics backend definition | done | `packages/shared/src/haproxy/template.ts` | |
| Per-domain UUID ACL generation | done | `packages/shared/src/haproxy/template.ts` | |
| WebSocket tunnel timeout | done | `packages/shared/src/haproxy/template.ts` | `timeout tunnel 3600s` on analytics backend |
| HTTPS enforcement for /_upm/* | done | `packages/shared/src/haproxy/template.ts` | HTTP-to-HTTPS redirect when SSL frontend exists |
| Backend maxconn limit | done | `packages/shared/src/haproxy/template.ts` | `maxconn 1000` on analytics backend |

## Phase 8: Workers

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Worker package setup | done | `apps/analytics-workers/package.json` | |
| Worker entry point | done | `apps/analytics-workers/src/index.ts` | Queue instances tracked and closed during shutdown |
| Worker tsconfig | done | `apps/analytics-workers/tsconfig.json` | Extends root tsconfig |
| ClickHouse client for workers | done | `apps/analytics-workers/src/clickhouse.ts` | |
| Funnel computation processor | done | `apps/analytics-workers/src/processors/funnel-compute.ts` | BATCH_SIZE defined but unused; loads all events at once (acceptable for current scale) |
| Anomaly detection processor | done | `apps/analytics-workers/src/processors/anomaly-detection.ts` | Baseline uses uniform hourly distribution (acceptable approximation) |
| Aggregate cleanup processor | done | `apps/analytics-workers/src/processors/aggregate-cleanup.ts` | |

## Phase 9: UI (apps/web)

| Task | Status | Files | Notes |
|------|--------|-------|-------|
| Analytics overview page | done | `apps/web/src/app/analytics/page.tsx` | Includes sparkline charts (SVG, last 7 days) |
| Domain dashboard page | done | `apps/web/src/app/analytics/[configId]/page.tsx` | Includes filter bar, comparison toggle, info tooltips |
| Public dashboard page | done | `apps/web/src/app/analytics/public/[token]/page.tsx`, `layout.tsx` | |
| Analytics hooks | done | `apps/web/src/hooks/use-analytics.ts`, `use-analytics-data.ts`, `use-analytics-funnels.ts` | |
| Hook barrel exports | done | `apps/web/src/hooks/index.ts` | All 28 analytics hooks exported |
| Period selector component | done | `.../_components/period-selector.tsx` | 24h, 7d, 30d, 90d options |
| Overview tab | done | `.../_components/overview-tab.tsx` | Supports showComparison prop |
| Pages tab | done | `.../_components/pages-tab.tsx` | |
| Referrers tab | done | `.../_components/referrers-tab.tsx` | Includes UTM breakdown (tabbed sources/mediums/campaigns) |
| Geography tab | done | `.../_components/geography-tab.tsx` | Includes timezone-based detection info tooltip |
| Devices tab | done | `.../_components/devices-tab.tsx` | |
| Events tab | done | `.../_components/events-tab.tsx` | Includes event detail drill-down view |
| Funnels tab | done | `.../_components/funnels-tab.tsx` | Dropoff display, analysis window selector, enable/disable toggle |
| Real-time tab | done | `.../_components/realtime-tab.tsx` | WebSocket with HTTP polling fallback; connection indicator |
| Settings tab | done | `.../_components/settings-tab.tsx` | |
| Sidebar navigation | done | `apps/web/src/components/sidebar.tsx` | |
| Extension hook | done | `apps/web/src/hooks/use-extensions.ts` | |
| Cross-dimensional filter bar | done | `.../_components/filter-bar.tsx` | 9 filter dimensions, chip display, integrated into dashboard page |
| Comparison toggle | done | `apps/web/src/app/analytics/[configId]/page.tsx` | Switch to show/hide comparison data |
| Info tooltips | done | Dashboard page + geography tab | Unique visitors approximation + timezone-based geography |

## Phase 10: Docker & Deployment

| Task | Status | Files |
|------|--------|-------|
| docker-compose.analytics.yml | done | `docker-compose.analytics.yml` |
| Dockerfile.analytics | done | `docker/Dockerfile.analytics` |
| Dockerfile.analytics-workers | done | `docker/Dockerfile.analytics-workers` |

---

## Known Gaps (prioritised)

All previously identified gaps have been resolved. See git history for details.

### Remaining Notes

- **Bootstrap script size**: 4.4KB unminified. Needs minification verification to confirm <2KB target is met.
- **Funnel batch processing**: BATCH_SIZE is defined but events are loaded at once. Acceptable at current scale but may need revisiting for very large funnels.
- **Anomaly baseline**: Uses uniform hourly distribution rather than per-hour historical baselines. Acceptable approximation for most use cases.

---

## Architecture Notes

- All PostgreSQL tables use nanoid primary keys (existing pattern)
- ClickHouse migrations are idempotent (CREATE IF NOT EXISTS)
- All three MVs read directly from analytics_events (no cascading)
- Extension detected via UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT presence
- apps/api proxies data queries to analytics service internal API via X-Internal-Secret header
- Only the analytics service connects to ClickHouse directly
- Workers run in a separate process (apps/analytics-workers)
- Embed scripts are plain JS served to browsers (not TypeScript)
- Bootstrap must be <2KB minified, tracker ~10-15KB
- Privacy-first: no cookies, no IP storage, no persistent identifiers
- Unique visitors approximated via referrer-domain matching
- Country detection via browser timezone (not GeoIP)
- Internal auth uses X-Internal-Secret header (not Authorization: Bearer)
- Live endpoint uses Redis sorted sets for active visitors/pages, pub/sub for real-time updates
- WebSocket live endpoint uses first-message authentication pattern with timing-safe token validation
- UI uses Next.js 15 App Router with use(params), React Query, Recharts, shadcn-style components
- Public dashboard auth uses JWT in React state + Authorization header (consistent with main dashboard API key pattern)
- stepDropoffs column exists in analyticsFunnelResults (undocumented enhancement)
- HAProxy analytics backend has timeout tunnel (3600s) and maxconn (1000)
- Real-time tab uses WebSocket with automatic HTTP polling fallback
- Cross-dimensional filters applied across all data endpoints (timeseries, pages, referrers, geography, devices, utm)
