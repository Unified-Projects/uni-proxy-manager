/**
 * Pomerium Restart Worker Integration Tests
 *
 * Tests the pomerium-restart processor end-to-end.
 * Processor tests skip when the Docker socket is not mounted.
 * API tests always run — they only require the test-runner container.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { access } from "fs/promises";
import type { Job } from "bullmq";
import type { PomeriumRestartJobData } from "@uni-proxy-manager/queue";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import { processPomeriumRestart } from "../../../apps/pomerium-workers/src/processors/pomerium-restart";

const DOCKER_SOCKET_PATH =
  process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

function createMockJob(
  reason = "Integration test restart"
): Job<PomeriumRestartJobData> {
  return {
    id: "integration-test-job-1",
    name: "pomerium-restart",
    data: { reason },
    opts: {},
    attemptsMade: 0,
    timestamp: Date.now(),
    returnvalue: undefined,
    failedReason: undefined,
    getState: async () => "active",
    updateProgress: async () => {},
    log: async () => {},
  } as unknown as Job<PomeriumRestartJobData>;
}

describe("Pomerium Restart Worker", () => {
  let dockerAvailable = false;

  beforeAll(async () => {
    await clearDatabase();
    try {
      await access(DOCKER_SOCKET_PATH);
      dockerAvailable = true;
    } catch {
      dockerAvailable = false;
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // ============================================================================
  // Processor — skips when Docker socket is not mounted
  // ============================================================================

  describe("processPomeriumRestart", () => {
    it("returns success: true and method: docker-restart", async (ctx) => {
      if (!dockerAvailable) ctx.skip();

      const result = await processPomeriumRestart(createMockJob());

      expect(result.success).toBe(true);
      expect(result.method).toBe("docker-restart");
      expect(result.error).toBeUndefined();
    });

    it("returns success: true for every reason string", async (ctx) => {
      if (!dockerAvailable) ctx.skip();

      const reasons = [
        "Manual restart from UI",
        "IdP credentials updated",
        "Config regenerated",
        "Scheduled maintenance",
      ];

      for (const reason of reasons) {
        const result = await processPomeriumRestart(createMockJob(reason));
        expect(result.success, `Expected success for reason: "${reason}"`).toBe(true);
        expect(result.method).toBe("docker-restart");
      }
    });

    it("error is undefined on success", async (ctx) => {
      if (!dockerAvailable) ctx.skip();

      const result = await processPomeriumRestart(createMockJob());
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // ============================================================================
  // API → queue round-trip — always runs
  // ============================================================================

  describe("API restart endpoint", () => {
    it("POST /api/pomerium/settings/restart returns 200 and queues the job", async () => {
      const response = await testClient.post("/api/pomerium/settings/restart");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Pomerium restart queued");
    });

    it("consecutive restart requests are both accepted", async () => {
      const [first, second] = await Promise.all([
        testClient.post("/api/pomerium/settings/restart"),
        testClient.post("/api/pomerium/settings/restart"),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });
  });
});
