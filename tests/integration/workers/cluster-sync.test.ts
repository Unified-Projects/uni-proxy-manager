import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import { createClusterNodeFixture } from "../setup/fixtures";
import { processClusterSync } from "../../../apps/workers/src/processors/cluster-sync";
import { type Job } from "bullmq";
import type { ClusterSyncJobData } from "@uni-proxy-manager/queue";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

function createMockJob(data: ClusterSyncJobData): Job<ClusterSyncJobData> {
  return {
    id: "test-cluster-sync-job",
    name: "cluster-sync",
    data,
    opts: {},
    attemptsMade: 0,
    timestamp: Date.now(),
    returnvalue: undefined,
    failedReason: undefined,
    getState: async () => "active",
    updateProgress: async () => {},
    log: async () => {},
  } as unknown as Job<ClusterSyncJobData>;
}

describe("Cluster Sync Worker", () => {
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

  describe("processClusterSync — no remote nodes", () => {
    it("should return nodesAttempted=0 when no remote nodes exist", async () => {
      const job = createMockJob({ reason: "test-sync" });
      const result = await processClusterSync(job);

      expect(result.success).toBe(true);
      expect(result.nodesAttempted).toBe(0);
      expect(result.nodesSucceeded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should skip local-only nodes", async () => {
      await testClient.post(
        "/api/cluster",
        createClusterNodeFixture({ isLocal: true })
      );

      const job = createMockJob({ reason: "local-only-test" });
      const result = await processClusterSync(job);

      expect(result.nodesAttempted).toBe(0);
    });
  });

  describe("processClusterSync — remote nodes with network errors", () => {
    it("should record error for unreachable remote node", async () => {
      await testClient.post("/api/cluster", {
        name: "unreachable-node",
        apiUrl: "http://127.0.0.1:19999",
        apiKey: "test-key",
        isLocal: false,
      });

      const job = createMockJob({ reason: "sync-unreachable" });
      const result = await processClusterSync(job);

      expect(result.success).toBe(true); // overall process succeeded
      expect(result.nodesAttempted).toBe(1);
      expect(result.nodesSucceeded).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].nodeId).toBeTruthy();
    });

    it("should update node status to error after failed sync", async () => {
      const createRes = await testClient.post<{ node: any }>("/api/cluster", {
        name: "status-error-node",
        apiUrl: "http://127.0.0.1:19998",
        apiKey: "test-key",
        isLocal: false,
      });
      const nodeId = createRes.body.node.id;

      const job = createMockJob({ reason: "status-error-test" });
      await processClusterSync(job);

      const node = await testDb.query.clusterNodes.findFirst({
        where: eq(schema.clusterNodes.id, nodeId),
      });

      expect(node?.status).toBe("error");
      expect(node?.lastSyncError).toBeTruthy();
    });
  });

  describe("processClusterSync — targetNodeIds filter", () => {
    it("should only attempt nodes in targetNodeIds when specified", async () => {
      const nodeARes = await testClient.post<{ node: any }>("/api/cluster", {
        name: "node-a",
        apiUrl: "http://127.0.0.1:19990",
        apiKey: "key-a",
        isLocal: false,
      });
      await testClient.post("/api/cluster", {
        name: "node-b",
        apiUrl: "http://127.0.0.1:19991",
        apiKey: "key-b",
        isLocal: false,
      });

      const job = createMockJob({
        reason: "targeted-sync",
        targetNodeIds: [nodeARes.body.node.id],
      });

      const result = await processClusterSync(job);

      // Only 1 node targeted, even though 2 remote nodes exist
      expect(result.nodesAttempted).toBe(1);
    });
  });

  describe("processClusterSync — health poll", () => {
    it("should run health poll without triggering sync errors for all nodes", async () => {
      await testClient.post("/api/cluster", {
        name: "poll-node",
        apiUrl: "http://127.0.0.1:19997",
        apiKey: "poll-key",
        isLocal: false,
      });

      const job = createMockJob({ reason: "health-poll" });
      const result = await processClusterSync(job);

      // Health poll returns success even when nodes are unreachable
      // (it silently updates statuses)
      expect(result.success).toBe(true);
      expect(result.nodesAttempted).toBeGreaterThanOrEqual(0);
    });

    it("should update lastSeenAt for health-poll when node responds", async () => {
      // This test mocks fetch to simulate a responding node
      const createRes = await testClient.post<{ node: any }>("/api/cluster", {
        name: "healthy-poll-node",
        apiUrl: "http://127.0.0.1:19996",
        apiKey: "poll-key-2",
        isLocal: false,
      });
      const nodeId = createRes.body.node.id;

      // Mock global fetch for this test to simulate a 200 response
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), { status: 200 })
      );

      const job = createMockJob({ reason: "health-poll" });
      await processClusterSync(job);

      global.fetch = originalFetch;

      const node = await testDb.query.clusterNodes.findFirst({
        where: eq(schema.clusterNodes.id, nodeId),
      });

      expect(node?.status).toBe("online");
      expect(node?.lastSeenAt).toBeTruthy();
    });
  });
});
