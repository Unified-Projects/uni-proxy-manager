import { type Job } from "bullmq";
import { Queue } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments, siteDomains, domains } from "@uni-proxy-manager/database/schema";
import { eq, and } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { getOpenRuntimesClient, type ExecutionResult } from "@uni-proxy-manager/shared/openruntimes";
import { waitForSiteDeployLock, releaseSiteDeployLock } from "@uni-proxy-manager/shared";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { SiteDeployJobData, SiteDeployResult, HaproxySiteConfigJobData, PreviewGenerateJobData } from "@uni-proxy-manager/queue";
import { mkdir, copyFile, stat } from "fs/promises";
import { join } from "path";

const DEPLOY_DIR = process.env.SITES_DEPLOY_DIR || "/storage/functions";
const STARTUP_TIMEOUT_SECONDS = Number.parseInt(
  process.env.SITES_RUNTIME_STARTUP_TIMEOUT_SECONDS || "",
  10
) || 120;

export async function processSiteDeploy(
  job: Job<SiteDeployJobData>
): Promise<SiteDeployResult> {
  const {
    siteId,
    deploymentId,
    targetSlot,
    artifactPath,
    runtimeConfig,
    renderMode,
    entryPoint,
    runtimePath,
  } = job.data;
  const redis = getRedisClient();
  const logChannel = `deployment-logs:${deploymentId}`;
  const statusChannel = `deployment-status:${deploymentId}`;

  const logBufferKey = `deployment-logs-buffer:${deploymentId}`;

  const log = async (message: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;

    // Store in Redis list for persistence (survives reconnects)
    await redis.rpush(logBufferKey, logLine);
    await redis.expire(logBufferKey, 86400); // 24 hour TTL

    // Publish for real-time subscribers
    await redis.publish(logChannel, logLine);

    console.log(`[Deploy ${deploymentId}] ${message}`);
  };

  const deployDir = join(DEPLOY_DIR, deploymentId);

  // Acquire deployment lock to prevent concurrent deployments for the same site
  const lockAcquired = await waitForSiteDeployLock(redis, siteId, 60000);
  if (!lockAcquired) {
    await log("Failed to acquire deployment lock - another deployment is in progress");
    throw new Error("Could not acquire deployment lock - another deployment is in progress");
  }

  try {
    await log("Starting deployment process...");

    // Get site info
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    // Resolve artifact source: local file path or S3 key passed directly to executor
    let sourcePath: string;

    if (artifactPath.startsWith("local:")) {
      // Local artifact storage — copy to deploy dir so executor can read from shared volume
      const localPath = artifactPath.substring(6); // Remove "local:" prefix
      await log(`Loading artifact from local storage: ${localPath}`);
      await mkdir(deployDir, { recursive: true });
      const artifactLocalPath = join(deployDir, "artifact.tar.gz");

      if (localPath === artifactLocalPath) {
        try {
          const fileStats = await stat(artifactLocalPath);
          await log(`Artifact already in place (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)`);
        } catch {
          throw new Error(`Artifact not found at ${artifactLocalPath}. The build may have failed or the artifact was cleaned up. Please rebuild.`);
        }
      } else {
        await copyFile(localPath, artifactLocalPath);
        const fileStats = await stat(artifactLocalPath);
        await log(`Artifact loaded from local storage (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)`);
      }

      sourcePath = artifactLocalPath;
    } else {
      // S3 key — pass directly to executor; it fetches from S3 via URT_STORAGE_DEVICE=s3
      await log(`Using S3 artifact: ${artifactPath}`);
      sourcePath = artifactPath;
    }

    // Determine runtime image - format: openruntimes/node:v5-{version}
    // OpenRuntimes image tags: node 22+ uses just major version ("22", "23"), older versions use "20.0", "18.0" etc.
    const nodeVersion = site.nodeVersion || "20";
    const majorVersion = nodeVersion.split(".")[0] || "20";
    let runtimeNodeVersion: string;
    if (parseInt(majorVersion, 10) >= 22) {
      runtimeNodeVersion = majorVersion;
    } else {
      runtimeNodeVersion = nodeVersion.includes(".") ? nodeVersion : `${nodeVersion}.0`;
    }
    const runtimeImage = `openruntimes/node:v5-${runtimeNodeVersion}`;

    // Runtime ID format: {siteId}-{deploymentId} (Appwrite-style, no site- prefix)
    const runtimeId = `${siteId}-${deploymentId}`;

    await log(`Creating runtime: ${runtimeId} with image: ${runtimeImage}`);

    // Get OpenRuntimes client
    const openruntimes = getOpenRuntimesClient();

    // Check if old runtime exists and delete it
    const existingRuntime = await openruntimes.getRuntime(runtimeId);
    if (existingRuntime) {
      await log(`Deleting existing runtime: ${runtimeId}`);
      await openruntimes.deleteRuntime(runtimeId);
    }

    await log(`Source path for OpenRuntimes: ${sourcePath}`);

    const effectiveRenderMode = renderMode || site.renderMode || "ssg";
    const isStatic = effectiveRenderMode === "ssg";
    const effectiveEntryPoint = entryPoint || site.entryPoint || undefined;
    const effectiveRuntimePath = runtimePath || site.runtimePath || undefined;

    const buildCustomStartCommand = (): string => {
      if (!effectiveEntryPoint) {
        throw new Error("Custom runtime deployments require an entryPoint.");
      }

      const runtimeSegments = [effectiveRuntimePath, effectiveEntryPoint]
        .filter(Boolean)
        .map((segment) => segment!.replace(/^\.?\//, "").replace(/\\/g, "/"));
      const relativeRuntimeTarget = runtimeSegments.join("/");

      if (!relativeRuntimeTarget) {
        throw new Error("Custom runtime deployments require a valid runtime target.");
      }

      const escapedTarget = relativeRuntimeTarget.replace(/"/g, '\\"');
      return `node "${escapedTarget}"`;
    };

    // Use framework-specific start commands (Appwrite-style)
    // These helper scripts handle finding server.js correctly after bundling
    let startCommand: string;
    switch (site.framework) {
      case "nextjs":
        startCommand = isStatic ? "bash helpers/server.sh" : "bash helpers/next-js/server.sh";
        break;
      case "sveltekit":
        startCommand = isStatic ? "bash helpers/server.sh" : "bash helpers/sveltekit/server.sh";
        break;
      case "static":
        startCommand = "bash helpers/server.sh";
        break;
      case "custom":
        startCommand = buildCustomStartCommand();
        break;
      default:
        startCommand = "bash helpers/server.sh";
    }

    const escapedStartCommand = startCommand.replace(/"/g, '\\"');
    const runtimeEntrypoint =
      `cp /tmp/code.tar.gz /mnt/code/code.tar.gz && nohup helpers/start.sh "${escapedStartCommand}"`;

    const executionPath = "/"; // Warm up root path for SSR or static

    const runtimeVariables = {
      ...(site.envVariables as Record<string, string> || {}),
      ...(isStatic ? { OPEN_RUNTIMES_STATIC_FALLBACK: "index.html" } : {}),
    };

    await log(`Starting runtime with ${runtimeConfig.memoryMb}MB memory and ${runtimeConfig.cpus} CPUs`);
    await log(`Render mode: ${effectiveRenderMode}`);
    await log(`Start command: ${startCommand}`);
    await log(`Runtime entrypoint: ${runtimeEntrypoint}`);

    const warmupTimeoutSeconds = Math.max(runtimeConfig.timeout, STARTUP_TIMEOUT_SECONDS);

    await log(`Creating runtime container...`);
    await openruntimes.createRuntime({
      runtimeId,
      image: runtimeImage,
      source: sourcePath,
      runtimeEntrypoint,
      cpus: runtimeConfig.cpus,
      memory: runtimeConfig.memoryMb,
      variables: runtimeVariables,
      version: "v5",
      timeout: warmupTimeoutSeconds,
      ...(site.coldStartEnabled === false ? { keepAliveId: siteId } : {}),
    });

    await log(`Waiting for runtime to be ready (up to ${warmupTimeoutSeconds}s)...`);
    await openruntimes.waitForRuntime(runtimeId, {
      timeoutMs: warmupTimeoutSeconds * 1000,
      pollIntervalMs: 2000,
    });

    await log(`Running health check...`);
    const healthCheck = await openruntimes.execute({
      runtimeId,
      path: executionPath,
      method: "GET",
      timeout: runtimeConfig.timeout,
    });

    await log(`Health check result: status=${healthCheck.statusCode}, duration=${healthCheck.duration}ms`);

    const errorsText = healthCheck.errors?.trim();
    if (errorsText) {
      await log(`Execution errors: ${healthCheck.errors}`);
    }

    const isHealthyStatus = healthCheck.statusCode < 500;
    if (!isHealthyStatus || errorsText) {
      await log(`Health check failed with status ${healthCheck.statusCode}`);
      throw new Error(`Runtime health check failed: ${healthCheck.statusCode}`);
    }

    await log(`Health check passed (status: ${healthCheck.statusCode})`);

    // Deactivate previous active deployment
    await db
      .update(deployments)
      .set({ isActive: false })
      .where(and(eq(deployments.siteId, siteId), eq(deployments.isActive, true)));

    // Update deployment status
    await db
      .update(deployments)
      .set({
        status: "live",
        isActive: true,
        deployedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));

    // Update site with new active slot and deployment
    await db
      .update(sites)
      .set({
        activeSlot: targetSlot,
        activeDeploymentId: deploymentId,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, siteId));

    await redis.publish(statusChannel, JSON.stringify({ status: "live" }));

    // Invalidate sites-lookup cache for all hostnames associated with this site
    await log("Invalidating route cache...");
    try {
      const siteHostnames = await db
        .select({ hostname: domains.hostname })
        .from(siteDomains)
        .innerJoin(domains, eq(domains.id, siteDomains.domainId))
        .where(eq(siteDomains.siteId, siteId));

      if (siteHostnames.length > 0) {
        const cacheKeys = siteHostnames.map(h => `sites:route:${h.hostname}`);
        await redis.del(...cacheKeys);
        await log(`Invalidated ${cacheKeys.length} route cache entries`);
      }
    } catch (cacheError) {
      // Log but don't fail deployment for cache invalidation errors
      await log(`Warning: Failed to invalidate route cache: ${cacheError}`);
    }

    // Queue HAProxy config update
    await log("Updating HAProxy configuration...");
    const haproxyQueue = new Queue<HaproxySiteConfigJobData>(QUEUES.HAPROXY_SITE_CONFIG, { connection: redis });
    await haproxyQueue.add(
      `haproxy-site-${siteId}`,
      {
        siteId,
        activeSlot: targetSlot,
        action: "update",
      },
      { jobId: `haproxy-site-${deploymentId}` }
    );

    // Queue preview generation
    await log("Queueing preview generation...");
    const previewQueue = new Queue<PreviewGenerateJobData>(QUEUES.PREVIEW_GENERATE, { connection: redis });
    await previewQueue.add(
      `preview-${deploymentId}`,
      {
        siteId,
        deploymentId,
        slug: site.slug,
      },
      { jobId: `preview-${deploymentId}` }
    );

    // Delete old slot runtime if exists
    const previousDeploymentId = site.activeDeploymentId;
    if (previousDeploymentId && previousDeploymentId !== deploymentId && !site.coldStartEnabled) {
      const oldRuntimeId = `${siteId}-${previousDeploymentId}`;
      const oldRuntime = await openruntimes.getRuntime(oldRuntimeId);
      if (oldRuntime) {
        await log(`Keeping old runtime ${oldRuntimeId} for zero-downtime`);
        // Don't delete immediately - let the old runtime serve remaining requests
        // It will be cleaned up by a manual or scheduled cleanup
      }
    }

    await log("Deployment completed successfully");

    // Append deploy logs to database
    const deployLogs = await redis.lrange(logBufferKey, 0, -1);
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });
    if (deployment) {
      const combinedLogs = deployment.buildLogs
        ? `${deployment.buildLogs}\n${deployLogs.join("\n")}`
        : deployLogs.join("\n");
      await db
        .update(deployments)
        .set({ buildLogs: combinedLogs })
        .where(eq(deployments.id, deploymentId));
    }

    // Set shorter TTL on log buffer (1 hour after completion)
    await redis.expire(logBufferKey, 3600);

    return {
      success: true,
      deploymentId,
      runtimeId,
      slot: targetSlot,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await log(`Deployment failed: ${errorMessage}`);

    // Update deployment status
    await db
      .update(deployments)
      .set({
        status: "failed",
        errorMessage,
      })
      .where(eq(deployments.id, deploymentId));

    // Update site status
    await db
      .update(sites)
      .set({
        status: "error",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, siteId));

    await redis.publish(statusChannel, JSON.stringify({ status: "failed", error: errorMessage }));

    // Append deploy logs to database even on failure
    try {
      const deployLogs = await redis.lrange(logBufferKey, 0, -1);
      const deployment = await db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
      });
      if (deployment) {
        const combinedLogs = deployment.buildLogs
          ? `${deployment.buildLogs}\n${deployLogs.join("\n")}`
          : deployLogs.join("\n");
        await db
          .update(deployments)
          .set({ buildLogs: combinedLogs })
          .where(eq(deployments.id, deploymentId));
      }
    } catch {
      // Ignore log save errors
    }

    // Set shorter TTL on log buffer (1 hour after completion)
    await redis.expire(logBufferKey, 3600);

    // Don't clean up the deploy directory on failure - keep artifact for retry
    // Cleanup will happen when deployment is deleted or a new build replaces it

    return {
      success: false,
      deploymentId,
      slot: targetSlot,
      error: errorMessage,
    };
  } finally {
    // Always release the deployment lock
    await releaseSiteDeployLock(redis, siteId);
  }
}
