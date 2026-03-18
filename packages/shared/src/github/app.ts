import { App } from "@octokit/app";
import { type Octokit, type RestEndpointMethodTypes } from "@octokit/rest";
import { createHmac, timingSafeEqual } from "crypto";

type RepoFromInstallation = RestEndpointMethodTypes["apps"]["listReposAccessibleToInstallation"]["response"]["data"]["repositories"][number];
type BranchFromList = RestEndpointMethodTypes["repos"]["listBranches"]["response"]["data"][number];

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface RepositoryInfo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  url: string;
  cloneUrl: string;
}

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  url: string;
}

export interface WebhookPayload {
  action?: string;
  repository?: {
    id: number;
    full_name: string;
    default_branch: string;
  };
  installation?: {
    id: number;
  };
  ref?: string;
  after?: string;
  before?: string;
  commits?: Array<{
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  }>;
  sender?: {
    login: string;
    id: number;
  };
}

export class GitHubAppService {
  private app: App;
  private webhookSecret?: string;

  constructor(config: GitHubAppConfig) {
    this.app = new App({
      appId: config.appId,
      privateKey: config.privateKey,
    });
    this.webhookSecret = config.webhookSecret;
  }

  /**
   * Get an authenticated Octokit instance for an installation
   */
  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    // The @octokit/app returns a properly configured Octokit instance but TypeScript
    // doesn't know it has REST endpoint methods, so we use a type assertion
    return this.app.getInstallationOctokit(installationId) as unknown as Octokit;
  }

  /**
   * Get the installation URL for a user to install the app
   */
  getInstallationUrl(state?: string): string {
    const baseUrl = `https://github.com/apps/${process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG || "uni-proxy-manager"}/installations/new`;
    if (state) {
      return `${baseUrl}?state=${encodeURIComponent(state)}`;
    }
    return baseUrl;
  }

  /**
   * Verify a webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn("[GitHub] No webhook secret configured, skipping verification");
      return true;
    }

    const expectedSignature = `sha256=${createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex")}`;

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  /**
   * List repositories accessible by an installation
   */
  async listRepositories(installationId: number): Promise<RepositoryInfo[]> {
    const octokit = await this.getInstallationOctokit(installationId);

    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: 100,
    });

    return data.repositories.map((repo: RepoFromInstallation) => ({
      id: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      defaultBranch: repo.default_branch,
      private: repo.private,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
    }));
  }

  /**
   * Get repository information
   */
  async getRepository(
    installationId: number,
    owner: string,
    repo: string
  ): Promise<RepositoryInfo> {
    const octokit = await this.getInstallationOctokit(installationId);

    const { data } = await octokit.repos.get({
      owner,
      repo,
    });

    return {
      id: data.id,
      fullName: data.full_name,
      name: data.name,
      owner: data.owner.login,
      defaultBranch: data.default_branch,
      private: data.private,
      url: data.html_url,
      cloneUrl: data.clone_url,
    };
  }

  /**
   * List branches for a repository
   */
  async listBranches(
    installationId: number,
    owner: string,
    repo: string
  ): Promise<BranchInfo[]> {
    const octokit = await this.getInstallationOctokit(installationId);

    const { data } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    return data.map((branch: BranchFromList) => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: branch.protected,
    }));
  }

  /**
   * Get a specific commit
   */
  async getCommit(
    installationId: number,
    owner: string,
    repo: string,
    ref: string
  ): Promise<CommitInfo> {
    const octokit = await this.getInstallationOctokit(installationId);

    const { data } = await octokit.repos.getCommit({
      owner,
      repo,
      ref,
    });

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author?.name || "Unknown",
        email: data.commit.author?.email || "",
        date: data.commit.author?.date || new Date().toISOString(),
      },
      url: data.html_url,
    };
  }

  /**
   * Get the latest commit on a branch
   */
  async getLatestCommit(
    installationId: number,
    owner: string,
    repo: string,
    branch: string
  ): Promise<CommitInfo> {
    return this.getCommit(installationId, owner, repo, branch);
  }

  /**
   * Download repository archive
   */
  async downloadArchive(
    installationId: number,
    owner: string,
    repo: string,
    ref: string
  ): Promise<ArrayBuffer> {
    const octokit = await this.getInstallationOctokit(installationId);

    const { data } = await octokit.repos.downloadTarballArchive({
      owner,
      repo,
      ref,
    });

    return data as ArrayBuffer;
  }

  /**
   * Get the clone URL with authentication token
   */
  async getAuthenticatedCloneUrl(
    installationId: number,
    owner: string,
    repo: string
  ): Promise<string> {
    const octokit = await this.getInstallationOctokit(installationId);

    // Get the installation access token
    const { token } = await this.app.octokit.auth({
      type: "installation",
      installationId,
    }) as { token: string };

    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  /**
   * Create a deployment status
   */
  async createDeploymentStatus(
    installationId: number,
    owner: string,
    repo: string,
    options: {
      ref: string;
      environment: string;
      state: "pending" | "success" | "failure" | "error" | "inactive" | "in_progress" | "queued";
      description?: string;
      logUrl?: string;
      environmentUrl?: string;
    }
  ): Promise<{ deploymentId: number; statusId: number }> {
    const octokit = await this.getInstallationOctokit(installationId);

    // Create deployment
    const { data: deployment } = await octokit.repos.createDeployment({
      owner,
      repo,
      ref: options.ref,
      environment: options.environment,
      auto_merge: false,
      required_contexts: [],
    });

    if (!("id" in deployment)) {
      throw new Error("Failed to create deployment");
    }

    // Create deployment status
    const { data: status } = await octokit.repos.createDeploymentStatus({
      owner,
      repo,
      deployment_id: deployment.id,
      state: options.state,
      description: options.description,
      log_url: options.logUrl,
      environment_url: options.environmentUrl,
    });

    return {
      deploymentId: deployment.id,
      statusId: status.id,
    };
  }

  /**
   * Update a deployment status
   */
  async updateDeploymentStatus(
    installationId: number,
    owner: string,
    repo: string,
    deploymentId: number,
    options: {
      state: "pending" | "success" | "failure" | "error" | "inactive" | "in_progress" | "queued";
      description?: string;
      logUrl?: string;
      environmentUrl?: string;
    }
  ): Promise<void> {
    const octokit = await this.getInstallationOctokit(installationId);

    await octokit.repos.createDeploymentStatus({
      owner,
      repo,
      deployment_id: deploymentId,
      state: options.state,
      description: options.description,
      log_url: options.logUrl,
      environment_url: options.environmentUrl,
    });
  }

  /**
   * Parse a webhook event
   */
  parseWebhookEvent(
    event: string,
    payload: WebhookPayload
  ): {
    type: "push" | "installation" | "ping" | "other";
    installationId?: number;
    repositoryId?: number;
    repositoryFullName?: string;
    branch?: string;
    commitSha?: string;
    commitMessage?: string;
  } {
    const base = {
      installationId: payload.installation?.id,
      repositoryId: payload.repository?.id,
      repositoryFullName: payload.repository?.full_name,
    };

    switch (event) {
      case "push":
        const branch = payload.ref?.replace("refs/heads/", "");
        return {
          ...base,
          type: "push",
          branch,
          commitSha: payload.after,
          commitMessage: payload.commits?.[0]?.message,
        };

      case "installation":
      case "installation_repositories":
        return {
          ...base,
          type: "installation",
        };

      case "ping":
        return {
          ...base,
          type: "ping",
        };

      default:
        return {
          ...base,
          type: "other",
        };
    }
  }
}

// Singleton instance
let gitHubAppInstance: GitHubAppService | null = null;

/**
 * Get the GitHub App service instance
 */
export function getGitHubApp(): GitHubAppService {
  if (!gitHubAppInstance) {
    const appId = process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID;
    const privateKey = process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY;
    const webhookSecret = process.env.UNI_PROXY_MANAGER_GITHUB_WEBHOOK_SECRET;

    if (!appId || !privateKey) {
      throw new Error(
        "GitHub App configuration missing. Set UNI_PROXY_MANAGER_GITHUB_APP_ID and UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY"
      );
    }

    gitHubAppInstance = new GitHubAppService({
      appId,
      privateKey: privateKey.replace(/\\n/g, "\n"),
      webhookSecret,
    });
  }

  return gitHubAppInstance;
}

/**
 * Check if GitHub App is configured
 */
export function isGitHubAppConfigured(): boolean {
  return !!(
    process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID &&
    process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY
  );
}
