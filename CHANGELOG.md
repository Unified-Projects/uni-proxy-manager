# Changelog

All notable changes to Uni-Proxy-Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-04-14

### Added
- Compile uploaded maintenance pages into HAProxy-ready `maintenance.http` responses with local CSS, JavaScript, and image assets inlined for direct serving
- Add unit and integration coverage for maintenance page compilation plus analytics health and live snapshot degradation handling

### Changed
- Return HTTP 200 from analytics health checks while reporting degraded dependency status in the response body
- Point HAProxy config generation and startup initialisation at compiled `maintenance.http` files for domain and site maintenance backends
- Use argument-safe child process execution in integration test setup instead of shell-dependent command invocation

### Fixed
- Recompile maintenance pages on upload, page updates, and maintenance enablement so HAProxy always serves the latest page bundle
- Fall back to empty analytics live snapshots when Redis is unavailable instead of failing the endpoint
- Reset ended Redis clients in shared Redis utilities and API rate limiting so services can recover cleanly after disconnects

## [0.1.2] - 2026-04-13

### Security
- Make API auth fail closed when `UNI_PROXY_MANAGER_AUTH_ENABLED=true` is set without a valid API key, while preserving the `/health` and `/api/analytics-public/*` bypasses
- Apply rate limits correctly for repeated bad API key attempts and return `Retry-After` metadata
- Require a bearer-protected invalidate secret for `sites-lookup` cache invalidation
- Prevent cluster node forwarding from sending stored credentials to public destinations
- Strip unsafe imported certificate file paths during settings import before persisting records
- Block outbound network access during error-page preview generation

### Changed
- Normalize cluster node API origins and stop returning stored node API keys from cluster APIs
- Treat the configured Pomerium authenticate hostname as routed instead of reporting it as `no-backends`
- Aggregate traffic metrics into hourly buckets with zero-filled gaps for day and last-24-hour views
- Aggregate site analytics records into shared time buckets and combine ranked page, referrer, and geography totals before applying limits
- Keep analytics live polling enabled by default while allowing it to be disabled explicitly when another realtime transport is active
- Refresh web certificate, cluster, Pomerium identity-provider, site settings, and typed API client flows to match the updated backend behavior
- Queue HAProxy site-config update jobs during deployment promotion and carry render-mode/runtime metadata needed for custom and SSR runtimes
- Preserve binary request and response bodies in the Rust `sites-lookup` proxy through binary-safe multipart and spooled response handling

### Fixed
- Update certificate SANs in place, normalize alternate names, and queue forced reissue work on the existing certificate record
- Link auto-created DNS certificates back to their originating domain immediately after domain creation
- Restrict certificate and domain cleanup to managed certificate directories inside the cert volume, leaving unmanaged absolute paths untouched
- Stop plain static ZIP uploads and redeploys from injecting implicit Node install/build commands when no build step is required
- Stop site API responses from exposing raw environment variables while keeping the dedicated env endpoint masked and available
- Restrict preview file access to the error page's own directory during preview generation
- Expand integration and unit coverage for certificates, domains, metrics, analytics, settings import, ZIP uploads, and site build/deploy jobs

## [0.1.1] - 2026-03-27

### Fixed
- Fix analytics Dockerfile to serve minified scripts
- Fix release workflow to use correct version tags for images and GitHub releases
- Stabilize CI docker startup (Pomerium, HAProxy, Dex config mounts and health checks)

### Changed
- Domain status improvements and routing updates
- Data table and dialog component refinements
- HAProxy settings UI updates
- Updated integration tests for error pages, maintenance pages, and preview generation

## [0.1.0] - 2026-03-18

### Added
- Initial public release of Uni-Proxy-Manager
- Full reverse-proxy management platform with:
  - Domain and backend routing management
  - TLS certificate request/upload/renewal flows
  - Security header, blocked-route, and access-control configuration
- Built-in site hosting and deployment workflows (static + SSR via extension):
  - Site creation, build/deploy/redeploy/rollback flows
  - GitHub-connected and direct upload deployments
  - Per-site analytics and deployment history
- Pomerium integration for protected routes and identity providers
- Analytics stack for traffic, events, funnels, and public analytics views
- Operational tooling:
  - Cluster/runtime views, metrics, and system configuration APIs
  - Background workers for certificate, HAProxy, deployment, and maintenance jobs
- Comprehensive test coverage:
  - Unit, integration, E2E UI, and real E2E executor-backed tests
- Docker-based local development and CI test workflows

### Security
- Added public vulnerability reporting policy in `SECURITY.md`
