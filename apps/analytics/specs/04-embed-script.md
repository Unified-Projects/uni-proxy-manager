# 04 - Embed Script

## Overview

The tracking script uses a lazy-load architecture: a tiny bootstrap (<2KB) fires the initial pageview immediately, then asynchronously loads the full tracker (~10-15KB) for rich interactions.

## Browser Support

- **Target**: Chrome 60+, Firefox 55+, Safari 12+, Edge 79+
- **Strategy**: Graceful degradation. Modern APIs (`URLSearchParams`, `Element.closest`, `Intl.DateTimeFormat`) are wrapped in try/catch guards. Older browsers still send the basic pageview beacon but may miss UTM extraction, data-attribute events, and timezone detection.
- **IE11**: Not supported. The bootstrap will still attempt to send a basic pageview but many features will be unavailable.

## Script Tag

Site owners paste this into their HTML:

```html
<script src="https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/script.js" defer></script>
```

Optionally, site operators can allow specific query parameters to be included in the pathname via the `data-allowed-params` attribute:

```html
<script src="https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/script.js"
        defer
        data-allowed-params="tab,page"></script>
```

The analytics backend dynamically generates `script.js` with the collection endpoint pre-configured.

## Noscript Pixel Fallback

```html
<noscript>
  <img src="https://example.com/_upm/a1b2c3d4-e5f6-7890-abcd-ef1234567890/pixel.gif"
       alt="" referrerpolicy="no-referrer-when-downgrade" />
</noscript>
```

The pixel provides limited data for noscript web visitors: only Referer (for pathname extraction), User-Agent, and timezone (via Accept-Language header as a fallback, though less accurate than client-side detection).

## Script Architecture

### Phase 1: Bootstrap (<2KB, inline in script.js)

Executes immediately on load. Responsibilities:

1. **Send initial pageview** via `navigator.sendBeacon()` (fallback to `fetch`)
2. **Extract UTM parameters** from `location.search`
3. **Extract referrer** from `document.referrer`
4. **Detect device type** from viewport width
5. **Lazy-load Phase 2** by creating a `<script>` element pointing to `/_upm/{uuid}/tracker.js`

### Phase 2: Full Tracker (~10-15KB, lazy-loaded)

Loaded asynchronously after the initial pageview. Responsibilities:

1. **SPA navigation tracking** - Listen to `pushState`, `replaceState`, and `popstate` events
2. **Custom events via JS API** - Expose `window.upm.track(name, meta?)`
3. **Custom events via data attributes** - Scan for `data-upm-event` attributes, attach click listeners
4. **Scroll depth tracking** - Track maximum scroll percentage via `IntersectionObserver` or scroll events
5. **Session duration** - Track time on page, send `session_end` beacon on `visibilitychange` or `beforeunload`
6. **Outbound link tracking** - Detect clicks on external links
7. **Hash change tracking** - Optional, for hash-based routing

## Bootstrap Script (Phase 1) - Pseudocode

```javascript
(function() {
  // Configuration (injected by server)
  var endpoint = "/_upm/{uuid}/collect";
  var uuid = "{uuid}";

  // Prevent double-loading
  if (window.__upm) return;

  // Check opt-out (doNotTrack, Global Privacy Control, manual disable)
  try {
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  } catch(e) {}
  if (window.upm_disable) return;

  // Generate in-memory session ID (not persisted to cookies/storage)
  // Use crypto.randomUUID() for cryptographic strength; fallback for older browsers
  var sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

  window.__upm = { uuid: uuid, q: [], sid: sid, initialPageviewSent: true };

  // Determine allowed query params from script tag data attribute
  var scriptEl = document.currentScript || document.querySelector('script[src*="/' + uuid + '/script.js"]');
  var allowedParams = [];
  if (scriptEl) {
    var allowedParamsAttr = scriptEl.getAttribute('data-allowed-params');
    if (allowedParamsAttr) {
      allowedParams = allowedParamsAttr.split(',').map(function(p) { return p.trim(); });
    }
  }

  // Build pathname with optional allowed query params
  var pathname = location.pathname;
  if (allowedParams.length > 0) {
    try {
      var params = new URLSearchParams(location.search);
      var allowedQuery = [];
      allowedParams.forEach(function(key) {
        if (params.has(key)) {
          allowedQuery.push(key + '=' + encodeURIComponent(params.get(key)));
        }
      });
      if (allowedQuery.length > 0) {
        pathname += '?' + allowedQuery.join('&');
      }
    } catch(e) {}
  }

  // Collect pageview data
  var data = {
    t: "pageview",                  // event type
    p: pathname,                    // pathname (optionally with allowed query params)
    r: document.referrer || "",     // referrer
    sw: screen.width,               // screen width
    sh: screen.height,              // screen height
    sid: sid,                       // session ID
    v: 1,                           // payload version
  };

  // Timezone (graceful degradation)
  try {
    data.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch(e) {}

  // Extract UTM params (graceful degradation for older browsers)
  try {
    var params = new URLSearchParams(location.search);
    ["source", "medium", "campaign", "term", "content"].forEach(function(k) {
      var v = params.get("utm_" + k);
      if (v) data["u_" + k] = v;
    });
  } catch(e) {
    // Fallback: manual query string parsing
    try {
      var search = location.search.substring(1);
      search.split("&").forEach(function(pair) {
        var parts = pair.split("=");
        var key = decodeURIComponent(parts[0] || "");
        var val = decodeURIComponent(parts[1] || "");
        if (key.indexOf("utm_") === 0) {
          var k = key.substring(4);
          if (["source","medium","campaign","term","content"].indexOf(k) >= 0) {
            data["u_" + k] = val;
          }
        }
      });
    } catch(e2) {}
  }

  // Send beacon
  // Note: sendBeacon with JSON requires a Blob to set Content-Type correctly
  var payload = JSON.stringify(data);
  try {
    var blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) {
      // sent successfully
    } else {
      throw new Error("sendBeacon failed");
    }
  } catch(e) {
    try {
      fetch(endpoint, {
        method: "POST",
        body: payload,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(function() {});
    } catch(e2) {}
  }

  // Public API (queued until tracker loads)
  window.upm = {
    track: function(name, meta) {
      window.__upm.q.push({ n: name, m: meta });
    },
  };

  // Lazy-load full tracker
  var s = document.createElement("script");
  s.src = "/_upm/" + uuid + "/tracker.js";
  s.async = true;
  (document.head || document.getElementsByTagName("head")[0]).appendChild(s);
})();
```

## Full Tracker (Phase 2) - Pseudocode

```javascript
(function() {
  var config = window.__upm;
  if (!config || !config.uuid) return;  // Guard against loading without bootstrap

  // Re-check opt-out (may have been set after bootstrap)
  try {
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  } catch(e) {}
  if (window.upm_disable) return;

  var endpoint = "/_upm/" + config.uuid + "/collect";
  var pageviewCount = 1; // bootstrap already sent the first pageview

  // Retrieve allowed params config from script tag
  var scriptEl = document.querySelector('script[src*="/' + config.uuid + '/script.js"]');
  var allowedParams = [];
  if (scriptEl) {
    var allowedParamsAttr = scriptEl.getAttribute('data-allowed-params');
    if (allowedParamsAttr) {
      allowedParams = allowedParamsAttr.split(',').map(function(p) { return p.trim(); });
    }
  }

  // Helper to build pathname with allowed params
  function getPathname() {
    var pathname = location.pathname;
    if (allowedParams.length > 0) {
      try {
        var params = new URLSearchParams(location.search);
        var allowedQuery = [];
        allowedParams.forEach(function(key) {
          if (params.has(key)) {
            allowedQuery.push(key + '=' + encodeURIComponent(params.get(key)));
          }
        });
        if (allowedQuery.length > 0) {
          pathname += '?' + allowedQuery.join('&');
        }
      } catch(e) {}
    }
    return pathname;
  }

  // --- SPA Navigation Tracking ---
  var lastPath = getPathname();
  var pageLoadTime = Date.now();
  var maxScroll = 0;

  function sendPageEnd() {
    // Send page-level metrics for the page being left
    var duration = Date.now() - pageLoadTime;
    send({
      t: "session_end",
      p: lastPath,
      sd: duration,
      sp: maxScroll,
      sid: config.sid,
      ib: pageviewCount === 1 ? 1 : 0,  // is_bounce: true if only 1 pageview in session
      v: 1,
    });
  }

  function trackPageview() {
    var currentPath = getPathname();
    if (currentPath === lastPath) return;

    // Send page-end for previous page before tracking new one
    sendPageEnd();

    // Reset per-page metrics
    var previousPath = lastPath;
    lastPath = currentPath;
    pageLoadTime = Date.now();
    maxScroll = 0;
    pageviewCount++;

    send({
      t: "pageview",
      p: currentPath,
      r: previousPath,  // Use previous internal path as referrer for SPA navigations
      sid: config.sid,
      v: 1,
    });
  }

  // Monkey-patch pushState only (replaceState is not tracked by default
  // as frameworks use it for non-navigational purposes like scroll restoration)
  var origPush = history.pushState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    trackPageview();
  };
  window.addEventListener("popstate", trackPageview);

  // --- Custom Events (JS API) ---
  // Replace window.upm before processing queue to avoid race conditions
  window.upm = {
    track: function(name, meta) {
      if (window.upm_disable) return;  // Runtime opt-out check
      // Validate: alphanumeric + underscores, max 200 chars
      var clean = String(name).replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 200).toLowerCase();
      // Cap metadata: max 20 keys, alphanumeric+underscore keys, max 500 chars per value
      var safeMeta = {};
      if (meta && typeof meta === "object") {
        var keys = Object.keys(meta).slice(0, 20);
        keys.forEach(function(k) {
          var safeKey = String(k).replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 100);
          safeMeta[safeKey] = String(meta[k]).substring(0, 500);
        });
      }
      send({ t: "event", n: clean, m: safeMeta, p: getPathname(), sid: config.sid, v: 1 });
    },
  };

  // --- Custom Events (Data Attributes) ---
  document.addEventListener("click", function(e) {
    // Graceful degradation: Element.closest not available in IE11
    var el;
    try { el = e.target.closest("[data-upm-event]"); } catch(err) { return; }
    if (!el) return;

    var name = el.getAttribute("data-upm-event");
    var meta = {};

    // Collect data-upm-event-* attributes as metadata
    try {
      Array.from(el.attributes).forEach(function(attr) {
        if (attr.name.indexOf("data-upm-event-") === 0 && attr.name !== "data-upm-event") {
          var key = attr.name.replace("data-upm-event-", "").replace(/-/g, "_");
          meta[key] = attr.value;
        }
      });
    } catch(err) {}

    window.upm.track(name, meta);
  });

  // --- Scroll Depth Tracking (throttled via requestAnimationFrame) ---
  var scrollTicking = false;
  function onScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 0) {
      var pct = Math.round((scrollTop / docHeight) * 100);
      if (pct > maxScroll) maxScroll = pct;
    }
  }
  window.addEventListener("scroll", function() {
    if (!scrollTicking) {
      requestAnimationFrame(function() {
        onScroll();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  // --- Session End (fires ONCE per page lifecycle) ---
  var sessionEndSent = false;

  function sendFinalSessionEnd() {
    if (sessionEndSent) return;
    sessionEndSent = true;
    sendPageEnd();
  }

  // Use pagehide where available (more reliable on iOS Safari), fall back to visibilitychange
  if ("onpagehide" in window) {
    window.addEventListener("pagehide", sendFinalSessionEnd);
  }
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden") {
      sendFinalSessionEnd();
    }
  });

  // --- Outbound Link Tracking ---
  document.addEventListener("click", function(e) {
    var link;
    try { link = e.target.closest("a[href]"); } catch(err) { return; }
    if (!link) return;

    try {
      var url = new URL(link.href);
      if (url.hostname !== location.hostname) {
        window.upm.track("outbound_click", {
          url: link.href,
          text: (link.textContent || "").substring(0, 100),
        });
      }
    } catch(err) {}
  });

  // --- Process Queued Events ---
  if (config.q && config.q.length) {
    config.q.forEach(function(evt) {
      window.upm.track(evt.n, evt.m);
    });
    config.q = [];
  }

  // --- Send Helper ---
  function send(data) {
    if (window.upm_disable) return;  // Runtime opt-out check
    var payload = JSON.stringify(data);
    try {
      var blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) {
        return;
      }
      throw new Error("sendBeacon failed");
    } catch(e) {
      try {
        fetch(endpoint, {
          method: "POST",
          body: payload,
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(function() {});
      } catch(e2) {}
    }
  }
})();
```

## Server-Side Script Generation

The analytics HTTP server generates `script.js` dynamically:

```typescript
// GET /_upm/{uuid}/script.js
app.get("/:uuid/script.js", async (c) => {
  const uuid = c.req.param("uuid");

  // Validate UUID exists and is enabled
  const config = await getAnalyticsConfigByUuid(uuid);
  if (!config || !config.enabled) {
    return c.text("", 404);
  }

  // Generate bootstrap script with endpoint baked in
  const script = generateBootstrapScript(uuid);

  return c.text(script, 200, {
    "Content-Type": "application/javascript",
    "Cache-Control": "public, max-age=3600",  // Cache for 1 hour
  });
});
```

The `tracker.js` is served as a static file (not dynamically generated) since it doesn't contain configuration -- it reads from `window.__upm`.

## Beacon Payload Format

### Pageview

```json
{
  "t": "pageview",
  "p": "/pricing",
  "r": "https://google.com/",
  "sw": 1920,
  "sh": 1080,
  "tz": "Europe/London",
  "sid": "k8f2m9x1a3b7c5d4",
  "v": 1,
  "u_source": "google",
  "u_medium": "cpc",
  "u_campaign": "spring_sale"
}
```

Note: The `p` field contains only the pathname by default. Query strings are stripped unless the script tag includes `data-allowed-params` to explicitly allow specific parameters.

### Pageview with Allowed Query Params

If the script tag includes `data-allowed-params="tab,page"`:

```json
{
  "t": "pageview",
  "p": "/pricing?tab=features&page=2",
  "r": "https://google.com/",
  "sw": 1920,
  "sh": 1080,
  "tz": "Europe/London",
  "sid": "k8f2m9x1a3b7c5d4",
  "v": 1
}
```

### SPA Pageview (subsequent navigation)

```json
{
  "t": "pageview",
  "p": "/dashboard",
  "r": "/pricing",
  "sid": "k8f2m9x1a3b7c5d4",
  "v": 1
}
```

Note: `r` for SPA pageviews is the previous internal path, not `document.referrer`.

### Custom Event

```json
{
  "t": "event",
  "n": "signup_click",
  "m": { "plan": "pro", "location": "header" },
  "p": "/pricing",
  "sid": "k8f2m9x1a3b7c5d4",
  "v": 1
}
```

### Session End

```json
{
  "t": "session_end",
  "p": "/pricing",
  "sd": 45200,
  "sp": 87,
  "sid": "k8f2m9x1a3b7c5d4",
  "ib": 0,
  "v": 1
}
```

Fields: `sd` = session duration (ms), `sp` = scroll depth (0-100), `ib` = is_bounce (1 if session had exactly one pageview).

## Server-Side Beacon Processing

The `POST /_upm/{uuid}/collect` endpoint:

1. **Origin validation**: Check `Origin` header matches the domain's hostname for this UUID (or is in `allowedOrigins`). Reject with 403 if mismatched. This prevents trivial analytics spam
2. **Rate limit check**: Per-IP (60/min) and per-UUID (10,000/min) via Redis sliding window
3. **Validate UUID**: Look up `analytics_config` by UUID (in-memory cache, stale-while-revalidate with 60s refresh)
4. **Validate and sanitise payload**:
   - Truncate pathname to 2000 chars
   - Truncate referrer to 2000 chars
   - Truncate UTM values to 500 chars each
   - Strip control characters from all string fields
   - Validate event metadata keys match `^[a-zA-Z0-9_]+$`, values max 500 chars
5. **Check ignored paths**: Skip if pathname matches any configured `ignoredPaths` glob pattern
6. **Determine uniqueness via referrer-domain matching**: Parse the Referer header's hostname. If it matches the tracked domain's hostname, set `is_unique = 0`. If referrer is empty or from a different domain, set `is_unique = 1`
7. **Derive country from timezone**: Map the `tz` field to a country code using a static timezone-to-country lookup table. If timezone is unrecognised, set country to "Unknown"
8. **Parse User-Agent**: Extract browser, browser version, OS, device type (using a lightweight UA parser) -- sanitise output
9. **Determine `is_entry`**: Set to 1 if this is a pageview event and `is_unique = 1` (first pageview from external/direct), or based on session tracking
10. **Write to ClickHouse**: Insert row into `analytics_events` (all three Materialised Views handle aggregation automatically)
11. **Publish to Redis**: `analytics:live:{configId}` for real-time WebSocket broadcast + add to `analytics:active:{configId}` sorted set

## Pixel Endpoint

The pixel endpoint (`GET /_upm/{uuid}/pixel.gif`) provides noscript fallback tracking:

1. **GPC check**: Check the `Sec-GPC` header. If present and set to "1", return the pixel image but do not record the event
2. **Referer validation**: Validate the Referer header matches the tracked domain (anti-abuse)
3. **Extract data**: Derive pathname from Referer, timezone from Accept-Language header (fallback, less accurate), User-Agent
4. **Process as beacon**: Follow the same server-side processing flow as the main beacon endpoint
5. **Return pixel**: Serve a transparent 1x1 GIF with appropriate cache headers

Note: The pixel provides limited data compared to the JavaScript beacon. It is intended solely for noscript web visitors.

## Server-Side API

For programmatic event submission (e.g. from backend services):

```
POST /_upm/{uuid}/api
Authorisation: Bearer {api_token}
Content-Type: application/json

{
  "events": [
    {
      "type": "event",
      "name": "purchase_completed",
      "pathname": "/checkout/success",
      "referrer": "https://example.com/cart",
      "timezone": "Europe/London",
      "meta": { "amount": "99.99", "currency": "GBP" },
      "timestamp": "2026-02-07T12:00:00Z"
    }
  ]
}
```

**Notes**:
- The API token is required. Validated via **SHA-256 fast hash** (`analytics_config.api_token_sha256`) using constant-time comparison. This prevents CPU exhaustion from bcrypt verification on every request. Bcrypt hash is only used during token generation/rotation
- Rate limited to 100 requests per minute per token
- `meta` values must be strings (matching ClickHouse `Map(String, String)`). **Keys must match `^[a-zA-Z0-9_]+$`** -- reject keys with special characters
- Maximum 100 events per request
- `referrer` field is used for uniqueness determination (same logic as client beacon)
- `timezone` field is used for country derivation
- **DoNotTrack**: Server-side API consumers are responsible for respecting DNT. An optional `dnt: true` field in the payload instructs the server to discard the event

## Privacy Considerations

This analytics system is designed to be privacy-first and compliant with GDPR/ePrivacy Directive without requiring consent:

- **No cookies** are set or read
- **No localStorage** is used
- **No IP addresses processed or stored**: The server never uses the client IP for any purpose
- **No pseudonymous identifiers stored**: No visitor hashes, fingerprints, or persistent identifiers are computed or retained
- **Unique visitors detected via referrer-domain matching**: If the Referer header's hostname matches the tracked domain, the pageview is counted as non-unique (internal navigation). If the referrer is empty or from a different domain, it is counted as unique. This is the same approach used by Simple Analytics
- **Country derived from browser timezone**: The `tz` field (e.g. "Europe/London") is mapped to a country code using a static lookup table. No GeoIP or IP-based geolocation is used
- **Session ID** is generated in-memory using `crypto.randomUUID()` (with `Math.random` fallback for older browsers) and exists only for the page lifecycle. Not persisted to cookies, localStorage, or any storage. Lost on page close
- **doNotTrack / GPC**: Bootstrap checks `navigator.doNotTrack === "1"` and `navigator.globalPrivacyControl` before sending any data. Full tracker re-checks on load. Both abort entirely if set. The pixel endpoint also checks the `Sec-GPC` header
- **Runtime opt-out**: `window.upm_disable` is checked in the bootstrap, at full tracker load, and in the `send()` helper -- so users can opt out at any point during the session
- **No consent required**: As no personal data is processed (no IP storage, no persistent identifiers, no cookies), this system does not require consent under GDPR Article 6 or the ePrivacy Directive
- **Query string privacy**: By default, query strings are stripped from the pathname to prevent accidental collection of sensitive parameters (e.g. password reset tokens, session IDs). Site operators can explicitly allow specific query params via `data-allowed-params`
- **Low-entropy data**: Screen dimensions and timezone are collected but are relatively low-entropy. They are used for analytics breakdowns, not for fingerprinting

## GDPR Legal Basis Guidance

This analytics system is designed to operate without requiring user consent under GDPR Article 6. The applicable legal basis is:

### Article 6(1)(f) - Legitimate Interest

Website operators have a legitimate interest in understanding how their website is used. This analytics system qualifies for the legitimate interest basis because:

1. **No personal data is processed**: No IP addresses, persistent identifiers, cookies, or fingerprints are collected or stored
2. **No cross-site tracking**: Visitors cannot be tracked across different websites
3. **No user profiling**: The system does not build profiles of individual users
4. **Minimal data collection**: Only aggregate, statistical data is collected (pageviews, device types, countries via timezone)
5. **User expectations**: Website visitors reasonably expect basic analytics to be collected

### ePrivacy Directive Compliance

The ePrivacy Directive (Cookie Law) does not apply because:
- No cookies are set or read
- No data is stored on the user's device (no localStorage, sessionStorage, or IndexedDB)
- Session IDs exist only in JavaScript memory and are lost on page close

### Recommended Privacy Policy Language

Domain operators should include analytics disclosure in their privacy policy. Example language:

> **Analytics**
>
> We use privacy-focused analytics to understand how visitors use our website. This analytics system:
> - Does not use cookies or store data on your device
> - Does not collect your IP address
> - Does not track you across websites
> - Derives approximate country from your browser's timezone setting
>
> We collect aggregate statistics including page views, device types, browsers, and referrer sources. This data cannot be used to identify individual visitors. You can opt out by enabling "Do Not Track" in your browser or using a browser extension that sets the Global Privacy Control signal.

### Simple Analytics Alignment

This approach is consistent with [Simple Analytics](https://simpleanalytics.com/), which operates under the same privacy-first principles and does not require consent under GDPR or ePrivacy. The unique visitor counting methodology (referrer-domain matching) and country detection (timezone-based) are identical to Simple Analytics' approach
