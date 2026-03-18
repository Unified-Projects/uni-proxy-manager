import { type Job, Queue } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments } from "@uni-proxy-manager/database/schema";
import { eq, and } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { getOpenRuntimesClient } from "@uni-proxy-manager/shared/openruntimes";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { SiteKeepAliveJobData, SiteKeepAliveResult, SiteDeployJobData } from "@uni-proxy-manager/queue";

/**
 * Process site health checks
 *
 * When siteId is "*", this is the scheduler job that finds all sites
 * with coldStartEnabled=false and queues individual health check jobs.
 *
 * For individual site jobs, it verifies the runtime container is still
 * running. URT's keepAliveId protection keeps containers warm - no HTTP
 * pings are needed. If the runtime is missing, a redeploy is queued.
 */
export async function processSiteKeepAlive(
  job: Job<SiteKeepAliveJobData>
): Promise<SiteKeepAliveResult> {
  const { siteId } = job.data;

  // Scheduler job - find all sites needing health checks and queue them
  if (siteId === "*") {
    return await scheduleHealthChecks();
  }

  // Individual site health check
  return await checkSiteHealth(siteId);
}

/**
 * Scheduler: Find all active sites with cold start disabled and queue health checks
 */
async function scheduleHealthChecks(): Promise<SiteKeepAliveResult> {
  const redis = getRedisClient();
  const keepAliveQueue = new Queue<SiteKeepAliveJobData>(QUEUES.SITE_KEEPALIVE, {
    connection: redis,
  });

  // Find all sites that need health checks:
  // - coldStartEnabled = false (user wants site always warm, protected by URT keepAliveId)
  // - status = active (site is deployed and running)
  // - has an active deployment
  const sitesToCheck = await db.query.sites.findMany({
    where: and(
      eq(sites.coldStartEnabled, false),
      eq(sites.status, "active")
    ),
    columns: {
      id: true,
      name: true,
      activeDeploymentId: true,
    },
  });

  const activeSites = sitesToCheck.filter((site) => site.activeDeploymentId);

  console.log(
    `[Health] Scheduling health checks for ${activeSites.length} sites with cold start disabled`
  );

  // Queue individual health check jobs for each site
  for (const site of activeSites) {
    await keepAliveQueue.add(
      `keepalive-${site.id}`,
      { siteId: site.id },
      {
        jobId: `keepalive-${site.id}-${Date.now()}`,
        removeOnComplete: true,
      }
    );
  }

  return {
    success: true,
    siteId: "*",
  };
}

/**
 * Check that a specific site's runtime container is still running.
 * If the runtime doesn't exist, queue a deploy job to recreate it.
 * URT's keepAliveId ownership protects running containers - no HTTP pings needed.
 */
async function checkSiteHealth(siteId: string): Promise<SiteKeepAliveResult> {
  try {
    // Get site info with active deployment
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      return {
        success: false,
        siteId,
        error: "Site not found",
      };
    }

    if (!site.activeDeploymentId) {
      return {
        success: false,
        siteId,
        error: "No active deployment",
      };
    }

    const openruntimes = getOpenRuntimesClient();
    const runtimeId = `${siteId}-${site.activeDeploymentId}`;

    // Check if runtime exists
    const runtime = await openruntimes.getRuntime(runtimeId);
    if (!runtime) {
      console.log(`[Health] Runtime ${runtimeId} not found, queuing deploy to start it`);

      // Get deployment info to queue a redeploy
      const deployment = await db.query.deployments.findFirst({
        where: eq(deployments.id, site.activeDeploymentId),
      });

      if (!deployment || !deployment.artifactPath) {
        console.log(`[Health] No valid deployment found for ${siteId}, cannot start runtime`);
        return {
          success: false,
          siteId,
          error: "No valid deployment to start runtime",
        };
      }

      // Queue a deploy job to recreate the runtime
      const redis = getRedisClient();
      const deployQueue = new Queue<SiteDeployJobData>(QUEUES.SITE_DEPLOY, {
        connection: redis,
      });

      await deployQueue.add(
        `keepalive-redeploy-${siteId}`,
        {
          siteId,
          deploymentId: deployment.id,
          targetSlot: (site.activeSlot as "blue" | "green") || "blue",
          artifactPath: deployment.artifactPath,
          runtimeConfig: {
            cpus: Number(site.cpuLimit) || 0.5,
            memoryMb: site.memoryMb || 256,
            timeout: site.timeoutSeconds || 30,
          },
        },
        { jobId: `keepalive-redeploy-${siteId}-${Date.now()}` }
      );

      console.log(`[Health] Queued deploy job to start runtime for ${site.name}`);

      return {
        success: true,
        siteId,
      };
    }

    // Runtime is running and protected by URT keepAliveId - no ping needed
    console.log(`[Health] Runtime ${runtimeId} is running for ${site.name}`);
    return { success: true, siteId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Health] Failed to check site ${siteId}: ${errorMessage}`);

    return {
      success: false,
      siteId,
      error: errorMessage,
    };
  }
}
