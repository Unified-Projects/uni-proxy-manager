/**
 * UPM Analytics - Bootstrap Script (Phase 1)
 *
 * This is the lightweight bootstrap that fires the initial
 * pageview immediately and then lazy-loads the full tracker script.
 *
 * Served dynamically as script.js with the UUID baked in by the server.
 */
(function () {
  // Prevent double-loading
  if (window.__upm) return;

  // Check opt-out signals (doNotTrack, Global Privacy Control, manual disable)
  try {
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  } catch (e) {}
  if (window.upm_disable) return;

  // Detect common automation/testing frameworks
  if (window.__nightmare || window.callPhantom || window._phantom || window.phantom || window._polypane) return;

  // Extract base URL and UUID from the current script's src attribute
  // Expected format: https://example.com/_upm/{uuid}/script.js
  var scriptEl = document.currentScript;
  if (!scriptEl) return;
  var src = scriptEl.src;
  var baseUrl = src.replace(/\/script\.js(\?.*)?$/, "");
  var uuidMatch = src.match(/\/([a-f0-9-]{36})\/script\.js/);
  var uuid = uuidMatch ? uuidMatch[1] : "";

  // Generate in-memory session ID (not persisted to cookies/storage)
  var sid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2) +
        Math.random().toString(36).substring(2);

  // Merge feature toggle flags injected by the server (defaults to enabled)
  var cfg = window.__upmConfig || {};
  window.__upm = {
    uuid: uuid,
    q: [],
    sid: sid,
    baseUrl: baseUrl,
    trackScrollDepth: cfg.scrollDepth !== false,
    trackSessionDuration: cfg.sessionDuration !== false,
    trackOutboundLinks: cfg.outboundLinks !== false,
  };

  // Determine allowed query params from script tag data attribute
  var allowedParams = [];
  var allowedParamsAttr = scriptEl.getAttribute("data-allowed-params");
  if (allowedParamsAttr) {
    allowedParams = allowedParamsAttr.split(",").map(function (p) {
      return p.trim();
    });
  }
  window.__upm.allowedParams = allowedParams;

  // Build pathname with optional allowed query params
  var pathname = location.pathname;
  if (allowedParams.length > 0) {
    try {
      var params = new URLSearchParams(location.search);
      var allowedQuery = [];
      allowedParams.forEach(function (key) {
        if (params.has(key)) {
          allowedQuery.push(key + "=" + encodeURIComponent(params.get(key)));
        }
      });
      if (allowedQuery.length > 0) {
        pathname += "?" + allowedQuery.join("&");
      }
    } catch (e) {}
  }

  // Compute device type from viewport width
  var vw = window.innerWidth || screen.width;
  var dt = vw < 768 ? "mobile" : vw < 1024 ? "tablet" : "desktop";

  // Clean referrer by stripping common subdomain prefixes for cleaner grouping
  var rawRef = document.referrer || "";
  var cleanRef = rawRef.replace(/^(https?:\/\/)(www\d?|m|w\d{0,3}m?|l|mobile)\./i, "$1");

  // Build pageview payload
  var data = {
    t: "pageview",
    p: pathname,
    r: cleanRef,
    sw: screen.width,
    sh: screen.height,
    dt: dt,
    sid: sid,
    v: 1,
  };

  // Timezone detection (graceful degradation)
  try {
    data.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {}

  // Extract UTM parameters (graceful degradation)
  try {
    var sp = new URLSearchParams(location.search);
    ["source", "medium", "campaign", "term", "content"].forEach(function (k) {
      var v = sp.get("utm_" + k);
      if (v) data["u_" + k] = v;
    });
  } catch (e) {
    // Fallback: manual query string parsing for older browsers
    try {
      var search = location.search.substring(1);
      search.split("&").forEach(function (pair) {
        var parts = pair.split("=");
        var key = decodeURIComponent(parts[0] || "");
        var val = decodeURIComponent(parts[1] || "");
        if (key.indexOf("utm_") === 0) {
          var k = key.substring(4);
          if (
            ["source", "medium", "campaign", "term", "content"].indexOf(k) >= 0
          ) {
            data["u_" + k] = val;
          }
        }
      });
    } catch (e2) {}
  }

  // Detect navigation type (reload, back_forward) via Performance API
  try {
    var navEntry = performance.getEntriesByType("navigation")[0];
    if (navEntry) {
      data.nav = navEntry.type; // "navigate", "reload", "back_forward", "prerender"
    }
  } catch (e) {}

  // Send initial pageview beacon
  var endpoint = baseUrl + "/collect";
  var payload = JSON.stringify(data);
  try {
    var blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) {
      // sent successfully
    } else {
      throw new Error("sendBeacon failed");
    }
  } catch (e) {
    try {
      fetch(endpoint, {
        method: "POST",
        body: payload,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(function () {});
    } catch (e2) {}
  }

  // Public API (queued until full tracker loads)
  window.upm = {
    track: function (name, meta) {
      window.__upm.q.push({ n: name, m: meta });
    },
  };

  // Lazy-load full tracker
  var s = document.createElement("script");
  s.src = baseUrl + "/tracker.js";
  s.async = true;
  (document.head || document.getElementsByTagName("head")[0]).appendChild(s);
})();
