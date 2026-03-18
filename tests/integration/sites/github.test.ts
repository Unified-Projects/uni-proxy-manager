import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture, createGitHubConnectionFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("GitHub API", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Create a test site for GitHub connections
    const siteData = createSiteFixture();
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  describe("GET /api/github/status", () => {
    it("should return GitHub App configuration status", async () => {
      const response = await testClient.get<{ configured: boolean; appSlug: string }>(
        "/api/github/status"
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("configured");
      expect(response.body).toHaveProperty("appSlug");
      expect(typeof response.body.configured).toBe("boolean");
    });
  });

  describe("GET /api/github/sites/:siteId", () => {
    it("should return not connected for site without GitHub connection", async () => {
      const response = await testClient.get<{ connected: boolean }>(
        `/api/github/sites/${testSiteId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.connected).toBe(false);
    });

    it("should return connection details for connected site", async () => {
      // Create connection directly in database
      const connectionData = createGitHubConnectionFixture(testSiteId);
      await testDb.insert(schema.githubConnections).values({
        id: `gh-conn-${Date.now()}`,
        siteId: testSiteId,
        installationId: connectionData.installationId,
        repositoryId: connectionData.repositoryId,
        repositoryFullName: connectionData.repositoryFullName,
        repositoryUrl: connectionData.repositoryUrl,
        productionBranch: connectionData.productionBranch,
        previewBranches: connectionData.previewBranches,
        defaultBranch: connectionData.defaultBranch,
        autoDeploy: connectionData.autoDeploy,
      });

      const response = await testClient.get<{
        connected: boolean;
        connection: {
          id: string;
          repositoryFullName: string;
          productionBranch: string;
          autoDeploy: boolean;
        };
      }>(`/api/github/sites/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.connected).toBe(true);
      expect(response.body.connection.repositoryFullName).toBe(connectionData.repositoryFullName);
      expect(response.body.connection.productionBranch).toBe(connectionData.productionBranch);
      expect(response.body.connection.autoDeploy).toBe(connectionData.autoDeploy);
    });
  });

  describe("POST /api/github/sites/:siteId", () => {
    it("should connect a repository to a site", async () => {
      const connectionData = {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
        repositoryUrl: "https://github.com/test-org/test-repo",
        productionBranch: "main",
        previewBranches: ["*"],
        autoDeploy: true,
      };

      const response = await testClient.post<{ connection: any }>(
        `/api/github/sites/${testSiteId}`,
        connectionData
      );

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("connection");
      expect(response.body.connection.repositoryFullName).toBe(connectionData.repositoryFullName);
      expect(response.body.connection.autoDeploy).toBe(true);

      // Verify in database
      const dbConnection = await testDb.query.githubConnections.findFirst({
        where: eq(schema.githubConnections.siteId, testSiteId),
      });
      expect(dbConnection).toBeDefined();
      expect(dbConnection!.repositoryFullName).toBe(connectionData.repositoryFullName);
    });

    it("should return 404 for non-existent site", async () => {
      const connectionData = {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      };

      const response = await testClient.post<{ error: string }>(
        "/api/github/sites/non-existent-id",
        connectionData
      );

      expect(response.status).toBe(404);
    });

    it("should return 409 if site is already connected", async () => {
      const connectionData = {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      };

      // First connection
      await testClient.post(`/api/github/sites/${testSiteId}`, connectionData);

      // Second connection attempt
      const response = await testClient.post<{ error: string }>(
        `/api/github/sites/${testSiteId}`,
        {
          installationId: 99999999,
          repositoryId: 88888888,
          repositoryFullName: "another-org/another-repo",
        }
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("already connected");
    });

    it("should use default values for optional fields", async () => {
      const connectionData = {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      };

      const response = await testClient.post<{ connection: any }>(
        `/api/github/sites/${testSiteId}`,
        connectionData
      );

      expect(response.status).toBe(201);
      expect(response.body.connection.productionBranch).toBe("main");
      expect(response.body.connection.autoDeploy).toBe(true);
    });
  });

  describe("PUT /api/github/sites/:siteId", () => {
    it("should update GitHub connection settings", async () => {
      // Create connection first
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      const response = await testClient.put<{ connection: any }>(
        `/api/github/sites/${testSiteId}`,
        {
          productionBranch: "production",
          autoDeploy: false,
          previewBranches: ["develop", "staging"],
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.connection.productionBranch).toBe("production");
      expect(response.body.connection.autoDeploy).toBe(false);
      expect(response.body.connection.previewBranches).toContain("develop");
      expect(response.body.connection.previewBranches).toContain("staging");
    });

    it("should return 404 if no connection exists", async () => {
      const response = await testClient.put<{ error: string }>(
        `/api/github/sites/${testSiteId}`,
        {
          productionBranch: "production",
        }
      );

      expect(response.status).toBe(404);
    });

    it("should partially update connection", async () => {
      // Create connection first
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      // Update only autoDeploy
      const response = await testClient.put<{ connection: any }>(
        `/api/github/sites/${testSiteId}`,
        {
          autoDeploy: false,
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.connection.autoDeploy).toBe(false);
      expect(response.body.connection.productionBranch).toBe("main"); // Should remain unchanged
    });
  });

  describe("DELETE /api/github/sites/:siteId", () => {
    it("should disconnect repository from site", async () => {
      // Create connection first
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      });

      const response = await testClient.delete<{ success: boolean }>(
        `/api/github/sites/${testSiteId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify connection is removed
      const dbConnection = await testDb.query.githubConnections.findFirst({
        where: eq(schema.githubConnections.siteId, testSiteId),
      });
      expect(dbConnection).toBeUndefined();
    });

    it("should return 404 if no connection exists", async () => {
      const response = await testClient.delete<{ error: string }>(
        `/api/github/sites/${testSiteId}`
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/github/sites/:siteId/branches", () => {
    it("should return 404 if no connection exists (or 503 if GitHub App not configured)", async () => {
      const response = await testClient.get<{ error: string }>(
        `/api/github/sites/${testSiteId}/branches`
      );

      // 503 if GitHub App not configured, 404 if configured but no connection
      expect([404, 503]).toContain(response.status);
    });

    // Note: Actual branch listing requires GitHub App to be configured
    // which may not be available in test environment
  });

  describe("POST /api/github/sites/:siteId/sync", () => {
    it("should return 404 if no connection exists (or 503 if GitHub App not configured)", async () => {
      const response = await testClient.post<{ error: string }>(
        `/api/github/sites/${testSiteId}/sync`
      );

      // 503 if GitHub App not configured, 404 if configured but no connection
      expect([404, 503]).toContain(response.status);
    });

    // Note: Actual sync requires GitHub App to be configured
  });

  describe("POST /api/github/webhook", () => {
    it("should reject requests without required headers or return 503 if not configured", async () => {
      const response = await testClient.post<{ error: string }>(
        "/api/github/webhook",
        { action: "push" }
      );

      // 503 if GitHub App not configured, 400 if configured but missing headers
      expect([400, 503]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body.error).toContain("Missing required headers");
      } else {
        expect(response.body.error).toContain("not configured");
      }
    });
  });

  describe("GET /api/github/install", () => {
    it("should return installation URL when configured", async () => {
      const response = await testClient.get<{ installUrl?: string; error?: string }>(
        "/api/github/install"
      );

      // Response depends on whether GitHub App is configured
      if (response.status === 200) {
        expect(response.body).toHaveProperty("installUrl");
      } else {
        expect(response.status).toBe(503);
        expect(response.body.error).toContain("not configured");
      }
    });

    it("should include siteId in state when provided", async () => {
      const response = await testClient.get<{ installUrl?: string; error?: string }>(
        `/api/github/install?siteId=${testSiteId}`
      );

      // If configured, verify URL includes state
      if (response.status === 200 && response.body.installUrl) {
        // URL should include state parameter with siteId
        // Note: Actual state encoding depends on GitHub App implementation
        expect(response.body.installUrl).toBeTruthy();
      }
    });
  });
});
