/**
 * GitHub Connections Schema Unit Tests
 *
 * Tests for the GitHub connections database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  githubConnections,
  type GitHubConnection,
  type NewGitHubConnection,
} from "../../../../../packages/database/src/schema/github-connections";

describe("GitHub Connections Schema", () => {
  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("githubConnections table", () => {
    it("should have id as primary key", () => {
      const idColumn = githubConnections.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have siteId as required unique field", () => {
      const siteIdColumn = githubConnections.siteId;
      expect(siteIdColumn.name).toBe("site_id");
      expect(siteIdColumn.notNull).toBe(true);
    });

    it("should have installationId as required field", () => {
      const installationIdColumn = githubConnections.installationId;
      expect(installationIdColumn.name).toBe("installation_id");
      expect(installationIdColumn.notNull).toBe(true);
    });

    it("should have repositoryId as required field", () => {
      const repositoryIdColumn = githubConnections.repositoryId;
      expect(repositoryIdColumn.name).toBe("repository_id");
      expect(repositoryIdColumn.notNull).toBe(true);
    });

    it("should have repositoryFullName as required field", () => {
      const repositoryFullNameColumn = githubConnections.repositoryFullName;
      expect(repositoryFullNameColumn.name).toBe("repository_full_name");
      expect(repositoryFullNameColumn.notNull).toBe(true);
    });

    it("should have repositoryUrl as optional field", () => {
      const repositoryUrlColumn = githubConnections.repositoryUrl;
      expect(repositoryUrlColumn.name).toBe("repository_url");
      expect(repositoryUrlColumn.notNull).toBe(false);
    });

    it("should have defaultBranch with default main", () => {
      const defaultBranchColumn = githubConnections.defaultBranch;
      expect(defaultBranchColumn.name).toBe("default_branch");
      expect(defaultBranchColumn.hasDefault).toBe(true);
    });

    it("should have productionBranch with default main", () => {
      const productionBranchColumn = githubConnections.productionBranch;
      expect(productionBranchColumn.name).toBe("production_branch");
      expect(productionBranchColumn.hasDefault).toBe(true);
    });

    it("should have previewBranches as JSONB field", () => {
      const previewBranchesColumn = githubConnections.previewBranches;
      expect(previewBranchesColumn.name).toBe("preview_branches");
      expect(previewBranchesColumn.dataType).toBe("json");
    });

    it("should have autoDeploy with default true", () => {
      const autoDeployColumn = githubConnections.autoDeploy;
      expect(autoDeployColumn.name).toBe("auto_deploy");
      expect(autoDeployColumn.notNull).toBe(true);
      expect(autoDeployColumn.hasDefault).toBe(true);
    });

    it("should have webhook fields", () => {
      expect(githubConnections.webhookId.name).toBe("webhook_id");
      expect(githubConnections.webhookSecret.name).toBe("webhook_secret");
      expect(githubConnections.webhookId.notNull).toBe(false);
      expect(githubConnections.webhookSecret.notNull).toBe(false);
    });

    it("should have access token fields", () => {
      expect(githubConnections.accessToken.name).toBe("access_token");
      expect(githubConnections.tokenExpiresAt.name).toBe("token_expires_at");
      expect(githubConnections.accessToken.notNull).toBe(false);
      expect(githubConnections.tokenExpiresAt.notNull).toBe(false);
    });

    it("should have last sync fields", () => {
      expect(githubConnections.lastSyncAt.name).toBe("last_sync_at");
      expect(githubConnections.lastCommitSha.name).toBe("last_commit_sha");
      expect(githubConnections.lastSyncAt.notNull).toBe(false);
      expect(githubConnections.lastCommitSha.notNull).toBe(false);
    });

    it("should have timestamps", () => {
      expect(githubConnections.createdAt.name).toBe("created_at");
      expect(githubConnections.updatedAt.name).toBe("updated_at");
      expect(githubConnections.createdAt.notNull).toBe(true);
      expect(githubConnections.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("GitHubConnection types", () => {
    it("should export GitHubConnection select type", () => {
      const connection: GitHubConnection = {
        id: "gh-conn-1",
        siteId: "site-1",
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "org/repo",
        repositoryUrl: "https://github.com/org/repo",
        defaultBranch: "main",
        productionBranch: "main",
        previewBranches: ["develop", "feature/*"],
        autoDeploy: true,
        webhookId: 11111111,
        webhookSecret: "whsec_secret123",
        accessToken: "ghs_token123",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        lastSyncAt: new Date(),
        lastCommitSha: "abc123def456",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(connection.id).toBe("gh-conn-1");
      expect(connection.repositoryFullName).toBe("org/repo");
      expect(connection.installationId).toBe(12345678);
    });

    it("should export NewGitHubConnection insert type with minimal fields", () => {
      const newConnection: NewGitHubConnection = {
        id: "gh-conn-1",
        siteId: "site-1",
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "org/repo",
      };

      expect(newConnection.id).toBe("gh-conn-1");
      expect(newConnection.siteId).toBe("site-1");
      expect(newConnection.repositoryFullName).toBe("org/repo");
    });

    it("should handle connection with preview branches", () => {
      const connection: Partial<GitHubConnection> = {
        productionBranch: "main",
        previewBranches: ["develop", "staging", "feature/*"],
        autoDeploy: true,
      };

      expect(connection.previewBranches).toHaveLength(3);
      expect(connection.previewBranches).toContain("feature/*");
    });

    it("should handle connection with wildcard preview branches", () => {
      const connection: Partial<GitHubConnection> = {
        previewBranches: ["*"], // All branches get previews
      };

      expect(connection.previewBranches).toContain("*");
    });

    it("should handle connection with token expiry", () => {
      const expiryDate = new Date(Date.now() + 3600000);
      const connection: Partial<GitHubConnection> = {
        accessToken: "ghs_token123",
        tokenExpiresAt: expiryDate,
      };

      expect(connection.tokenExpiresAt).toEqual(expiryDate);
    });

    it("should handle connection with sync info", () => {
      const connection: Partial<GitHubConnection> = {
        lastSyncAt: new Date(),
        lastCommitSha: "abc123def456789012345678901234567890abcd",
      };

      expect(connection.lastCommitSha).toHaveLength(40);
      expect(connection.lastSyncAt).toBeDefined();
    });

    it("should handle connection without auto deploy", () => {
      const connection: Partial<GitHubConnection> = {
        autoDeploy: false,
        webhookId: null,
        webhookSecret: null,
      };

      expect(connection.autoDeploy).toBe(false);
    });
  });
});
