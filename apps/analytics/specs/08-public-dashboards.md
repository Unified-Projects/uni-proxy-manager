# 08 - Public Dashboards

## Overview

Domain owners can share a read-only analytics dashboard via a public URL. The public dashboard is rendered within the main Next.js app at a special route that bypasses the standard API key authentication.

## URL Structure

```
https://<UNI_PROXY_MANAGER_URL>/analytics/public/{publicDashboardToken}
```

Where `publicDashboardToken` is a random token stored in `analytics_config.public_dashboard_token` (generated when public dashboard is enabled).

## Access Control Options

Per-domain, the public dashboard supports multiple access control methods:

### 1. Public (No Auth)

Anyone with the URL can view the dashboard.

- `publicDashboardEnabled = true`
- `publicDashboardPasswordHash = null`

### 2. Password Protected

Visitors must enter a password to view the dashboard.

- `publicDashboardEnabled = true`
- `publicDashboardPasswordHash = "<bcrypt_hash>"`

**Flow**:
1. Visitor opens the public URL
2. If no valid session, show a password form
3. Password is verified against the bcrypt hash using `bcrypt.compare()` (timing-safe by design)
4. On correct password, return a short-lived JWT (24h), signed with `UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET` (HS256, minimum 32 bytes)
5. The JWT is stored in React state and passed via `Authorization: Bearer <sessionToken>` header on subsequent requests (consistent with the main dashboard API key pattern)
6. Subsequent requests within the session don't require re-entering the password

### 3. Pomerium Protected

If the Pomerium extension is enabled, public dashboards can be protected via identity-aware proxy.

- `publicDashboardEnabled = true`
- Domain has Pomerium routes configured for the `/analytics/public/*` path pattern

This requires no additional analytics-specific logic -- Pomerium's HAProxy integration handles auth at the proxy level before the request reaches the Next.js app.

### 4. External Auth (Entra/SSO)

For environments using external identity providers:
- Configure Pomerium with the desired IdP (Azure AD/Entra, Google, OIDC)
- Add a Pomerium route protecting `/analytics/public/*` on the UPM domain
- The public dashboard is then only accessible to authenticated users

## API Endpoints

### `GET /api/analytics/public/:token/verify`

Verify that a public dashboard token is valid and check access requirements.

**Response** (no auth needed for this endpoint):
```json
{
  "valid": true,
  "domainHostname": "example.com",
  "requiresPassword": true,
  "dashboardName": "example.com Analytics"
}
```

### `POST /api/analytics/:configId/public-dashboard/rotate`

Regenerate the public dashboard token. The old token is immediately invalidated and all existing sessions are revoked.

**Request**: No body required.

**Response**:
```json
{
  "publicDashboardToken": "abc123xyz...",
  "publicDashboardUrl": "https://upm.example.com/analytics/public/abc123xyz...",
  "message": "Token regenerated. The previous URL is no longer valid."
}
```

**Note**: This endpoint requires standard API authentication (not public token auth). Only domain owners can rotate the token.

---

### `POST /api/analytics/public/:token/auth`

Authenticate with a password for password-protected dashboards.

**Request**:
```json
{
  "password": "secret123"
}
```

**Response** (on success):
```json
{
  "authenticated": true,
  "sessionToken": "eyJ...",
  "expiresIn": 86400
}
```

The `sessionToken` is a short-lived JWT (24h), signed with `UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET` (HS256). It is stored in React state on the client and sent via `Authorization: Bearer <sessionToken>` header on subsequent API requests. This is consistent with how the main dashboard handles API key authentication.

**Rate limiting**: This endpoint uses `strictRateLimiter` (10 requests per minute per IP) to prevent brute-force attacks.

### `GET /api/analytics/public/:token/summary`

Public version of the summary endpoint. Returns the same data structure as `/api/analytics/:configId/summary` but:
- Authenticated via public token (+ optional session token for password-protected dashboards)
- Does not expose configuration details, API tokens, or embed snippets

### `GET /api/analytics/public/:token/timeseries`
### `GET /api/analytics/public/:token/pages`
### `GET /api/analytics/public/:token/referrers`
### `GET /api/analytics/public/:token/geography`
### `GET /api/analytics/public/:token/devices`
### `GET /api/analytics/public/:token/utm`

All follow the same pattern -- same response structure as the internal API, authenticated via public token.

**Note**: Custom events are **not** exposed on public dashboards (internal-only).

### `GET /api/analytics/public/:token/export/csv`

CSV export is available on public dashboards (same as internal).

**Formula injection protection**: CSV export includes protection against formula injection. The following prefixes are escaped: `=`, `+`, `-`, `@`, `\t`, `\r`, and `0x` (hexadecimal prefix).

---

## UI - Public Dashboard Page

**File**: `apps/web/src/app/analytics/public/[token]/page.tsx`

### Layout

The public dashboard uses a **simplified layout** without the main app sidebar/navigation:

- Clean header with domain hostname and "Powered by Uni-Proxy-Manager" link
- Period selector (24h, 7d, 30d, 90d)
- No settings/configuration access
- No funnel data (internal-only)
- No custom events (internal-only)
- CSV export button

### Authentication Flow

```
1. Page loads -> GET /api/analytics/public/{token}/verify

2a. If requiresPassword = false:
    -> Fetch and display data directly

2b. If requiresPassword = true:
    -> Show password form
    -> POST /api/analytics/public/{token}/auth
    -> Store session token in React state
    -> Pass via Authorization: Bearer header on subsequent requests
    -> Fetch and display data

3. If token is invalid:
    -> Show "Dashboard not found" page
```

### Pixel Endpoint Behaviour

The noscript pixel endpoint (`pixel.gif`) performs server-side validation:
- Checks the `Sec-GPC` header (Global Privacy Control) and honours the user's privacy preference
- Validates the Referer header to ensure the request originates from an expected domain

**Note**: The pixel endpoint is intended for noscript web visitors only (users without JavaScript enabled).

### Content

The public dashboard shows a subset of the full dashboard:

| Section | Included | Notes |
|---------|----------|-------|
| Summary cards | Yes | Pageviews, visitors, bounce rate, avg duration |
| Traffic chart | Yes | Line chart with pageviews + visitors |
| Top pages | Yes | Top 20 pages |
| Top referrers | Yes | Top 20 referrers |
| Geography | Yes | Country breakdown |
| Devices | Yes | Device/browser/OS |
| UTM campaigns | Yes | Source and campaign breakdown |
| Events | No | Custom events are internal-only |
| Funnels | No | Funnels are internal-only |
| Real-time | No | Live data is internal-only |
| Settings | No | Configuration is internal-only |

### Styling

The public dashboard uses the same component library (`@uni-proxy-manager/ui`) but with:
- A standalone layout (no sidebar)
- Optional light/dark mode toggle
- Responsive design (mobile-friendly)

---

## Configuration UI

In the analytics settings tab (`/analytics/[configId]` -> Settings):

```
+-----------------------------------------------+
| Public Dashboard                               |
|                                                 |
| [Toggle] Enable public dashboard               |
|                                                 |
| Shareable URL:                                  |
| [https://upm.example.com/analytics/public/xyz] |
| [Copy] [Open in new tab]                       |
|                                                 |
| Password Protection:                            |
| [Toggle] Require password                       |
| Password: [••••••••••] [Change]                |
|                                                 |
| Token Security:                                 |
| [Regenerate Token] - Invalidates old URL       |
|                                                 |
| Note: For SSO/Entra protection, configure a    |
| Pomerium route for this path.                  |
+-----------------------------------------------+
```

## Security Considerations

- Public tokens are cryptographically random (32 bytes, base64url encoded)
- Passwords are hashed with bcrypt (cost factor 12) before storage
- Password comparison uses bcrypt's built-in timing-safe comparison (`bcrypt.compare()`)
- Session tokens are short-lived JWTs (24h expiry), signed with `UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET` (HS256, minimum 32 bytes, generated via `openssl rand -base64 32`)
- Session tokens are stored in React state and passed via Authorization header (consistent with main dashboard pattern)
- Rate limiting applies to public endpoints (using `strictRateLimiter` -- 10 req/min for auth, standard rate for data)
- Public endpoints never expose: API tokens, embed snippets, internal config, tracking UUIDs
- The `publicDashboardToken` is distinct from the `trackingUuid` -- knowing one does not reveal the other
- The JWT secret (`UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET`) is distinct from any other secrets in the system and is only used for public dashboard session tokens
- **Token rotation**: If a public dashboard token is compromised, domain owners can regenerate it via `POST /api/analytics/:configId/public-dashboard/rotate`. The old token is immediately invalidated and all existing sessions are revoked. This provides a recovery mechanism without needing to disable and re-enable the public dashboard
