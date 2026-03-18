/**
 * Deployments Schema Unit Tests
 *
 * Tests for the deployments database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  deployments,
  deploymentSlotEnum,
  deploymentStatusEnum,
  deploymentTriggerEnum,
  type Deployment,
  type NewDeployment,
} from "../../../../../packages/database/src/schema/deployments";

describe("Deployments Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("deploymentSlotEnum", () => {
    it("should define blue and green slots", () => {
      const enumValues = deploymentSlotEnum.enumValues;

      expect(enumValues).toContain("blue");
      expect(enumValues).toContain("green");
    });

    it("should have exactly 2 slots", () => {
      expect(deploymentSlotEnum.enumValues).toHaveLength(2);
    });

    it("should have correct enum name", () => {
      expect(deploymentSlotEnum.enumName).toBe("deployment_slot");
    });
  });

  describe("deploymentStatusEnum", () => {
    it("should define all expected status values", () => {
      const enumValues = deploymentStatusEnum.enumValues;

      expect(enumValues).toContain("pending");
      expect(enumValues).toContain("building");
      expect(enumValues).toContain("deploying");
      expect(enumValues).toContain("live");
      expect(enumValues).toContain("failed");
      expect(enumValues).toContain("rolled_back");
      expect(enumValues).toContain("cancelled");
    });

    it("should have exactly 7 status values", () => {
      expect(deploymentStatusEnum.enumValues).toHaveLength(7);
    });

    it("should have correct enum name", () => {
      expect(deploymentStatusEnum.enumName).toBe("deployment_status");
    });
  });

  describe("deploymentTriggerEnum", () => {
    it("should define all expected trigger values", () => {
      const enumValues = deploymentTriggerEnum.enumValues;

      expect(enumValues).toContain("manual");
      expect(enumValues).toContain("webhook");
      expect(enumValues).toContain("schedule");
      expect(enumValues).toContain("rollback");
      expect(enumValues).toContain("upload");
    });

    it("should have exactly 5 trigger values", () => {
      expect(deploymentTriggerEnum.enumValues).toHaveLength(5);
    });

    it("should have correct enum name", () => {
      expect(deploymentTriggerEnum.enumName).toBe("deployment_trigger");
    });
  });

  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("deployments table", () => {
    it("should have id as primary key", () => {
      const idColumn = deployments.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have siteId as required field", () => {
      const siteIdColumn = deployments.siteId;
      expect(siteIdColumn.name).toBe("site_id");
      expect(siteIdColumn.notNull).toBe(true);
    });

    it("should have version as required integer", () => {
      const versionColumn = deployments.version;
      expect(versionColumn.name).toBe("version");
      expect(versionColumn.notNull).toBe(true);
    });

    it("should have commit info fields", () => {
      expect(deployments.commitSha.name).toBe("commit_sha");
      expect(deployments.commitMessage.name).toBe("commit_message");
      expect(deployments.branch.name).toBe("branch");
    });

    it("should have build info fields", () => {
      expect(deployments.buildStartedAt.name).toBe("build_started_at");
      expect(deployments.buildCompletedAt.name).toBe("build_completed_at");
      expect(deployments.buildLogs.name).toBe("build_logs");
      expect(deployments.buildDurationMs.name).toBe("build_duration_ms");
    });

    it("should have slot field", () => {
      const slotColumn = deployments.slot;
      expect(slotColumn.name).toBe("slot");
      expect(slotColumn.notNull).toBe(false);
    });

    it("should have isActive with default false", () => {
      const isActiveColumn = deployments.isActive;
      expect(isActiveColumn.name).toBe("is_active");
      expect(isActiveColumn.notNull).toBe(true);
      expect(isActiveColumn.hasDefault).toBe(true);
    });

    it("should have artifact fields", () => {
      expect(deployments.artifactPath.name).toBe("artifact_path");
      expect(deployments.artifactSize.name).toBe("artifact_size");
    });

    it("should have status with default pending", () => {
      const statusColumn = deployments.status;
      expect(statusColumn.name).toBe("status");
      expect(statusColumn.notNull).toBe(true);
      expect(statusColumn.hasDefault).toBe(true);
    });

    it("should have errorMessage field", () => {
      const errorMessageColumn = deployments.errorMessage;
      expect(errorMessageColumn.name).toBe("error_message");
      expect(errorMessageColumn.notNull).toBe(false);
    });

    it("should have triggeredBy with default manual", () => {
      const triggeredByColumn = deployments.triggeredBy;
      expect(triggeredByColumn.name).toBe("triggered_by");
      expect(triggeredByColumn.notNull).toBe(true);
      expect(triggeredByColumn.hasDefault).toBe(true);
    });

    it("should have deployedAt timestamp", () => {
      const deployedAtColumn = deployments.deployedAt;
      expect(deployedAtColumn.name).toBe("deployed_at");
      expect(deployedAtColumn.notNull).toBe(false);
    });

    it("should have previewUrl field", () => {
      const previewUrlColumn = deployments.previewUrl;
      expect(previewUrlColumn.name).toBe("preview_url");
      expect(previewUrlColumn.notNull).toBe(false);
    });

    it("should have createdAt timestamp", () => {
      const createdAtColumn = deployments.createdAt;
      expect(createdAtColumn.name).toBe("created_at");
      expect(createdAtColumn.notNull).toBe(true);
      expect(createdAtColumn.hasDefault).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("Deployment types", () => {
    it("should export Deployment select type", () => {
      const deployment: Deployment = {
        id: "deploy-1",
        siteId: "site-1",
        version: 5,
        commitSha: "abc123def456",
        commitMessage: "feat: add new feature",
        branch: "main",
        buildStartedAt: new Date(),
        buildCompletedAt: new Date(),
        buildLogs: "Build completed successfully",
        buildDurationMs: 120000,
        slot: "blue",
        isActive: true,
        artifactPath: "/artifacts/deploy-1.tar.gz",
        artifactSize: 50000000,
        status: "live",
        errorMessage: null,
        triggeredBy: "webhook",
        deployedAt: new Date(),
        previewUrl: "https://preview-deploy-1.example.com",
        createdAt: new Date(),
      };

      expect(deployment.id).toBe("deploy-1");
      expect(deployment.version).toBe(5);
      expect(deployment.status).toBe("live");
    });

    it("should export NewDeployment insert type with minimal fields", () => {
      const newDeployment: NewDeployment = {
        id: "deploy-1",
        siteId: "site-1",
        version: 1,
      };

      expect(newDeployment.id).toBe("deploy-1");
      expect(newDeployment.siteId).toBe("site-1");
      expect(newDeployment.version).toBe(1);
    });

    it("should allow all slot values", () => {
      const slots: Deployment["slot"][] = ["blue", "green", null];

      slots.forEach(slot => {
        const deployment: Partial<Deployment> = { slot };
        expect(deployment.slot).toBe(slot);
      });
    });

    it("should allow all status values", () => {
      const statuses: Deployment["status"][] = [
        "pending",
        "building",
        "deploying",
        "live",
        "failed",
        "rolled_back",
        "cancelled",
      ];

      statuses.forEach(status => {
        const deployment: Partial<Deployment> = { status };
        expect(deployment.status).toBe(status);
      });
    });

    it("should allow all trigger values", () => {
      const triggers: Deployment["triggeredBy"][] = [
        "manual",
        "webhook",
        "schedule",
        "rollback",
        "upload",
      ];

      triggers.forEach(trigger => {
        const deployment: Partial<Deployment> = { triggeredBy: trigger };
        expect(deployment.triggeredBy).toBe(trigger);
      });
    });

    it("should handle failed deployment with error", () => {
      const failedDeployment: Partial<Deployment> = {
        status: "failed",
        errorMessage: "Build failed: npm install returned error code 1",
        buildCompletedAt: new Date(),
        deployedAt: null,
      };

      expect(failedDeployment.status).toBe("failed");
      expect(failedDeployment.errorMessage).toBeDefined();
    });

    it("should handle preview deployment", () => {
      const previewDeployment: Partial<Deployment> = {
        branch: "feature/new-feature",
        previewUrl: "https://preview-feature.example.com",
        isActive: false,
      };

      expect(previewDeployment.branch).toBe("feature/new-feature");
      expect(previewDeployment.previewUrl).toBeDefined();
    });
  });
});
