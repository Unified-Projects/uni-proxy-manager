import { type Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { githubConnections } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getGitHubApp, isGitHubAppConfigured } from "@uni-proxy-manager/shared/github";
import type { GitHubSyncJobData } from "@uni-proxy-manager/queue";

export async function processGitHubSync(
  job: Job<GitHubSyncJobData>
): Promise<void> {
  const { siteId, installationId, action } = job.data;

  if (!isGitHubAppConfigured()) {
    console.log("[GitHub Sync] GitHub App not configured, skipping");
    return;
  }

  const gitHubApp = getGitHubApp();

  try {
    switch (action) {
      case "refresh_token":
        await refreshInstallationToken(siteId, installationId, gitHubApp);
        break;

      case "fetch_branches":
        await fetchBranches(siteId, installationId, gitHubApp);
        break;

      case "check_commit":
        await checkLatestCommit(siteId, installationId, gitHubApp);
        break;

      case "sync_all":
        await refreshInstallationToken(siteId, installationId, gitHubApp);
        await fetchBranches(siteId, installationId, gitHubApp);
        await checkLatestCommit(siteId, installationId, gitHubApp);
        break;

      default:
        console.warn(`[GitHub Sync] Unknown action: ${action}`);
    }
  } catch (error) {
    console.error(`[GitHub Sync] Error processing ${action} for site ${siteId}:`, error);
    throw error;
  }
}

async function refreshInstallationToken(
  siteId: string,
  installationId: number,
  gitHubApp: ReturnType<typeof getGitHubApp>
): Promise<void> {
  console.log(`[GitHub Sync] Refreshing token for installation ${installationId}`);

  try {
    const octokit = await gitHubApp.getInstallationOctokit(installationId);

    // Update last sync time
    await db
      .update(githubConnections)
      .set({
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(githubConnections.siteId, siteId));

    console.log(`[GitHub Sync] Token refreshed for installation ${installationId}`);
  } catch (error) {
    console.error(`[GitHub Sync] Failed to refresh token:`, error);
    throw error;
  }
}

async function fetchBranches(
  siteId: string,
  installationId: number,
  gitHubApp: ReturnType<typeof getGitHubApp>
): Promise<void> {
  console.log(`[GitHub Sync] Fetching branches for site ${siteId}`);

  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.siteId, siteId),
  });

  if (!connection) {
    throw new Error(`No GitHub connection found for site ${siteId}`);
  }

  const parts = connection.repositoryFullName.split("/");
  const owner = parts[0];
  const repo = parts[1];

  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${connection.repositoryFullName}`);
  }

  const branches = await gitHubApp.listBranches(installationId, owner, repo);

  // Update default branch if needed
  const repoInfo = await gitHubApp.getRepository(installationId, owner, repo);

  await db
    .update(githubConnections)
    .set({
      defaultBranch: repoInfo.defaultBranch,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(githubConnections.id, connection.id));

  console.log(`[GitHub Sync] Fetched ${branches.length} branches, default: ${repoInfo.defaultBranch}`);
}

async function checkLatestCommit(
  siteId: string,
  installationId: number,
  gitHubApp: ReturnType<typeof getGitHubApp>
): Promise<void> {
  console.log(`[GitHub Sync] Checking latest commit for site ${siteId}`);

  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.siteId, siteId),
  });

  if (!connection) {
    throw new Error(`No GitHub connection found for site ${siteId}`);
  }

  const repoParts = connection.repositoryFullName.split("/");
  const owner = repoParts[0];
  const repo = repoParts[1];

  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${connection.repositoryFullName}`);
  }

  const latestCommit = await gitHubApp.getLatestCommit(
    installationId,
    owner,
    repo,
    connection.productionBranch || "main"
  );

  // Check if commit has changed
  const hasNewCommit = latestCommit.sha !== connection.lastCommitSha;

  await db
    .update(githubConnections)
    .set({
      lastCommitSha: latestCommit.sha,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(githubConnections.id, connection.id));

  if (hasNewCommit) {
    console.log(`[GitHub Sync] New commit detected: ${latestCommit.sha.substring(0, 7)} - ${latestCommit.message}`);
    // Deploys happen via webhooks -- this just updates connection info
  } else {
    console.log(`[GitHub Sync] No new commits`);
  }
}
