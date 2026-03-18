/**
 * WebSocket live endpoint.
 *
 * Two variants:
 *
 *  PUBLIC  /_upm/:uuid/live
 *    Only available when publicDashboardEnabled = true on the config.
 *    Uses first-message JWT authentication so tokens never appear in URLs
 *    or server logs.
 *
 *  INTERNAL  /internal/analytics/:uuid/live/ws
 *    Gated by X-Internal-Secret (internalAuth middleware).
 *    No first-message JWT auth — the HTTP upgrade is already authenticated.
 *    Used exclusively by apps/api to serve the admin dashboard over the
 *    internal network; never exposed via HAProxy.
 *
 * Redis subscribers are shared across clients watching the same configId
 * to avoid O(n) Redis connections.
 */

import { Hono } from "hono";
import { getConfigByUuid } from "../services/config-cache";
import { internalAuth } from "../middleware/internal-auth";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { getAnalyticsJwtSecret } from "@uni-proxy-manager/shared/config";
import * as jose from "jose";
import Redis from "ioredis";

type WsClient = {
  data: WsData;
  send: (msg: string) => void;
  close: (code?: number, reason?: string) => void;
};

type WsData =
  | { mode: "public"; configId: string }
  | { mode: "internal"; configId: string };

const app = new Hono();

// ---------------------------------------------------------------------------
// Public route — only when publicDashboardEnabled
// ---------------------------------------------------------------------------

app.get("/:uuid/live", async (c) => {
  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  if (!config || !config.enabled) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  if (!config.publicDashboardEnabled) {
    return c.json({ error: { code: "FORBIDDEN", message: "Public dashboard is not enabled" } }, 403);
  }

  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: { code: "UPGRADE_REQUIRED", message: "WebSocket upgrade required" } }, 426);
  }

  const server = (c.env as Record<string, unknown>)?.server;
  if (!server || typeof (server as Record<string, unknown>).upgrade !== "function") {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "WebSocket not supported" } }, 500);
  }

  const success = (server as { upgrade: (req: Request, opts: unknown) => boolean }).upgrade(c.req.raw, {
    data: { mode: "public", configId: config.id } satisfies WsData,
  });

  if (!success) {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "WebSocket upgrade failed" } }, 500);
  }

  return new Response(null, { status: 101 });
});

// ---------------------------------------------------------------------------
// Internal route — gated by internalAuth, no JWT first-message auth
// ---------------------------------------------------------------------------

app.get("/:uuid/live/ws", internalAuth, async (c) => {
  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  if (!config || !config.enabled) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: { code: "UPGRADE_REQUIRED", message: "WebSocket upgrade required" } }, 426);
  }

  const server = (c.env as Record<string, unknown>)?.server;
  if (!server || typeof (server as Record<string, unknown>).upgrade !== "function") {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "WebSocket not supported" } }, 500);
  }

  const success = (server as { upgrade: (req: Request, opts: unknown) => boolean }).upgrade(c.req.raw, {
    data: { mode: "internal", configId: config.id } satisfies WsData,
  });

  if (!success) {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "WebSocket upgrade failed" } }, 500);
  }

  return new Response(null, { status: 101 });
});

// ---------------------------------------------------------------------------
// Shared Redis fan-out helpers
// ---------------------------------------------------------------------------

/**
 * Query the current live snapshot for a configId from Redis.
 */
async function fetchLiveSnapshot(configId: string): Promise<string> {
  const redis = getRedisClient();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fiveMinAgo = nowSeconds - 5 * 60;

  const activeKey = `analytics:active:${configId}`;
  const activePagesKey = `analytics:active_pages:${configId}`;
  const recentEventsKey = `analytics:recent_events:${configId}`;

  const [activeVisitors, activePagesRaw, recentEventsRaw] = await Promise.all([
    redis.zcount(activeKey, fiveMinAgo, "+inf"),
    redis.zrangebyscore(activePagesKey, fiveMinAgo, nowSeconds),
    redis.lrange(recentEventsKey, 0, 49),
  ]);

  const pageCounts = new Map<string, number>();
  for (const entry of activePagesRaw) {
    const colonIdx = entry.indexOf(":");
    const pathname = colonIdx >= 0 ? entry.substring(colonIdx + 1) : entry;
    pageCounts.set(pathname, (pageCounts.get(pathname) || 0) + 1);
  }
  const activePages = Array.from(pageCounts.entries())
    .map(([pathname, visitors]) => ({ pathname, visitors }))
    .sort((a, b) => b.visitors - a.visitors);

  const recentEvents: unknown[] = [];
  for (const raw of recentEventsRaw) {
    try {
      recentEvents.push(JSON.parse(raw));
    } catch {
      // Skip malformed entries.
    }
  }

  return JSON.stringify({ activeVisitors, activePages, recentEvents });
}

/**
 * Shared Redis subscribers keyed by channel name.
 * One subscriber per unique channel, fan-out to all connected clients.
 */
const channelSubscribers = new Map<string, { subscriber: Redis; clients: Set<WsClient> }>();

function addClientToChannel(channel: string, ws: WsClient): void {
  const existing = channelSubscribers.get(channel);
  if (existing) {
    existing.clients.add(ws);
    return;
  }

  const subscriber = getRedisClient().duplicate();
  const clients = new Set<WsClient>([ws]);
  const configId = channel.replace("analytics:live:", "");

  subscriber.subscribe(channel);

  subscriber.on("message", (_ch: string, _msg: string) => {
    fetchLiveSnapshot(configId).then((snapshot) => {
      for (const client of clients) {
        try {
          client.send(snapshot);
        } catch {
          // Client disconnected; close handler will clean it up.
        }
      }
    }).catch(() => {
      // Redis query failed; skip this broadcast.
    });
  });

  channelSubscribers.set(channel, { subscriber, clients });
}

function removeClientFromChannel(channel: string, ws: WsClient): void {
  const entry = channelSubscribers.get(channel);
  if (!entry) return;

  entry.clients.delete(ws);

  if (entry.clients.size === 0) {
    entry.subscriber.unsubscribe(channel);
    entry.subscriber.disconnect();
    channelSubscribers.delete(channel);
  }
}

// ---------------------------------------------------------------------------
// Bun WebSocket handler (single handler covers both public and internal)
// ---------------------------------------------------------------------------

export function createWebSocketHandler() {
  // Per-connection state for the public (JWT-auth) path only.
  const publicState = new Map<WsClient, {
    channel: string | null;
    authenticated: boolean;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  return {
    open(ws: WsClient) {
      if (ws.data.mode === "internal") {
        // Internal connections are already authenticated at the HTTP layer.
        // Subscribe immediately and start forwarding data.
        const channel = `analytics:live:${ws.data.configId}`;
        addClientToChannel(channel, ws);
        return;
      }

      // Public connection — start 5-second auth timeout.
      const timeout = setTimeout(() => {
        const state = publicState.get(ws);
        if (state && !state.authenticated) {
          ws.send(JSON.stringify({ type: "auth_timeout" }));
          ws.close(1008, "Auth timeout");
          publicState.delete(ws);
        }
      }, 5000);

      publicState.set(ws, { channel: null, authenticated: false, timeout });
    },

    async message(ws: WsClient, message: string) {
      if (ws.data.mode === "internal") {
        // Internal clients do not send messages.
        return;
      }

      const state = publicState.get(ws);
      if (!state) return;

      if (!state.authenticated) {
        try {
          const data = JSON.parse(message);
          if (data.type === "auth" && data.token && typeof data.token === "string") {
            let payload: jose.JWTPayload;
            try {
              const secret = new TextEncoder().encode(getAnalyticsJwtSecret());
              const result = await jose.jwtVerify(data.token, secret);
              payload = result.payload;
            } catch {
              ws.send(JSON.stringify({ type: "auth_error" }));
              ws.close(1008, "Invalid token");
              publicState.delete(ws);
              return;
            }

            if (payload.configId !== ws.data.configId) {
              ws.send(JSON.stringify({ type: "auth_error" }));
              ws.close(1008, "Token scope mismatch");
              publicState.delete(ws);
              return;
            }

            clearTimeout(state.timeout);
            state.authenticated = true;

            const channel = `analytics:live:${ws.data.configId}`;
            state.channel = channel;
            addClientToChannel(channel, ws);

            ws.send(JSON.stringify({ type: "auth_ok" }));
          } else {
            ws.send(JSON.stringify({ type: "auth_error" }));
            ws.close(1008, "Invalid auth");
            publicState.delete(ws);
          }
        } catch {
          ws.send(JSON.stringify({ type: "auth_error" }));
          ws.close(1008, "Invalid message");
          publicState.delete(ws);
        }
      }
    },

    close(ws: WsClient) {
      if (ws.data.mode === "internal") {
        const channel = `analytics:live:${ws.data.configId}`;
        removeClientFromChannel(channel, ws);
        return;
      }

      const state = publicState.get(ws);
      if (state) {
        clearTimeout(state.timeout);
        if (state.channel) {
          removeClientFromChannel(state.channel, ws);
        }
        publicState.delete(ws);
      }
    },
  };
}

export default app;
