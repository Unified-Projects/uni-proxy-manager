import type { Job } from "bullmq";
import { Queue } from "bullmq";
import http from "http";
import { checkHaproxyHealth, isHaproxyRunning } from "@uni-proxy-manager/shared/haproxy";
import { db } from "@uni-proxy-manager/database";
import { systemConfig, CONFIG_KEYS, DEFAULT_HAPROXY_WATCHDOG_CONFIG } from "@uni-proxy-manager/database/schema";
import type { HaproxyWatchdogConfig } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { HaproxyWatchdogJobData, HaproxyWatchdogResult, HaproxyReloadJobData } from "@uni-proxy-manager/queue";

const HAPROXY_CONTAINER_NAME = process.env.HAPROXY_CONTAINER_NAME || "uni-proxy-manager-haproxy";
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

function dockerRequest(options: http.RequestOptions): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });

    req.on("error", reject);

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Docker API request timed out"));
    });

    req.end();
  });
}

async function inspectContainer(): Promise<{ status: string; running: boolean } | null> {
  try {
    const result = await dockerRequest({
      socketPath: DOCKER_SOCKET_PATH,
      path: `/containers/${HAPROXY_CONTAINER_NAME}/json`,
      method: "GET",
    });

    if (result.statusCode !== 200) {
      console.warn(`[HAProxy Watchdog] Container inspect returned ${result.statusCode}`);
      return null;
    }

    const data = JSON.parse(result.body);
    return {
      status: data?.State?.Status ?? "unknown",
      running: data?.State?.Running ?? false,
    };
  } catch (err) {
    console.warn("[HAProxy Watchdog] Failed to inspect container:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function restartContainer(): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await dockerRequest({
      socketPath: DOCKER_SOCKET_PATH,
      path: `/containers/${HAPROXY_CONTAINER_NAME}/restart?t=10`,
      method: "POST",
    });

    if (result.statusCode === 204 || result.statusCode === 200) {
      return { success: true };
    }

    return { success: false, error: `Docker API returned ${result.statusCode}: ${result.body}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function pollUntilHealthy(maxAttempts = 10, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const running = await isHaproxyRunning();
    if (running) {
      return true;
    }
  }
  return false;
}

export async function processHaproxyWatchdog(
  job: Job<HaproxyWatchdogJobData>
): Promise<HaproxyWatchdogResult> {
  // Read config from DB
  let watchdogConfig: HaproxyWatchdogConfig = DEFAULT_HAPROXY_WATCHDOG_CONFIG;
  try {
    const row = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.key, CONFIG_KEYS.HAPROXY_WATCHDOG),
    });
    if (row) {
      watchdogConfig = row.value as HaproxyWatchdogConfig;
    }
  } catch (err) {
    console.warn("[HAProxy Watchdog] Could not read config from DB, using default:", err instanceof Error ? err.message : err);
  }

  if (!watchdogConfig.enabled) {
    console.log("[HAProxy Watchdog] Watchdog disabled in config, skipping");
    return {
      success: true,
      skipped: true,
      haproxyWasHealthy: false,
      restartAttempted: false,
    };
  }

  // Check HAProxy health
  let healthResult: Awaited<ReturnType<typeof checkHaproxyHealth>>;
  try {
    healthResult = await checkHaproxyHealth();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[HAProxy Watchdog] Health check threw:", error);
    return {
      success: false,
      haproxyWasHealthy: false,
      restartAttempted: false,
      error,
    };
  }

  if (healthResult.healthy) {
    return {
      success: true,
      haproxyWasHealthy: true,
      restartAttempted: false,
    };
  }

  // HAProxy is unhealthy — inspect container state
  console.log("[HAProxy Watchdog] HAProxy is unhealthy, inspecting container...");
  const containerState = await inspectContainer();
  if (containerState) {
    console.log(`[HAProxy Watchdog] Container state: status=${containerState.status}, running=${containerState.running}`);
  }

  // Attempt Docker restart
  console.log(`[HAProxy Watchdog] Restarting container ${HAPROXY_CONTAINER_NAME}...`);
  const restartResult = await restartContainer();

  if (!restartResult.success) {
    console.error("[HAProxy Watchdog] Container restart failed:", restartResult.error);
    return {
      success: false,
      haproxyWasHealthy: false,
      restartAttempted: true,
      restartSucceeded: false,
      error: restartResult.error,
    };
  }

  console.log("[HAProxy Watchdog] Container restart issued, polling for health...");
  const becameHealthy = await pollUntilHealthy();

  if (becameHealthy) {
    console.log("[HAProxy Watchdog] HAProxy is healthy again, queuing reload...");
    try {
      const redis = getRedisClient();
      const reloadQueue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, { connection: redis });
      await reloadQueue.add(
        "haproxy-reload",
        { reason: "watchdog-restart", triggeredBy: "api" },
        { jobId: `watchdog-reload-${Date.now()}` }
      );
      console.log("[HAProxy Watchdog] Reload job queued");
    } catch (err) {
      console.error("[HAProxy Watchdog] Failed to queue reload job:", err instanceof Error ? err.message : err);
    }
  } else {
    console.error("[HAProxy Watchdog] HAProxy did not become healthy within polling window");
  }

  return {
    success: becameHealthy,
    haproxyWasHealthy: false,
    restartAttempted: true,
    restartSucceeded: becameHealthy,
  };
}
