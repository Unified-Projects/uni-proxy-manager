/**
 * System Config API Integration Tests
 *
 * Tests for the /api/system-config endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("System Config API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  // ============================================================================
  // GET /api/system-config - Get All Config
  // ============================================================================

  describe("GET /api/system-config", () => {
    it("should return default configuration when empty", async () => {
      const response = await testClient.get<{
        config: Record<string, unknown>;
      }>("/api/system-config");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("config");
      expect(response.body.config).toHaveProperty("retention");
      expect(response.body.config).toHaveProperty("build_defaults");
    });

    it("should return all configuration keys", async () => {
      const response = await testClient.get<{
        config: {
          retention: object;
          build_defaults: object;
        };
      }>("/api/system-config");

      expect(response.status).toBe(200);
      expect(typeof response.body.config.retention).toBe("object");
      expect(typeof response.body.config.build_defaults).toBe("object");
    });
  });

  // ============================================================================
  // GET /api/system-config/retention - Get Retention Config
  // ============================================================================

  describe("GET /api/system-config/retention", () => {
    it("should return default retention configuration", async () => {
      const response = await testClient.get<{
        retention: {
          maxDeploymentsPerSite: number;
          deploymentMaxAgeDays: number;
          artifactRetentionDays: number;
          logRetentionDays: number;
        };
      }>("/api/system-config/retention");

      expect(response.status).toBe(200);
      expect(response.body.retention).toBeDefined();
      expect(response.body.retention.maxDeploymentsPerSite).toBeGreaterThan(0);
      expect(response.body.retention.deploymentMaxAgeDays).toBeGreaterThan(0);
      expect(response.body.retention.artifactRetentionDays).toBeGreaterThan(0);
      expect(response.body.retention.logRetentionDays).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // PUT /api/system-config/retention - Update Retention Config
  // ============================================================================

  describe("PUT /api/system-config/retention", () => {
    it("should update retention configuration", async () => {
      const response = await testClient.put<{
        retention: {
          maxDeploymentsPerSite: number;
          deploymentMaxAgeDays: number;
        };
      }>("/api/system-config/retention", {
        maxDeploymentsPerSite: 20,
        deploymentMaxAgeDays: 60,
        artifactRetentionDays: 30,
        logRetentionDays: 14,
      });

      expect(response.status).toBe(200);
      expect(response.body.retention.maxDeploymentsPerSite).toBe(20);
      expect(response.body.retention.deploymentMaxAgeDays).toBe(60);
    });

    it("should validate minimum values", async () => {
      const response = await testClient.put("/api/system-config/retention", {
        maxDeploymentsPerSite: 0, // Invalid: below minimum
        deploymentMaxAgeDays: 30,
        artifactRetentionDays: 30,
        logRetentionDays: 30,
      });

      expect(response.status).toBe(400);
    });

    it("should validate maximum values", async () => {
      const response = await testClient.put("/api/system-config/retention", {
        maxDeploymentsPerSite: 500, // Invalid: above maximum
        deploymentMaxAgeDays: 30,
        artifactRetentionDays: 30,
        logRetentionDays: 30,
      });

      expect(response.status).toBe(400);
    });

    it("should persist configuration", async () => {
      await testClient.put("/api/system-config/retention", {
        maxDeploymentsPerSite: 25,
        deploymentMaxAgeDays: 45,
        artifactRetentionDays: 20,
        logRetentionDays: 10,
      });

      const getRes = await testClient.get<{
        retention: { maxDeploymentsPerSite: number };
      }>("/api/system-config/retention");

      expect(getRes.status).toBe(200);
      expect(getRes.body.retention.maxDeploymentsPerSite).toBe(25);
    });
  });

  // ============================================================================
  // POST /api/system-config/retention/reset - Reset Retention Config
  // ============================================================================

  describe("POST /api/system-config/retention/reset", () => {
    it("should reset to default retention configuration", async () => {
      // First update to custom values
      await testClient.put("/api/system-config/retention", {
        maxDeploymentsPerSite: 50,
        deploymentMaxAgeDays: 90,
        artifactRetentionDays: 60,
        logRetentionDays: 30,
      });

      // Reset
      const response = await testClient.post<{
        retention: {
          maxDeploymentsPerSite: number;
        };
      }>("/api/system-config/retention/reset", {});

      expect(response.status).toBe(200);
      // Should be back to defaults
      expect(response.body.retention).toBeDefined();
    });
  });

  // ============================================================================
  // GET /api/system-config/build-defaults - Get Build Defaults
  // ============================================================================

  describe("GET /api/system-config/build-defaults", () => {
    it("should return default build configuration", async () => {
      const response = await testClient.get<{
        buildDefaults: {
          defaultBuildCpus: number;
          defaultBuildMemoryMb: number;
          defaultBuildTimeoutSeconds: number;
        };
      }>("/api/system-config/build-defaults");

      expect(response.status).toBe(200);
      expect(response.body.buildDefaults).toBeDefined();
      expect(response.body.buildDefaults.defaultBuildCpus).toBeGreaterThan(0);
      expect(response.body.buildDefaults.defaultBuildMemoryMb).toBeGreaterThan(0);
      expect(response.body.buildDefaults.defaultBuildTimeoutSeconds).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // PUT /api/system-config/build-defaults - Update Build Defaults
  // ============================================================================

  describe("PUT /api/system-config/build-defaults", () => {
    it("should update build defaults configuration", async () => {
      const response = await testClient.put<{
        buildDefaults: {
          defaultBuildCpus: number;
          defaultBuildMemoryMb: number;
          defaultBuildTimeoutSeconds: number;
        };
      }>("/api/system-config/build-defaults", {
        defaultBuildCpus: 4,
        defaultBuildMemoryMb: 8192,
        defaultBuildTimeoutSeconds: 1800,
      });

      expect(response.status).toBe(200);
      expect(response.body.buildDefaults.defaultBuildCpus).toBe(4);
      expect(response.body.buildDefaults.defaultBuildMemoryMb).toBe(8192);
      expect(response.body.buildDefaults.defaultBuildTimeoutSeconds).toBe(1800);
    });

    it("should validate CPU minimum", async () => {
      const response = await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 0.1, // Invalid: below minimum
        defaultBuildMemoryMb: 4096,
        defaultBuildTimeoutSeconds: 600,
      });

      expect(response.status).toBe(400);
    });

    it("should validate CPU maximum", async () => {
      const response = await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 16, // Invalid: above maximum
        defaultBuildMemoryMb: 4096,
        defaultBuildTimeoutSeconds: 600,
      });

      expect(response.status).toBe(400);
    });

    it("should validate memory minimum", async () => {
      const response = await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 2,
        defaultBuildMemoryMb: 256, // Invalid: below minimum
        defaultBuildTimeoutSeconds: 600,
      });

      expect(response.status).toBe(400);
    });

    it("should validate memory maximum", async () => {
      const response = await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 2,
        defaultBuildMemoryMb: 32768, // Invalid: above maximum
        defaultBuildTimeoutSeconds: 600,
      });

      expect(response.status).toBe(400);
    });

    it("should validate timeout minimum", async () => {
      const response = await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 2,
        defaultBuildMemoryMb: 4096,
        defaultBuildTimeoutSeconds: 30, // Invalid: below minimum
      });

      expect(response.status).toBe(400);
    });

    it("should validate timeout maximum", async () => {
      const response = await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 2,
        defaultBuildMemoryMb: 4096,
        defaultBuildTimeoutSeconds: 7200, // Invalid: above maximum
      });

      expect(response.status).toBe(400);
    });

    it("should persist configuration", async () => {
      await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 3,
        defaultBuildMemoryMb: 6144,
        defaultBuildTimeoutSeconds: 1200,
      });

      const getRes = await testClient.get<{
        buildDefaults: { defaultBuildCpus: number };
      }>("/api/system-config/build-defaults");

      expect(getRes.status).toBe(200);
      expect(getRes.body.buildDefaults.defaultBuildCpus).toBe(3);
    });
  });

  // ============================================================================
  // POST /api/system-config/build-defaults/reset - Reset Build Defaults
  // ============================================================================

  describe("POST /api/system-config/build-defaults/reset", () => {
    it("should reset to default build configuration", async () => {
      // First update to custom values
      await testClient.put("/api/system-config/build-defaults", {
        defaultBuildCpus: 8,
        defaultBuildMemoryMb: 16384,
        defaultBuildTimeoutSeconds: 3600,
      });

      // Reset
      const response = await testClient.post<{
        buildDefaults: {
          defaultBuildCpus: number;
          defaultBuildMemoryMb: number;
          defaultBuildTimeoutSeconds: number;
        };
      }>("/api/system-config/build-defaults/reset", {});

      expect(response.status).toBe(200);
      expect(response.body.buildDefaults).toBeDefined();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle concurrent config updates", async () => {
      const updates = await Promise.all([
        testClient.put("/api/system-config/retention", {
          maxDeploymentsPerSite: 15,
          deploymentMaxAgeDays: 45,
          artifactRetentionDays: 30,
          logRetentionDays: 14,
        }),
        testClient.put("/api/system-config/build-defaults", {
          defaultBuildCpus: 2,
          defaultBuildMemoryMb: 4096,
          defaultBuildTimeoutSeconds: 900,
        }),
      ]);

      updates.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it("should handle config creation when none exists", async () => {
      // Clear any existing config
      await clearDatabase();

      const response = await testClient.put("/api/system-config/retention", {
        maxDeploymentsPerSite: 10,
        deploymentMaxAgeDays: 30,
        artifactRetentionDays: 15,
        logRetentionDays: 7,
      });

      expect(response.status).toBe(200);
      expect(response.body.retention.maxDeploymentsPerSite).toBe(10);
    });
  });
});
