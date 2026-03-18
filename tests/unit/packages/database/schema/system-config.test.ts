/**
 * System Config Schema Unit Tests
 *
 * Tests for the system config database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  systemConfig,
  type SystemConfig,
  type NewSystemConfig,
  type RetentionConfig,
  type BuildDefaultsConfig,
  DEFAULT_RETENTION_CONFIG,
  DEFAULT_BUILD_DEFAULTS_CONFIG,
  CONFIG_KEYS,
} from "../../../../../packages/database/src/schema/system-config";

describe("System Config Schema", () => {
  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("systemConfig table", () => {
    it("should have id as primary key", () => {
      const idColumn = systemConfig.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have key as required unique field", () => {
      const keyColumn = systemConfig.key;
      expect(keyColumn.name).toBe("key");
      expect(keyColumn.notNull).toBe(true);
    });

    it("should have value as required JSONB field", () => {
      const valueColumn = systemConfig.value;
      expect(valueColumn.name).toBe("value");
      expect(valueColumn.notNull).toBe(true);
      expect(valueColumn.dataType).toBe("json");
    });

    it("should have description as optional field", () => {
      const descriptionColumn = systemConfig.description;
      expect(descriptionColumn.name).toBe("description");
      expect(descriptionColumn.notNull).toBe(false);
    });

    it("should have timestamps", () => {
      expect(systemConfig.createdAt.name).toBe("created_at");
      expect(systemConfig.updatedAt.name).toBe("updated_at");
      expect(systemConfig.createdAt.notNull).toBe(true);
      expect(systemConfig.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("SystemConfig types", () => {
    it("should export SystemConfig select type", () => {
      const config: SystemConfig = {
        id: "config-1",
        key: "retention",
        value: DEFAULT_RETENTION_CONFIG,
        description: "Deployment retention settings",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(config.id).toBe("config-1");
      expect(config.key).toBe("retention");
      expect(config.value).toEqual(DEFAULT_RETENTION_CONFIG);
    });

    it("should export NewSystemConfig insert type", () => {
      const newConfig: NewSystemConfig = {
        id: "config-1",
        key: "build_defaults",
        value: DEFAULT_BUILD_DEFAULTS_CONFIG,
      };

      expect(newConfig.id).toBe("config-1");
      expect(newConfig.key).toBe("build_defaults");
    });
  });

  // ============================================================================
  // Retention Config Tests
  // ============================================================================

  describe("RetentionConfig", () => {
    it("should have all required fields", () => {
      const config: RetentionConfig = {
        maxDeploymentsPerSite: 10,
        deploymentMaxAgeDays: 90,
        artifactRetentionDays: 30,
        logRetentionDays: 30,
      };

      expect(config.maxDeploymentsPerSite).toBe(10);
      expect(config.deploymentMaxAgeDays).toBe(90);
      expect(config.artifactRetentionDays).toBe(30);
      expect(config.logRetentionDays).toBe(30);
    });

    it("should have correct defaults", () => {
      expect(DEFAULT_RETENTION_CONFIG.maxDeploymentsPerSite).toBe(10);
      expect(DEFAULT_RETENTION_CONFIG.deploymentMaxAgeDays).toBe(90);
      expect(DEFAULT_RETENTION_CONFIG.artifactRetentionDays).toBe(30);
      expect(DEFAULT_RETENTION_CONFIG.logRetentionDays).toBe(30);
    });

    it("should allow custom values", () => {
      const customConfig: RetentionConfig = {
        maxDeploymentsPerSite: 50,
        deploymentMaxAgeDays: 180,
        artifactRetentionDays: 60,
        logRetentionDays: 14,
      };

      expect(customConfig.maxDeploymentsPerSite).toBe(50);
      expect(customConfig.deploymentMaxAgeDays).toBe(180);
    });
  });

  // ============================================================================
  // Build Defaults Config Tests
  // ============================================================================

  describe("BuildDefaultsConfig", () => {
    it("should have all required fields", () => {
      const config: BuildDefaultsConfig = {
        defaultBuildCpus: 2,
        defaultBuildMemoryMb: 4096,
        defaultBuildTimeoutSeconds: 900,
      };

      expect(config.defaultBuildCpus).toBe(2);
      expect(config.defaultBuildMemoryMb).toBe(4096);
      expect(config.defaultBuildTimeoutSeconds).toBe(900);
    });

    it("should have correct defaults", () => {
      expect(DEFAULT_BUILD_DEFAULTS_CONFIG.defaultBuildCpus).toBe(1.0);
      expect(DEFAULT_BUILD_DEFAULTS_CONFIG.defaultBuildMemoryMb).toBe(2048);
      expect(DEFAULT_BUILD_DEFAULTS_CONFIG.defaultBuildTimeoutSeconds).toBe(900);
    });

    it("should allow fractional CPU values", () => {
      const config: BuildDefaultsConfig = {
        defaultBuildCpus: 0.5,
        defaultBuildMemoryMb: 1024,
        defaultBuildTimeoutSeconds: 600,
      };

      expect(config.defaultBuildCpus).toBe(0.5);
    });

    it("should allow high resource values", () => {
      const highResourceConfig: BuildDefaultsConfig = {
        defaultBuildCpus: 8,
        defaultBuildMemoryMb: 16384,
        defaultBuildTimeoutSeconds: 3600,
      };

      expect(highResourceConfig.defaultBuildCpus).toBe(8);
      expect(highResourceConfig.defaultBuildMemoryMb).toBe(16384);
    });
  });

  // ============================================================================
  // Config Keys Tests
  // ============================================================================

  describe("CONFIG_KEYS", () => {
    it("should have RETENTION key", () => {
      expect(CONFIG_KEYS.RETENTION).toBe("retention");
    });

    it("should have BUILD_DEFAULTS key", () => {
      expect(CONFIG_KEYS.BUILD_DEFAULTS).toBe("build_defaults");
    });

    it("should have HAPROXY_WATCHDOG key", () => {
      expect(CONFIG_KEYS.HAPROXY_WATCHDOG).toBe("haproxy_watchdog");
    });

    it("should have exactly 3 keys", () => {
      const keys = Object.keys(CONFIG_KEYS);
      expect(keys).toHaveLength(3);
    });
  });
});
