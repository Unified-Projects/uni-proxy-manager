/**
 * Anomaly detection processor.
 *
 * Compares recent traffic against cached baselines and flags significant
 * deviations. Baselines are recomputed daily.
 */

import { type Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { analyticsConfig } from "@uni-proxy-manager/database";
import { eq } from "drizzle-orm";
import { getClickHouseClient } from "../clickhouse";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import type { AnalyticsAnomalyDetectionJobData } from "@uni-proxy-manager/queue";

const Z_SCORE_THRESHOLD = 2;

export async function processAnomalyDetection(job: Job<AnalyticsAnomalyDetectionJobData>): Promise<void> {
  const isBaselineRecompute = job.name === "anomaly-baseline-recompute";

  if (isBaselineRecompute) {
    await recomputeBaselines();
  } else {
    await detectAnomalies(job.data.analyticsConfigId);
  }
}

/**
 * Detect anomalies by comparing the last hour's traffic against cached
 * hourly baselines for the matching day-of-week and hour slot.
 */
async function detectAnomalies(specificConfigId?: string): Promise<void> {
  const configs = specificConfigId
    ? await db.query.analyticsConfig.findMany({ where: eq(analyticsConfig.id, specificConfigId) })
    : await db.query.analyticsConfig.findMany({ where: eq(analyticsConfig.enabled, true) });

  const redis = getRedisClient();
  const client = getClickHouseClient();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayOfWeek = now.getUTCDay();
  const hourOfDay = now.getUTCHours();

  for (const config of configs) {
    try {
      // Read baseline from Redis.
      const baselineKey = `analytics:baseline:${config.id}`;
      const meanKey = `${dayOfWeek}:${hourOfDay}:mean`;
      const stddevKey = `${dayOfWeek}:${hourOfDay}:stddev`;

      const [meanStr, stddevStr] = await Promise.all([
        redis.hget(baselineKey, meanKey),
        redis.hget(baselineKey, stddevKey),
      ]);

      if (!meanStr || !stddevStr) continue;

      const mean = parseFloat(meanStr);
      const stddev = parseFloat(stddevStr);
      if (stddev === 0) continue;

      // Query the last hour's traffic from hourly aggregates.
      const startStr = oneHourAgo.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
      const endStr = now.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

      const result = await client.query({
        query: `
          SELECT sumMerge(page_views) AS total_pv
          FROM analytics_agg_hour
          WHERE analytics_config_id = {configId:String}
            AND bucket >= {start:DateTime}
            AND bucket <= {end:DateTime}
        `,
        query_params: { configId: config.id, start: startStr, end: endStr },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ total_pv: number }[]>();
      const actual = Number(rows[0]?.total_pv) || 0;

      // Calculate z-score.
      const zScore = (actual - mean) / stddev;

      if (Math.abs(zScore) > Z_SCORE_THRESHOLD) {
        const anomalyType = zScore > 0 ? "traffic_spike" : "traffic_drop";
        const anomalyData = JSON.stringify({
          type: anomalyType,
          actual,
          expected: mean,
          zScore: Math.round(zScore * 100) / 100,
          timestamp: now.toISOString(),
        });

        // Publish anomaly event.
        await redis.publish(`analytics:anomaly:${config.id}`, anomalyData);

        // Store in sorted set for dashboard display.
        const anomaliesKey = `analytics:anomalies:${config.id}`;
        await redis.zadd(anomaliesKey, now.getTime(), anomalyData);
        await redis.expire(anomaliesKey, 86400); // 24h TTL.
      }
    } catch (err) {
      console.error(`[Anomaly Detection] Error for config ${config.id}:`, err);
    }
  }
}

/**
 * Recompute traffic baselines from the last 30 days of hourly aggregates,
 * grouped by day-of-week and hour. Computes real mean and stddev per slot.
 */
async function recomputeBaselines(): Promise<void> {
  const configs = await db.query.analyticsConfig.findMany({
    where: eq(analyticsConfig.enabled, true),
  });

  const client = getClickHouseClient();
  const redis = getRedisClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startStr = thirtyDaysAgo.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
  const endStr = now.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

  for (const config of configs) {
    try {
      const result = await client.query({
        query: `
          SELECT
            toDayOfWeek(bucket) AS day_of_week,
            toHour(bucket) AS hour_of_day,
            sumMerge(page_views) AS hourly_pv
          FROM analytics_agg_hour
          WHERE analytics_config_id = {configId:String}
            AND bucket >= {start:DateTime}
            AND bucket <= {end:DateTime}
          GROUP BY day_of_week, hour_of_day, toDate(bucket)
          ORDER BY day_of_week, hour_of_day
        `,
        query_params: { configId: config.id, start: startStr, end: endStr },
        format: "JSONEachRow",
      });

      const rows = await result.json<{
        day_of_week: number;
        hour_of_day: number;
        hourly_pv: number;
      }[]>();

      // Accumulate observations per (dow, hour) slot.
      const slots = new Map<string, number[]>();

      for (const row of rows) {
        // ClickHouse toDayOfWeek returns 1=Mon..7=Sun; convert to JS 0=Sun..6=Sat.
        const jsDow = row.day_of_week === 7 ? 0 : row.day_of_week;
        const key = `${jsDow}:${row.hour_of_day}`;
        let arr = slots.get(key);
        if (!arr) {
          arr = [];
          slots.set(key, arr);
        }
        arr.push(Number(row.hourly_pv));
      }

      const baselineKey = `analytics:baseline:${config.id}`;
      const pipeline = redis.pipeline();

      for (const [key, observations] of slots) {
        const n = observations.length;
        const sum = observations.reduce((a, b) => a + b, 0);
        const mean = sum / n;

        let stddev: number;
        if (n < 3) {
          // Not enough data points for a reliable stddev; use a fallback.
          stddev = Math.max(mean * 0.5, 1);
        } else {
          const variance = observations.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
          stddev = Math.sqrt(variance);
          // Guard against near-zero stddev even with enough data.
          if (stddev < 1) stddev = 1;
        }

        pipeline.hset(baselineKey, `${key}:mean`, String(mean));
        pipeline.hset(baselineKey, `${key}:stddev`, String(stddev));
      }

      // Set 48h TTL.
      pipeline.expire(baselineKey, 172800);
      await pipeline.exec();

      console.log(`[Anomaly Detection] Baseline recomputed for config ${config.id}`);
    } catch (err) {
      console.error(`[Anomaly Detection] Baseline error for config ${config.id}:`, err);
    }
  }
}
