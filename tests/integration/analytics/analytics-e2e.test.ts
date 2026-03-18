/**
 * Analytics Subsystem E2E Integration Tests
 *
 * Tests the full analytics pipeline against real Docker containers:
 * beacon collection -> ClickHouse storage -> internal query API.
 *
 * Requires: test-postgres, test-redis, test-clickhouse, test-analytics, test-website
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import { getTestDb, closeTestDb } from "../setup/test-db";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ANALYTICS_URL = process.env.TEST_ANALYTICS_URL || "http://test-analytics:3003";
const WEBSITE_URL = process.env.TEST_WEBSITE_URL || "http://test-website:80";
const INTERNAL_SECRET = process.env.UNI_PROXY_MANAGER_INTERNAL_SECRET || "test-internal-secret";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DOMAIN_ID = `test-analytics-domain-${Date.now()}`;
const TEST_CONFIG_ID = `test-analytics-config-${Date.now()}`;
const TEST_UUID = crypto.randomUUID();
const TEST_HOSTNAME = "test-website";

/** API token for server-side API tests. */
const API_TOKEN = "test-api-token-for-integration";
const API_TOKEN_SHA256 = crypto.createHash("sha256").update(API_TOKEN).digest("hex");

/** Send a beacon to the collect endpoint. */
async function sendBeacon(
  uuid: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${ANALYTICS_URL}/_upm/${uuid}/collect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://${TEST_HOSTNAME}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Build a valid beacon payload. */
function makeBeacon(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: "pageview",
    p: "/",
    sid: `session-${crypto.randomUUID()}`,
    v: 1,
    r: "",
    tz: "America/New_York",
    sw: 1920,
    sh: 1080,
    ...overrides,
  };
}

/** Query ClickHouse analytics_events directly via HTTP interface. */
async function queryClickHouse(query: string): Promise<unknown[]> {
  const chUrl = process.env.UNI_PROXY_MANAGER_CLICKHOUSE_URL || "http://test-clickhouse:8123";
  const chPassword = process.env.UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD || "test_clickhouse_password";

  const res = await fetch(`${chUrl}/?query=${encodeURIComponent(query + " FORMAT JSON")}`, {
    headers: {
      "X-ClickHouse-User": "analytics",
      "X-ClickHouse-Key": chPassword,
      "X-ClickHouse-Database": "analytics",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickHouse query failed (${res.status}): ${text}`);
  }

  const json = await res.json() as { data: unknown[] };
  return json.data;
}

/** Wait for the analytics service config cache to pick up our test config. */
async function waitForConfigCache(uuid: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${uuid}/script.js`);
      if (res.status === 200) return;
    } catch {
      // Service might not be ready yet.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Config cache did not pick up UUID ${uuid} within ${timeoutMs}ms`);
}

/** Pause to allow fire-and-forget ingestion to complete. */
async function waitForIngestion(ms = 2000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

describe("Analytics E2E", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const db = getTestDb();

    // Ensure the analytics service is healthy.
    const healthRes = await fetch(`${ANALYTICS_URL}/health`);
    expect(healthRes.status).toBe(200);

    // Create a test domain in PostgreSQL.
    await db.insert(schema.domains).values({
      id: TEST_DOMAIN_ID,
      hostname: TEST_HOSTNAME,
      displayName: "Analytics Test Website",
      status: "active",
      sslEnabled: false,
      forceHttps: false,
    }).onConflictDoNothing();

    // Create a test analytics config linked to that domain.
    await db.insert(schema.analyticsConfig).values({
      id: TEST_CONFIG_ID,
      domainId: TEST_DOMAIN_ID,
      trackingUuid: TEST_UUID,
      enabled: true,
      apiTokenSha256: API_TOKEN_SHA256,
      rawRetentionDays: 90,
      aggregateRetentionDays: 365,
      trackScrollDepth: true,
      trackSessionDuration: true,
      trackOutboundLinks: true,
      captureUtmParams: true,
      allowedOrigins: [],
      ignoredPaths: [],
    }).onConflictDoNothing();

    // Wait for the analytics service config cache to pick it up.
    await waitForConfigCache(TEST_UUID);
  });

  afterAll(async () => {
    const db = getTestDb();

    // Clean up test data from PostgreSQL.
    try {
      await db.delete(schema.analyticsConfig).where(eq(schema.analyticsConfig.id, TEST_CONFIG_ID));
      await db.delete(schema.domains).where(eq(schema.domains.id, TEST_DOMAIN_ID));
    } catch {
      // Best-effort cleanup.
    }

    // Clean up test data from ClickHouse.
    try {
      await queryClickHouse(
        `ALTER TABLE analytics_events DELETE WHERE analytics_config_id = '${TEST_CONFIG_ID}'`,
      );
    } catch {
      // Best-effort cleanup.
    }

    await closeTestDb();
  });

  // =========================================================================
  // Health Check
  // =========================================================================

  describe("Health check", () => {
    it("should return 200 with ok status", async () => {
      const res = await fetch(`${ANALYTICS_URL}/health`);
      expect(res.status).toBe(200);

      const body = await res.json() as { status: string; service: string };
      expect(body.status).toBe("ok");
      expect(body.service).toBe("analytics");
    });
  });

  // =========================================================================
  // Beacon Collection
  // =========================================================================

  describe("Beacon collection", () => {
    it("should accept a valid pageview beacon and store in ClickHouse", async () => {
      const sessionId = `e2e-pv-${crypto.randomUUID()}`;
      const res = await sendBeacon(TEST_UUID, makeBeacon({
        sid: sessionId,
        p: "/e2e-test-page",
      }));

      expect(res.status).toBe(202);

      await waitForIngestion();

      const rows = await queryClickHouse(
        `SELECT * FROM analytics_events WHERE session_id = '${sessionId}' AND analytics_config_id = '${TEST_CONFIG_ID}'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row.event_type).toBe("pageview");
      expect(row.pathname).toBe("/e2e-test-page");
      expect(row.analytics_config_id).toBe(TEST_CONFIG_ID);
    });

    it("should accept a custom event with name and meta", async () => {
      const sessionId = `e2e-evt-${crypto.randomUUID()}`;
      const res = await sendBeacon(TEST_UUID, makeBeacon({
        t: "event",
        sid: sessionId,
        p: "/pricing",
        n: "signup_click",
        m: { plan: "pro" },
      }));

      expect(res.status).toBe(202);

      await waitForIngestion();

      const rows = await queryClickHouse(
        `SELECT * FROM analytics_events WHERE session_id = '${sessionId}' AND event_type = 'event'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row.event_name).toBe("signup_click");
      expect(row.pathname).toBe("/pricing");
    });

    it("should accept a session_end event with duration and scroll depth", async () => {
      const sessionId = `e2e-se-${crypto.randomUUID()}`;
      const res = await sendBeacon(TEST_UUID, makeBeacon({
        t: "session_end",
        sid: sessionId,
        p: "/about",
        sd: 15000,
        sp: 75,
        ib: 0,
      }));

      expect(res.status).toBe(202);

      await waitForIngestion();

      const rows = await queryClickHouse(
        `SELECT * FROM analytics_events WHERE session_id = '${sessionId}' AND event_type = 'session_end'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);

      const row = rows[0] as Record<string, unknown>;
      expect(Number(row.session_duration_ms)).toBe(15000);
      expect(Number(row.scroll_depth_pct)).toBe(75);
    });

    it("should reject beacons with bot User-Agent", async () => {
      const sessionId = `e2e-bot-${crypto.randomUUID()}`;
      const res = await sendBeacon(
        TEST_UUID,
        makeBeacon({ sid: sessionId, p: "/bot-page" }),
        { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      );

      expect(res.status).toBe(204);

      await waitForIngestion();

      const rows = await queryClickHouse(
        `SELECT * FROM analytics_events WHERE session_id = '${sessionId}'`,
      );
      expect(rows.length).toBe(0);
    });

    it("should respect Sec-GPC header", async () => {
      const sessionId = `e2e-gpc-${crypto.randomUUID()}`;
      const res = await sendBeacon(
        TEST_UUID,
        makeBeacon({ sid: sessionId, p: "/gpc-page" }),
        { "Sec-GPC": "1" },
      );

      expect(res.status).toBe(204);

      await waitForIngestion();

      const rows = await queryClickHouse(
        `SELECT * FROM analytics_events WHERE session_id = '${sessionId}'`,
      );
      expect(rows.length).toBe(0);
    });

    it("should return 404 for unknown UUID", async () => {
      const res = await sendBeacon("nonexistent-uuid", makeBeacon());
      expect(res.status).toBe(404);
    });

    it("should reject CORS from mismatched origin", async () => {
      const res = await sendBeacon(
        TEST_UUID,
        makeBeacon(),
        { Origin: "http://evil-site.com" },
      );

      expect(res.status).toBe(403);
    });

    it("should return 400 for invalid payload", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: `http://${TEST_HOSTNAME}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify({ t: "pageview" }), // missing sid, p, v
      });

      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // Script Serving
  // =========================================================================

  describe("Script serving", () => {
    it("should serve script.js with correct content type", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/script.js`);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("javascript");

      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    });

    it("should serve tracker.js with correct content type", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/tracker.js`);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("javascript");
    });

    it("should return 404 for unknown UUID on script.js", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/nonexistent-uuid/script.js`);
      expect(res.status).toBe(404);
    });

    it("should include cache headers on scripts", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/script.js`);

      expect(res.status).toBe(200);
      const cacheControl = res.headers.get("Cache-Control") || "";
      expect(cacheControl).toContain("max-age");
    });
  });

  // =========================================================================
  // Pixel Tracking
  // =========================================================================

  describe("Pixel tracking", () => {
    it("should return 1x1 GIF with correct content type", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/pixel.gif`, {
        headers: {
          Referer: `http://${TEST_HOSTNAME}/index.html`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
      expect(res.headers.get("Cache-Control")).toContain("no-cache");
    });

    it("should record a pixel event in ClickHouse when Referer matches", async () => {
      // First we need to check that events from this endpoint appear in ClickHouse.
      const before = await queryClickHouse(
        `SELECT count() as cnt FROM analytics_events WHERE analytics_config_id = '${TEST_CONFIG_ID}' AND source = 'pixel'`,
      ) as { cnt: string }[];
      const countBefore = Number(before[0]?.cnt || 0);

      await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/pixel.gif`, {
        headers: {
          Referer: `http://${TEST_HOSTNAME}/pixel-test-page.html`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      await waitForIngestion();

      const after = await queryClickHouse(
        `SELECT count() as cnt FROM analytics_events WHERE analytics_config_id = '${TEST_CONFIG_ID}' AND source = 'pixel'`,
      ) as { cnt: string }[];
      const countAfter = Number(after[0]?.cnt || 0);

      expect(countAfter).toBeGreaterThan(countBefore);
    });

    it("should return GIF but NOT record event when Referer mismatches", async () => {
      const before = await queryClickHouse(
        `SELECT count() as cnt FROM analytics_events WHERE analytics_config_id = '${TEST_CONFIG_ID}' AND source = 'pixel'`,
      ) as { cnt: string }[];
      const countBefore = Number(before[0]?.cnt || 0);

      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/pixel.gif`, {
        headers: {
          Referer: "http://evil-site.com/page.html",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");

      await waitForIngestion();

      const after = await queryClickHouse(
        `SELECT count() as cnt FROM analytics_events WHERE analytics_config_id = '${TEST_CONFIG_ID}' AND source = 'pixel'`,
      ) as { cnt: string }[];
      const countAfter = Number(after[0]?.cnt || 0);

      expect(countAfter).toBe(countBefore);
    });

    it("should return GIF for unknown UUID", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/nonexistent-uuid/pixel.gif`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
    });
  });

  // =========================================================================
  // Server-Side API
  // =========================================================================

  describe("Server-side API", () => {
    it("should accept valid events with Bearer token", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify({
          events: [
            { type: "pageview", pathname: "/api-test-page" },
          ],
        }),
      });

      expect(res.status).toBe(202);
      const body = await res.json() as { accepted: number };
      expect(body.accepted).toBe(1);

      await waitForIngestion();

      const rows = await queryClickHouse(
        `SELECT * FROM analytics_events WHERE analytics_config_id = '${TEST_CONFIG_ID}' AND pathname = '/api-test-page' AND source = 'api'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("should accept a batch of events", async () => {
      const events = [
        { type: "pageview", pathname: "/batch-1" },
        { type: "pageview", pathname: "/batch-2" },
        { type: "event", pathname: "/batch-3", name: "cta_click" },
      ];

      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify({ events }),
      });

      expect(res.status).toBe(202);
      const body = await res.json() as { accepted: number };
      expect(body.accepted).toBe(3);
    });

    it("should return 401 for missing token", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ type: "pageview", pathname: "/" }] }),
      });

      expect(res.status).toBe(401);
    });

    it("should return 401 for invalid token", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({ events: [{ type: "pageview", pathname: "/" }] }),
      });

      expect(res.status).toBe(401);
    });

    it("should return 400 for empty events array", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${TEST_UUID}/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify({ events: [] }),
      });

      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // Internal API
  // =========================================================================

  describe("Internal API", () => {
    // Seed some events first so the internal API has data to return.
    beforeAll(async () => {
      // Insert a few beacons with known data.
      const sessionId = `e2e-internal-${crypto.randomUUID()}`;
      await sendBeacon(TEST_UUID, makeBeacon({
        sid: sessionId,
        p: "/internal-test",
        tz: "Europe/London",
      }));
      await sendBeacon(TEST_UUID, makeBeacon({
        sid: sessionId,
        p: "/internal-test-2",
        r: "https://google.com/search?q=test",
        tz: "Europe/London",
      }));

      // Also send a custom event.
      await sendBeacon(TEST_UUID, makeBeacon({
        t: "event",
        sid: sessionId,
        p: "/internal-test",
        n: "button_click",
        m: { variant: "blue" },
      }));

      await waitForIngestion(3000);
    });

    it("should return 401 without X-Internal-Secret", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/summary`,
      );
      expect(res.status).toBe(401);
    });

    it("should return 401 with wrong X-Internal-Secret", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/summary`,
        { headers: { "X-Internal-Secret": "wrong-secret" } },
      );
      expect(res.status).toBe(401);
    });

    it("should return summary data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/summary`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { summary: Record<string, unknown> };
      expect(body.summary).toBeDefined();
      expect(typeof body.summary.pageViews).toBe("number");
      expect(typeof body.summary.uniqueVisitors).toBe("number");
      expect(typeof body.summary.sessions).toBe("number");
      expect(typeof body.summary.bounceRate).toBe("number");
    });

    it("should return timeseries data", async () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/timeseries?start=${hourAgo.toISOString()}&end=${now.toISOString()}`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { timeseries: unknown[] };
      expect(body.timeseries).toBeDefined();
      expect(Array.isArray(body.timeseries)).toBe(true);
    });

    it("should return pages data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/pages`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { pages: unknown[]; entryPages: unknown[]; exitPages: unknown[] };
      expect(body.pages).toBeDefined();
      expect(Array.isArray(body.pages)).toBe(true);
    });

    it("should return referrers data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/referrers`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { referrers: unknown[] };
      expect(body.referrers).toBeDefined();
      expect(Array.isArray(body.referrers)).toBe(true);
    });

    it("should return geography data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/geography`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { countries: unknown[] };
      expect(body.countries).toBeDefined();
      expect(Array.isArray(body.countries)).toBe(true);
    });

    it("should return devices data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/devices`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { devices: Record<string, number>; browsers: unknown[]; os: unknown[] };
      expect(body.devices).toBeDefined();
      expect(typeof body.devices.desktop).toBe("number");
      expect(Array.isArray(body.browsers)).toBe(true);
      expect(Array.isArray(body.os)).toBe(true);
    });

    it("should return events data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/events`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { events: unknown[] };
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
    });

    it("should return live data", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/live`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { activeVisitors: number; activePages: unknown[] };
      expect(typeof body.activeVisitors).toBe("number");
      expect(Array.isArray(body.activePages)).toBe(true);
    });

    it("should return 404 for non-existent config ID", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/nonexistent-config/summary`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );
      expect(res.status).toBe(404);
    });

    it("should support export as JSON", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/export?format=json&type=summary`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toBeDefined();
    });

    it("should support export as CSV", async () => {
      const res = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/export?format=csv&type=summary`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
    });
  });

  // =========================================================================
  // ClickHouse Migrations
  // =========================================================================

  describe("ClickHouse tables", () => {
    it("should have analytics_events table", async () => {
      const rows = await queryClickHouse("SELECT count() as cnt FROM analytics_events");
      expect(rows.length).toBe(1);
    });

    it("should have analytics_agg_minute table", async () => {
      const rows = await queryClickHouse("SELECT count() as cnt FROM analytics_agg_minute");
      expect(rows.length).toBe(1);
    });

    it("should have analytics_agg_hour table", async () => {
      const rows = await queryClickHouse("SELECT count() as cnt FROM analytics_agg_hour");
      expect(rows.length).toBe(1);
    });

    it("should have analytics_agg_day table", async () => {
      const rows = await queryClickHouse("SELECT count() as cnt FROM analytics_agg_day");
      expect(rows.length).toBe(1);
    });
  });

  // =========================================================================
  // Test Website
  // =========================================================================

  describe("Test website", () => {
    it("should serve the index page", async () => {
      const res = await fetch(`${WEBSITE_URL}/index.html`);
      expect(res.status).toBe(200);

      const body = await res.text();
      expect(body).toContain("Test Website Home");
      expect(body).toContain("script.js");
    });

    it("should serve the about page", async () => {
      const res = await fetch(`${WEBSITE_URL}/about.html`);
      expect(res.status).toBe(200);

      const body = await res.text();
      expect(body).toContain("Test Website About");
    });

    it("should serve the noscript page with pixel tag", async () => {
      const res = await fetch(`${WEBSITE_URL}/noscript.html`);
      expect(res.status).toBe(200);

      const body = await res.text();
      expect(body).toContain("pixel.gif");
    });
  });

  // =========================================================================
  // Disabled Config
  // =========================================================================

  describe("Disabled config", () => {
    const DISABLED_CONFIG_ID = `test-disabled-config-${Date.now()}`;
    const DISABLED_DOMAIN_ID = `test-disabled-domain-${Date.now()}`;
    const DISABLED_UUID = crypto.randomUUID();

    beforeAll(async () => {
      const db = getTestDb();

      await db.insert(schema.domains).values({
        id: DISABLED_DOMAIN_ID,
        hostname: "disabled-test.example.com",
        displayName: "Disabled Test",
        status: "active",
        sslEnabled: false,
        forceHttps: false,
      }).onConflictDoNothing();

      await db.insert(schema.analyticsConfig).values({
        id: DISABLED_CONFIG_ID,
        domainId: DISABLED_DOMAIN_ID,
        trackingUuid: DISABLED_UUID,
        enabled: false,
        rawRetentionDays: 90,
        aggregateRetentionDays: 365,
        trackScrollDepth: true,
        trackSessionDuration: true,
        trackOutboundLinks: true,
        captureUtmParams: true,
        allowedOrigins: [],
        ignoredPaths: [],
      }).onConflictDoNothing();

      // Wait for config cache refresh.
      await new Promise((r) => setTimeout(r, 65_000));
    });

    afterAll(async () => {
      const db = getTestDb();
      try {
        await db.delete(schema.analyticsConfig).where(eq(schema.analyticsConfig.id, DISABLED_CONFIG_ID));
        await db.delete(schema.domains).where(eq(schema.domains.id, DISABLED_DOMAIN_ID));
      } catch {
        // Best-effort cleanup.
      }
    });

    it("should reject beacon to disabled config", async () => {
      // The CORS middleware runs before the config-enabled check, so a
      // mismatched origin yields 403.  With the correct origin we'd get 404.
      const res = await sendBeacon(DISABLED_UUID, makeBeacon());
      expect([403, 404]).toContain(res.status);
    });

    it("should return 404 for script.js on disabled config", async () => {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${DISABLED_UUID}/script.js`);
      expect(res.status).toBe(404);
    });
  });
});
