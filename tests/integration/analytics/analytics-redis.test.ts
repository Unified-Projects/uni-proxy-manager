/**
 * Analytics Redis Side-Effects Integration Tests
 *
 * Verifies that beacon ingestion correctly updates Redis data structures
 * for active visitor tracking and live event streaming.
 *
 * Requires: test-postgres, test-redis, test-clickhouse, test-analytics, test-website
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import Redis from "ioredis";
import { getTestDb, closeTestDb } from "../setup/test-db";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ANALYTICS_URL = process.env.TEST_ANALYTICS_URL || "http://test-analytics:3003";
const REDIS_URL = process.env.UNI_PROXY_MANAGER_REDIS_URL || "redis://test-redis:6379";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DOMAIN_ID = `test-redis-domain-${Date.now()}`;
const TEST_CONFIG_ID = `test-redis-config-${Date.now()}`;
const TEST_UUID = crypto.randomUUID();
const TEST_HOSTNAME = "test-website";

let redis: Redis;

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

/** Pause for fire-and-forget ingestion. */
async function waitForIngestion(ms = 2000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

describe("Analytics Redis side-effects", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const db = getTestDb();
    redis = new Redis(REDIS_URL);

    // Ensure service is healthy.
    const healthRes = await fetch(`${ANALYTICS_URL}/health`);
    expect(healthRes.status).toBe(200);

    // Create test domain + analytics config.
    await db.insert(schema.domains).values({
      id: TEST_DOMAIN_ID,
      hostname: TEST_HOSTNAME,
      displayName: "Redis Test Website",
      status: "active",
      sslEnabled: false,
      forceHttps: false,
    }).onConflictDoNothing();

    await db.insert(schema.analyticsConfig).values({
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
    }).onConflictDoNothing();

    await waitForConfigCache(TEST_UUID);
  });

  afterAll(async () => {
    const db = getTestDb();

    // Clean up Redis keys for this config.
    try {
      const keys = await redis.keys(`analytics:*:${TEST_CONFIG_ID}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Best-effort cleanup.
    }

    // Clean up PostgreSQL.
    try {
      await db.delete(schema.analyticsConfig).where(eq(schema.analyticsConfig.id, TEST_CONFIG_ID));
      await db.delete(schema.domains).where(eq(schema.domains.id, TEST_DOMAIN_ID));
    } catch {
      // Best-effort cleanup.
    }

    await redis.quit();
    await closeTestDb();
  });

  // =========================================================================
  // Active Visitors Sorted Set
  // =========================================================================

  describe("Active visitors tracking", () => {
    it("should add session to active visitors sorted set after beacon", async () => {
      const sessionId = `redis-active-${crypto.randomUUID()}`;
      const activeKey = `analytics:active:${TEST_CONFIG_ID}`;

      const res = await sendBeacon(TEST_UUID, makeBeacon({
        sid: sessionId,
        p: "/redis-test",
      }));
      expect(res.status).toBe(202);

      await waitForIngestion();

      // Check the sorted set contains this session.
      const members = await redis.zrangebyscore(
        activeKey,
        Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
        "+inf",
      );

      expect(members).toContain(sessionId);
    });

    it("should update session score on subsequent beacons", async () => {
      const sessionId = `redis-update-${crypto.randomUUID()}`;
      const activeKey = `analytics:active:${TEST_CONFIG_ID}`;

      // First beacon.
      await sendBeacon(TEST_UUID, makeBeacon({ sid: sessionId, p: "/page-1" }));
      await waitForIngestion();

      const scoreBefore = await redis.zscore(activeKey, sessionId);
      expect(scoreBefore).not.toBeNull();

      // Wait a moment and send another.
      await new Promise((r) => setTimeout(r, 1100));
      await sendBeacon(TEST_UUID, makeBeacon({ sid: sessionId, p: "/page-2" }));
      await waitForIngestion();

      const scoreAfter = await redis.zscore(activeKey, sessionId);
      expect(scoreAfter).not.toBeNull();

      // Score should have increased (it's a unix timestamp).
      expect(Number(scoreAfter)).toBeGreaterThanOrEqual(Number(scoreBefore));
    });
  });

  // =========================================================================
  // Active Pages Sorted Set
  // =========================================================================

  describe("Active pages tracking", () => {
    it("should add session:pathname to active pages sorted set", async () => {
      const sessionId = `redis-pages-${crypto.randomUUID()}`;
      const activePagesKey = `analytics:active_pages:${TEST_CONFIG_ID}`;

      await sendBeacon(TEST_UUID, makeBeacon({
        sid: sessionId,
        p: "/redis-pages-test",
      }));

      await waitForIngestion();

      const members = await redis.zrangebyscore(
        activePagesKey,
        Math.floor(Date.now() / 1000) - 300,
        "+inf",
      );

      // The entry format is "sessionId:/pathname"
      const expected = `${sessionId}:/redis-pages-test`;
      expect(members).toContain(expected);
    });
  });

  // =========================================================================
  // Live Channel Pub/Sub
  // =========================================================================

  describe("Live channel pub/sub", () => {
    it("should publish event to the live channel when a beacon is received", async () => {
      const sessionId = `redis-live-${crypto.randomUUID()}`;
      const liveChannel = `analytics:live:${TEST_CONFIG_ID}`;

      // Set up a subscriber to listen for the event.
      const subscriber = new Redis(REDIS_URL);
      const receivedMessages: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscriber.unsubscribe();
          subscriber.quit();
          reject(new Error("Timed out waiting for live channel message"));
        }, 15_000);

        subscriber.subscribe(liveChannel, (err) => {
          if (err) {
            clearTimeout(timeout);
            reject(err);
            return;
          }

          // Now send the beacon (after subscription is established).
          sendBeacon(TEST_UUID, makeBeacon({
            sid: sessionId,
            p: "/live-test-page",
          })).catch(() => {});
        });

        subscriber.on("message", (_channel: string, message: string) => {
          receivedMessages.push(message);
          clearTimeout(timeout);
          subscriber.unsubscribe();
          subscriber.quit();
          resolve();
        });
      });

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

      const parsed = JSON.parse(receivedMessages[0]) as Record<string, unknown>;
      expect(parsed.eventType).toBe("pageview");
      expect(parsed.pathname).toBe("/live-test-page");
      expect(parsed.timestamp).toBeDefined();
    });
  });

  // =========================================================================
  // Stale Entry Cleanup
  // =========================================================================

  describe("Stale entry cleanup", () => {
    it("should remove entries older than the TTL via zremrangebyscore", async () => {
      const activeKey = `analytics:active:${TEST_CONFIG_ID}`;

      // Manually insert an entry with a very old score (300+ seconds ago).
      const staleSession = `stale-session-${crypto.randomUUID()}`;
      const staleScore = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      await redis.zadd(activeKey, staleScore.toString(), staleSession);

      // Send a new beacon to trigger cleanup.
      await sendBeacon(TEST_UUID, makeBeacon({
        sid: `trigger-cleanup-${crypto.randomUUID()}`,
        p: "/cleanup-trigger",
      }));
      await waitForIngestion();

      // The stale entry should have been cleaned up.
      const score = await redis.zscore(activeKey, staleSession);
      expect(score).toBeNull();
    });
  });
});
