import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { getCorsConfig, getApiPort, getAuthConfig } from "@uni-proxy-manager/shared/config";
import { closeRedisConnection, pingRedis } from "@uni-proxy-manager/shared/redis";
import { pingDatabase } from "@uni-proxy-manager/database";
import { buildHealthStatus } from "./utils/health";
import { getExtensionStatus } from "./extensions";
import { initHaproxyConfig } from "./utils/haproxy-init";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { securityHeadersMiddleware } from "./middleware/security-headers";

import domainsRoutes from "./routes/domains";
import backendsRoutes from "./routes/backends";
import certificatesRoutes from "./routes/certificates";
import dnsProvidersRoutes from "./routes/dns-providers";
import errorPagesRoutes from "./routes/error-pages";
import maintenanceRoutes from "./routes/maintenance";
import haproxyRoutes from "./routes/haproxy";
import statsRoutes from "./routes/stats";
import configRoutes from "./routes/config";
import metricsRoutes from "./routes/metrics";
import extensionsRoutes from "./routes/extensions";
import systemConfigRoutes from "./routes/system-config";
import domainRouteRulesRoutes from "./routes/domain-route-rules";
import domainIpRulesRoutes from "./routes/domain-ip-rules";
import domainSecurityHeadersRoutes from "./routes/domain-security-headers";
import domainBlockedRoutesRoutes from "./routes/domain-blocked-routes";
import sharedBackendsRoutes from "./routes/shared-backends";
import settingsExportImportRoutes from "./routes/settings-export-import";
import clusterRoutes from "./routes/cluster";
import haproxyRuntimeRoutes from "./routes/haproxy-runtime";
import clusterRuntimeRoutes from "./routes/cluster-runtime";
import analyticsPublicRoutes from "./routes/analytics-public";

const app = new Hono();

app.use("*", logger());

// Security headers applied to all responses
app.use("*", securityHeadersMiddleware);

const corsConfig = getCorsConfig();
if (corsConfig.enabled) {
  app.use(
    "*",
    cors({
      origin: corsConfig.origins,
      credentials: true,
    })
  );
}

const authConfig = getAuthConfig();
if (authConfig.enabled) {
  app.use("*", authMiddleware);
  console.log("[API] Authentication enabled - API key required for all endpoints except /health");
} else {
  console.warn("[API] Authentication explicitly disabled via UNI_PROXY_MANAGER_AUTH_ENABLED=false.");
}

// Request body size limit (10MB) to prevent resource exhaustion
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 10 * 1024 * 1024, // 10MB
    onError: (c) => {
      return c.json(
        {
          error: "Payload Too Large",
          message: "Request body exceeds the 10MB size limit.",
        },
        413
      );
    },
  })
);
console.log("[API] Body size limit enabled - 10MB max per request");

// Rate limiting (applied after auth so health checks are not rate limited)
app.use("/api/*", rateLimitMiddleware);
console.log("[API] Rate limiting enabled - 100 requests per minute per IP");

app.get("/health", async (c) => {
  try {
    const [redisOk, dbOk] = await Promise.all([pingRedis(), pingDatabase()]);
    const payload = buildHealthStatus(redisOk, dbOk);
    // Always return 200 so HAProxy keeps the backend in rotation.
    // Redis/DB being degraded is reported in the payload but does not make
    // the API process itself unavailable.
    return c.json(payload, 200);
  } catch (error) {
    const payload = buildHealthStatus(false, false, error);
    return c.json(payload, 200);
  }
});

app.route("/api/domains", domainsRoutes);
app.route("/api/backends", backendsRoutes);
app.route("/api/certificates", certificatesRoutes);
app.route("/api/dns-providers", dnsProvidersRoutes);
app.route("/api/error-pages", errorPagesRoutes);
app.route("/api/maintenance", maintenanceRoutes);
app.route("/api/haproxy", haproxyRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/config", configRoutes);
app.route("/api/metrics", metricsRoutes);
app.route("/api/extensions", extensionsRoutes);
app.route("/api/system-config", systemConfigRoutes);
// Advanced domain configuration
app.route("/api/domain-route-rules", domainRouteRulesRoutes);
app.route("/api/domains", domainIpRulesRoutes); // Nested: /api/domains/:domainId/ip-rules
app.route("/api/domains", domainSecurityHeadersRoutes); // Nested: /api/domains/:domainId/security-headers
app.route("/api/domain-blocked-routes", domainBlockedRoutesRoutes);
app.route("/api/shared-backends", sharedBackendsRoutes);
app.route("/api/settings", settingsExportImportRoutes);
app.route("/api/cluster", clusterRoutes);
app.route("/api/haproxy/runtime", haproxyRuntimeRoutes);
app.route("/api/cluster/runtime", clusterRuntimeRoutes);
app.route("/api/analytics-public", analyticsPublicRoutes);

const extensions = getExtensionStatus();

// Track async route loading for testing
let routesReady: Promise<void> | undefined;

if (extensions.sites) {
  console.log("[API] Sites extension enabled - mounting routes");

  // Dynamic import to avoid loading code when extension is disabled
  // Note: Site proxying is handled by sites-lookup service which proxies to executor
  const sitesPromise = Promise.all([
    import("./routes/sites"),
    import("./routes/site-deployments"),
    import("./routes/github"),
    import("./routes/site-analytics"),
    import("./routes/s3-providers"),
  ]).then(([sitesRoutes, deploymentsRoutes, githubRoutes, analyticsRoutes, s3Routes]) => {
    app.route("/api/sites", sitesRoutes.default);
    app.route("/api/deployments", deploymentsRoutes.default);
    app.route("/api/github", githubRoutes.default);
    app.route("/api/site-analytics", analyticsRoutes.default);
    app.route("/api/s3-providers", s3Routes.default);
    console.log("[API] Sites extension routes mounted");
  }).catch((error) => {
    console.error("[API] Failed to load Sites extension routes:", error);
  });

  routesReady = sitesPromise;
} else {
  console.log("[API] Sites extension disabled");
}

if (extensions.pomerium) {
  console.log("[API] Pomerium extension enabled - mounting routes");

  const pomeriumPromise = Promise.all([
    import("./routes/pomerium-idps"),
    import("./routes/pomerium-routes"),
    import("./routes/pomerium-settings"),
  ]).then(([idpsRoutes, routesRoutes, settingsRoutes]) => {
    app.route("/api/pomerium/idps", idpsRoutes.default);
    app.route("/api/pomerium/routes", routesRoutes.default);
    app.route("/api/pomerium/settings", settingsRoutes.default);
    console.log("[API] Pomerium extension routes mounted");
  }).catch((error) => {
    console.error("[API] Failed to load Pomerium extension routes:", error);
  });

  // Combine with existing routes ready promise
  routesReady = routesReady
    ? Promise.all([routesReady, pomeriumPromise]).then(() => {})
    : pomeriumPromise;
} else {
  console.log("[API] Pomerium extension disabled");
}

if (extensions.analytics) {
  console.log("[API] Analytics extension enabled - mounting routes");

  const analyticsPromise = Promise.all([
    import("./routes/analytics"),
    import("./routes/analytics-config"),
    import("./routes/analytics-funnels"),
  ]).then(([analyticsRoutes, configRoutes, funnelRoutes]) => {
    app.route("/api/analytics", analyticsRoutes.default);
    app.route("/api/analytics-config", configRoutes.default);
    app.route("/api/analytics-funnels", funnelRoutes.default);
    setAnalyticsWsProxyHandler(analyticsRoutes.createAnalyticsWsProxyHandler());
    console.log("[API] Analytics extension routes mounted");
  }).catch((error) => {
    console.error("[API] Failed to load Analytics extension routes:", error);
  });

  routesReady = routesReady
    ? Promise.all([routesReady, analyticsPromise]).then(() => {})
    : analyticsPromise;
} else {
  console.log("[API] Analytics extension disabled");
}

// Export for test client to await
export const waitForRoutes = routesReady ? () => routesReady : () => Promise.resolve();

app.get("/", (c) => {
  const extensionStatus = getExtensionStatus();

  const endpoints: Record<string, string> = {
    health: "/health",
    domains: "/api/domains",
    backends: "/api/backends",
    certificates: "/api/certificates",
    dnsProviders: "/api/dns-providers",
    errorPages: "/api/error-pages",
    maintenance: "/api/maintenance",
    haproxy: "/api/haproxy",
    stats: "/api/stats",
    config: "/api/config",
    metrics: "/api/metrics",
    extensions: "/api/extensions",
    systemConfig: "/api/system-config",
    settings: "/api/settings",
    cluster: "/api/cluster",
    clusterRuntime: "/api/cluster/runtime",
    analyticsPublic: "/api/analytics-public",
  };

  // Add Sites endpoints if extension is enabled
  if (extensionStatus.sites) {
    endpoints.sites = "/api/sites";
    endpoints.deployments = "/api/deployments";
    endpoints.github = "/api/github";
    endpoints.siteAnalytics = "/api/site-analytics";
    endpoints.s3Providers = "/api/s3-providers";
  }

  if (extensionStatus.pomerium) {
    endpoints.pomeriumIdps = "/api/pomerium/idps";
    endpoints.pomeriumRoutes = "/api/pomerium/routes";
    endpoints.pomeriumSettings = "/api/pomerium/settings";
  }

  if (extensionStatus.analytics) {
    endpoints.analytics = "/api/analytics";
    endpoints.analyticsConfig = "/api/analytics-config";
    endpoints.analyticsFunnels = "/api/analytics-funnels";
  }

  return c.json({
    name: "Uni-Proxy-Manager API",
    version: "0.1.3",
    extensions: extensionStatus,
    endpoints,
  });
});

async function init() {
  console.log("[API] Initializing services...");

  try {
    await initHaproxyConfig();
  } catch (error) {
    console.error("[API] Failed to initialize HAProxy config:", error);
  }

  try {
    const redisOk = await pingRedis();
    if (redisOk) {
      console.log("[API] Redis connection established");
    } else {
      console.warn("[API] Redis connection failed - some features will be unavailable");
    }
  } catch (error) {
    console.error("[API] Failed to connect to Redis:", error);
    console.warn("[API] Starting without Redis - some features will be unavailable");
  }
}

// Track the Bun server instance so we can stop it during shutdown when available
let serverInstance: ReturnType<typeof Bun.serve> | null = null;

// Track in-flight requests so we can drain before shutdown
let inFlightRequests = 0;

async function shutdown(signal: string) {
  console.log(`[API] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  if (serverInstance) {
    console.log("[API] Stopping server - no new connections will be accepted");
    serverInstance.stop();
    serverInstance = null;
  }

  // Wait for in-flight requests to complete (up to 30 seconds)
  const drainTimeout = 30_000;
  const drainStart = Date.now();
  while (inFlightRequests > 0 && Date.now() - drainStart < drainTimeout) {
    console.log(`[API] Waiting for ${inFlightRequests} in-flight request(s) to complete...`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (inFlightRequests > 0) {
    console.warn(`[API] Drain timeout reached with ${inFlightRequests} request(s) still in-flight, forcing shutdown`);
  } else {
    console.log("[API] All in-flight requests completed");
  }

  try {
    await closeRedisConnection();
    console.log("[API] Shutdown complete");
  } catch (error) {
    console.error("[API] Error during shutdown:", error);
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Ensure init() completes before the server starts accepting requests
await init();

const port = getApiPort();
console.log(`[API] Uni-Proxy-Manager API starting on port ${port}...`);

// Populated when the analytics extension mounts its routes.
// The delegate object below is given to Bun.serve() at startup so Bun
// always has a stable websocket handler reference — it forwards to the
// real handler once it resolves from the async import.
type WsHandler = ReturnType<typeof import("./routes/analytics").createAnalyticsWsProxyHandler>;
let _wsHandler: WsHandler | null = null;

const wsDelegate: WsHandler = {
  open: (ws) => _wsHandler?.open(ws),
  close: (ws) => _wsHandler?.close(ws),
  message: (ws, msg) => _wsHandler?.message(ws, msg),
};

export function setAnalyticsWsProxyHandler(handler: WsHandler) {
  _wsHandler = handler;
}

const serverConfig = {
  port,
  async fetch(req: Request, server: unknown) {
    inFlightRequests++;
    try {
      return await app.fetch(req, { server });
    } finally {
      inFlightRequests--;
    }
  },
  websocket: wsDelegate,
};

// Bun auto-serves the default exported server config for entrypoints.
// We intentionally do not call Bun.serve() here to avoid double-binding the port.
export default serverConfig;
