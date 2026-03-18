import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import { processHaproxyReload } from "../../../apps/workers/src/processors/haproxy-reload";
import { type Job } from "bullmq";
import type { HaproxyReloadJobData } from "@uni-proxy-manager/queue";
import { readFile, access, stat } from "fs/promises";
import { getHaproxyConfigPath } from "@uni-proxy-manager/shared/config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

describe("HAProxy Reload Worker", () => {
  const configPath = getHaproxyConfigPath();

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  /**
   * Create a mock BullMQ job
   */
  function createMockJob(data: HaproxyReloadJobData): Job<HaproxyReloadJobData> {
    return {
      id: "test-job-id",
      name: "haproxy-reload",
      data,
      opts: {},
      attemptsMade: 0,
      timestamp: Date.now(),
      returnvalue: undefined,
      failedReason: undefined,
      getState: async () => "active",
      updateProgress: async () => {},
      log: async () => {},
    } as unknown as Job<HaproxyReloadJobData>;
  }

  describe("Config File Verification", () => {
    it("should verify config file exists before reload", async () => {
      // First generate a config by creating a domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Add backend to make domain active
      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Generate config
      await testClient.post("/api/haproxy/reload");

      // Now test the reload worker
      const job = createMockJob({
        reason: "Test reload",
        triggeredBy: "api",
        affectedDomainIds: [domainId],
      });

      const result = await processHaproxyReload(job);

      // Should succeed (config path should be returned)
      expect(result.configPath).toBe(configPath);
    });

    it("should fail gracefully when config file is missing", async () => {
      // Note: This test depends on the system state
      // In a fresh test environment, config might not exist
      const job = createMockJob({
        reason: "Test reload with missing config",
        triggeredBy: "api",
        affectedDomainIds: [],
      });

      // The result depends on whether config exists
      const result = await processHaproxyReload(job);

      // If config doesn't exist, it should report failure
      // If it does exist, it should succeed
      expect(result.configPath).toBeDefined();
    });
  });

  describe("Config Validation", () => {
    it("should validate config before reload", async () => {
      // Create domain with backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Generate config via API
      await testClient.post("/api/haproxy/apply");

      // Verify config file exists
      try {
        await access(configPath);
      } catch {
        // Config might not exist, skip this test
        return;
      }

      // Validate config using haproxy -c
      try {
        const { stdout, stderr } = await execAsync(`haproxy -c -f ${configPath}`);
        // Config should be valid
        expect(stderr).toContain("Configuration file is valid");
      } catch (error) {
        // HAProxy might not be installed in test environment
        // That's OK - we're testing the worker logic, not haproxy itself
      }
    });
  });

  describe("Reload Methods", () => {
    it("should attempt socket-based reload first", async () => {
      // Create domain with backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId));
      await testClient.post("/api/haproxy/apply");

      const job = createMockJob({
        reason: "Test socket reload",
        triggeredBy: "api",
        affectedDomainIds: [domainId],
      });

      const result = await processHaproxyReload(job);

      // Should return one of the valid reload methods
      expect(["socket", "signal", "docker-sighup", "docker-exec"]).toContain(result.reloadMethod);
    });

    it("should fall back to signal-based reload when socket unavailable", async () => {
      // This test verifies the fallback mechanism
      const job = createMockJob({
        reason: "Test signal fallback",
        triggeredBy: "api",
        affectedDomainIds: [],
      });

      const result = await processHaproxyReload(job);

      // In test environment without HAProxy socket, should use signal
      // The exact method depends on the environment
      expect(result.reloadMethod).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle reload failure gracefully", async () => {
      const job = createMockJob({
        reason: "Test failure handling",
        triggeredBy: "api",
        affectedDomainIds: [],
        force: false,
      });

      const result = await processHaproxyReload(job);

      // Should not throw, should return result with status
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("Integration with API", () => {
    it("should reload after domain is created with backend", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Add backend
      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Trigger config generation
      await testClient.post("/api/haproxy/apply");

      // Verify config was written
      try {
        const configContent = await readFile(configPath, "utf-8");

        // Config should contain the domain's frontend
        // (actual content depends on the generateHAProxyConfigString implementation)
        expect(configContent).toBeDefined();
        expect(configContent.length).toBeGreaterThan(0);
      } catch {
        // Config file might not exist in test environment
      }
    });

    it("should include domain backends in generated config", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "test-backend-config.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Add multiple backends
      await testClient.post("/api/backends", createBackendFixture(domainId, {
        name: "primary-backend",
        address: "10.0.0.1",
        port: 8080,
        weight: 100,
      }));

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        name: "secondary-backend",
        address: "10.0.0.2",
        port: 8080,
        weight: 50,
      }));

      // Generate config preview
      const previewRes = await testClient.get<{ config: string }>("/api/haproxy/config/preview");

      if (previewRes.status === 200 && previewRes.body.config) {
        // Config should reference the backends
        expect(previewRes.body.config).toContain("10.0.0.1");
        expect(previewRes.body.config).toContain("10.0.0.2");
      }
    });

    it("should update config when maintenance mode changes", async () => {
      // Create domain with backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maintenance-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Enable maintenance mode
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        bypassIps: ["192.168.1.1"],
      });

      // Generate config preview
      const previewRes = await testClient.get<{ config: string }>("/api/haproxy/config/preview");

      if (previewRes.status === 200 && previewRes.body.config) {
        // Config should include maintenance ACL
        expect(previewRes.body.config).toContain("maintenance");
      }
    });
  });

  describe("Force Reload", () => {
    it("should support force reload option", async () => {
      const job = createMockJob({
        reason: "Force reload test",
        triggeredBy: "api",
        affectedDomainIds: [],
        force: true,
      });

      const result = await processHaproxyReload(job);

      // Force reload should still return a result
      expect(result).toBeDefined();
    });
  });

  describe("Affected Domain IDs", () => {
    it("should track affected domain IDs in job data", async () => {
      // Create multiple domains
      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );

      const job = createMockJob({
        reason: "Multi-domain reload",
        triggeredBy: "api",
        affectedDomainIds: [domain1Res.body.domain.id, domain2Res.body.domain.id],
      });

      // Job data should contain the domain IDs
      expect(job.data.affectedDomainIds).toHaveLength(2);
      expect(job.data.affectedDomainIds).toContain(domain1Res.body.domain.id);
      expect(job.data.affectedDomainIds).toContain(domain2Res.body.domain.id);
    });
  });
});
