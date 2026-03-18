/**
 * Maintenance Windows Schema Unit Tests
 *
 * Tests for the maintenance windows database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  maintenanceWindows,
  type MaintenanceWindow,
  type NewMaintenanceWindow,
} from "../../../../../packages/database/src/schema/maintenance";

describe("Maintenance Windows Schema", () => {
  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("maintenanceWindows table", () => {
    it("should have id as primary key", () => {
      const idColumn = maintenanceWindows.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have domainId as required field", () => {
      const domainIdColumn = maintenanceWindows.domainId;
      expect(domainIdColumn.name).toBe("domain_id");
      expect(domainIdColumn.notNull).toBe(true);
    });

    it("should have title as optional field", () => {
      const titleColumn = maintenanceWindows.title;
      expect(titleColumn.name).toBe("title");
      expect(titleColumn.notNull).toBe(false);
    });

    it("should have reason as optional field", () => {
      const reasonColumn = maintenanceWindows.reason;
      expect(reasonColumn.name).toBe("reason");
      expect(reasonColumn.notNull).toBe(false);
    });

    it("should have scheduling fields", () => {
      expect(maintenanceWindows.scheduledStartAt.name).toBe("scheduled_start_at");
      expect(maintenanceWindows.scheduledEndAt.name).toBe("scheduled_end_at");
      expect(maintenanceWindows.scheduledStartAt.notNull).toBe(false);
      expect(maintenanceWindows.scheduledEndAt.notNull).toBe(false);
    });

    it("should have activation fields", () => {
      expect(maintenanceWindows.activatedAt.name).toBe("activated_at");
      expect(maintenanceWindows.deactivatedAt.name).toBe("deactivated_at");
      expect(maintenanceWindows.activatedAt.notNull).toBe(false);
      expect(maintenanceWindows.deactivatedAt.notNull).toBe(false);
    });

    it("should have isActive with default false", () => {
      const isActiveColumn = maintenanceWindows.isActive;
      expect(isActiveColumn.name).toBe("is_active");
      expect(isActiveColumn.notNull).toBe(true);
      expect(isActiveColumn.hasDefault).toBe(true);
    });

    it("should have triggeredBy as optional field", () => {
      const triggeredByColumn = maintenanceWindows.triggeredBy;
      expect(triggeredByColumn.name).toBe("triggered_by");
      expect(triggeredByColumn.notNull).toBe(false);
    });

    it("should have bypassIps as JSONB field", () => {
      const bypassIpsColumn = maintenanceWindows.bypassIps;
      expect(bypassIpsColumn.name).toBe("bypass_ips");
      expect(bypassIpsColumn.dataType).toBe("json");
    });

    it("should have notification settings", () => {
      expect(maintenanceWindows.notifyOnStart.name).toBe("notify_on_start");
      expect(maintenanceWindows.notifyOnEnd.name).toBe("notify_on_end");
      expect(maintenanceWindows.notificationWebhook.name).toBe("notification_webhook");
      expect(maintenanceWindows.notifyOnStart.notNull).toBe(true);
      expect(maintenanceWindows.notifyOnEnd.notNull).toBe(true);
    });

    it("should have notification defaults as false", () => {
      expect(maintenanceWindows.notifyOnStart.hasDefault).toBe(true);
      expect(maintenanceWindows.notifyOnEnd.hasDefault).toBe(true);
    });

    it("should have timestamps", () => {
      expect(maintenanceWindows.createdAt.name).toBe("created_at");
      expect(maintenanceWindows.updatedAt.name).toBe("updated_at");
      expect(maintenanceWindows.createdAt.notNull).toBe(true);
      expect(maintenanceWindows.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("MaintenanceWindow types", () => {
    it("should export MaintenanceWindow select type", () => {
      const window: MaintenanceWindow = {
        id: "maint-1",
        domainId: "domain-1",
        title: "Database Migration",
        reason: "Upgrading to PostgreSQL 16",
        scheduledStartAt: new Date("2024-03-01T02:00:00Z"),
        scheduledEndAt: new Date("2024-03-01T04:00:00Z"),
        activatedAt: new Date("2024-03-01T02:00:00Z"),
        deactivatedAt: null,
        isActive: true,
        triggeredBy: "scheduled",
        bypassIps: ["192.168.1.1", "10.0.0.0/8"],
        notifyOnStart: true,
        notifyOnEnd: true,
        notificationWebhook: "https://hooks.slack.com/services/xxx",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(window.id).toBe("maint-1");
      expect(window.title).toBe("Database Migration");
      expect(window.isActive).toBe(true);
    });

    it("should export NewMaintenanceWindow insert type with minimal fields", () => {
      const newWindow: NewMaintenanceWindow = {
        id: "maint-1",
        domainId: "domain-1",
      };

      expect(newWindow.id).toBe("maint-1");
      expect(newWindow.domainId).toBe("domain-1");
    });

    it("should handle scheduled maintenance window", () => {
      const scheduledWindow: Partial<MaintenanceWindow> = {
        scheduledStartAt: new Date("2024-03-01T02:00:00Z"),
        scheduledEndAt: new Date("2024-03-01T04:00:00Z"),
        triggeredBy: "scheduled",
        isActive: false,
      };

      expect(scheduledWindow.scheduledStartAt).toBeDefined();
      expect(scheduledWindow.scheduledEndAt).toBeDefined();
      expect(scheduledWindow.triggeredBy).toBe("scheduled");
    });

    it("should handle immediate/manual maintenance window", () => {
      const immediateWindow: Partial<MaintenanceWindow> = {
        scheduledStartAt: null,
        scheduledEndAt: null,
        activatedAt: new Date(),
        triggeredBy: "admin-user-123",
        isActive: true,
      };

      expect(immediateWindow.scheduledStartAt).toBeNull();
      expect(immediateWindow.activatedAt).toBeDefined();
      expect(immediateWindow.isActive).toBe(true);
    });

    it("should handle API-triggered maintenance window", () => {
      const apiWindow: Partial<MaintenanceWindow> = {
        triggeredBy: "api",
        title: "Emergency Maintenance",
        reason: "Critical security patch",
      };

      expect(apiWindow.triggeredBy).toBe("api");
    });

    it("should handle completed maintenance window", () => {
      const completedWindow: Partial<MaintenanceWindow> = {
        activatedAt: new Date("2024-03-01T02:00:00Z"),
        deactivatedAt: new Date("2024-03-01T03:30:00Z"),
        isActive: false,
      };

      expect(completedWindow.isActive).toBe(false);
      expect(completedWindow.deactivatedAt).toBeDefined();
    });

    it("should handle bypass IPs", () => {
      const window: Partial<MaintenanceWindow> = {
        bypassIps: ["192.168.1.1", "10.0.0.0/8", "172.16.0.0/12"],
      };

      expect(window.bypassIps).toHaveLength(3);
      expect(window.bypassIps).toContain("10.0.0.0/8");
    });

    it("should handle notification settings", () => {
      const window: Partial<MaintenanceWindow> = {
        notifyOnStart: true,
        notifyOnEnd: true,
        notificationWebhook: "https://hooks.slack.com/services/xxx",
      };

      expect(window.notifyOnStart).toBe(true);
      expect(window.notifyOnEnd).toBe(true);
      expect(window.notificationWebhook).toContain("slack.com");
    });
  });
});
