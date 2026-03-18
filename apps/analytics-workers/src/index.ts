// Analytics workers -- background jobs (funnels, anomaly detection, etc.)
// Runs separately from the HTTP server so heavy work doesn't block ingestion.

import { Worker, Queue } from "bullmq";
import { QUEUES, getQueueConfig } from "@uni-proxy-manager/queue";
import { getRedisClient, closeRedisConnection } from "@uni-proxy-manager/shared/redis";
import { closeClickHouseClient } from "./clickhouse";
import { processFunnelCompute } from "./processors/funnel-compute";
import { processAnomalyDetection } from "./processors/anomaly-detection";
import { processAggregateCleanup } from "./processors/aggregate-cleanup";
import { processDataCleanup } from "./processors/data-cleanup";

const workers: Worker[] = [];
const queues: Queue[] = [];

async function init() {
  console.log("[Analytics Workers] Starting...");
  const redis = getRedisClient();

  // Funnel computation worker.
  const funnelWorker = new Worker(
    QUEUES.ANALYTICS_FUNNEL_COMPUTE,
    processFunnelCompute,
    { connection: redis, concurrency: 2 },
  );
  workers.push(funnelWorker);

  // Anomaly detection worker.
  const anomalyWorker = new Worker(
    QUEUES.ANALYTICS_ANOMALY_DETECTION,
    processAnomalyDetection,
    { connection: redis, concurrency: 1 },
  );
  workers.push(anomalyWorker);

  // Aggregate cleanup worker.
  const cleanupWorker = new Worker(
    QUEUES.ANALYTICS_AGGREGATE_CLEANUP,
    processAggregateCleanup,
    { connection: redis, concurrency: 1 },
  );
  workers.push(cleanupWorker);

  // Data cleanup worker (handles per-config data deletion on config removal).
  const dataCleanupWorker = new Worker(
    QUEUES.ANALYTICS_DATA_CLEANUP,
    processDataCleanup,
    { connection: redis, concurrency: 1 },
  );
  workers.push(dataCleanupWorker);

  // Set up error handlers.
  for (const worker of workers) {
    worker.on("error", (err) => {
      console.error(`[Analytics Workers] ${worker.name} error:`, err);
    });
    worker.on("failed", (job, err) => {
      console.error(`[Analytics Workers] Job ${job?.id} failed:`, err.message);
    });
    worker.on("completed", (job) => {
      console.log(`[Analytics Workers] Job ${job.id} completed`);
    });
  }

  // Clean up accumulated completed/failed jobs from before removeOnComplete was applied.
  const analyticsQueues = [
    QUEUES.ANALYTICS_FUNNEL_COMPUTE,
    QUEUES.ANALYTICS_ANOMALY_DETECTION,
    QUEUES.ANALYTICS_AGGREGATE_CLEANUP,
    QUEUES.ANALYTICS_DATA_CLEANUP,
  ] as const;
  for (const queueName of analyticsQueues) {
    const q = new Queue(queueName, { connection: redis });
    await Promise.all([
      q.clean(0, 100, "completed"),
      q.clean(0, 100, "failed"),
    ]);
    await q.close();
  }
  console.log("[Analytics Workers] Cleaned up stale job history");

  // Set up recurring jobs. Track the queue instances so they are closed during shutdown.
  const funnelQueue = new Queue(QUEUES.ANALYTICS_FUNNEL_COMPUTE, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.ANALYTICS_FUNNEL_COMPUTE),
  });
  queues.push(funnelQueue);
  const anomalyQueue = new Queue(QUEUES.ANALYTICS_ANOMALY_DETECTION, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.ANALYTICS_ANOMALY_DETECTION),
  });
  queues.push(anomalyQueue);

  // Funnel computation: every 15 minutes.
  await funnelQueue.add(
    "funnel-compute-all",
    {},
    {
      ...getQueueConfig(QUEUES.ANALYTICS_FUNNEL_COMPUTE),
      repeat: { pattern: "*/15 * * * *" },
      jobId: "analytics-funnel-compute-all",
    },
  );

  // Anomaly detection: every 5 minutes.
  await anomalyQueue.add(
    "anomaly-detect",
    {},
    {
      ...getQueueConfig(QUEUES.ANALYTICS_ANOMALY_DETECTION),
      repeat: { pattern: "*/5 * * * *" },
      jobId: "analytics-anomaly-detect",
    },
  );

  // Anomaly baseline recomputation: daily at 01:00.
  await anomalyQueue.add(
    "anomaly-baseline-recompute",
    {},
    {
      ...getQueueConfig(QUEUES.ANALYTICS_ANOMALY_DETECTION),
      repeat: { pattern: "0 1 * * *" },
      jobId: "analytics-anomaly-baseline",
    },
  );

  // Aggregate cleanup: daily at 03:00 UTC.
  const cleanupQueue = new Queue(QUEUES.ANALYTICS_AGGREGATE_CLEANUP, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.ANALYTICS_AGGREGATE_CLEANUP),
  });
  queues.push(cleanupQueue);
  await cleanupQueue.add(
    "aggregate-cleanup",
    {},
    {
      ...getQueueConfig(QUEUES.ANALYTICS_AGGREGATE_CLEANUP),
      repeat: { pattern: "0 3 * * *" },
      jobId: "analytics-aggregate-cleanup",
    },
  );

  console.log("[Analytics Workers] All workers and recurring jobs initialised");
}

async function shutdown(signal: string) {
  console.log(`[Analytics Workers] Received ${signal}, shutting down gracefully...`);

  const closePromises = [
    ...workers.map((w) => w.close()),
    ...queues.map((q) => q.close()),
  ];
  await Promise.all(closePromises);

  await closeClickHouseClient();
  await closeRedisConnection();

  console.log("[Analytics Workers] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

init().catch((err) => {
  console.error("[Analytics Workers] Failed to initialise:", err);
  process.exit(1);
});
