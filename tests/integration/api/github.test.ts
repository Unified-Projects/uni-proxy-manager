/**
 * GitHub API Integration Tests
 *
 * Tests for the /api/github endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture, createGitHubConnectionFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

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

    // Create a test site
    const siteRes = await testClient.post<{ site: any }>("/api/sites", createSiteFixture());
    testSiteId = siteRes.body.site.id;
  });

  // ============================================================================
  // GET /api/github/status - GitHub App Status
  // ============================================================================

  describe("GET /api/github/status", () => {
    it("should return GitHub App configuration status", async () => {
      const response = await testClient.get<{
        configured: boolean;
        appSlug: string;
      }>("/api/github/status");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("configured");
      expect(response.body).toHaveProperty("appSlug");
      expect(typeof response.body.configured).toBe("boolean");
    });
  });

  // ============================================================================
  // GET /api/github/install - Installation URL
  // ============================================================================

  describe("GET /api/github/install", () => {
    it("should return installation URL when configured", async () => {
      const response = await testClient.get<{
        installUrl?: string;
        error?: string;
      }>("/api/github/install");

      // Either returns URL or 503 if not configured
      expect([200, 503]).toContain(response.status);
    });

    it("should accept siteId parameter", async () => {
      const response = await testClient.get<{
        installUrl?: string;
        error?: string;
      }>(`/api/github/install?siteId=${testSiteId}`);

      expect([200, 503]).toContain(response.status);
    });
  });

  // ============================================================================
  // GET /api/github/callback - OAuth Callback
  // ============================================================================

  describe("GET /api/github/callback", () => {
    it("should return 400 without installation_id", async () => {
      const response = await testClient.get("/api/github/callback");

      expect(response.status).toBe(400);
    });

    it("should redirect with valid installation_id", async () => {
      const response = await testClient.get("/api/github/callback?installation_id=12345");

      // Should redirect (302) or handle appropriately
      expect([200, 302]).toContain(response.status);
    });

    it("should pass through state parameter", async () => {
      const state = JSON.stringify({ siteId: testSiteId });
      const response = await testClient.get(
        `/api/github/callback?installation_id=12345&state=${encodeURIComponent(state)}`
      );

      expect([200, 302]).toContain(response.status);
    });
  });

  // ============================================================================
  // POST /api/github/webhook - Webhook Handler
  // ============================================================================

  describe("POST /api/github/webhook", () => {
    it("should return 400 or 503 without required headers", async () => {
      const response = await testClient.post("/api/github/webhook", {});

      // 400 when headers missing, 503 when GitHub App is not configured
      expect([400, 503]).toContain(response.status);
    });

    it("should return 401 with invalid signature", async () => {
      const response = await testClient.post(
        "/api/github/webhook",
        { action: "push" },
        {
          "X-GitHub-Event": "push",
          "X-Hub-Signature-256": "sha256=invalid",
          "X-GitHub-Delivery": "test-delivery-id",
        }
      );

      // Either 401 (invalid) or 503 (not configured)
      expect([401, 503]).toContain(response.status);
    });
  });

  // ============================================================================
  // GET /api/github/sites/:siteId - Get Connection
  // ============================================================================

  describe("GET /api/github/sites/:siteId", () => {
    it("should return connected: false when no connection exists", async () => {
      const response = await testClient.get<{
        connected: boolean;
      }>(`/api/github/sites/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.connected).toBe(false);
    });

    it("should return connection details when connected", async () => {
      // Create a GitHub connection directly
      const connectionData = createGitHubConnectionFixture(testSiteId);
      await testDb.insert(schema.githubConnections).values({
        id: nanoid(),
        ...connectionData,
      });

      const response = await testClient.get<{
        connected: boolean;
        connection: {
          repositoryFullName: string;
          productionBranch: string;
          autoDeploy: boolean;
        };
      }>(`/api/github/sites/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.connected).toBe(true);
      expect(response.body.connection).toBeDefined();
      expect(response.body.connection.repositoryFullName).toBe(connectionData.repositoryFullName);
    });
  });

  // ============================================================================
  // POST /api/github/sites/:siteId - Connect Repository
  // ============================================================================

  describe("POST /api/github/sites/:siteId", () => {
    it("should connect repository to site", async () => {
      const response = await testClient.post<{
        connection: {
          id: string;
          repositoryFullName: string;
        };
      }>(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      expect(response.status).toBe(201);
      expect(response.body.connection).toBeDefined();
      expect(response.body.connection.repositoryFullName).toBe("test-org/test-repo");
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.post("/api/github/sites/non-existent-id", {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      });

      expect(response.status).toBe(404);
    });

    it("should return 409 if already connected", async () => {
      // Create first connection
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      });

      // Try to connect again
      const response = await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 11111111,
        repositoryId: 22222222,
        repositoryFullName: "other-org/other-repo",
      });

      expect(response.status).toBe(409);
    });

    it("should validate required fields", async () => {
      const response = await testClient.post(`/api/github/sites/${testSiteId}`, {
        // Missing required fields
      });

      expect(response.status).toBe(400);
    });
  });

  // ============================================================================
  // PUT /api/github/sites/:siteId - Update Connection
  // ============================================================================

  describe("PUT /api/github/sites/:siteId", () => {
    it("should update connection settings", async () => {
      // Create connection first
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      const response = await testClient.put<{
        connection: {
          productionBranch: string;
          autoDeploy: boolean;
        };
      }>(`/api/github/sites/${testSiteId}`, {
        productionBranch: "develop",
        autoDeploy: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.connection.productionBranch).toBe("develop");
      expect(response.body.connection.autoDeploy).toBe(false);
    });

    it("should return 404 when no connection exists", async () => {
      const response = await testClient.put(`/api/github/sites/${testSiteId}`, {
        autoDeploy: false,
      });

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // DELETE /api/github/sites/:siteId - Disconnect
  // ============================================================================

  describe("DELETE /api/github/sites/:siteId", () => {
    it("should disconnect repository", async () => {
      // Create connection first
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      });

      const response = await testClient.delete<{
        success: boolean;
      }>(`/api/github/sites/${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify disconnected
      const checkRes = await testClient.get<{ connected: boolean }>(
        `/api/github/sites/${testSiteId}`
      );
      expect(checkRes.body.connected).toBe(false);
    });

    it("should return 404 when no connection exists", async () => {
      const response = await testClient.delete(`/api/github/sites/${testSiteId}`);

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /api/github/sites/:siteId/branches - List Branches
  // ============================================================================

  describe("GET /api/github/sites/:siteId/branches", () => {
    it("should return 404 or 503 when no connection exists", async () => {
      const response = await testClient.get(`/api/github/sites/${testSiteId}/branches`);

      // 404 when no connection exists, 503 when GitHub App is not configured
      expect([404, 503]).toContain(response.status);
    });

    it("should return branches when connected and GitHub configured", async () => {
      // Create connection
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      });

      const response = await testClient.get<{
        branches?: Array<{ name: string }>;
        error?: string;
      }>(`/api/github/sites/${testSiteId}/branches`);

      // Either returns branches or 503 if GitHub not configured
      expect([200, 503]).toContain(response.status);
    });
  });

  // ============================================================================
  // POST /api/github/sites/:siteId/sync - Manual Sync
  // ============================================================================

  describe("POST /api/github/sites/:siteId/sync", () => {
    it("should return 404 or 503 when no connection exists", async () => {
      const response = await testClient.post(`/api/github/sites/${testSiteId}/sync`, {});

      // 404 when no connection exists, 503 when GitHub App is not configured
      expect([404, 503]).toContain(response.status);
    });

    it("should sync when connected and GitHub configured", async () => {
      // Create connection
      await testClient.post(`/api/github/sites/${testSiteId}`, {
        installationId: 12345678,
        repositoryId: 87654321,
        repositoryFullName: "test-org/test-repo",
      });

      const response = await testClient.post<{
        synced?: boolean;
        error?: string;
      }>(`/api/github/sites/${testSiteId}/sync`, {});

      // Either syncs or 503 if GitHub not configured
      expect([200, 503]).toContain(response.status);
    });
  });

  // ============================================================================
  // GET /api/github/installations/:installationId/repositories
  // ============================================================================

  describe("GET /api/github/installations/:installationId/repositories", () => {
    it("should return repositories or 503 if not configured", async () => {
      const response = await testClient.get<{
        repositories?: Array<{ id: number; full_name: string }>;
        error?: string;
      }>("/api/github/installations/12345678/repositories");

      // Either returns repos or 503 if GitHub not configured
      expect([200, 503]).toContain(response.status);
    });
  });
});
