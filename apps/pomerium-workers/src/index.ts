import { Worker, Queue } from "bullmq";
import {
  getRedisClient,
  closeRedisConnection,
} from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type {
  PomeriumConfigJobData,
  PomeriumRestartJobData,
} from "@uni-proxy-manager/queue";
import { processPomeriumConfig } from "./processors/pomerium-config";
import { processPomeriumRestart } from "./processors/pomerium-restart";

const workers: Worker[] = [];

async function startWorkers() {
  console.log("[Pomerium Workers] Starting pomerium extension workers...");

  if (process.env.UNI_PROXY_MANAGER_POMERIUM_ENABLED !== "true") {
    console.log(
      "[Pomerium Workers] Pomerium extension is not enabled. Exiting."
    );
    process.exit(0);
  }

  const pomeriumInternalUrl = process.env.POMERIUM_INTERNAL_URL;
  if (!pomeriumInternalUrl) {
    console.warn(
      "[Pomerium Workers] POMERIUM_INTERNAL_URL not set. Config sync may not work properly."
    );
  }

  const redis = getRedisClient();

  // Pomerium Config Worker
  const pomeriumConfigWorker = new Worker(
    QUEUES.POMERIUM_CONFIG,
    processPomeriumConfig,
    {
      connection: redis,
      concurrency: 1, // Only one config update at a time
    }
  );
  workers.push(pomeriumConfigWorker);
  console.log(`[Pomerium Workers] Started ${QUEUES.POMERIUM_CONFIG} worker`);

  // Pomerium Restart Worker
  const pomeriumRestartWorker = new Worker(
    QUEUES.POMERIUM_RESTART,
    processPomeriumRestart,
    {
      connection: redis,
      concurrency: 1,
    }
  );
  workers.push(pomeriumRestartWorker);
  console.log(`[Pomerium Workers] Started ${QUEUES.POMERIUM_RESTART} worker`);

  // Setup error handlers
  for (const worker of workers) {
    worker.on("error", (err) => {
      console.error(`[Pomerium Workers] Worker ${worker.name} error:`, err);
    });

    worker.on("failed", (job, err) => {
      console.error(
        `[Pomerium Workers] Job ${job?.id} in ${worker.name} failed:`,
        err.message
      );
    });

    worker.on("completed", (job) => {
      console.log(
        `[Pomerium Workers] Job ${job.id} in ${worker.name} completed`
      );
    });
  }

  // Queue initial config generation on startup
  const configQueue = new Queue<PomeriumConfigJobData>(QUEUES.POMERIUM_CONFIG, {
    connection: redis,
  });

  await configQueue.add(
    "pomerium-config-startup",
    { reason: "Worker startup", triggeredBy: "startup" },
    { jobId: `pomerium-config-startup-${Date.now()}` }
  );

  console.log("[Pomerium Workers] Queued initial config generation");
  console.log("[Pomerium Workers] All workers started");
}

async function shutdown(signal: string) {
  console.log(
    `[Pomerium Workers] Received ${signal}, shutting down gracefully...`
  );

  // Close all workers
  const closePromises = workers.map(async (worker) => {
    try {
      await worker.close();
      console.log(`[Pomerium Workers] Worker ${worker.name} closed`);
    } catch (err) {
      console.error(
        `[Pomerium Workers] Error closing worker ${worker.name}:`,
        err
      );
    }
  });

  await Promise.all(closePromises);

  // Close Redis connection
  await closeRedisConnection();

  console.log("[Pomerium Workers] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start workers
startWorkers().catch((err) => {
  console.error("[Pomerium Workers] Failed to start workers:", err);
  process.exit(1);
});

// Keep process alive
console.log("[Pomerium Workers] Workers running. Press Ctrl+C to stop.");
