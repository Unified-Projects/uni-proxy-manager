# 03 - HAProxy Integration

## Overview

Each domain with analytics enabled gets a unique UUID route in HAProxy. Requests to `/_upm/{uuid}/*` are proxied to the analytics backend service. This means the tracking script and beacon endpoints share the same origin as the tracked site, avoiding third-party cookie/CORS issues.

**HTTPS enforcement**: All analytics endpoints (beacons, scripts) should be accessed over HTTPS. HAProxy should enforce HTTPS redirection for analytics routes.

## Route Pattern

```
https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/script.js
https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/tracker.js
https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/collect
https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/pixel.gif
https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/api
https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/live  (WebSocket)
```

The UUID is stored in `analytics_config.tracking_uuid` and generated when analytics is enabled for a domain.

**Note on `pixel.gif`**: The pixel endpoint is intended for noscript web visitors only (users without JavaScript enabled). The pixel performs server-side validation of the `Sec-GPC` header and validates the Referer header.

## HAProxy Config Changes

### Files to Modify

- `packages/shared/src/haproxy/types.ts` - Add `AnalyticsRouteConfig` and `AnalyticsBackendConfig` types
- `packages/shared/src/haproxy/template.ts` - Add analytics backend and ACL generation

### New Types

```typescript
// In packages/shared/src/haproxy/types.ts

export interface AnalyticsRouteConfig {
  domainId: string;
  hostname: string;
  trackingUuid: string;
  enabled: boolean;
}

export interface AnalyticsBackendConfig {
  host: string;   // "analytics" (Docker service name)
  port: number;   // 3003
}
```

### Backend Definition

A single shared backend for all analytics routes:

```typescript
export function generateAnalyticsBackend(
  config: AnalyticsBackendConfig = { host: "analytics", port: 3003 }
): HAProxyBackend {
  return {
    name: "analytics_backend",
    mode: "http",
    loadBalanceMethod: "roundrobin",
    servers: [
      {
        name: "analytics",
        address: config.host,
        port: config.port,
        weight: 100,
        healthCheck: {
          enabled: true,
          path: "/health",
          interval: 5,
          timeout: 3,
          fall: 3,
          rise: 2,
        },
      },
    ],
    httpCheck: {
      path: "/health",
      expectStatus: 200,
    },
  };
}
```

### ACL Generation

For each domain with analytics enabled, add path-based ACLs to both HTTP and HTTPS frontends:

```typescript
function applyAnalyticsRoutes(
  frontend: HAProxyFrontend,
  analyticsRoutes: AnalyticsRouteConfig[]
): void {
  const enabledRoutes = analyticsRoutes.filter(r => r.enabled);
  if (enabledRoutes.length === 0) return;

  frontend.httpRequestRules = frontend.httpRequestRules || [];

  // Collect all analytics ACLs first, then insert them as a batch
  // before existing use_backend rules. This avoids ordering issues
  // when multiple domains each call unshift() individually.
  const analyticsUseBackends: UseBackendRule[] = [];

  for (const route of enabledRoutes) {
    const sanitizedDomain = sanitizeIdentifier(route.hostname);
    const aclName = `analytics_${sanitizedDomain}`;

    // Match: host is this domain AND path starts with /_upm/{uuid}/
    frontend.acls.push({
      name: aclName,
      condition: `hdr(host) -i ${route.hostname} path_beg /_upm/${route.trackingUuid}/`,
    });

    analyticsUseBackends.push({
      backendName: "analytics_backend",
      condition: aclName,
    });
  }

  // Insert all analytics routes before existing domain routing rules
  frontend.useBackends.unshift(...analyticsUseBackends);
}
```

### Integration into `generateCompleteHAProxyConfig`

**File**: `packages/shared/src/haproxy/template.ts`

Extend the `generateCompleteHAProxyConfig` function signature:

```typescript
export function generateCompleteHAProxyConfig(
  domains: DomainConfig[],
  options: {
    certsDir?: string;
    errorPagesDir?: string;
    sites?: SiteConfig[];
    executorConfig?: SitesExecutorConfig;
    pomerium?: PomeriumConfig;
    analytics?: {                              // NEW
      routes: AnalyticsRouteConfig[];
      backend?: AnalyticsBackendConfig;
    };
  } = {}
): HAProxyConfig {
```

Add analytics handling after existing extension processing:

```typescript
// Apply analytics routes if enabled
if (options.analytics?.routes && options.analytics.routes.length > 0) {
  // Add analytics backend
  config.backends.push(
    generateAnalyticsBackend(options.analytics.backend)
  );

  // Apply analytics ACLs to frontends
  const httpFrontend = config.frontends.find(f => f.name === "http_front");
  const httpsFrontend = config.frontends.find(f => f.name === "https_front");

  if (httpFrontend) {
    applyAnalyticsRoutes(httpFrontend, options.analytics.routes);
  }
  if (httpsFrontend) {
    applyAnalyticsRoutes(httpsFrontend, options.analytics.routes);
  }
}
```

### Generated HAProxy Config Example

For a domain `example.com` with UUID `a1b2c3d4-e5f6-7890-abcd-ef1234567890`:

```haproxy
frontend http_front
    mode http
    bind *:80

    # Analytics ACL (before domain routing)
    acl analytics_example_com hdr(host) -i example.com path_beg /_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/
    use_backend analytics_backend if analytics_example_com

    # Normal domain routing
    acl host_example_com hdr(host) -i example.com
    use_backend backend_example_com if host_example_com

    default_backend fallback_backend

backend analytics_backend
    mode http
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200
    server analytics analytics:3003 weight 100 check inter 5s fall 3 rise 2
```

### Important: ACL Ordering

Analytics ACLs must be inserted **before** regular domain routing ACLs. This is achieved by using `frontend.useBackends.unshift(...analyticsUseBackends)` to batch-insert all analytics rules at position 0. HAProxy evaluates `use_backend` rules in order, so the more specific `/_upm/{uuid}/` path match must come first.

**Note**: All analytics routes point to the same `analytics_backend`, so their relative ordering amongst themselves does not matter. Only the ordering relative to domain-level `use_backend` rules is important.

## HAProxy Reload Trigger

When analytics is enabled/disabled for a domain, or when a domain's tracking UUID changes, the `HAPROXY_RELOAD` queue job must be triggered to regenerate the config.

The existing reload mechanism in `apps/workers/src/processors/haproxy-reload.ts` needs to be extended to:

1. Query `analytics_config` for all enabled analytics configs (joined with domains for hostname)
2. Build `AnalyticsRouteConfig[]` from the results
3. Pass them to `generateCompleteHAProxyConfig` via the `analytics` option

## WebSocket Support

HAProxy needs to support WebSocket upgrades for the `/_upm/{uuid}/live` endpoint. The analytics backend configuration should include:

```haproxy
backend analytics_backend
    mode http
    balance roundrobin
    # Enable WebSocket support
    option http-server-close
    timeout tunnel 3600s
    ...
```

This is handled by adding to the backend generation:

```typescript
// In generateAnalyticsBackend, add httpRequestRules for WebSocket
httpRequestRules: [
  'set-header Connection "upgrade" if { hdr(Connection) -i "upgrade" }',
],
```

And ensuring the backend timeout is extended for WebSocket connections via a tunnel timeout setting.

**Note on WebSocket authentication**: Authentication is handled via a **first-message pattern** at the application level, not at the HAProxy level. The WebSocket connection is established unauthenticated through HAProxy, and the analytics service validates the token sent as the first WebSocket message. This avoids leaking auth tokens in URLs that would appear in HAProxy access logs. See [01-architecture.md](./01-architecture.md#websocket-authentication) for details.

**Connection limits**: Consider setting `maxconn` on the analytics backend server to prevent idle WebSocket connections from exhausting HAProxy's connection pool. A reasonable starting point is `maxconn 1000` per backend server, adjustable based on expected concurrent dashboard users.
