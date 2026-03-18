/**
 * Aggregate cleanup processor.
 *
 * Deletes expired rows from ClickHouse aggregate tables to reclaim storage.
 * Minute aggregates older than 7 days and hour aggregates older than 180 days
 * are removed.
 */

import { type Job } from "bullmq";
import { getClickHouseClient } from "../clickhouse";
import type { AnalyticsAggregateCleanupJobData } from "@uni-proxy-manager/queue";

export async function processAggregateCleanup(job: Job<AnalyticsAggregateCleanupJobData>): Promise<void> {
  const client = getClickHouseClient();
  const now = new Date();

  // Delete minute aggregates older than 7 days.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

  await client.command({
    query: `ALTER TABLE analytics_agg_minute DELETE WHERE bucket < {cutoff:DateTime}`,
    query_params: { cutoff: sevenDaysAgoStr },
  });

  console.log(`[Aggregate Cleanup] Deleted minute aggregates older than ${sevenDaysAgoStr}`);

  // Delete hour aggregates older than 180 days.
  const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgoStr = oneEightyDaysAgo.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

  await client.command({
    query: `ALTER TABLE analytics_agg_hour DELETE WHERE bucket < {cutoff:DateTime}`,
    query_params: { cutoff: oneEightyDaysAgoStr },
  });

  console.log(`[Aggregate Cleanup] Deleted hour aggregates older than ${oneEightyDaysAgoStr}`);

  console.log("[Aggregate Cleanup] Cleanup complete");
}
