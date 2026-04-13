import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments, githubConnections } from "@uni-proxy-manager/database/schema";
import { eq, desc } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { getGitHubApp, isGitHubAppConfigured } from "@uni-proxy-manager/shared/github";
import { QUEUES } from "@uni-proxy-manager/queue";

const app = new Hono();

const connectRepoSchema = z.object({
  installationId: z.number(),
  repositoryId: z.number(),
  repositoryFullName: z.string(),
  repositoryUrl: z.string().optional(),
  productionBranch: z.string().default("main"),
  previewBranches: z.array(z.string()).default(["*"]),
  autoDeploy: z.boolean().default(true),
});

const updateConnectionSchema = z.object({
  productionBranch: z.string().optional(),
  previewBranches: z.array(z.string()).optional(),
  autoDeploy: z.boolean().optional(),
});

/**
 * GET /api/github/status
 * Check if GitHub App is configured
 */
app.get("/status", async (c) => {
  return c.json({
    configured: isGitHubAppConfigured(),
    appSlug: process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG || "uni-proxy-manager",
  });
});

/**
 * GET /api/github/install
 * Get the GitHub App installation URL
 */
app.get("/install", async (c) => {
  if (!isGitHubAppConfigured()) {
    return c.json({ error: "GitHub App not configured" }, 503);
  }

  const siteId = c.req.query("siteId");
  const state = siteId ? JSON.stringify({ siteId }) : undefined;

  try {
    const gitHubApp = getGitHubApp();
    const installUrl = gitHubApp.getInstallationUrl(state);
    return c.json({ installUrl });
  } catch (error) {
    console.error("[GitHub] Error getting install URL:", error);
    return c.json({ error: "Failed to get installation URL" }, 500);
  }
});

/**
 * GET /api/github/callback
 * Handle GitHub App installation callback
 */
app.get("/callback", async (c) => {
  const installationId = c.req.query("installation_id");
  const setupAction = c.req.query("setup_action");
  const state = c.req.query("state");

  if (!installationId) {
    return c.json({ error: "Missing installation_id" }, 400);
  }

  let parsedState: { siteId?: string } = {};
  if (state) {
    try {
      parsedState = JSON.parse(state);
    } catch {
      // Ignore invalid state
    }
  }

  // Redirect to frontend with installation info
  const redirectUrl = new URL("/sites/github/callback", process.env.UNI_PROXY_MANAGER_FRONTEND_URL || "http://localhost:3000");
  redirectUrl.searchParams.set("installation_id", installationId);
  if (setupAction) {
    redirectUrl.searchParams.set("setup_action", setupAction);
  }
  if (parsedState.siteId) {
    redirectUrl.searchParams.set("site_id", parsedState.siteId);
  }

  return c.redirect(redirectUrl.toString());
});

/**
 * POST /api/github/webhook
 * Handle GitHub webhook events
 */
app.post("/webhook", async (c) => {
  if (!isGitHubAppConfigured()) {
    return c.json({ error: "GitHub App not configured" }, 503);
  }

  const event = c.req.header("X-GitHub-Event");
  const signature = c.req.header("X-Hub-Signature-256");
  const deliveryId = c.req.header("X-GitHub-Delivery");

  if (!event || !signature) {
    return c.json({ error: "Missing required headers" }, 400);
  }

  const payload = await c.req.text();

  try {
    const gitHubApp = getGitHubApp();

    // Verify webhook signature
    if (!gitHubApp.verifyWebhookSignature(payload, signature)) {
      console.warn("[GitHub] Invalid webhook signature for delivery:", deliveryId);
      return c.json({ error: "Invalid signature" }, 401);
    }

    const parsedPayload = JSON.parse(payload);
    const webhookEvent = gitHubApp.parseWebhookEvent(event, parsedPayload);

    console.log(`[GitHub] Received ${event} event:`, {
      deliveryId,
      type: webhookEvent.type,
      repo: webhookEvent.repositoryFullName,
      branch: webhookEvent.branch,
    });

    // Handle push events - trigger deployment
    if (webhookEvent.type === "push" && webhookEvent.repositoryId) {
      const connection = await db.query.githubConnections.findFirst({
        where: eq(githubConnections.repositoryId, webhookEvent.repositoryId),
      });

      if (connection && connection.autoDeploy) {
        // Check if this branch should trigger a deploy
        const shouldDeploy =
          webhookEvent.branch === connection.productionBranch ||
          (connection.previewBranches &&
            (connection.previewBranches.includes("*") ||
              connection.previewBranches.includes(webhookEvent.branch || "")));

        if (shouldDeploy) {
          console.log(`[GitHub] Triggering deployment for ${connection.repositoryFullName}:${webhookEvent.branch}`);

          const site = await db.query.sites.findFirst({
            where: eq(sites.id, connection.siteId),
          });

          if (site) {
            // Get latest deployment to determine version and slot
            const latestDeployment = await db.query.deployments.findFirst({
              where: eq(deployments.siteId, site.id),
              orderBy: [desc(deployments.version)],
            });

            const nextVersion = (latestDeployment?.version || 0) + 1;
            const targetSlot = latestDeployment?.slot === "blue" ? "green" : "blue";

            // Create deployment record
            const deploymentId = nanoid();
            await db.insert(deployments).values({
              id: deploymentId,
              siteId: site.id,
              version: nextVersion,
              slot: targetSlot,
              branch: webhookEvent.branch,
              commitSha: webhookEvent.commitSha,
              commitMessage: webhookEvent.commitMessage,
              status: "pending",
              triggeredBy: "webhook",
            });

            // Update connection with latest commit
            await db
              .update(githubConnections)
              .set({
                lastCommitSha: webhookEvent.commitSha,
                lastSyncAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(githubConnections.id, connection.id));

            // Update site status
            await db
              .update(sites)
              .set({
                status: "building",
                updatedAt: new Date(),
              })
              .where(eq(sites.id, site.id));

            // Queue build job
            try {
              const redis = getRedisClient();
              const queue = new Queue(QUEUES.SITE_BUILD, { connection: redis });

              await queue.add(
                `build-${deploymentId}`,
                {
                  siteId: site.id,
                  deploymentId,
                  commitSha: webhookEvent.commitSha,
                  branch: webhookEvent.branch,
                  envVariables: site.envVariables || {},
                  buildCommand: site.buildCommand || "npm run build",
                  installCommand: site.installCommand || "npm install",
                  nodeVersion: site.nodeVersion || "20",
                  framework: site.framework,
                  buildConfig: {
                    cpus: parseFloat(site.buildCpus || "1.0"),
                    memoryMb: site.buildMemoryMb || 2048,
                    timeoutSeconds: site.buildTimeoutSeconds || 900,
                  },
                },
                { jobId: `site-build-${deploymentId}` }
              );
            } catch (queueError) {
              console.error("[GitHub] Failed to queue build job:", queueError);
            }
          }
        }
      }
    }

    return c.json({ received: true, deliveryId });
  } catch (error) {
    console.error("[GitHub] Webhook processing error:", error);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

/**
 * GET /api/github/installations/:installationId/repositories
 * List repositories for a GitHub App installation
 */
app.get("/installations/:installationId/repositories", async (c) => {
  const { installationId } = c.req.param();

  if (!isGitHubAppConfigured()) {
    return c.json({ error: "GitHub App not configured" }, 503);
  }

  try {
    const gitHubApp = getGitHubApp();
    const repos = await gitHubApp.listRepositories(parseInt(installationId, 10));
    return c.json({ repositories: repos });
  } catch (error) {
    console.error("[GitHub] Error listing repositories:", error);
    return c.json({ error: "Failed to list repositories" }, 500);
  }
});

/**
 * GET /api/github/sites/:siteId
 * Get GitHub connection for a site
 */
app.get("/sites/:siteId", async (c) => {
  const { siteId } = c.req.param();

  try {
    const connection = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, siteId),
    });

    if (!connection) {
      return c.json({ connected: false });
    }

    return c.json({
      connected: true,
      connection: {
        id: connection.id,
        repositoryFullName: connection.repositoryFullName,
        repositoryUrl: connection.repositoryUrl,
        productionBranch: connection.productionBranch,
        previewBranches: connection.previewBranches,
        autoDeploy: connection.autoDeploy,
        lastSyncAt: connection.lastSyncAt,
        lastCommitSha: connection.lastCommitSha,
      },
    });
  } catch (error) {
    console.error("[GitHub] Error getting connection:", error);
    return c.json({ error: "Failed to get GitHub connection" }, 500);
  }
});

/**
 * POST /api/github/sites/:siteId
 * Connect a GitHub repository to a site
 */
app.post("/sites/:siteId", zValidator("json", connectRepoSchema), async (c) => {
  const { siteId } = c.req.param();
  const data = c.req.valid("json");

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Check if already connected
    const existingConnection = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, siteId),
    });

    if (existingConnection) {
      return c.json({ error: "Site is already connected to a repository" }, 409);
    }

    // Create connection
    const connectionId = nanoid();
    const [connection] = await db
      .insert(githubConnections)
      .values({
        id: connectionId,
        siteId,
        installationId: data.installationId,
        repositoryId: data.repositoryId,
        repositoryFullName: data.repositoryFullName,
        repositoryUrl: data.repositoryUrl,
        productionBranch: data.productionBranch,
        previewBranches: data.previewBranches,
        autoDeploy: data.autoDeploy,
        defaultBranch: data.productionBranch,
      })
      .returning();

    // Fetch initial branch/commit info
    if (isGitHubAppConfigured()) {
      try {
        const gitHubApp = getGitHubApp();
        const repoParts = data.repositoryFullName.split("/");
        const owner = repoParts[0];
        const repo = repoParts[1];

        if (!owner || !repo) {
          throw new Error(`Invalid repository format: ${data.repositoryFullName}`);
        }

        const latestCommit = await gitHubApp.getLatestCommit(
          data.installationId,
          owner,
          repo,
          data.productionBranch
        );

        await db
          .update(githubConnections)
          .set({
            lastCommitSha: latestCommit.sha,
            lastSyncAt: new Date(),
          })
          .where(eq(githubConnections.id, connectionId));
      } catch (syncError) {
        console.warn("[GitHub] Failed to sync initial commit:", syncError);
      }
    }

    return c.json({ connection }, 201);
  } catch (error) {
    console.error("[GitHub] Error connecting repository:", error);
    return c.json({ error: "Failed to connect repository" }, 500);
  }
});

/**
 * PUT /api/github/sites/:siteId
 * Update GitHub connection settings
 */
app.put("/sites/:siteId", zValidator("json", updateConnectionSchema), async (c) => {
  const { siteId } = c.req.param();
  const data = c.req.valid("json");

  try {
    const connection = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, siteId),
    });

    if (!connection) {
      return c.json({ error: "No GitHub connection found" }, 404);
    }

    const [updated] = await db
      .update(githubConnections)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(githubConnections.id, connection.id))
      .returning();

    return c.json({ connection: updated });
  } catch (error) {
    console.error("[GitHub] Error updating connection:", error);
    return c.json({ error: "Failed to update connection" }, 500);
  }
});

/**
 * DELETE /api/github/sites/:siteId
 * Disconnect a GitHub repository from a site
 */
app.delete("/sites/:siteId", async (c) => {
  const { siteId } = c.req.param();

  try {
    const connection = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, siteId),
    });

    if (!connection) {
      return c.json({ error: "No GitHub connection found" }, 404);
    }

    await db.delete(githubConnections).where(eq(githubConnections.id, connection.id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[GitHub] Error disconnecting repository:", error);
    return c.json({ error: "Failed to disconnect repository" }, 500);
  }
});

/**
 * GET /api/github/sites/:siteId/branches
 * List branches for a connected repository
 */
app.get("/sites/:siteId/branches", async (c) => {
  const { siteId } = c.req.param();

  if (!isGitHubAppConfigured()) {
    return c.json({ error: "GitHub App not configured" }, 503);
  }

  try {
    const connection = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, siteId),
    });

    if (!connection) {
      return c.json({ error: "No GitHub connection found" }, 404);
    }

    const gitHubApp = getGitHubApp();
    const repoParts = connection.repositoryFullName.split("/");
    const owner = repoParts[0];
    const repo = repoParts[1];

    if (!owner || !repo) {
      return c.json({ error: `Invalid repository format: ${connection.repositoryFullName}` }, 400);
    }

    const branches = await gitHubApp.listBranches(
      connection.installationId,
      owner,
      repo
    );

    return c.json({ branches });
  } catch (error) {
    console.error("[GitHub] Error listing branches:", error);
    return c.json({ error: "Failed to list branches" }, 500);
  }
});

/**
 * POST /api/github/sites/:siteId/sync
 * Manually sync latest commit info from GitHub
 */
app.post("/sites/:siteId/sync", async (c) => {
  const { siteId } = c.req.param();

  if (!isGitHubAppConfigured()) {
    return c.json({ error: "GitHub App not configured" }, 503);
  }

  try {
    const connection = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, siteId),
    });

    if (!connection) {
      return c.json({ error: "No GitHub connection found" }, 404);
    }

    const gitHubApp = getGitHubApp();
    const repoParts = connection.repositoryFullName.split("/");
    const owner = repoParts[0];
    const repo = repoParts[1];

    if (!owner || !repo) {
      return c.json({ error: `Invalid repository format: ${connection.repositoryFullName}` }, 400);
    }

    const latestCommit = await gitHubApp.getLatestCommit(
      connection.installationId,
      owner,
      repo,
      connection.productionBranch || "main"
    );

    const [updated] = await db
      .update(githubConnections)
      .set({
        lastCommitSha: latestCommit.sha,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(githubConnections.id, connection.id))
      .returning();

    return c.json({
      synced: true,
      latestCommit: {
        sha: latestCommit.sha,
        message: latestCommit.message,
        author: latestCommit.author,
      },
    });
  } catch (error) {
    console.error("[GitHub] Error syncing:", error);
    return c.json({ error: "Failed to sync from GitHub" }, 500);
  }
});

export default app;
