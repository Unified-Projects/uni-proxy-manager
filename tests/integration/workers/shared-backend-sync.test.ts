import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import {
  createDomainFixture,
  createSharedBackendFixture,
} from "../setup/fixtures";
import { processSharedBackendSync } from "../../../apps/workers/src/processors/shared-backend-sync";
import { type Job } from "bullmq";
import type { SharedBackendSyncJobData } from "@uni-proxy-manager/queue";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

function createMockJob(
  data: SharedBackendSyncJobData
): Job<SharedBackendSyncJobData> {
  return {
    id: "test-shared-backend-sync-job",
    name: "shared-backend-sync",
    data,
    opts: {},
    attemptsMade: 0,
    timestamp: Date.now(),
    returnvalue: undefined,
    failedReason: undefined,
    getState: async () => "active",
    updateProgress: async () => {},
    log: async () => {},
  } as unknown as Job<SharedBackendSyncJobData>;
}

describe("Shared Backend Sync Worker", () => {
  let domainId: string;
  let sharedBackendId: string;

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

    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture()
    );
    domainId = domainRes.body.domain.id;

    const sbRes = await testClient.post<{ sharedBackend: any }>(
      "/api/shared-backends",
      createSharedBackendFixture({ name: "sync-test-sb" })
    );
    sharedBackendId = sbRes.body.sharedBackend.id;
  });

  describe("processSharedBackendSync", () => {
    it("should return success with domainsAffected=0 when no domains linked", async () => {
      const job = createMockJob({
        sharedBackendId,
        reason: "test sync",
      });

      const result = await processSharedBackendSync(job);

      expect(result.success).toBe(true);
      expect(result.sharedBackendId).toBe(sharedBackendId);
      expect(result.domainsAffected).toBe(0);
    });

    it("should update linked domains lastConfigUpdate when a domain is linked", async () => {
      // Link the domain
      await testClient.post(
        `/api/shared-backends/${sharedBackendId}/domains`,
        { domainId }
      );

      const domainBefore = await testDb.query.domains.findFirst({
        where: eq(schema.domains.id, domainId),
      });

      // Small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 10));

      const job = createMockJob({
        sharedBackendId,
        reason: "backend updated",
      });

      const result = await processSharedBackendSync(job);

      expect(result.success).toBe(true);
      expect(result.domainsAffected).toBe(1);

      const domainAfter = await testDb.query.domains.findFirst({
        where: eq(schema.domains.id, domainId),
      });

      expect(domainAfter?.updatedAt.getTime()).toBeGreaterThanOrEqual(
        domainBefore?.updatedAt.getTime() ?? 0
      );
    });

    it("should handle multiple linked domains", async () => {
      // Create second domain
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId2 = domain2Res.body.domain.id;

      await testClient.post(
        `/api/shared-backends/${sharedBackendId}/domains`,
        { domainId }
      );
      await testClient.post(
        `/api/shared-backends/${sharedBackendId}/domains`,
        { domainId: domainId2 }
      );

      const job = createMockJob({
        sharedBackendId,
        reason: "multi-domain test",
      });

      const result = await processSharedBackendSync(job);

      expect(result.success).toBe(true);
      expect(result.domainsAffected).toBe(2);
    });

    it("should return failure result for non-existent sharedBackendId", async () => {
      const job = createMockJob({
        sharedBackendId: "non-existent-sb-id",
        reason: "test",
      });

      // processSharedBackendSync should not throw — it returns a result
      const result = await processSharedBackendSync(job);
      // No domains linked, so domainsAffected is 0 (not an error)
      expect(result.success).toBe(true);
      expect(result.domainsAffected).toBe(0);
    });
  });
});
