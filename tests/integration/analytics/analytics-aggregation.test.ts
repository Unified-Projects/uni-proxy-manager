/**
 * Analytics MV Aggregation Pipeline Integration Tests
 *
 * Verifies that beacons inserted into analytics_events are correctly
 * aggregated by the three materialized views into:
 *   - analytics_agg_minute  (AggregatingMergeTree, TTL 7 days)
 *   - analytics_agg_hour    (AggregatingMergeTree, TTL 180 days)
 *   - analytics_agg_day     (AggregatingMergeTree)
 *
 * Requires: test-postgres, test-redis, test-clickhouse, test-analytics
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
const INTERNAL_SECRET = process.env.UNI_PROXY_MANAGER_INTERNAL_SECRET || "test-internal-secret";

// ---------------------------------------------------------------------------
// Test identifiers — unique per run to avoid cross-test contamination
// ---------------------------------------------------------------------------

const RUN_SUFFIX = Date.now();
const TEST_DOMAIN_ID = `test-mv-domain-${RUN_SUFFIX}`;
const TEST_CONFIG_ID = `test-mv-config-${RUN_SUFFIX}`;
const TEST_UUID = crypto.randomUUID();
const TEST_HOSTNAME = "test-website";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Query ClickHouse via HTTP interface with analytics credentials. */
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

/** POST a beacon to the collect endpoint. */
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Build a minimal valid beacon payload with overrides. */
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

/** Wait for fire-and-forget ingestion + MV population. */
async function waitForIngestion(ms = 3000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Poll until the analytics service has cached the config for the given UUID. */
async function waitForConfigCache(uuid: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${ANALYTICS_URL}/_upm/${uuid}/script.js`);
      if (res.status === 200) return;
    } catch {
      // Service not ready yet.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Config cache did not pick up UUID ${uuid} within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

describe("Materialized View Aggregation Pipeline", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const db = getTestDb();

    await db
      .insert(schema.domains)
      .values({
        id: TEST_DOMAIN_ID,
        hostname: TEST_HOSTNAME,
        displayName: "Analytics MV Test Website",
        status: "active",
        sslEnabled: false,
        forceHttps: false,
      })
      .onConflictDoNothing();

    await db
      .insert(schema.analyticsConfig)
      .values({
        id: TEST_CONFIG_ID,
        domainId: TEST_DOMAIN_ID,
        trackingUuid: TEST_UUID,
        enabled: true,
        rawRetentionDays: 90,
        aggregateRetentionDays: 365,
        trackScrollDepth: true,
        trackSessionDuration: true,
        trackOutboundLinks: true,
        captureUtmParams: true,
        allowedOrigins: [],
        ignoredPaths: [],
      })
      .onConflictDoNothing();

    await waitForConfigCache(TEST_UUID);
  });

  afterAll(async () => {
    const db = getTestDb();

    try {
      await db
        .delete(schema.analyticsConfig)
        .where(eq(schema.analyticsConfig.id, TEST_CONFIG_ID));
      await db.delete(schema.domains).where(eq(schema.domains.id, TEST_DOMAIN_ID));
    } catch {
      // Best-effort cleanup.
    }

    // Remove raw events so MV aggregates are no longer re-materialized for
    // this config on future runs.  The agg tables will TTL on their own.
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
  // Page-view counts
  // =========================================================================

  describe("page-view and unique-visitor counts", () => {
    it("populates analytics_agg_minute after beacon collection", async () => {
      // Send 3 pageview beacons with distinct session IDs.
      await sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-pv-${crypto.randomUUID()}`, p: "/mv-test-1" }));
      await sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-pv-${crypto.randomUUID()}`, p: "/mv-test-2" }));
      await sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-pv-${crypto.randomUUID()}`, p: "/mv-test-3" }));

      await waitForIngestion();

      const rows = await queryClickHouse(`
        SELECT
          sum(page_views) AS pv,
          sum(unique_visitors) AS uv
        FROM analytics_agg_minute
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 5 MINUTE
      `) as { pv: string; uv: string }[];

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(Number(rows[0].pv)).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // top_paths map
  // =========================================================================

  describe("top_paths map", () => {
    it("populates top_paths map with correct pathname counts", async () => {
      await sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-path-${crypto.randomUUID()}`, p: "/pricing" }));
      await sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-path-${crypto.randomUUID()}`, p: "/pricing" }));
      await sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-path-${crypto.randomUUID()}`, p: "/about" }));

      await waitForIngestion();

      const rows = await queryClickHouse(`
        SELECT sumMap(top_paths) AS top_paths
        FROM analytics_agg_minute
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 5 MINUTE
      `) as { top_paths: Record<string, number> }[];

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const paths = rows[0].top_paths;
      expect(Number(paths["/pricing"] ?? 0)).toBeGreaterThanOrEqual(2);
      expect(Number(paths["/about"] ?? 0)).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // geo_data map (timezone → country code)
  // =========================================================================

  describe("geo_data map", () => {
    it("populates geo_data map from timezone-derived country codes", async () => {
      await sendBeacon(
        TEST_UUID,
        makeBeacon({ sid: `mv-geo-${crypto.randomUUID()}`, p: "/geo-test", tz: "Europe/London" }),
      );
      await sendBeacon(
        TEST_UUID,
        makeBeacon({ sid: `mv-geo-${crypto.randomUUID()}`, p: "/geo-test", tz: "America/New_York" }),
      );

      await waitForIngestion();

      const rows = await queryClickHouse(`
        SELECT sumMap(geo_data) AS geo_data
        FROM analytics_agg_minute
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 5 MINUTE
      `) as { geo_data: Record<string, number> }[];

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const geo = rows[0].geo_data;
      expect(Number(geo["GB"] ?? 0)).toBeGreaterThanOrEqual(1);
      expect(Number(geo["US"] ?? 0)).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Bounces
  // =========================================================================

  describe("bounce tracking", () => {
    it("records bounce events in analytics_agg_minute", async () => {
      // Query baseline before sending the bounce beacon.
      const before = await queryClickHouse(`
        SELECT sum(bounces) AS bounces
        FROM analytics_agg_minute
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 5 MINUTE
      `) as { bounces: string }[];
      const bouncesBefore = Number(before[0]?.bounces ?? 0);

      await sendBeacon(
        TEST_UUID,
        makeBeacon({
          t: "session_end",
          sid: `mv-bounce-${crypto.randomUUID()}`,
          p: "/bounce-page",
          ib: 1,
          sd: 0,
          sp: 0,
        }),
      );

      await waitForIngestion();

      const after = await queryClickHouse(`
        SELECT sum(bounces) AS bounces
        FROM analytics_agg_minute
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 5 MINUTE
      `) as { bounces: string }[];
      const bouncesAfter = Number(after[0]?.bounces ?? 0);

      expect(bouncesAfter).toBeGreaterThan(bouncesBefore);
    });
  });

  // =========================================================================
  // Internal /summary endpoint reflects aggregated data
  // =========================================================================

  describe("internal summary endpoint", () => {
    it("reflects aggregated beacon data via /summary", async () => {
      // Baseline page-view count from the summary endpoint.
      const resBefore = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/summary`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );
      expect(resBefore.status).toBe(200);
      const bodyBefore = await resBefore.json() as { summary: { pageViews: number } };
      const pvBefore = bodyBefore.summary.pageViews;

      // Send 5 additional pageview beacons.
      await Promise.all(
        Array.from({ length: 5 }, () =>
          sendBeacon(TEST_UUID, makeBeacon({ sid: `mv-sum-${crypto.randomUUID()}`, p: "/summary-test" })),
        ),
      );

      await waitForIngestion();

      const resAfter = await fetch(
        `${ANALYTICS_URL}/internal/analytics/${TEST_CONFIG_ID}/summary`,
        { headers: { "X-Internal-Secret": INTERNAL_SECRET } },
      );
      expect(resAfter.status).toBe(200);
      const bodyAfter = await resAfter.json() as { summary: { pageViews: number } };
      const pvAfter = bodyAfter.summary.pageViews;

      expect(pvAfter).toBeGreaterThanOrEqual(pvBefore + 5);
    });
  });

  // =========================================================================
  // analytics_agg_hour mirrors analytics_agg_minute
  // =========================================================================

  describe("analytics_agg_hour", () => {
    it("mirrors analytics_agg_minute page_views for the same config in the last hour", async () => {
      // Both tables are populated from independent MVs reading the same source,
      // so their sums for this config should be equal.
      const minuteRows = await queryClickHouse(`
        SELECT sum(page_views) AS pv
        FROM analytics_agg_minute
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 1 HOUR
      `) as { pv: string }[];

      const hourRows = await queryClickHouse(`
        SELECT sum(page_views) AS pv
        FROM analytics_agg_hour
        WHERE analytics_config_id = '${TEST_CONFIG_ID}'
          AND bucket >= now() - INTERVAL 1 HOUR
      `) as { pv: string }[];

      const minutePv = Number(minuteRows[0]?.pv ?? 0);
      const hourPv = Number(hourRows[0]?.pv ?? 0);

      // Both MVs read from analytics_events; their totals must agree.
      expect(minutePv).toBeGreaterThan(0);
      expect(hourPv).toBe(minutePv);
    });
  });
});
