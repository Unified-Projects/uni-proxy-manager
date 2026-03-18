/**
 * Analytics data query routes.
 * Proxies all data queries to the analytics service's internal API.
 *
 * The live WebSocket endpoint is proxied internally through the API so the
 * browser never connects directly to the analytics service or the tracked
 * site's public domain.
 */

import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { analyticsConfig } from "@uni-proxy-manager/database";
import { eq } from "drizzle-orm";
import { getInternalSecret, getAnalyticsEndpoint } from "@uni-proxy-manager/shared/config";

// ---------------------------------------------------------------------------
// WebSocket proxy state
// ---------------------------------------------------------------------------

type ProxyWsData = {
  analyticsWsUrl: string;
  internalSecret: string;
};

type ProxyWs = {
  data: ProxyWsData;
  send: (msg: string | ArrayBuffer) => void;
  close: (code?: number, reason?: string) => void;
};

const proxyConnections = new Map<ProxyWs, WebSocket>();

/**
 * Bun WebSocket handler that bridges browser clients to the analytics
 * service's internal live endpoint.
 *
 * The browser connects to /api/analytics/:configId/live/ws (auth-protected
 * by the API's session middleware). The API opens its own WebSocket to the
 * analytics service's internal route using X-Internal-Secret, so the
 * browser never touches the analytics service or the tracked site's public
 * domain directly.
 *
 * The analytics internal route skips JWT first-message auth (the HTTP
 * upgrade is already authenticated), so the API sends auth_ok to the
 * browser as soon as the internal connection opens.
 */
export function createAnalyticsWsProxyHandler() {
  return {
    open(ws: ProxyWs) {
      let analyticsWs: WebSocket;
      try {
        analyticsWs = new WebSocket(ws.data.analyticsWsUrl, {
          headers: { "X-Internal-Secret": ws.data.internalSecret },
        } as never);
      } catch {
        ws.close(1011, "Failed to connect to analytics service");
        return;
      }

      proxyConnections.set(ws, analyticsWs);

      analyticsWs.onopen = () => {
        // Internal connection is authenticated at the HTTP upgrade level.
        // Signal the browser that the live stream is ready.
        try {
          ws.send(JSON.stringify({ type: "auth_ok" }));
        } catch {
          // Browser already disconnected.
        }
      };

      analyticsWs.onmessage = (event: MessageEvent) => {
        const msg = typeof event.data === "string" ? event.data : String(event.data);
        try {
          ws.send(msg);
        } catch {
          // Browser disconnected; close handler cleans up.
        }
      };

      analyticsWs.onclose = () => {
        proxyConnections.delete(ws);
        try { ws.close(); } catch { /* already closed */ }
      };

      analyticsWs.onerror = () => {
        proxyConnections.delete(ws);
        try { ws.close(1011, "Analytics service error"); } catch { /* already closed */ }
      };
    },

    close(ws: ProxyWs) {
      const analyticsWs = proxyConnections.get(ws);
      if (analyticsWs) {
        analyticsWs.close();
        proxyConnections.delete(ws);
      }
    },

    message(_ws: ProxyWs, _msg: string) {
      // The browser does not send messages after the connection is established.
    },
  };
}

const app = new Hono();

async function proxyToAnalytics(path: string, queryString: string): Promise<Response> {
  const endpoint = getAnalyticsEndpoint();
  const secret = getInternalSecret();
  const url = queryString
    ? `${endpoint}/internal/analytics${path}?${queryString}`
    : `${endpoint}/internal/analytics${path}`;
  return fetch(url, {
    headers: { "X-Internal-Secret": secret },
  });
}

async function validateConfigExists(configId: string): Promise<boolean> {
  const config = await db.query.analyticsConfig.findFirst({
    where: eq(analyticsConfig.id, configId),
    columns: { id: true },
  });
  return !!config;
}

async function proxyHandler(c: { req: { param: (k: string) => string; url: string }; json: (data: unknown, status?: number) => Response }) {
  const configId = c.req.param("configId");
  if (!(await validateConfigExists(configId))) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  const url = new URL(c.req.url);
  const pathAfterConfig = url.pathname.replace(/^\/api\/analytics\/[^/]+/, "");
  const proxyPath = `/${configId}${pathAfterConfig}`;

  let resp: Response;
  try {
    resp = await proxyToAnalytics(proxyPath, url.searchParams.toString());
  } catch {
    return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analytics service unreachable" } }, 502);
  }

  try {
    const data = await resp.json();
    return c.json(data, resp.status as 200);
  } catch {
    return c.json({ error: { code: "BAD_GATEWAY", message: "Invalid response from analytics service" } }, 502);
  }
}

// Data query endpoints.
app.get("/:configId/summary", proxyHandler as never);
app.get("/:configId/timeseries", proxyHandler as never);
app.get("/:configId/pages", proxyHandler as never);
app.get("/:configId/referrers", proxyHandler as never);
app.get("/:configId/geography", proxyHandler as never);
app.get("/:configId/devices", proxyHandler as never);
app.get("/:configId/events", proxyHandler as never);
app.get("/:configId/events/:eventName", async (c) => {
  const configId = c.req.param("configId");
  const eventName = c.req.param("eventName");
  if (!(await validateConfigExists(configId))) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }
  const url = new URL(c.req.url);
  let resp: Response;
  try {
    resp = await proxyToAnalytics(`/${configId}/events/${eventName}`, url.searchParams.toString());
  } catch {
    return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analytics service unreachable" } }, 502);
  }
  try {
    const data = await resp.json();
    return c.json(data, resp.status as 200);
  } catch {
    return c.json({ error: { code: "BAD_GATEWAY", message: "Invalid response from analytics service" } }, 502);
  }
});
app.get("/:configId/utm", proxyHandler as never);
app.get("/:configId/live", proxyHandler as never);

// GET /:configId/live/ws-info - Return the WebSocket connection URL.
// The WS endpoint is on the API itself so the browser never touches the
// analytics service or the tracked site's public domain directly.
app.get("/:configId/live/ws-info", async (c) => {
  const configId = c.req.param("configId");
  const config = await db.query.analyticsConfig.findFirst({
    where: eq(analyticsConfig.id, configId),
    columns: { id: true, trackingUuid: true, enabled: true },
  });

  if (!config) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }

  // Build the WS URL using the public-facing hostname and protocol.
  // Prefer proxy-forwarded headers over what Bun sees on the socket
  // (which is always HTTP when behind a TLS-terminating reverse proxy).
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? new URL(c.req.url).host;
  const forwardedProto = c.req.header("X-Forwarded-Proto")?.split(",")[0]?.trim();
  // Default to wss — only downgrade to ws if the proto is explicitly http.
  const wsProtocol = forwardedProto === "http" ? "ws" : "wss";
  const wsUrl = `${wsProtocol}://${host}/api/analytics/${configId}/live/ws`;

  return c.json({
    wsUrl,
    trackingUuid: config.trackingUuid,
    enabled: config.enabled,
  });
});

// GET /:configId/live/ws - WebSocket upgrade (proxied to analytics service internally).
app.get("/:configId/live/ws", async (c) => {
  const configId = c.req.param("configId");
  const config = await db.query.analyticsConfig.findFirst({
    where: eq(analyticsConfig.id, configId),
    columns: { id: true, trackingUuid: true, enabled: true },
  });

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

  // Build the internal analytics WS URL — goes straight to the analytics
  // service container via the internal-only route, never through HAProxy
  // or the tracked site's public domain.
  const endpoint = getAnalyticsEndpoint(); // e.g. http://analytics:3003
  const wsEndpoint = endpoint.replace(/^http/, "ws");
  const analyticsWsUrl = `${wsEndpoint}/internal/analytics/${config.trackingUuid}/live/ws`;

  const internalSecret = getInternalSecret();

  const success = (server as { upgrade: (req: Request, opts: unknown) => boolean }).upgrade(c.req.raw, {
    data: { analyticsWsUrl, internalSecret } satisfies ProxyWsData,
  });

  if (!success) {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "WebSocket upgrade failed" } }, 500);
  }

  return new Response(null, { status: 101 });
});

// Export endpoints.
app.get("/:configId/export/csv", async (c) => {
  const configId = c.req.param("configId");
  if (!(await validateConfigExists(configId))) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }
  const url = new URL(c.req.url);
  url.searchParams.set("format", "csv");
  let resp: Response;
  try {
    resp = await proxyToAnalytics(`/${configId}/export`, url.searchParams.toString());
  } catch {
    return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analytics service unreachable" } }, 502);
  }
  const text = await resp.text();
  return c.text(text, resp.status as 200, {
    "Content-Type": "text/csv",
    "Content-Disposition": resp.headers.get("Content-Disposition") || `attachment; filename="analytics-export.csv"`,
  });
});

app.get("/:configId/export/json", async (c) => {
  const configId = c.req.param("configId");
  if (!(await validateConfigExists(configId))) {
    return c.json({ error: { code: "CONFIG_NOT_FOUND", message: "Not found" } }, 404);
  }
  const url = new URL(c.req.url);
  url.searchParams.set("format", "json");
  let resp: Response;
  try {
    resp = await proxyToAnalytics(`/${configId}/export`, url.searchParams.toString());
  } catch {
    return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Analytics service unreachable" } }, 502);
  }
  try {
    const data = await resp.json();
    return c.json(data, resp.status as 200);
  } catch {
    return c.json({ error: { code: "BAD_GATEWAY", message: "Invalid response from analytics service" } }, 502);
  }
});

export default app;
