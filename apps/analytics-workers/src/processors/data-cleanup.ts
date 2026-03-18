/**
 * Data cleanup processor.
 *
 * Deletes all ClickHouse data for a removed analytics config.
 * Queued by the API when an analytics config is deleted, so the
 * HTTP response can return immediately and retries are handled
 * by BullMQ if ClickHouse is temporarily unavailable.
 */

import type { Job } from "bullmq";
import type { AnalyticsDataCleanupJobData } from "@uni-proxy-manager/queue";
import { getClickHouseClient } from "../clickhouse";

const TABLES = [
  "analytics_events",
  "analytics_agg_minute",
  "analytics_agg_hour",
] as const;

export async function processDataCleanup(job: Job<AnalyticsDataCleanupJobData>): Promise<void> {
  const { analyticsConfigId } = job.data;

  if (!analyticsConfigId) {
    throw new Error("Missing analyticsConfigId in job data");
  }

  const client = getClickHouseClient();

  for (const table of TABLES) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE analytics_config_id = {configId:String}`,
      query_params: { configId: analyticsConfigId },
    });
    console.log(`[Data Cleanup] Deletion queued | table=${table} | configId=${analyticsConfigId}`);
  }

  console.log(`[Data Cleanup] All tables processed for configId=${analyticsConfigId}`);
}
