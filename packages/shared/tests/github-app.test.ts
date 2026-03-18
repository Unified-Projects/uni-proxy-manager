import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Use vi.hoisted() to create shared mock values available to vi.mock factories.
// IMPORTANT: do NOT call .mockImplementation(fn) inside vi.hoisted() - Vitest's
// transform reduces `vi.fn().mockImplementation(fn)` to just `fn` in that
// context. Set implementations as separate module-level statements instead.
const { mockOctokit, mockGetInstallationOctokit, mockAuth } = vi.hoisted(() => {
  const octokit = {
    apps: { listReposAccessibleToInstallation: vi.fn() },
    repos: {
      get: vi.fn(),
      listBranches: vi.fn(),
      getCommit: vi.fn(),
      downloadTarballArchive: vi.fn(),
      createDeployment: vi.fn(),
      createDeploymentStatus: vi.fn(),
    },
  };
  return {
    mockOctokit: octokit,
    mockGetInstallationOctokit: vi.fn(),
    mockAuth: vi.fn(),
  };
});

vi.mock("@octokit/app", () => ({
  App: vi.fn(function () {
    return {
      getInstallationOctokit: mockGetInstallationOctokit,
      octokit: { auth: mockAuth },
    };
  }),
  Octokit: vi.fn(),
}));

// Import after mocking
import { GitHubAppService, isGitHubAppConfigured } from "../src/github/app";

const mockConfig = {
  appId: "12345",
  privateKey: `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0vN...
-----END RSA PRIVATE KEY-----`,
  webhookSecret: "webhook-secret-123",
};

describe("GitHubAppService", () => {
  let service: GitHubAppService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset mock implementations
    mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
    mockAuth.mockResolvedValue({ token: "ghs_test123" });

    service = new GitHubAppService(mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("verifyWebhookSignature", () => {
    it("returns true for valid signature", () => {
      const payload = '{"action":"push"}';
      const validSignature = `sha256=${crypto
        .createHmac("sha256", "webhook-secret-123")
        .update(payload)
        .digest("hex")}`;

      const result = service.verifyWebhookSignature(payload, validSignature);

      expect(result).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const payload = '{"action":"push"}';
      const invalidSignature = "sha256=invalid";

      const result = service.verifyWebhookSignature(payload, invalidSignature);

      expect(result).toBe(false);
    });

    it("returns true when no webhook secret configured", () => {
      const serviceNoSecret = new GitHubAppService({
        appId: "12345",
        privateKey: mockConfig.privateKey,
      });

      const result = serviceNoSecret.verifyWebhookSignature("payload", "any-sig");

      expect(result).toBe(true);
    });
  });

  describe("getInstallationUrl", () => {
    it("returns installation URL without state", () => {
      const originalEnv = process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG;
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = "my-app";

      const url = service.getInstallationUrl();

      expect(url).toBe("https://github.com/apps/my-app/installations/new");

      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = originalEnv;
    });

    it("returns installation URL with state", () => {
      const originalEnv = process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG;
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = "my-app";

      const url = service.getInstallationUrl("site-123");

      expect(url).toContain("state=site-123");

      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = originalEnv;
    });
  });

  describe("listRepositories", () => {
    it("returns list of repositories", async () => {
      mockOctokit.apps.listReposAccessibleToInstallation.mockResolvedValueOnce({
        data: {
          repositories: [
            {
              id: 1,
              full_name: "owner/repo1",
              name: "repo1",
              owner: { login: "owner" },
              default_branch: "main",
              private: false,
              html_url: "https://github.com/owner/repo1",
              clone_url: "https://github.com/owner/repo1.git",
            },
            {
              id: 2,
              full_name: "owner/repo2",
              name: "repo2",
              owner: { login: "owner" },
              default_branch: "master",
              private: true,
              html_url: "https://github.com/owner/repo2",
              clone_url: "https://github.com/owner/repo2.git",
            },
          ],
        },
      });

      const repos = await service.listRepositories(12345);

      expect(repos).toHaveLength(2);
      expect(repos[0]).toEqual({
        id: 1,
        fullName: "owner/repo1",
        name: "repo1",
        owner: "owner",
        defaultBranch: "main",
        private: false,
        url: "https://github.com/owner/repo1",
        cloneUrl: "https://github.com/owner/repo1.git",
      });
    });
  });

  describe("getRepository", () => {
    it("returns repository info", async () => {
      mockOctokit.repos.get.mockResolvedValueOnce({
        data: {
          id: 1,
          full_name: "owner/repo",
          name: "repo",
          owner: { login: "owner" },
          default_branch: "main",
          private: false,
          html_url: "https://github.com/owner/repo",
          clone_url: "https://github.com/owner/repo.git",
        },
      });

      const repo = await service.getRepository(12345, "owner", "repo");

      expect(repo.fullName).toBe("owner/repo");
      expect(repo.defaultBranch).toBe("main");
    });
  });

  describe("listBranches", () => {
    it("returns list of branches", async () => {
      mockOctokit.repos.listBranches.mockResolvedValueOnce({
        data: [
          { name: "main", commit: { sha: "abc123" }, protected: true },
          { name: "develop", commit: { sha: "def456" }, protected: false },
        ],
      });

      const branches = await service.listBranches(12345, "owner", "repo");

      expect(branches).toHaveLength(2);
      expect(branches[0]).toEqual({
        name: "main",
        sha: "abc123",
        protected: true,
      });
    });
  });

  describe("getCommit", () => {
    it("returns commit info", async () => {
      mockOctokit.repos.getCommit.mockResolvedValueOnce({
        data: {
          sha: "abc123def456",
          commit: {
            message: "feat: add new feature",
            author: {
              name: "John Doe",
              email: "john@example.com",
              date: "2024-01-15T10:00:00Z",
            },
          },
          html_url: "https://github.com/owner/repo/commit/abc123",
        },
      });

      const commit = await service.getCommit(12345, "owner", "repo", "abc123");

      expect(commit.sha).toBe("abc123def456");
      expect(commit.message).toBe("feat: add new feature");
      expect(commit.author.name).toBe("John Doe");
    });

    it("handles missing author", async () => {
      mockOctokit.repos.getCommit.mockResolvedValueOnce({
        data: {
          sha: "abc123",
          commit: {
            message: "commit",
            author: null,
          },
          html_url: "https://github.com/owner/repo/commit/abc123",
        },
      });

      const commit = await service.getCommit(12345, "owner", "repo", "abc123");

      expect(commit.author.name).toBe("Unknown");
      expect(commit.author.email).toBe("");
    });
  });

  describe("getLatestCommit", () => {
    it("calls getCommit with branch name", async () => {
      mockOctokit.repos.getCommit.mockResolvedValueOnce({
        data: {
          sha: "latest123",
          commit: {
            message: "latest commit",
            author: { name: "Author", email: "a@b.com", date: "2024-01-15T10:00:00Z" },
          },
          html_url: "https://github.com/owner/repo/commit/latest123",
        },
      });

      const commit = await service.getLatestCommit(12345, "owner", "repo", "main");

      expect(mockOctokit.repos.getCommit).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "main",
      });
      expect(commit.sha).toBe("latest123");
    });
  });

  describe("downloadArchive", () => {
    it("downloads repository tarball", async () => {
      const mockBuffer = new ArrayBuffer(1024);
      mockOctokit.repos.downloadTarballArchive.mockResolvedValueOnce({
        data: mockBuffer,
      });

      const result = await service.downloadArchive(12345, "owner", "repo", "abc123");

      expect(mockOctokit.repos.downloadTarballArchive).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "abc123",
      });
      expect(result).toBe(mockBuffer);
    });
  });

  describe("getAuthenticatedCloneUrl", () => {
    it("returns URL with access token", async () => {
      const url = await service.getAuthenticatedCloneUrl(12345, "owner", "repo");

      expect(url).toBe("https://x-access-token:ghs_test123@github.com/owner/repo.git");
    });
  });

  describe("createDeploymentStatus", () => {
    it("creates deployment and status", async () => {
      mockOctokit.repos.createDeployment.mockResolvedValueOnce({
        data: { id: 100 },
      });
      mockOctokit.repos.createDeploymentStatus.mockResolvedValueOnce({
        data: { id: 200 },
      });

      const result = await service.createDeploymentStatus(12345, "owner", "repo", {
        ref: "abc123",
        environment: "production",
        state: "success",
        description: "Deployment complete",
        logUrl: "https://logs.example.com",
        environmentUrl: "https://app.example.com",
      });

      expect(mockOctokit.repos.createDeployment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "abc123",
        environment: "production",
        auto_merge: false,
        required_contexts: [],
      });

      expect(result.deploymentId).toBe(100);
      expect(result.statusId).toBe(200);
    });

    it("throws when deployment creation fails", async () => {
      mockOctokit.repos.createDeployment.mockResolvedValueOnce({
        data: { message: "Conflict" },
      });

      await expect(
        service.createDeploymentStatus(12345, "owner", "repo", {
          ref: "abc123",
          environment: "production",
          state: "pending",
        })
      ).rejects.toThrow("Failed to create deployment");
    });
  });

  describe("updateDeploymentStatus", () => {
    it("updates deployment status", async () => {
      mockOctokit.repos.createDeploymentStatus.mockResolvedValueOnce({});

      await service.updateDeploymentStatus(12345, "owner", "repo", 100, {
        state: "success",
        description: "Done",
      });

      expect(mockOctokit.repos.createDeploymentStatus).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        deployment_id: 100,
        state: "success",
        description: "Done",
        log_url: undefined,
        environment_url: undefined,
      });
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses push event", () => {
      const result = service.parseWebhookEvent("push", {
        installation: { id: 12345 },
        repository: { id: 1, full_name: "owner/repo", default_branch: "main" },
        ref: "refs/heads/main",
        after: "abc123",
        commits: [{ id: "abc123", message: "feat: update", author: { name: "Dev", email: "dev@example.com" } }],
      });

      expect(result.type).toBe("push");
      expect(result.branch).toBe("main");
      expect(result.commitSha).toBe("abc123");
      expect(result.commitMessage).toBe("feat: update");
    });

    it("parses installation event", () => {
      const result = service.parseWebhookEvent("installation", {
        installation: { id: 12345 },
        action: "created",
      });

      expect(result.type).toBe("installation");
      expect(result.installationId).toBe(12345);
    });

    it("parses ping event", () => {
      const result = service.parseWebhookEvent("ping", {
        repository: { id: 1, full_name: "owner/repo", default_branch: "main" },
      });

      expect(result.type).toBe("ping");
    });

    it("returns other for unknown events", () => {
      const result = service.parseWebhookEvent("star", {
        action: "created",
      });

      expect(result.type).toBe("other");
    });
  });
});

describe("isGitHubAppConfigured", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns true when both app ID and private key are set", () => {
    process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID = "12345";
    process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY = "private-key";

    expect(isGitHubAppConfigured()).toBe(true);
  });

  it("returns false when app ID is missing", () => {
    delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID;
    process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY = "private-key";

    expect(isGitHubAppConfigured()).toBe(false);
  });

  it("returns false when private key is missing", () => {
    process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID = "12345";
    delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY;

    expect(isGitHubAppConfigured()).toBe(false);
  });
});
