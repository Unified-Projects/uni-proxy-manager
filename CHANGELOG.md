# Changelog

All notable changes to Uni-Proxy-Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
