/**
 * Deployments API Integration Tests
 *
 * Comprehensive tests for deployment-related endpoints.
 *
 * API Routes:
 * Sites routes:
 * - POST /api/sites/:id/deploy - Trigger deployment (requires source)
 * - POST /api/sites/:id/upload - Upload ZIP and deploy
 * - POST /api/sites/:id/rollback/:deploymentId - Rollback to previous deployment
 *
 * Deployment routes:
 * - GET /api/deployments - List deployments (with optional siteId filter)
 * - GET /api/deployments/:id - Get single deployment
 * - GET /api/deployments/:id/logs - Get deployment logs
 * - POST /api/deployments/:id/cancel - Cancel in-progress deployment
 * - POST /api/deployments/:id/retry - Retry failed deployment
 * - POST /api/deployments/:id/redeploy - Redeploy existing deployment
 * - POST /api/deployments/:id/promote - Promote deployment to production
 * - DELETE /api/deployments/:id - Delete deployment
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../../setup/test-db";
import { clearRedisQueues } from "../../setup/test-redis";
import { createSiteFixture } from "../../setup/fixtures";
import * as schema from "../../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Deployments API", () => {
  let testSiteId: string;

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

    // Create a site for deployment tests
    const siteRes = await testClient.post("/api/sites", createSiteFixture());
    testSiteId = siteRes.body.site.id;
  });

  /**
   * Helper to create a deployment directly in the database
   * (since we can't trigger real builds in tests)
   */
  async function createDeploymentInDb(
    siteId: string,
    overrides: Partial<{
      status: string;
      version: number;
      slot: string;
      branch: string;
      isActive: boolean;
      artifactPath: string;
      buildLogs: string;
    }> = {}
  ) {
    const deploymentId = nanoid();
    const [deployment] = await testDb
      .insert(schema.deployments)
      .values({
        id: deploymentId,
        siteId,
        version: overrides.version ?? 1,
        slot: (overrides.slot as "blue" | "green") ?? "blue",
        branch: overrides.branch ?? "main",
        status: (overrides.status as any) ?? "pending",
        triggeredBy: "manual",
        isActive: overrides.isActive ?? false,
        artifactPath: overrides.artifactPath,
        buildLogs: overrides.buildLogs,
      })
      .returning();
    return deployment;
  }

  // ============================================================================
  // POST /api/sites/:id/deploy - Trigger Deployment
  // ============================================================================

  describe("POST /api/sites/:id/deploy", () => {
    it("should return error when no source available", async () => {
      const response = await testClient.post(`/api/sites/${testSiteId}/deploy`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("No source available");
      expect(response.body.hint).toBeDefined();
    });

    it("should return 404 for non-existent site", async () => {
      const response = await testClient.post("/api/sites/nonexistent-id/deploy");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /api/deployments - List Deployments
  // ============================================================================

  describe("GET /api/deployments", () => {
    it("should return empty array when no deployments exist", async () => {
      const response = await testClient.get("/api/deployments");

      expect(response.status).toBe(200);
      expect(response.body.deployments).toEqual([]);
    });

    it("should list all deployments", async () => {
      await createDeploymentInDb(testSiteId, { version: 1, status: "pending" });
      await createDeploymentInDb(testSiteId, { version: 2, status: "live" });
      await createDeploymentInDb(testSiteId, { version: 3, status: "failed" });

      const response = await testClient.get("/api/deployments");

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(3);
    });

    it("should filter deployments by siteId", async () => {
      // Create another site
      const otherSiteRes = await testClient.post("/api/sites", createSiteFixture());
      const otherSiteId = otherSiteRes.body.site.id;

      await createDeploymentInDb(testSiteId, { version: 1 });
      await createDeploymentInDb(testSiteId, { version: 2 });
      await createDeploymentInDb(otherSiteId, { version: 1 });

      const response = await testClient.get(`/api/deployments?siteId=${testSiteId}`);

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(2);
      expect(response.body.deployments.every((d: any) => d.siteId === testSiteId)).toBe(true);
    });

    it("should respect limit parameter", async () => {
      await createDeploymentInDb(testSiteId, { version: 1 });
      await createDeploymentInDb(testSiteId, { version: 2 });
      await createDeploymentInDb(testSiteId, { version: 3 });
      await createDeploymentInDb(testSiteId, { version: 4 });
      await createDeploymentInDb(testSiteId, { version: 5 });

      const response = await testClient.get("/api/deployments?limit=3");

      expect(response.status).toBe(200);
      expect(response.body.deployments).toHaveLength(3);
    });

    it("should respect offset parameter", async () => {
      await createDeploymentInDb(testSiteId, { version: 1 });
      await createDeploymentInDb(testSiteId, { version: 2 });
      await createDeploymentInDb(testSiteId, { version: 3 });

      const allResponse = await testClient.get("/api/deployments");
      const offsetResponse = await testClient.get("/api/deployments?offset=1");

      expect(offsetResponse.status).toBe(200);
      expect(offsetResponse.body.deployments).toHaveLength(2);
    });

    it("should order deployments by createdAt descending", async () => {
      await createDeploymentInDb(testSiteId, { version: 1 });
      await new Promise((r) => setTimeout(r, 10)); // Small delay to ensure different timestamps
      await createDeploymentInDb(testSiteId, { version: 2 });
      await new Promise((r) => setTimeout(r, 10));
      await createDeploymentInDb(testSiteId, { version: 3 });

      const response = await testClient.get("/api/deployments");

      expect(response.status).toBe(200);
      expect(response.body.deployments[0].version).toBe(3);
      expect(response.body.deployments[2].version).toBe(1);
    });
  });

  // ============================================================================
  // GET /api/deployments/:id - Get Single Deployment
  // ============================================================================

  describe("GET /api/deployments/:id", () => {
    it("should return deployment with site info", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        version: 1,
        status: "live",
        branch: "main",
      });

      const response = await testClient.get(`/api/deployments/${deployment.id}`);

      expect(response.status).toBe(200);
      expect(response.body.deployment.id).toBe(deployment.id);
      expect(response.body.deployment.siteId).toBe(testSiteId);
      expect(response.body.deployment.version).toBe(1);
      expect(response.body.deployment.status).toBe("live");
      expect(response.body.deployment.site).toBeDefined();
      expect(response.body.deployment.site.id).toBe(testSiteId);
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.get("/api/deployments/nonexistent-id");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /api/deployments/:id/logs - Get Deployment Logs
  // ============================================================================

  describe("GET /api/deployments/:id/logs", () => {
    it("should return stored logs for completed deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
        buildLogs: "Build started...\nInstalling dependencies...\nBuild complete!",
      });

      const response = await testClient.get(`/api/deployments/${deployment.id}/logs`);

      expect(response.status).toBe(200);
      expect(response.body.logs).toContain("Build started");
      expect(response.body.status).toBe("live");
      expect(response.body.complete).toBe(true);
    });

    it("should return empty logs when none exist", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "failed",
      });

      const response = await testClient.get(`/api/deployments/${deployment.id}/logs`);

      expect(response.status).toBe(200);
      expect(response.body.logs).toBe("");
      expect(response.body.complete).toBe(true);
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.get("/api/deployments/nonexistent-id/logs");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/deployments/:id/cancel - Cancel Deployment
  // ============================================================================

  describe("POST /api/deployments/:id/cancel", () => {
    it("should cancel pending deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "pending",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.deployment.status).toBe("cancelled");
      expect(response.body.message).toContain("cancelled");
    });

    it("should cancel building deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "building",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.deployment.status).toBe("cancelled");
    });

    it("should reject cancelling completed deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/cancel`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("in-progress");
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.post("/api/deployments/nonexistent-id/cancel");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/deployments/:id/retry - Retry Failed Deployment
  // ============================================================================

  describe("POST /api/deployments/:id/retry", () => {
    it("should reject retry without artifact", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "failed",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/retry`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("artifact");
    });

    it("should reject retry for non-failed deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
        artifactPath: "/path/to/artifact",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/retry`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("failed");
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.post("/api/deployments/nonexistent-id/retry");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/deployments/:id/redeploy - Redeploy Existing Deployment
  // ============================================================================

  describe("POST /api/deployments/:id/redeploy", () => {
    it("should reject redeploy without artifact", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/redeploy`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("artifact");
    });

    it("should reject redeploy for in-progress deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "building",
        artifactPath: "/path/to/artifact",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/redeploy`);

      expect(response.status).toBe(400);
    });

    it("should reject redeploy for failed deployment (use retry instead)", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "failed",
        artifactPath: "/path/to/artifact",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/redeploy`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("retry");
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.post("/api/deployments/nonexistent-id/redeploy");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/deployments/:id/promote - Promote Deployment
  // ============================================================================

  describe("POST /api/deployments/:id/promote", () => {
    it("should reject promoting non-live deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "pending",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/promote`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("live");
    });

    it("should reject promoting already active deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
        isActive: true,
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/promote`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("already active");
    });

    it("should promote live non-active deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
        isActive: false,
        slot: "blue",
      });

      const response = await testClient.post(`/api/deployments/${deployment.id}/promote`);

      expect(response.status).toBe(200);
      expect(response.body.deployment.isActive).toBe(true);
      expect(response.body.message).toContain("promoted");
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.post("/api/deployments/nonexistent-id/promote");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // DELETE /api/deployments/:id - Delete Deployment
  // ============================================================================

  describe("DELETE /api/deployments/:id", () => {
    it("should delete inactive completed deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
        isActive: false,
      });

      const response = await testClient.delete(`/api/deployments/${deployment.id}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("deleted");

      // Verify deletion
      const checkResponse = await testClient.get(`/api/deployments/${deployment.id}`);
      expect(checkResponse.status).toBe(404);
    });

    it("should reject deleting active deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
        isActive: true,
      });

      const response = await testClient.delete(`/api/deployments/${deployment.id}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("active");
    });

    it("should reject deleting in-progress deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "building",
      });

      const response = await testClient.delete(`/api/deployments/${deployment.id}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Cancel");
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.delete("/api/deployments/nonexistent-id");
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/sites/:id/rollback/:deploymentId - Rollback
  // ============================================================================

  describe("POST /api/sites/:id/rollback/:deploymentId", () => {
    it("should reject rollback to non-live deployment", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "failed",
      });

      const response = await testClient.post(
        `/api/sites/${testSiteId}/rollback/${deployment.id}`
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("live");
    });

    it("should return 404 for non-existent site", async () => {
      const deployment = await createDeploymentInDb(testSiteId, {
        status: "live",
      });

      const response = await testClient.post(
        `/api/sites/nonexistent-site/rollback/${deployment.id}`
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for non-existent deployment", async () => {
      const response = await testClient.post(
        `/api/sites/${testSiteId}/rollback/nonexistent-deployment`
      );

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle concurrent list requests", async () => {
      await createDeploymentInDb(testSiteId, { version: 1 });
      await createDeploymentInDb(testSiteId, { version: 2 });

      const responses = await Promise.all([
        testClient.get("/api/deployments"),
        testClient.get("/api/deployments"),
        testClient.get("/api/deployments"),
      ]);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.deployments).toHaveLength(2);
      });
    });

    it("should handle deployments from multiple sites", async () => {
      const site2Res = await testClient.post("/api/sites", createSiteFixture());
      const site2Id = site2Res.body.site.id;

      const site3Res = await testClient.post("/api/sites", createSiteFixture());
      const site3Id = site3Res.body.site.id;

      await createDeploymentInDb(testSiteId, { version: 1 });
      await createDeploymentInDb(site2Id, { version: 1 });
      await createDeploymentInDb(site3Id, { version: 1 });

      const allResponse = await testClient.get("/api/deployments");
      expect(allResponse.body.deployments).toHaveLength(3);

      const filteredResponse = await testClient.get(`/api/deployments?siteId=${site2Id}`);
      expect(filteredResponse.body.deployments).toHaveLength(1);
      expect(filteredResponse.body.deployments[0].siteId).toBe(site2Id);
    });

    it("should handle deployment with all status types", async () => {
      const statuses = ["pending", "building", "deploying", "live", "failed", "cancelled", "rolled_back"];

      for (const status of statuses) {
        await createDeploymentInDb(testSiteId, { status, version: statuses.indexOf(status) + 1 });
      }

      const response = await testClient.get("/api/deployments");
      expect(response.body.deployments).toHaveLength(7);

      const statusCounts = response.body.deployments.reduce((acc: any, d: any) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      }, {});

      statuses.forEach((status) => {
        expect(statusCounts[status]).toBe(1);
      });
    });
  });
});
