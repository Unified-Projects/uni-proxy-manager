import { Worker, Queue } from "bullmq";
import { getRedisClient, closeRedisConnection } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { SiteAnalyticsJobData, SiteKeepAliveJobData } from "@uni-proxy-manager/queue";
import {
  validateOpenRuntimesConfiguration,
  isOpenRuntimesConfigured,
  getOpenRuntimesClient,
} from "@uni-proxy-manager/shared/openruntimes";

// Import processors
import { processSiteBuild } from "./processors/site-build";
import { processSiteDeploy } from "./processors/site-deploy";
import { processSiteAnalytics } from "./processors/site-analytics";
import { processGitHubSync } from "./processors/github-sync";
import { processPreviewGenerate } from "./processors/preview-generate";
import { processHaproxySiteConfig } from "./processors/haproxy-site-config";
import { processSiteKeepAlive } from "./processors/site-keepalive";

const workers: Worker[] = [];

async function startWorkers() {
  console.log("[Sites Workers] Starting sites extension workers...");

  if (process.env.UNI_PROXY_MANAGER_SITES_ENABLED !== "true") {
    console.log("[Sites Workers] Sites extension is not enabled. Exiting.");
    process.exit(0);
  }

  const configValidation = validateOpenRuntimesConfiguration();
  if (!configValidation.valid) {
    console.error("[Sites Workers] Configuration errors:");
    configValidation.errors.forEach((err) => console.error(`  - ${err}`));
    console.error("[Sites Workers] Cannot start without valid configuration.");
    process.exit(1);
  }

  if (isOpenRuntimesConfigured()) {
    try {
      const client = getOpenRuntimesClient();
      const health = await client.healthCheck();
      if (health.healthy) {
        console.log(
          `[Sites Workers] OpenRuntimes executor connected (version: ${health.version || "unknown"})`
        );
      } else {
        console.warn(
          "[Sites Workers] OpenRuntimes executor health check failed:",
          health.error
        );
        console.warn("[Sites Workers] Continuing - executor may become available later");
      }
    } catch (error) {
      console.warn("[Sites Workers] Could not connect to OpenRuntimes executor:", error);
      console.warn("[Sites Workers] Continuing - executor may become available later");
    }
  }

  const redis = getRedisClient();

  // Site Build Worker
  const siteBuildWorker = new Worker(
    QUEUES.SITE_BUILD,
    processSiteBuild,
    {
      connection: redis,
      concurrency: 2, // Allow 2 concurrent builds
    }
  );
  workers.push(siteBuildWorker);
  console.log(`[Sites Workers] Started ${QUEUES.SITE_BUILD} worker`);

  // Site Deploy Worker
  const siteDeployWorker = new Worker(
    QUEUES.SITE_DEPLOY,
    processSiteDeploy,
    {
      connection: redis,
      concurrency: 2,
    }
  );
  workers.push(siteDeployWorker);
  console.log(`[Sites Workers] Started ${QUEUES.SITE_DEPLOY} worker`);

  // Site Analytics Worker
  const siteAnalyticsWorker = new Worker(
    QUEUES.SITE_ANALYTICS,
    processSiteAnalytics,
    {
      connection: redis,
      concurrency: 1,
    }
  );
  workers.push(siteAnalyticsWorker);
  console.log(`[Sites Workers] Started ${QUEUES.SITE_ANALYTICS} worker`);

  // GitHub Sync Worker
  const githubSyncWorker = new Worker(
    QUEUES.GITHUB_SYNC,
    processGitHubSync,
    {
      connection: redis,
      concurrency: 3,
    }
  );
  workers.push(githubSyncWorker);
  console.log(`[Sites Workers] Started ${QUEUES.GITHUB_SYNC} worker`);

  // Preview Generate Worker
  const previewGenerateWorker = new Worker(
    QUEUES.PREVIEW_GENERATE,
    processPreviewGenerate,
    {
      connection: redis,
      concurrency: 2,
    }
  );
  workers.push(previewGenerateWorker);
  console.log(`[Sites Workers] Started ${QUEUES.PREVIEW_GENERATE} worker`);

  // HAProxy Site Config Worker
  const haproxySiteConfigWorker = new Worker(
    QUEUES.HAPROXY_SITE_CONFIG,
    processHaproxySiteConfig,
    {
      connection: redis,
      concurrency: 1, // Only one config update at a time
    }
  );
  workers.push(haproxySiteConfigWorker);
  console.log(`[Sites Workers] Started ${QUEUES.HAPROXY_SITE_CONFIG} worker`);

  // Site Keep-Alive Worker
  const siteKeepAliveWorker = new Worker(
    QUEUES.SITE_KEEPALIVE,
    processSiteKeepAlive,
    {
      connection: redis,
      concurrency: 5, // Allow multiple pings in parallel
    }
  );
  workers.push(siteKeepAliveWorker);
  console.log(`[Sites Workers] Started ${QUEUES.SITE_KEEPALIVE} worker`);

  // Setup error handlers
  for (const worker of workers) {
    worker.on("error", (err) => {
      console.error(`[Sites Workers] Worker ${worker.name} error:`, err);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Sites Workers] Job ${job?.id} in ${worker.name} failed:`, err.message);
    });

    worker.on("completed", (job) => {
      console.log(`[Sites Workers] Job ${job.id} in ${worker.name} completed`);
    });
  }

  // Setup recurring analytics collection job (every minute)
  const analyticsQueue = new Queue<SiteAnalyticsJobData>(QUEUES.SITE_ANALYTICS, {
    connection: redis,
  });

  await analyticsQueue.add(
    "site-analytics-collection",
    { siteId: "*", timestamp: new Date().toISOString() },
    {
      repeat: {
        pattern: "* * * * *", // Every minute
      },
      jobId: "site-analytics-recurring",
    }
  );

  console.log("[Sites Workers] Scheduled site analytics collection (every minute)");

  // Setup recurring keep-alive job (every 5 minutes)
  const keepAliveQueue = new Queue<SiteKeepAliveJobData>(QUEUES.SITE_KEEPALIVE, {
    connection: redis,
  });

  await keepAliveQueue.add(
    "site-keepalive-scheduler",
    { siteId: "*" },
    {
      repeat: {
        pattern: "*/5 * * * *", // Every 5 minutes
      },
      jobId: "site-keepalive-scheduler",
    }
  );

  // Trigger immediate keep-alive ping on startup
  await keepAliveQueue.add(
    "site-keepalive-startup",
    { siteId: "*" },
    { jobId: `site-keepalive-startup-${Date.now()}` }
  );

  console.log("[Sites Workers] Scheduled site keep-alive pings (every 5 minutes, plus immediate startup ping)");
  console.log("[Sites Workers] All workers started");
}

async function shutdown(signal: string) {
  console.log(`[Sites Workers] Received ${signal}, shutting down gracefully...`);

  // Close all workers
  const closePromises = workers.map(async (worker) => {
    try {
      await worker.close();
      console.log(`[Sites Workers] Worker ${worker.name} closed`);
    } catch (err) {
      console.error(`[Sites Workers] Error closing worker ${worker.name}:`, err);
    }
  });

  await Promise.all(closePromises);

  // Close Redis connection
  await closeRedisConnection();

  console.log("[Sites Workers] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start workers
startWorkers().catch((err) => {
  console.error("[Sites Workers] Failed to start workers:", err);
  process.exit(1);
});

// Keep process alive
console.log("[Sites Workers] Workers running. Press Ctrl+C to stop.");
