import { Hono } from "hono";
import { logger } from "hono/logger";
import { getClickHouseClient, closeClickHouseClient } from "./clickhouse/client";
import { runClickHouseMigrations } from "./clickhouse/migrate";
import { closeRedisConnection, pingRedis } from "@uni-proxy-manager/shared/redis";
import { startConfigCache, stopConfigCache } from "./services/config-cache";
import { preloadScripts } from "./routes/scripts";

// Routes
import collectRoutes from "./routes/collect";
import scriptRoutes from "./routes/scripts";
import pixelRoutes from "./routes/pixel";
import serverApiRoutes from "./routes/server-api";
import internalRoutes from "./routes/internal";
import liveRoutes, { createWebSocketHandler } from "./routes/live";

const app = new Hono();

// Log only internal API routes (low throughput) to avoid overhead on beacon collection.
app.use("/internal/*", logger());

// Global security headers.
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// Health check
app.get("/health", async (c) => {
  try {
    const [redisOk, clickhouseOk] = await Promise.all([
      pingRedis(),
      getClickHouseClient().ping().then(() => true).catch(() => false),
    ]);
    const allOk = redisOk && clickhouseOk;
    return c.json({
      status: allOk ? "ok" : "degraded",
      service: "analytics",
      redis: redisOk ? "ok" : "down",
      clickhouse: clickhouseOk ? "ok" : "down",
      timestamp: new Date().toISOString(),
    }, allOk ? 200 : 503);
  } catch {
    return c.json({ status: "error", service: "analytics" }, 503);
  }
});

// Public beacon routes (proxied via HAProxy /_upm/{uuid}/*)
app.route("/_upm", collectRoutes);
app.route("/_upm", scriptRoutes);
app.route("/_upm", pixelRoutes);
app.route("/_upm", serverApiRoutes);
// Public live WS — only serves when publicDashboardEnabled = true on the config.
app.route("/_upm", liveRoutes);

// Internal API routes (accessed by apps/api, not exposed via HAProxy)
app.route("/internal/analytics", internalRoutes);
// Internal live WS — gated by X-Internal-Secret, used by the admin dashboard proxy.
app.route("/internal/analytics", liveRoutes);

async function init() {
  console.log("[Analytics] Initialising services...");

  try {
    const client = getClickHouseClient();
    await runClickHouseMigrations(client);
    console.log("[Analytics] ClickHouse migrations complete");
  } catch (error) {
    console.error("[Analytics] Failed to run ClickHouse migrations:", error);
  }

  try {
    const redisOk = await pingRedis();
    if (redisOk) {
      console.log("[Analytics] Redis connection established");
    } else {
      console.warn("[Analytics] Redis connection failed - some features will be unavailable");
    }
  } catch (error) {
    console.error("[Analytics] Failed to connect to Redis:", error);
  }

  try {
    await startConfigCache();
    console.log("[Analytics] Config cache started");
  } catch (error) {
    console.error("[Analytics] Failed to start config cache:", error);
  }

  try {
    await preloadScripts();
    console.log("[Analytics] Scripts pre-loaded");
  } catch (error) {
    console.error("[Analytics] Failed to pre-load scripts:", error);
  }
}

async function shutdown(signal: string) {
  console.log(`[Analytics] Received ${signal}, shutting down gracefully...`);

  try {
    stopConfigCache();
    await closeClickHouseClient();
    await closeRedisConnection();
    console.log("[Analytics] Shutdown complete");
  } catch (error) {
    console.error("[Analytics] Error during shutdown:", error);
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

init().then(() => {
  console.log("[Analytics] Analytics service starting on port 3003...");
});

export default {
  port: 3003,
  fetch(req: Request, server: unknown) {
    return app.fetch(req, { server });
  },
  websocket: createWebSocketHandler(),
};
