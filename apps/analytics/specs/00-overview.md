# Analytics Extension - Specification Index

Privacy-first, self-hosted analytics for domains managed by Uni-Proxy-Manager. Inspired by Simple Analytics with additional capabilities: funnel tracking, real-time WebSocket updates, public dashboards, and ClickHouse-powered analytical queries.

## Spec Documents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture](./01-architecture.md) | System architecture, data flow, deployment model, extension integration |
| 02 | [Database](./02-database.md) | Dual storage: PostgreSQL (config, Drizzle ORM) + ClickHouse (events, aggregates) |
| 03 | [HAProxy Integration](./03-haproxy.md) | Per-domain UUID route generation (`/_upm/{uuid}/*`) in HAProxy config |
| 04 | [Embed Script](./04-embed-script.md) | Client-side tracking script (bootstrap + lazy-loaded tracker) |
| 05 | [API Endpoints](./05-api.md) | REST API for analytics data, configuration, CSV export |
| 06 | [Workers](./06-workers.md) | Background jobs: GeoIP updates, funnel computation, anomaly detection |
| 07 | [UI](./07-ui.md) | Analytics dashboard pages and components |
| 08 | [Public Dashboards](./08-public-dashboards.md) | Shareable read-only dashboards with auth options |
| 09 | [Funnels](./09-funnels.md) | Conversion funnel definition and tracking |

## Key Design Decisions

- **Per-domain UUID routes**: Each domain gets a unique `/_upm/{uuid}/` path in HAProxy, proxied to the analytics backend
- **Opt-in per domain**: Domain owners explicitly enable analytics
- **Privacy-first, no consent required**: No cookies, no fingerprinting, no pseudonymous identifiers stored. Unique visitor detection based on referrer-domain matching (if referrer hostname matches current site, it's a returning visit; otherwise unique). Country detection via browser timezone (using `Intl.DateTimeFormat().resolvedOptions().timeZone`), not IP geolocation. No IP addresses received, stored, or processed. Compliant with GDPR/ePrivacy without consent requirements
- **Lazy-load script**: <2KB bootstrap sends initial pageview, then loads full tracker (~10-15KB). Graceful degradation for older browsers (try/catch guards for modern APIs)
- **ClickHouse for analytics data**: Raw events and aggregates stored in ClickHouse (columnar, compressed, fast). Materialised Views handle automatic rollups using `sumMap` for breakdown fields. TTL handles baseline retention. Only deployed when analytics is enabled
- **PostgreSQL for config**: Analytics configuration, funnel definitions, and public dashboard settings stay in PostgreSQL via Drizzle ORM (matching existing extension pattern)
- **Analytics service as ClickHouse proxy**: Only `apps/analytics` connects to ClickHouse. The API service (`apps/api`) queries analytics data via internal HTTP endpoints on the analytics service, matching how Sites delegates to its executor
- **Separate from existing HAProxy analytics**: The new analytics module is independent. Existing server-side HAProxy metrics on the domain detail page remain untouched. The `site_analytics` table tracks server-side HAProxy log data; the new module tracks client-side JS interactions. Both coexist, serving different purposes
- **Own Docker service**: Dedicated container for beacon receiver, plus a separate analytics worker process, plus ClickHouse container
- **Timezone-based country detection**: Browser timezone used to derive country (no GeoIP, no IP processing)
- **Real-time**: WebSocket for live visitor counts and event streams (first-message authentication, Redis pub/sub for broadcast, Redis sorted sets for recent state)
- **Configurable retention**: Global ClickHouse TTL as a floor; per-domain retention enforced at query time. Minute aggregates TTL set to 7 days
- **Extension detection**: Service availability pattern (matching Sites/Pomerium), not env var toggle
- **Breakdown cardinality cap**: `sumMap` fields capped at configurable per-domain limit with global maximum of 500 entries (enforced at query time)
- **Session model**: Client-generated in-memory session IDs (not persisted to storage) with server-side `is_bounce` detection based on single-pageview sessions. Funnels track steps within a single session only (no cross-session tracking)
- **Browser support**: Modern browsers (Chrome 60+, Firefox 55+, Safari 12+, Edge 79+) with graceful degradation for older browsers via try/catch guards
- **Query string handling**: Stripped from pathnames by default (only `location.pathname` sent). UTM parameters extracted separately. Configurable parameter allowlist available for specific tracking needs
- **Privacy-respecting pixel endpoint**: Server-side privacy checks (Sec-GPC header, Referer validation). Best-effort delivery accepted -- data loss during ClickHouse outages is documented and expected
- **Entry/exit page tracking**: `is_entry` and `is_exit` flags in data model for session flow analysis
- **UTM medium tracking**: Added to aggregates alongside other UTM parameters
- **Input sanitisation**: Dual-layer approach with truncation, validation, and control character stripping at ingestion, plus HTML encoding at rendering
- **Cross-dimensional filtering**: Launch requirement on all data query endpoints for flexible analysis
- **Authorisation model**: Inherits existing proxy manager model (all users see everything). Public dashboards handled by Pomerium integration
