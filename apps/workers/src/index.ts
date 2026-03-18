import { Worker, Queue } from "bullmq";
import { getRedisClient, closeRedisConnection } from "@uni-proxy-manager/shared/redis";
import { QUEUES, getQueueConfig } from "@uni-proxy-manager/queue";
import type { MetricsCollectionJobData, MaintenanceCleanupJobData, HaproxyLogParseJobData, ClusterSyncJobData, HaproxyWatchdogJobData } from "@uni-proxy-manager/queue";

// Import processors
import { processCertificateIssue } from "./processors/certificate-issue";
import { processCertificateRenewal } from "./processors/certificate-renewal";
import { processDnsChallenge } from "./processors/dns-challenge";
import { processHaproxyReload } from "./processors/haproxy-reload";
import { processHealthCheck } from "./processors/health-check";
import { processMetricsCollection } from "./processors/metrics-collection";
import { processMaintenanceCleanup } from "./processors/maintenance-cleanup";
import { processHaproxyLogParse } from "./processors/haproxy-log-parser";
import { processSharedBackendSync } from "./processors/shared-backend-sync";
import { processClusterSync, pollNodeHealth } from "./processors/cluster-sync";
import { processHaproxyWatchdog } from "./processors/haproxy-watchdog";

const workers: Worker[] = [];

async function startWorkers() {
  console.log("[Workers] Starting background workers...");

  const redis = getRedisClient();

  // Certificate Issue Worker
  const certIssueWorker = new Worker(
    QUEUES.CERTIFICATE_ISSUE,
    processCertificateIssue,
    {
      connection: redis,
      concurrency: 2,
    }
  );
  workers.push(certIssueWorker);
  console.log(`[Workers] Started ${QUEUES.CERTIFICATE_ISSUE} worker`);

  // Certificate Renewal Worker
  const certRenewalWorker = new Worker(
    QUEUES.CERTIFICATE_RENEWAL,
    processCertificateRenewal,
    {
      connection: redis,
      concurrency: 2,
    }
  );
  workers.push(certRenewalWorker);
  console.log(`[Workers] Started ${QUEUES.CERTIFICATE_RENEWAL} worker`);

  // DNS Challenge Worker
  const dnsWorker = new Worker(
    QUEUES.DNS_CHALLENGE,
    processDnsChallenge,
    {
      connection: redis,
      concurrency: 5,
    }
  );
  workers.push(dnsWorker);
  console.log(`[Workers] Started ${QUEUES.DNS_CHALLENGE} worker`);

  // HAProxy Reload Worker
  const haproxyWorker = new Worker(
    QUEUES.HAPROXY_RELOAD,
    processHaproxyReload,
    {
      connection: redis,
      concurrency: 1, // Only one reload at a time
    }
  );
  workers.push(haproxyWorker);
  console.log(`[Workers] Started ${QUEUES.HAPROXY_RELOAD} worker`);

  // Health Check Worker
  const healthWorker = new Worker(
    QUEUES.HEALTH_CHECK,
    processHealthCheck,
    {
      connection: redis,
      concurrency: 10,
    }
  );
  workers.push(healthWorker);
  console.log(`[Workers] Started ${QUEUES.HEALTH_CHECK} worker`);

  // Metrics Collection Worker
  const metricsWorker = new Worker(
    QUEUES.METRICS_COLLECTION,
    processMetricsCollection,
    {
      connection: redis,
      concurrency: 1, // Only one metrics collection at a time
    }
  );
  workers.push(metricsWorker);
  console.log(`[Workers] Started ${QUEUES.METRICS_COLLECTION} worker`);

  // Maintenance Cleanup Worker
  const maintenanceWorker = new Worker(
    QUEUES.MAINTENANCE_CLEANUP,
    processMaintenanceCleanup,
    {
      connection: redis,
      concurrency: 1, // Only one cleanup at a time
    }
  );
  workers.push(maintenanceWorker);
  console.log(`[Workers] Started ${QUEUES.MAINTENANCE_CLEANUP} worker`);

  // HAProxy Log Parser Worker
  const logParserWorker = new Worker(
    QUEUES.HAPROXY_LOG_PARSE,
    processHaproxyLogParse,
    {
      connection: redis,
      concurrency: 1, // Only one log parse at a time
    }
  );
  workers.push(logParserWorker);
  console.log(`[Workers] Started ${QUEUES.HAPROXY_LOG_PARSE} worker`);

  // Shared Backend Sync Worker
  const sharedBackendSyncWorker = new Worker(
    QUEUES.SHARED_BACKEND_SYNC,
    processSharedBackendSync,
    {
      connection: redis,
      concurrency: 3,
    }
  );
  workers.push(sharedBackendSyncWorker);
  console.log(`[Workers] Started ${QUEUES.SHARED_BACKEND_SYNC} worker`);

  // Cluster Sync Worker
  const clusterSyncWorker = new Worker(
    QUEUES.CLUSTER_SYNC,
    processClusterSync,
    {
      connection: redis,
      concurrency: 3,
    }
  );
  workers.push(clusterSyncWorker);
  console.log(`[Workers] Started ${QUEUES.CLUSTER_SYNC} worker`);

  // HAProxy Watchdog Worker
  const haproxyWatchdogWorker = new Worker(
    QUEUES.HAPROXY_WATCHDOG,
    processHaproxyWatchdog,
    {
      connection: redis,
      concurrency: 1,
    }
  );
  workers.push(haproxyWatchdogWorker);
  console.log(`[Workers] Started ${QUEUES.HAPROXY_WATCHDOG} worker`);

  // Setup error handlers
  for (const worker of workers) {
    worker.on("error", (err) => {
      console.error(`[Workers] Worker ${worker.name} error:`, err);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Workers] Job ${job?.id} in ${worker.name} failed:`, err.message);
    });

    worker.on("completed", (job) => {
      console.log(`[Workers] Job ${job.id} in ${worker.name} completed`);
    });
  }

  // Clean up accumulated completed/failed jobs from before removeOnComplete was applied.
  // These queues run frequently (every minute or 30s) and can accumulate thousands of
  // stale job records in Redis if they were running without cleanup settings.
  const highFrequencyQueues = [
    QUEUES.METRICS_COLLECTION,
    QUEUES.HAPROXY_LOG_PARSE,
    QUEUES.CLUSTER_SYNC,
    QUEUES.HAPROXY_WATCHDOG,
  ] as const;
  for (const queueName of highFrequencyQueues) {
    const q = new Queue(queueName, { connection: redis });
    await Promise.all([
      q.clean(0, 100, "completed"),
      q.clean(0, 100, "failed"),
    ]);
    await q.close();
  }
  console.log("[Workers] Cleaned up stale job history from high-frequency queues");

  // Setup recurring metrics collection job (every minute)
  const metricsQueue = new Queue<MetricsCollectionJobData>(QUEUES.METRICS_COLLECTION, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.METRICS_COLLECTION),
  });

  await metricsQueue.add(
    "metrics-collection",
    { timestamp: new Date().toISOString() },
    {
      ...getQueueConfig(QUEUES.METRICS_COLLECTION),
      repeat: {
        pattern: "* * * * *", // Every minute
      },
      jobId: "metrics-collection-recurring",
    }
  );

  console.log("[Workers] Scheduled metrics collection (every minute)");

  // Setup recurring HAProxy log parsing job (every minute)
  const logParserQueue = new Queue<HaproxyLogParseJobData>(QUEUES.HAPROXY_LOG_PARSE, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.HAPROXY_LOG_PARSE),
  });

  await logParserQueue.add(
    "haproxy-log-parse",
    { timestamp: new Date().toISOString() },
    {
      ...getQueueConfig(QUEUES.HAPROXY_LOG_PARSE),
      repeat: {
        pattern: "* * * * *", // Every minute
      },
      jobId: "haproxy-log-parse-recurring",
    }
  );

  console.log("[Workers] Scheduled HAProxy log parsing (every minute)");

  // Setup recurring maintenance cleanup job (daily at 3 AM)
  const maintenanceQueue = new Queue<MaintenanceCleanupJobData>(QUEUES.MAINTENANCE_CLEANUP, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.MAINTENANCE_CLEANUP),
  });

  await maintenanceQueue.add(
    "daily-cleanup",
    { type: "all" },
    {
      ...getQueueConfig(QUEUES.MAINTENANCE_CLEANUP),
      repeat: {
        pattern: "0 3 * * *", // Daily at 3 AM
      },
      jobId: "daily-maintenance-cleanup",
    }
  );

  console.log("[Workers] Scheduled daily maintenance cleanup (3 AM)");

  // Setup recurring cluster health-poll job (every 30 seconds via cluster-sync queue)
  const clusterHealthQueue = new Queue<ClusterSyncJobData>(QUEUES.CLUSTER_SYNC, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.CLUSTER_SYNC),
  });

  // Health poll: enqueue a no-op sync job every 30s just to update node status.
  // The processor calls /health on each node before doing any reload.
  await clusterHealthQueue.add(
    "cluster-health-poll",
    { reason: "health-poll", triggeredBy: "manual" },
    {
      ...getQueueConfig(QUEUES.CLUSTER_SYNC),
      repeat: {
        every: 30_000, // Every 30 seconds
      },
      jobId: "cluster-health-poll-recurring",
    }
  );

  console.log("[Workers] Scheduled cluster health polling (every 30 seconds)");

  // Setup recurring HAProxy watchdog job (every 30 seconds)
  const watchdogQueue = new Queue<HaproxyWatchdogJobData>(QUEUES.HAPROXY_WATCHDOG, {
    connection: redis,
    defaultJobOptions: getQueueConfig(QUEUES.HAPROXY_WATCHDOG),
  });

  await watchdogQueue.add(
    "haproxy-watchdog",
    { timestamp: new Date().toISOString() },
    {
      ...getQueueConfig(QUEUES.HAPROXY_WATCHDOG),
      repeat: {
        every: 30_000,
      },
      jobId: "haproxy-watchdog-recurring",
    }
  );

  console.log("[Workers] Scheduled HAProxy watchdog (every 30 seconds)");
  console.log("[Workers] All workers started");
}

async function shutdown(signal: string) {
  console.log(`[Workers] Received ${signal}, shutting down gracefully...`);

  // Close all workers
  const closePromises = workers.map(async (worker) => {
    try {
      await worker.close();
      console.log(`[Workers] Worker ${worker.name} closed`);
    } catch (err) {
      console.error(`[Workers] Error closing worker ${worker.name}:`, err);
    }
  });

  await Promise.all(closePromises);

  // Close Redis connection
  await closeRedisConnection();

  console.log("[Workers] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start workers
startWorkers().catch((err) => {
  console.error("[Workers] Failed to start workers:", err);
  process.exit(1);
});

// Keep process alive
console.log("[Workers] Workers running. Press Ctrl+C to stop.");
