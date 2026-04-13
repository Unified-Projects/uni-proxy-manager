import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments, s3Providers } from "@uni-proxy-manager/database/schema";
import { eq, desc, and, ne } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { S3Service } from "@uni-proxy-manager/shared/s3";
import { rm } from "fs/promises";
import { nanoid } from "nanoid";
import { QUEUES, type HaproxySiteConfigJobData } from "@uni-proxy-manager/queue";

const app = new Hono();

/**
 * GET /api/deployments
 * List all deployments (optionally filtered by siteId)
 */
app.get("/", async (c) => {
  const siteId = c.req.query("siteId");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  try {
    const whereClause = siteId ? eq(deployments.siteId, siteId) : undefined;

    const allDeployments = await db.query.deployments.findMany({
      where: whereClause,
      orderBy: [desc(deployments.createdAt)],
      limit,
      offset,
    });

    return c.json({ deployments: allDeployments });
  } catch (error) {
    console.error("[Deployments] Error listing deployments:", error);
    return c.json({ error: "Failed to list deployments" }, 500);
  }
});

/**
 * GET /api/deployments/:id
 * Get a single deployment with full details
 */
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    const site = await db.query.sites.findFirst({
      where: eq(sites.id, deployment.siteId),
    });

    return c.json({
      deployment: {
        ...deployment,
        site,
      },
    });
  } catch (error) {
    console.error("[Deployments] Error getting deployment:", error);
    return c.json({ error: "Failed to get deployment" }, 500);
  }
});

/**
 * GET /api/deployments/:id/logs
 * Stream build logs for a deployment (SSE)
 */
app.get("/:id/logs", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    // For completed builds, return stored logs
    if (deployment.status !== "pending" && deployment.status !== "building" && deployment.status !== "deploying") {
      return c.json({
        logs: deployment.buildLogs || "",
        status: deployment.status,
        complete: true,
      });
    }

    // For active builds, set up SSE stream
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const stream = new ReadableStream({
      async start(controller) {
        const redis = getRedisClient();
        const logChannel = `deployment-logs:${id}`;
        const statusChannel = `deployment-status:${id}`;
        const logBufferKey = `deployment-logs-buffer:${id}`;

        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(
            new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        // First, send any buffered logs from Redis list
        const bufferedLogs = await redis.lrange(logBufferKey, 0, -1);
        for (const logLine of bufferedLogs) {
          sendEvent("log", { line: logLine });
        }

        // Subscribe to new log updates
        const subscriber = redis.duplicate();
        await subscriber.connect();

        subscriber.subscribe(logChannel, (message) => {
          if (typeof message === "string") {
            sendEvent("log", { line: message });
          }
        });

        subscriber.subscribe(statusChannel, (message) => {
          if (typeof message === "string") {
            const status = JSON.parse(message);
            sendEvent("status", status);
            if (["live", "failed", "cancelled", "rolled_back"].includes(status.status)) {
              controller.close();
            }
          }
        });

        // Send initial status
        sendEvent("status", { status: deployment.status });

        // Cleanup on close
        c.req.raw.signal.addEventListener("abort", async () => {
          try {
            await subscriber.unsubscribe(logChannel);
            await subscriber.unsubscribe(statusChannel);
            await subscriber.quit();
          } catch (cleanupError) {
            console.warn("[Deployments] Error during SSE log subscriber cleanup:", cleanupError);
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Deployments] Error streaming logs:", error);
    return c.json({ error: "Failed to stream logs" }, 500);
  }
});

/**
 * GET /api/deployments/:id/status-stream
 * SSE endpoint for deployment status updates only (lightweight)
 */
app.get("/:id/status-stream", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    // For completed deployments, return status immediately
    if (!["pending", "building", "deploying"].includes(deployment.status)) {
      return c.json({
        status: deployment.status,
        complete: true,
      });
    }

    // Set up SSE stream for in-progress deployments
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const stream = new ReadableStream({
      async start(controller) {
        const redis = getRedisClient();
        const statusChannel = `deployment-status:${id}`;

        const sendEvent = (data: unknown) => {
          controller.enqueue(
            new TextEncoder().encode(`event: status\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        // Send initial status
        sendEvent({ status: deployment.status });

        // Subscribe to status updates
        const subscriber = redis.duplicate();
        await subscriber.connect();

        subscriber.subscribe(statusChannel, (message) => {
          if (typeof message === "string") {
            try {
              const status = JSON.parse(message);
              sendEvent(status);
              if (["live", "failed", "cancelled", "rolled_back"].includes(status.status)) {
                controller.close();
              }
            } catch {
              // Ignore parse errors
            }
          }
        });

        // Heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          sendEvent({ type: "heartbeat" });
        }, 30000);

        // Cleanup on close
        c.req.raw.signal.addEventListener("abort", async () => {
          clearInterval(heartbeat);
          try {
            await subscriber.unsubscribe(statusChannel);
            await subscriber.quit();
          } catch (cleanupError) {
            console.warn("[Deployments] Error during SSE status subscriber cleanup:", cleanupError);
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Deployments] Error streaming status:", error);
    return c.json({ error: "Failed to stream status" }, 500);
  }
});

/**
 * POST /api/deployments/:id/cancel
 * Cancel an in-progress deployment
 */
app.post("/:id/cancel", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (!["pending", "building", "deploying"].includes(deployment.status)) {
      return c.json({ error: "Can only cancel in-progress deployments" }, 400);
    }

    // Update deployment status
    const [updated] = await db
      .update(deployments)
      .set({
        status: "cancelled",
        errorMessage: "Cancelled by user",
      })
      .where(eq(deployments.id, id))
      .returning();

    // Notify workers to stop
    const redis = getRedisClient();
    await redis.publish(`deployment-cancel:${id}`, JSON.stringify({ deploymentId: id }));

    // Update site status if it was building
    await db
      .update(sites)
      .set({
        status: "error",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, deployment.siteId));

    return c.json({
      deployment: updated,
      message: "Deployment cancelled",
    });
  } catch (error) {
    console.error("[Deployments] Error cancelling deployment:", error);
    return c.json({ error: "Failed to cancel deployment" }, 500);
  }
});

/**
 * POST /api/deployments/:id/retry
 * Retry a failed deployment (re-run deploy step using existing artifact)
 */
app.post("/:id/retry", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (deployment.status !== "failed") {
      return c.json({ error: "Can only retry failed deployments" }, 400);
    }

    if (!deployment.artifactPath) {
      return c.json({ error: "No artifact available - build may have failed. Trigger a new deployment instead." }, 400);
    }

    const site = await db.query.sites.findFirst({
      where: eq(sites.id, deployment.siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Reset deployment status
    await db
      .update(deployments)
      .set({
        status: "deploying",
        errorMessage: null,
      })
      .where(eq(deployments.id, id));

    // Queue deploy job
    const redis = getRedisClient();
    const deployQueue = new Queue("site-deploy", { connection: redis });
    await deployQueue.add(
      `deploy-${id}`,
      {
        siteId: site.id,
        deploymentId: id,
        targetSlot: deployment.slot || "blue",
        artifactPath: deployment.artifactPath,
        runtimeConfig: {
          cpus: parseFloat(site.cpuLimit || "0.5"),
          memoryMb: site.memoryMb || 256,
          timeout: site.timeoutSeconds || 30,
        },
        entryPoint: site.entryPoint || undefined,
        runtimePath: site.runtimePath || undefined,
      },
      { jobId: `site-deploy-retry-${id}-${Date.now()}` }
    );

    // Update site status
    await db
      .update(sites)
      .set({
        status: "deploying",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id));

    return c.json({
      message: "Deployment retry queued",
      deploymentId: id,
    });
  } catch (error) {
    console.error("[Deployments] Error retrying deployment:", error);
    return c.json({ error: "Failed to retry deployment" }, 500);
  }
});

/**
 * POST /api/deployments/:id/redeploy
 * Re-deploy an already built deployment (reuse artifact)
 */
app.post("/:id/redeploy", async (c) => {
  const { id } = c.req.param();

  try {
    const sourceDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!sourceDeployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (["pending", "building", "deploying"].includes(sourceDeployment.status)) {
      return c.json({ error: "Cannot redeploy an in-progress deployment" }, 400);
    }

    if (sourceDeployment.status === "failed") {
      return c.json({ error: "Use retry to redeploy failed deployments" }, 400);
    }

    if (!sourceDeployment.artifactPath) {
      return c.json({ error: "No artifact available - build may have failed. Trigger a new deployment instead." }, 400);
    }

    const site = await db.query.sites.findFirst({
      where: eq(sites.id, sourceDeployment.siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const latestDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.siteId, site.id),
      orderBy: [desc(deployments.version)],
    });

    const nextVersion = (latestDeployment?.version || 0) + 1;
    const targetSlot = site.activeSlot === "blue" ? "green" : "blue";

    const [newDeployment] = await db
      .insert(deployments)
      .values({
        id: nanoid(),
        siteId: site.id,
        version: nextVersion,
        slot: targetSlot,
        branch: sourceDeployment.branch,
        commitSha: sourceDeployment.commitSha,
        commitMessage: `Redeploy v${sourceDeployment.version}`,
        artifactPath: sourceDeployment.artifactPath,
        artifactSize: sourceDeployment.artifactSize,
        buildCompletedAt: sourceDeployment.buildCompletedAt,
        buildDurationMs: sourceDeployment.buildDurationMs,
        buildLogs: sourceDeployment.buildLogs,
        status: "deploying",
        triggeredBy: "manual",
      })
      .returning();

    if (!newDeployment) {
      return c.json({ error: "Failed to create deployment record" }, 500);
    }

    const redis = getRedisClient();
    const deployQueue = new Queue("site-deploy", { connection: redis });
    await deployQueue.add(
      `deploy-${newDeployment.id}`,
      {
        siteId: site.id,
        deploymentId: newDeployment.id,
        targetSlot,
        artifactPath: sourceDeployment.artifactPath,
        runtimeConfig: {
          cpus: parseFloat(site.cpuLimit || "0.5"),
          memoryMb: site.memoryMb || 256,
          timeout: site.timeoutSeconds || 30,
        },
        entryPoint: site.entryPoint || undefined,
        runtimePath: site.runtimePath || undefined,
      },
      { jobId: `site-deploy-redeploy-${newDeployment.id}` }
    );

    await db
      .update(sites)
      .set({
        status: "deploying",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id));

    return c.json({
      message: "Deployment redeploy queued",
      deploymentId: newDeployment.id,
    });
  } catch (error) {
    console.error("[Deployments] Error redeploying deployment:", error);
    return c.json({ error: "Failed to redeploy deployment" }, 500);
  }
});

/**
 * DELETE /api/deployments/:id
 * Delete a deployment and its artifact (if unused)
 */
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (deployment.isActive) {
      return c.json({ error: "Cannot delete the active deployment" }, 400);
    }

    if (["pending", "building", "deploying"].includes(deployment.status)) {
      return c.json({ error: "Cancel the deployment before deleting it" }, 400);
    }

    const site = await db.query.sites.findFirst({
      where: eq(sites.id, deployment.siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Clean up artifacts when no other deployment references them
    if (deployment.artifactPath) {
      const otherDeployment = await db.query.deployments.findFirst({
        where: and(
          eq(deployments.artifactPath, deployment.artifactPath),
          ne(deployments.id, deployment.id)
        ),
      });

      if (!otherDeployment) {
        if (deployment.artifactPath.startsWith("local:")) {
          const localPath = deployment.artifactPath.substring(6);
          try {
            await rm(localPath, { force: true });
          } catch (rmError) {
            console.warn(`[Deployments] Failed to remove local artifact: ${localPath}`, rmError);
          }
        } else {
          const s3Provider = await db.query.s3Providers.findFirst({
            where: eq(s3Providers.usedForArtifacts, true),
          });

          if (s3Provider) {
            const s3 = new S3Service({
              endpoint: s3Provider.endpoint,
              region: s3Provider.region,
              bucket: s3Provider.bucket,
              accessKeyId: s3Provider.accessKeyId,
              secretAccessKey: s3Provider.secretAccessKey,
            });

            await s3.delete(deployment.artifactPath);
          }
        }
      }
    }

    // Clean up preview artifact if stored in S3
    const previewProvider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.usedForArtifacts, true),
    });

    if (previewProvider) {
      const s3 = new S3Service({
        endpoint: previewProvider.endpoint,
        region: previewProvider.region,
        bucket: previewProvider.bucket,
        accessKeyId: previewProvider.accessKeyId,
        secretAccessKey: previewProvider.secretAccessKey,
        pathPrefix: previewProvider.pathPrefix || undefined,
      });

      await s3.delete(`previews/${site.id}/${deployment.id}.png`);
    }

    await db.delete(deployments).where(eq(deployments.id, id));

    return c.json({
      message: "Deployment deleted",
      deploymentId: id,
    });
  } catch (error) {
    console.error("[Deployments] Error deleting deployment:", error);
    return c.json({ error: "Failed to delete deployment" }, 500);
  }
});

/**
 * POST /api/deployments/:id/promote
 * Promote a deployment to production (switch active slot)
 */
app.post("/:id/promote", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (deployment.status !== "live" && deployment.status !== "rolled_back") {
      return c.json({ error: "Can only promote live or rolled back deployments" }, 400);
    }

    if (deployment.isActive) {
      return c.json({ error: "Deployment is already active" }, 400);
    }

    const site = await db.query.sites.findFirst({
      where: eq(sites.id, deployment.siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Deactivate current active deployment
    await db
      .update(deployments)
      .set({ isActive: false })
      .where(and(eq(deployments.siteId, site.id), eq(deployments.isActive, true)));

    // Activate this deployment
    const [updated] = await db
      .update(deployments)
      .set({
        isActive: true,
        deployedAt: new Date(),
      })
      .where(eq(deployments.id, id))
      .returning();

    const activeSlot = deployment.slot || site.activeSlot || "blue";

    // Update site active slot and deployment
    await db
      .update(sites)
      .set({
        activeSlot,
        activeDeploymentId: id,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id));

    // Queue HAProxy config update
    try {
      const redis = getRedisClient();
      const queue = new Queue<HaproxySiteConfigJobData>(QUEUES.HAPROXY_SITE_CONFIG, {
        connection: redis,
      });
      await queue.add("update-site-backend", {
        siteId: site.id,
        activeSlot,
        action: "update",
      });
    } catch (queueError) {
      console.error("[Deployments] Failed to queue HAProxy update:", queueError);
    }

    return c.json({
      deployment: updated,
      message: "Deployment promoted to production",
    });
  } catch (error) {
    console.error("[Deployments] Error promoting deployment:", error);
    return c.json({ error: "Failed to promote deployment" }, 500);
  }
});

/**
 * GET /api/deployments/:id/preview
 * Get preview image for a deployment
 */
app.get("/:id/preview", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (!deployment.previewUrl) {
      return c.json({ error: "No preview available" }, 404);
    }

    return c.json({
      previewUrl: deployment.previewUrl,
      deploymentId: id,
    });
  } catch (error) {
    console.error("[Deployments] Error getting preview:", error);
    return c.json({ error: "Failed to get preview" }, 500);
  }
});

/**
 * POST /api/deployments/:id/generate-preview
 * Queue preview generation for a deployment
 */
app.post("/:id/generate-preview", async (c) => {
  const { id } = c.req.param();

  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });

    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (deployment.status !== "live") {
      return c.json({ error: "Can only generate preview for live deployments" }, 400);
    }

    const site = await db.query.sites.findFirst({
      where: eq(sites.id, deployment.siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Queue preview generation
    try {
      const redis = getRedisClient();
      const queue = new Queue("preview-generate", { connection: redis });
      await queue.add(
        `preview-${id}`,
        {
          siteId: site.id,
          deploymentId: id,
          slug: site.slug,
        },
        { jobId: `preview-${id}` }
      );
    } catch (queueError) {
      console.error("[Deployments] Failed to queue preview generation:", queueError);
      return c.json({ error: "Failed to queue preview generation" }, 500);
    }

    return c.json({
      message: "Preview generation queued",
      deploymentId: id,
    });
  } catch (error) {
    console.error("[Deployments] Error queueing preview:", error);
    return c.json({ error: "Failed to queue preview generation" }, 500);
  }
});

export default app;
