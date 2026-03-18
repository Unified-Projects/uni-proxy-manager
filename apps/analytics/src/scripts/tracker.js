/*! UPM Analytics - Privacy-first web analytics (v1) | © Unified Projects LTD */
/**
 * UPM Analytics - Full Tracker (Phase 2)
 *
 * Lazy-loaded by the bootstrap script. Provides SPA navigation tracking,
 * custom events (JS API + data attributes), scroll depth tracking, session
 * duration, outbound link tracking, and session end beacons.
 *
 * Reads configuration from window.__upm set by the bootstrap.
 */
(function () {
  var config = window.__upm;
  if (!config || !config.uuid) return; // Guard against loading without bootstrap

  // Re-check opt-out signals (may have been set after bootstrap loaded)
  try {
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  } catch (e) {}
  if (window.upm_disable) return;

  var endpoint = config.baseUrl + "/collect";
  var pageviewCount = 1; // Bootstrap already sent the first pageview

  // Retrieve allowed params config from bootstrap
  var allowedParams = config.allowedParams || [];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the current pathname, optionally including allowed query parameters.
   */
  function getPathname() {
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
    return pathname;
  }

  /**
   * Send a JSON payload to the collection endpoint via sendBeacon with fetch
   * fallback. sendBeacon is preferred because it is reliable during page
   * unload / visibilitychange events.
   */
  function send(data) {
    if (window.upm_disable) return; // Runtime opt-out check
    var payload = JSON.stringify(data);
    try {
      var blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) {
        return;
      }
      throw new Error("sendBeacon failed");
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
  }

  // ---------------------------------------------------------------------------
  // SPA Navigation Tracking
  // ---------------------------------------------------------------------------

  var lastPath = getPathname();
  var pageLoadTime = Date.now();
  var maxScroll = 0;

  /**
   * Send page-end metrics for the page being navigated away from.
   */
  function sendPageEnd() {
    var duration = Date.now() - pageLoadTime;
    send({
      t: "session_end",
      p: lastPath,
      sd: duration,
      sp: maxScroll,
      sid: config.sid,
      ib: pageviewCount === 1 ? 1 : 0,
      v: 1,
    });
  }

  /**
   * Track an SPA navigation if the pathname has actually changed.
   */
  function trackPageview() {
    var currentPath = getPathname();
    if (currentPath === lastPath) return;

    // Send page-end beacon for the previous page
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
      r: previousPath, // Use previous internal path as referrer for SPA navigations
      sid: config.sid,
      v: 1,
    });
  }

  // Monkey-patch history.pushState (replaceState is intentionally not patched
  // as frameworks use it for non-navigational purposes like scroll restoration)
  var origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    trackPageview();
  };
  window.addEventListener("popstate", trackPageview);

  // Handle hash-based SPA navigation (e.g. #/page1 -> #/page2)
  var lastHash = location.hash;
  window.addEventListener("hashchange", function () {
    var newHash = location.hash;
    if (newHash !== lastHash) {
      lastHash = newHash;
      var currentPath = getPathname() + newHash;
      var previousPath = lastPath;

      // Send page-end beacon for the previous page
      sendPageEnd();

      // Reset per-page metrics
      lastPath = currentPath;
      pageLoadTime = Date.now();
      maxScroll = 0;
      pageviewCount++;

      send({
        t: "pageview",
        p: currentPath,
        r: previousPath,
        sid: config.sid,
        v: 1,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Custom Events - JS API
  // ---------------------------------------------------------------------------

  // Replace the queuing stub with the real implementation
  window.upm = {
    track: function (name, meta) {
      if (window.upm_disable) return; // Runtime opt-out check

      // Sanitise event name: alphanumeric + underscores, max 200 chars, lowercase
      var clean = String(name)
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .substring(0, 200)
        .toLowerCase();

      // Sanitise metadata: max 20 keys, alphanumeric+underscore keys, max 500 char values
      var safeMeta = {};
      if (meta && typeof meta === "object") {
        var keys = Object.keys(meta).slice(0, 20);
        keys.forEach(function (k) {
          var safeKey = String(k)
            .replace(/[^a-zA-Z0-9_]/g, "_")
            .substring(0, 100);
          safeMeta[safeKey] = String(meta[k]).substring(0, 500);
        });
      }

      send({
        t: "event",
        n: clean,
        m: safeMeta,
        p: getPathname(),
        sid: config.sid,
        v: 1,
      });
    },
  };

  // ---------------------------------------------------------------------------
  // Custom Events - Data Attributes
  // ---------------------------------------------------------------------------

  document.addEventListener("click", function (e) {
    // Graceful degradation: Element.closest is not available in IE11
    var el;
    try {
      el = e.target.closest("[data-upm-event]");
    } catch (err) {
      return;
    }
    if (!el) return;

    var name = el.getAttribute("data-upm-event");
    var meta = {};

    // Collect data-upm-event-* attributes as metadata
    try {
      Array.from(el.attributes).forEach(function (attr) {
        if (
          attr.name.indexOf("data-upm-event-") === 0 &&
          attr.name !== "data-upm-event"
        ) {
          var key = attr.name.replace("data-upm-event-", "").replace(/-/g, "_");
          meta[key] = attr.value;
        }
      });
    } catch (err) {}

    window.upm.track(name, meta);
  });

  // ---------------------------------------------------------------------------
  // Scroll Depth Tracking (throttled via requestAnimationFrame)
  // Only initialised if scroll depth tracking is enabled in the config.
  // ---------------------------------------------------------------------------

  if (config.trackScrollDepth !== false) {
    var scrollTicking = false;

    function onScroll() {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        // Round to nearest 5% to reduce cardinality in storage
        var pct = Math.min(100, 5 * Math.round((scrollTop / docHeight) * 100 / 5));
        if (pct > maxScroll) maxScroll = pct;
      }
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!scrollTicking) {
          requestAnimationFrame(function () {
            onScroll();
            scrollTicking = false;
          });
          scrollTicking = true;
        }
      },
      { passive: true }
    );
  }

  // ---------------------------------------------------------------------------
  // Session End
  // Only initialised if session duration tracking is enabled in the config.
  // ---------------------------------------------------------------------------

  if (config.trackSessionDuration !== false) {
    var sessionEndSent = false;

    function sendFinalSessionEnd() {
      if (sessionEndSent) return;
      sessionEndSent = true;
      sendPageEnd();
    }

    // Use pagehide where available (more reliable on iOS Safari), fall back to
    // visibilitychange
    if ("onpagehide" in window) {
      window.addEventListener("pagehide", sendFinalSessionEnd);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        sendFinalSessionEnd();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Outbound Link Tracking
  // Only initialised if outbound link tracking is enabled in the config.
  // ---------------------------------------------------------------------------

  if (config.trackOutboundLinks !== false) {
    document.addEventListener("click", function (e) {
      var link;
      try {
        link = e.target.closest("a[href]");
      } catch (err) {
        return;
      }
      if (!link) return;

      try {
        var url = new URL(link.href);
        if (url.hostname !== location.hostname) {
          window.upm.track("outbound_click", {
            url: link.href,
            text: (link.textContent || "").substring(0, 100),
          });
        }
      } catch (err) {}
    });
  }

  // ---------------------------------------------------------------------------
  // Process Queued Events
  // ---------------------------------------------------------------------------

  if (config.q && config.q.length) {
    config.q.forEach(function (evt) {
      window.upm.track(evt.n, evt.m);
    });
    config.q = [];
  }
})();
