import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import {
  createDomainFixture,
  createMaintenanceWindowFixture,
} from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Maintenance API", () => {
  let testDomainId: string;

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

    const fixture = createDomainFixture();
    const domainRes = await testClient.post<{ domain: any; error?: string }>(
      "/api/domains",
      fixture
    );

    if (domainRes.status !== 201) {
      throw new Error(
        `Failed to create test domain: ${domainRes.status} - ${JSON.stringify(domainRes.body)}, fixture: ${JSON.stringify(fixture)}`
      );
    }

    testDomainId = domainRes.body.domain.id;
  });

  describe("GET /api/maintenance/domains/:domainId", () => {
    it("should return maintenance status for domain", async () => {
      const response = await testClient.get<{
        maintenanceEnabled: boolean;
        bypassIps: string[];
        activeWindow?: any;
      }>(`/api/maintenance/domains/${testDomainId}`);

      expect(response.status).toBe(200);
      expect(response.body.maintenanceEnabled).toBe(false);
      expect(response.body.bypassIps).toEqual([]);
      expect(response.body.activeWindow).toBeUndefined();
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.get(
        "/api/maintenance/domains/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/maintenance/domains/:domainId/enable", () => {
    it("should enable maintenance mode and queue HAProxy reload", async () => {
      const response = await testClient.post<{
        success: boolean;
        maintenanceWindowId: string;
      }>(`/api/maintenance/domains/${testDomainId}/enable`, {
        reason: "Scheduled maintenance",
        bypassIps: ["192.168.1.1", "10.0.0.1"],
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.maintenanceWindowId).toBeDefined();

      // Verify domain is in maintenance
      const domainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainRes.body.domain.maintenanceEnabled).toBe(true);
      expect(domainRes.body.domain.maintenanceBypassIps).toContain(
        "192.168.1.1"
      );

      // Verify maintenance window was created
      const statusRes = await testClient.get<{
        maintenanceEnabled: boolean;
        activeWindow: any;
      }>(`/api/maintenance/domains/${testDomainId}`);
      expect(statusRes.body.activeWindow).toBeDefined();
      expect(statusRes.body.activeWindow.reason).toBe("Scheduled maintenance");
      expect(statusRes.body.activeWindow.isActive).toBe(true);

      // Verify HAProxy reload was queued
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(
        counts.waiting + counts.active + counts.completed
      ).toBeGreaterThanOrEqual(1);
    });

    it("should enable maintenance without bypass IPs", async () => {
      const response = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${testDomainId}/enable`,
        {
          reason: "Quick maintenance",
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.post(
        "/api/maintenance/domains/non-existent-id/enable",
        {}
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/maintenance/domains/:domainId/disable", () => {
    it("should disable maintenance mode and deactivate window", async () => {
      // Enable first
      await testClient.post(`/api/maintenance/domains/${testDomainId}/enable`, {
        reason: "Test",
      });

      await clearRedisQueues();

      const response = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${testDomainId}/disable`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify domain is not in maintenance
      const domainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainRes.body.domain.maintenanceEnabled).toBe(false);

      // Verify maintenance window was deactivated
      const statusRes = await testClient.get<{
        maintenanceEnabled: boolean;
        activeWindow?: any;
      }>(`/api/maintenance/domains/${testDomainId}`);
      expect(statusRes.body.activeWindow).toBeUndefined();

      // Verify HAProxy reload was queued
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(
        counts.waiting + counts.active + counts.completed
      ).toBeGreaterThanOrEqual(1);
    });

    it("should succeed even if maintenance is not enabled", async () => {
      const response = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${testDomainId}/disable`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.post(
        "/api/maintenance/domains/non-existent-id/disable"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/maintenance/domains/:domainId/bypass-ips", () => {
    it("should update bypass IPs", async () => {
      const response = await testClient.put<{ success: boolean }>(
        `/api/maintenance/domains/${testDomainId}/bypass-ips`,
        {
          bypassIps: ["10.0.0.100", "10.0.0.101"],
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const domainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainRes.body.domain.maintenanceBypassIps).toEqual([
        "10.0.0.100",
        "10.0.0.101",
      ]);
    });

    it("should queue HAProxy reload if maintenance is active", async () => {
      await testClient.post(`/api/maintenance/domains/${testDomainId}/enable`, {});
      await clearRedisQueues();

      await testClient.put(`/api/maintenance/domains/${testDomainId}/bypass-ips`, {
        bypassIps: ["10.0.0.200"],
      });

      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(
        counts.waiting + counts.active + counts.completed
      ).toBeGreaterThanOrEqual(1);
    });

    it("should clear bypass IPs with empty array", async () => {
      // Set some IPs first
      await testClient.put(`/api/maintenance/domains/${testDomainId}/bypass-ips`, {
        bypassIps: ["10.0.0.1"],
      });

      // Clear them
      const response = await testClient.put<{ success: boolean }>(
        `/api/maintenance/domains/${testDomainId}/bypass-ips`,
        {
          bypassIps: [],
        }
      );

      expect(response.status).toBe(200);

      const domainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainRes.body.domain.maintenanceBypassIps).toEqual([]);
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.put(
        "/api/maintenance/domains/non-existent-id/bypass-ips",
        {
          bypassIps: [],
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/maintenance/windows", () => {
    it("should schedule future maintenance window", async () => {
      const windowData = createMaintenanceWindowFixture(testDomainId);
      const response = await testClient.post<{ window: any }>(
        "/api/maintenance/windows",
        windowData
      );

      expect(response.status).toBe(201);
      expect(response.body.window.title).toBe(windowData.title);
      expect(response.body.window.isActive).toBe(false);
      expect(response.body.window.triggeredBy).toBe("scheduled");
    });

    it("should return 404 for non-existent domain", async () => {
      const windowData = createMaintenanceWindowFixture("non-existent-id");
      const response = await testClient.post("/api/maintenance/windows", windowData);

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/maintenance/windows", () => {
    it("should list maintenance windows", async () => {
      await testClient.post(`/api/maintenance/domains/${testDomainId}/enable`, {
        reason: "Test 1",
      });
      await testClient.post(
        "/api/maintenance/windows",
        createMaintenanceWindowFixture(testDomainId)
      );

      const response = await testClient.get<{ windows: any[] }>(
        "/api/maintenance/windows"
      );

      expect(response.status).toBe(200);
      expect(response.body.windows.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by active windows", async () => {
      await testClient.post(`/api/maintenance/domains/${testDomainId}/enable`, {
        reason: "Active",
      });

      const response = await testClient.get<{ windows: any[] }>(
        "/api/maintenance/windows?active=true"
      );

      expect(response.status).toBe(200);
      expect(response.body.windows.every((w: any) => w.isActive)).toBe(true);
    });

    it("should filter by domain", async () => {
      await testClient.post(`/api/maintenance/domains/${testDomainId}/enable`, {
        reason: "Test",
      });

      const response = await testClient.get<{ windows: any[] }>(
        `/api/maintenance/windows?domainId=${testDomainId}`
      );

      expect(response.status).toBe(200);
      expect(
        response.body.windows.every((w: any) => w.domainId === testDomainId)
      ).toBe(true);
    });
  });
});
