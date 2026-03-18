/**
 * GitHub App Service Unit Tests
 *
 * Tests for the GitHub App service utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  GitHubAppService,
  isGitHubAppConfigured,
  type GitHubAppConfig,
  type RepositoryInfo,
  type BranchInfo,
  type CommitInfo,
  type WebhookPayload,
} from "../../../../packages/shared/src/github/app";

// Mock @octokit/app
vi.mock("@octokit/app", () => ({
  App: vi.fn().mockImplementation(() => ({
    getInstallationOctokit: vi.fn().mockResolvedValue({
      apps: {
        listReposAccessibleToInstallation: vi.fn(),
      },
      repos: {
        get: vi.fn(),
        listBranches: vi.fn(),
        getCommit: vi.fn(),
        downloadTarballArchive: vi.fn(),
        createDeployment: vi.fn(),
        createDeploymentStatus: vi.fn(),
      },
    }),
    octokit: {
      auth: vi.fn().mockResolvedValue({ token: "test-token" }),
    },
  })),
}));

describe("GitHub App Service", () => {
  const testConfig: GitHubAppConfig = {
    appId: "12345",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
    webhookSecret: "whsec_test123",
    clientId: "Iv1.abc123",
    clientSecret: "secret123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any environment variables
    delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID;
    delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY;
    delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG;
  });

  // ============================================================================
  // Constructor Tests
  // ============================================================================

  describe("GitHubAppService constructor", () => {
    it("should create a new GitHubAppService instance", () => {
      const service = new GitHubAppService(testConfig);
      expect(service).toBeInstanceOf(GitHubAppService);
    });

    it("should work without webhook secret", () => {
      const configNoSecret = { ...testConfig, webhookSecret: undefined };
      const service = new GitHubAppService(configNoSecret);
      expect(service).toBeInstanceOf(GitHubAppService);
    });

    it("should work without client credentials", () => {
      const configNoClient = {
        appId: testConfig.appId,
        privateKey: testConfig.privateKey,
      };
      const service = new GitHubAppService(configNoClient);
      expect(service).toBeInstanceOf(GitHubAppService);
    });
  });

  // ============================================================================
  // Webhook Verification Tests
  // ============================================================================

  describe("verifyWebhookSignature", () => {
    it("should verify valid webhook signature", () => {
      const service = new GitHubAppService(testConfig);
      const payload = JSON.stringify({ action: "push" });
      const signature = `sha256=${createHmac("sha256", testConfig.webhookSecret!)
        .update(payload)
        .digest("hex")}`;

      expect(service.verifyWebhookSignature(payload, signature)).toBe(true);
    });

    it("should reject invalid webhook signature", () => {
      const service = new GitHubAppService(testConfig);
      const payload = JSON.stringify({ action: "push" });
      const signature = "sha256=invalid_signature";

      expect(service.verifyWebhookSignature(payload, signature)).toBe(false);
    });

    it("should return true when no webhook secret configured", () => {
      const service = new GitHubAppService({
        appId: testConfig.appId,
        privateKey: testConfig.privateKey,
      });
      const payload = JSON.stringify({ action: "push" });

      expect(service.verifyWebhookSignature(payload, "any")).toBe(true);
    });

    it("should handle malformed signature gracefully", () => {
      const service = new GitHubAppService(testConfig);
      const payload = JSON.stringify({ action: "push" });

      expect(service.verifyWebhookSignature(payload, "not-a-valid-format")).toBe(false);
    });
  });

  // ============================================================================
  // Installation URL Tests
  // ============================================================================

  describe("getInstallationUrl", () => {
    it("should return base installation URL without state", () => {
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = "test-app";
      const service = new GitHubAppService(testConfig);
      const url = service.getInstallationUrl();

      expect(url).toBe("https://github.com/apps/test-app/installations/new");
    });

    it("should include state parameter when provided", () => {
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = "test-app";
      const service = new GitHubAppService(testConfig);
      const url = service.getInstallationUrl("site-123");

      expect(url).toBe("https://github.com/apps/test-app/installations/new?state=site-123");
    });

    it("should URL encode state parameter", () => {
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_SLUG = "test-app";
      const service = new GitHubAppService(testConfig);
      const url = service.getInstallationUrl("site with spaces");

      expect(url).toContain("state=site%20with%20spaces");
    });

    it("should use default slug when not set", () => {
      const service = new GitHubAppService(testConfig);
      const url = service.getInstallationUrl();

      expect(url).toBe("https://github.com/apps/uni-proxy-manager/installations/new");
    });
  });

  // ============================================================================
  // Webhook Event Parsing Tests
  // ============================================================================

  describe("parseWebhookEvent", () => {
    const service = new GitHubAppService(testConfig);

    it("should parse push event", () => {
      const payload: WebhookPayload = {
        action: "push",
        repository: {
          id: 123,
          full_name: "org/repo",
          default_branch: "main",
        },
        installation: { id: 456 },
        ref: "refs/heads/main",
        after: "abc123",
        commits: [{ id: "abc123", message: "feat: new feature", author: { name: "Test", email: "test@example.com" } }],
      };

      const result = service.parseWebhookEvent("push", payload);

      expect(result.type).toBe("push");
      expect(result.branch).toBe("main");
      expect(result.commitSha).toBe("abc123");
      expect(result.commitMessage).toBe("feat: new feature");
      expect(result.installationId).toBe(456);
      expect(result.repositoryId).toBe(123);
      expect(result.repositoryFullName).toBe("org/repo");
    });

    it("should parse installation event", () => {
      const payload: WebhookPayload = {
        action: "created",
        installation: { id: 789 },
        repository: {
          id: 123,
          full_name: "org/repo",
          default_branch: "main",
        },
      };

      const result = service.parseWebhookEvent("installation", payload);

      expect(result.type).toBe("installation");
      expect(result.installationId).toBe(789);
    });

    it("should parse installation_repositories event", () => {
      const payload: WebhookPayload = {
        action: "added",
        installation: { id: 789 },
      };

      const result = service.parseWebhookEvent("installation_repositories", payload);

      expect(result.type).toBe("installation");
    });

    it("should parse ping event", () => {
      const payload: WebhookPayload = {
        installation: { id: 123 },
      };

      const result = service.parseWebhookEvent("ping", payload);

      expect(result.type).toBe("ping");
    });

    it("should handle unknown event type", () => {
      const payload: WebhookPayload = {
        action: "unknown",
        installation: { id: 123 },
      };

      const result = service.parseWebhookEvent("unknown_event", payload);

      expect(result.type).toBe("other");
    });

    it("should extract branch from refs/heads/ prefix", () => {
      const payload: WebhookPayload = {
        ref: "refs/heads/feature/new-feature",
        after: "def456",
        installation: { id: 123 },
      };

      const result = service.parseWebhookEvent("push", payload);

      expect(result.branch).toBe("feature/new-feature");
    });
  });

  // ============================================================================
  // Configuration Check Tests
  // ============================================================================

  describe("isGitHubAppConfigured", () => {
    it("should return true when both app ID and private key are set", () => {
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID = "12345";
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY = "private-key";

      expect(isGitHubAppConfigured()).toBe(true);
    });

    it("should return false when app ID is missing", () => {
      delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID;
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY = "private-key";

      expect(isGitHubAppConfigured()).toBe(false);
    });

    it("should return false when private key is missing", () => {
      process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID = "12345";
      delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY;

      expect(isGitHubAppConfigured()).toBe(false);
    });

    it("should return false when both are missing", () => {
      delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_ID;
      delete process.env.UNI_PROXY_MANAGER_GITHUB_APP_PRIVATE_KEY;

      expect(isGitHubAppConfigured()).toBe(false);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("RepositoryInfo type", () => {
    it("should have all required fields", () => {
      const repo: RepositoryInfo = {
        id: 123456,
        fullName: "org/repo",
        name: "repo",
        owner: "org",
        defaultBranch: "main",
        private: true,
        url: "https://github.com/org/repo",
        cloneUrl: "https://github.com/org/repo.git",
      };

      expect(repo.id).toBe(123456);
      expect(repo.fullName).toBe("org/repo");
      expect(repo.private).toBe(true);
    });
  });

  describe("BranchInfo type", () => {
    it("should have all required fields", () => {
      const branch: BranchInfo = {
        name: "main",
        sha: "abc123def456",
        protected: true,
      };

      expect(branch.name).toBe("main");
      expect(branch.sha).toBe("abc123def456");
      expect(branch.protected).toBe(true);
    });
  });

  describe("CommitInfo type", () => {
    it("should have all required fields", () => {
      const commit: CommitInfo = {
        sha: "abc123def456789",
        message: "feat: add new feature",
        author: {
          name: "Test Author",
          email: "test@example.com",
          date: "2024-01-15T10:00:00Z",
        },
        url: "https://github.com/org/repo/commit/abc123",
      };

      expect(commit.sha).toBe("abc123def456789");
      expect(commit.author.name).toBe("Test Author");
    });
  });
});
