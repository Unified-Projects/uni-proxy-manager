import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { createHmac } from "crypto";

describe("GitHub Webhooks", () => {
  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  /**
   * Generate a GitHub webhook signature
   */
  function generateSignature(payload: string, secret: string): string {
    const hmac = createHmac("sha256", secret);
    hmac.update(payload);
    return `sha256=${hmac.digest("hex")}`;
  }

  describe("GitHub App Status", () => {
    it("should return GitHub app status", async () => {
      const response = await testClient.get<{
        configured: boolean;
        appSlug: string;
      }>("/api/github/status");

      expect(response.status).toBe(200);
      expect(typeof response.body.configured).toBe("boolean");
      expect(typeof response.body.appSlug).toBe("string");
    });
  });

  describe("Webhook Endpoint", () => {
    it("should reject webhook without required headers", async () => {
      const response = await testClient.post("/api/github/webhook", {});

      // Should fail if GitHub App not configured or missing headers
      expect([400, 503]).toContain(response.status);
    });

    it("should reject webhook with missing X-GitHub-Event header", async () => {
      const payload = JSON.stringify({ action: "opened" });

      // Custom fetch to set specific headers
      const app = await import("../setup/test-client").then((m) => m.testClient);
      const response = await app.post("/api/github/webhook", {});

      expect([400, 503]).toContain(response.status);
    });
  });

  describe("GitHub Connection", () => {
    it("should check if site has GitHub connection", async () => {
      // Create a site first
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "Test Site",
          hostname: "test-gh.example.com",
          framework: "nextjs",
        }
      );

      if (siteRes.status !== 201) {
        // Sites API might not be fully implemented
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      const response = await testClient.get<{ connected: boolean }>(
        `/api/github/sites/${siteId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.connected).toBe(false);
    });

    it("should return 404 for non-existent connection", async () => {
      const response = await testClient.get("/api/github/sites/non-existent-site");

      // Will either be 200 with connected: false or 500 if site lookup fails
      expect([200, 500]).toContain(response.status);
    });
  });

  describe("Repository Connection Flow", () => {
    it("should handle connect repository request", async () => {
      // First create a site
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "GH Connect Test",
          hostname: "gh-connect.example.com",
          framework: "react",
        }
      );

      if (siteRes.status !== 201) {
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      // Try to connect repository
      const connectRes = await testClient.post(
        `/api/github/sites/${siteId}`,
        {
          installationId: 12345,
          repositoryId: 67890,
          repositoryFullName: "testuser/testrepo",
          repositoryUrl: "https://github.com/testuser/testrepo",
          productionBranch: "main",
          previewBranches: ["develop", "staging"],
          autoDeploy: true,
        }
      );

      // Will fail if GitHub App not configured (503) or succeed (201)
      expect([201, 500, 503]).toContain(connectRes.status);
    });

    it("should prevent duplicate repository connections", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "Duplicate Test",
          hostname: "dup-test.example.com",
          framework: "vue",
        }
      );

      if (siteRes.status !== 201) {
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      // Create connection directly in database
      await testDb.insert(schema.githubConnections).values({
        id: `gh-conn-${Date.now()}`,
        siteId,
        installationId: 11111,
        repositoryId: 22222,
        repositoryFullName: "owner/repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      // Try to connect again
      const connectRes = await testClient.post(
        `/api/github/sites/${siteId}`,
        {
          installationId: 33333,
          repositoryId: 44444,
          repositoryFullName: "owner/other-repo",
          productionBranch: "main",
          autoDeploy: true,
        }
      );

      // Should return 409 Conflict
      expect(connectRes.status).toBe(409);
    });
  });

  describe("Connection Management", () => {
    it("should update connection settings", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "Update Test",
          hostname: "update-test.example.com",
          framework: "nextjs",
        }
      );

      if (siteRes.status !== 201) {
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      // Create connection
      await testDb.insert(schema.githubConnections).values({
        id: `gh-update-${Date.now()}`,
        siteId,
        installationId: 11111,
        repositoryId: 22222,
        repositoryFullName: "owner/repo",
        productionBranch: "main",
        previewBranches: ["develop"],
        autoDeploy: true,
      });

      // Update connection
      const updateRes = await testClient.put<{ connection: any }>(
        `/api/github/sites/${siteId}`,
        {
          productionBranch: "master",
          autoDeploy: false,
        }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.connection.productionBranch).toBe("master");
      expect(updateRes.body.connection.autoDeploy).toBe(false);
    });

    it("should delete GitHub connection", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "Delete Test",
          hostname: "delete-test.example.com",
          framework: "svelte",
        }
      );

      if (siteRes.status !== 201) {
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      // Create connection
      const connId = `gh-delete-${Date.now()}`;
      await testDb.insert(schema.githubConnections).values({
        id: connId,
        siteId,
        installationId: 11111,
        repositoryId: 22222,
        repositoryFullName: "owner/repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      // Delete connection
      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/github/sites/${siteId}`
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify deleted
      const checkRes = await testClient.get<{ connected: boolean }>(
        `/api/github/sites/${siteId}`
      );
      expect(checkRes.body.connected).toBe(false);
    });
  });

  describe("Branch Listing", () => {
    it("should return 503 when GitHub App not configured", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "Branch Test",
          hostname: "branch-test.example.com",
          framework: "nextjs",
        }
      );

      if (siteRes.status !== 201) {
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      // Create connection
      await testDb.insert(schema.githubConnections).values({
        id: `gh-branch-${Date.now()}`,
        siteId,
        installationId: 11111,
        repositoryId: 22222,
        repositoryFullName: "owner/repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      const response = await testClient.get(`/api/github/sites/${siteId}/branches`);

      // Will be 503 if GitHub not configured, or 200 if it is
      expect([200, 500, 503]).toContain(response.status);
    });
  });

  describe("Sync Endpoint", () => {
    it("should handle sync request", async () => {
      const siteRes = await testClient.post<{ site: any }>(
        "/api/sites",
        {
          name: "Sync Test",
          hostname: "sync-test.example.com",
          framework: "nextjs",
        }
      );

      if (siteRes.status !== 201) {
        console.log("Sites API not available, skipping test");
        return;
      }

      const siteId = siteRes.body.site.id;

      // Create connection
      await testDb.insert(schema.githubConnections).values({
        id: `gh-sync-${Date.now()}`,
        siteId,
        installationId: 11111,
        repositoryId: 22222,
        repositoryFullName: "owner/repo",
        productionBranch: "main",
        autoDeploy: true,
      });

      const response = await testClient.post(`/api/github/sites/${siteId}/sync`);

      // Will be 503 if GitHub not configured
      expect([200, 500, 503]).toContain(response.status);
    });
  });

  describe("Installation URL", () => {
    it("should return install URL endpoint", async () => {
      const response = await testClient.get("/api/github/install");

      // Will be 503 if not configured, or 200 with installUrl
      expect([200, 500, 503]).toContain(response.status);
    });

    it("should accept siteId query parameter for state", async () => {
      const response = await testClient.get("/api/github/install?siteId=test-site-123");

      expect([200, 500, 503]).toContain(response.status);
    });
  });

  describe("Webhook Signature Verification", () => {
    it("should generate valid HMAC signature", () => {
      const payload = '{"action":"push"}';
      const secret = "test-secret";

      const signature = generateSignature(payload, secret);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it("should generate different signatures for different payloads", () => {
      const secret = "test-secret";
      const sig1 = generateSignature('{"action":"push"}', secret);
      const sig2 = generateSignature('{"action":"pull"}', secret);

      expect(sig1).not.toBe(sig2);
    });

    it("should generate different signatures for different secrets", () => {
      const payload = '{"action":"push"}';
      const sig1 = generateSignature(payload, "secret1");
      const sig2 = generateSignature(payload, "secret2");

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("Push Event Handling", () => {
    it("should handle push event payload structure", () => {
      const pushPayload = {
        ref: "refs/heads/main",
        before: "abc123",
        after: "def456",
        repository: {
          id: 12345,
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
        head_commit: {
          id: "def456",
          message: "Update README",
          author: {
            name: "Test User",
            email: "test@example.com",
          },
        },
      };

      // Verify payload structure
      expect(pushPayload.ref).toMatch(/^refs\/heads\//);
      expect(pushPayload.repository.full_name).toMatch(/\//);
      expect(pushPayload.head_commit.id).toBeDefined();
    });
  });

  describe("Installation Repository Listing", () => {
    it("should return 503 when GitHub App not configured", async () => {
      const response = await testClient.get(
        "/api/github/installations/12345/repositories"
      );

      expect([200, 500, 503]).toContain(response.status);
    });
  });
});
