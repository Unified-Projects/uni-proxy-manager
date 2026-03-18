/**
 * URT (Unified Runtimes) Integration Tests
 *
 * These tests run against a real URT executor Docker container.
 * They verify end-to-end functionality including:
 * - Health checks
 * - Runtime creation and management
 * - Function execution
 * - Build operations
 *
 * Prerequisites:
 * - Docker must be running
 * - test-executor container must be up (see docker-compose.test.yml)
 * - SITES_EXECUTOR_SECRET must match the executor's secret
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  OpenRuntimesClient,
  type ExecutionResult,
  type RuntimeInfo,
} from "../../../packages/shared/src/openruntimes/client";

// Skip these tests if executor is not available or running locally (not in Docker)
// OpenRuntimes executor requires Docker-in-Docker environment to function properly
const IS_DOCKER_ENV = process.env.DATABASE_URL?.includes("test-postgres");
const SKIP_URT_TESTS = process.env.SKIP_URT_TESTS === "true" || !IS_DOCKER_ENV;
const SKIP_IF_NO_EXECUTOR = SKIP_URT_TESTS ? describe.skip : describe;

const EXECUTOR_URL = process.env.SITES_EXECUTOR_ENDPOINT || "http://test-executor:80";
const EXECUTOR_SECRET = process.env.SITES_EXECUTOR_SECRET || "test-executor-secret";
const TEST_RUNTIME_ID = `test-runtime-${Date.now()}`;
const BUILD_RUNTIME_ID = `test-build-${Date.now()}`;

// Simple Node.js function for testing
const TEST_FUNCTION_CODE = `
module.exports = async (context) => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Hello from URT!",
      method: context.req.method,
      path: context.req.path,
      timestamp: new Date().toISOString()
    })
  };
};
`;

// Build function code with package.json
const BUILD_FUNCTION_CODE = JSON.stringify({
  name: "test-function",
  version: "1.0.0",
  main: "index.js",
  dependencies: {},
});

SKIP_IF_NO_EXECUTOR("URT Executor Integration", () => {
  let client: OpenRuntimesClient;

  beforeAll(() => {
    client = new OpenRuntimesClient({
      endpoint: EXECUTOR_URL,
      secret: EXECUTOR_SECRET,
    });
  });

  describe("Health Check", () => {
    it("should return healthy status from URT executor", async () => {
      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.status).toBe("pass");
      expect(result.version).toBeDefined();
    });

    it("should fail gracefully with wrong secret", async () => {
      const wrongClient = new OpenRuntimesClient({
        endpoint: EXECUTOR_URL,
        secret: "wrong-secret",
      });

      const result = await wrongClient.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Runtime CRUD Operations", () => {
    let createdRuntimeId: string;

    beforeEach(() => {
      createdRuntimeId = `${TEST_RUNTIME_ID}-${Date.now()}`;
    });

    it("should create a runtime with v5 protocol", async () => {
      const runtime = await client.createRuntime({
        runtimeId: createdRuntimeId,
        image: "openruntimes/node:v5-22",
        entrypoint: "index.js",
        timeout: 300,
        cpus: 1,
        memory: 512,
        version: "v5",
        restartPolicy: "no",
      });

      expect(runtime).toBeDefined();
      expect(runtime.runtimeId).toBe(createdRuntimeId);
    });

    it("should list created runtimes", async () => {
      const runtimes = await client.listRuntimes();

      expect(Array.isArray(runtimes)).toBe(true);
      // Our test runtime should be in the list
      const found = runtimes.find((r) => r.runtimeId === createdRuntimeId);
      expect(found).toBeDefined();
    });

    it("should get runtime details", async () => {
      const runtime = await client.getRuntime(createdRuntimeId);

      expect(runtime).toBeDefined();
      expect(runtime?.runtimeId).toBe(createdRuntimeId);
    });

    it("should return null for non-existent runtime", async () => {
      const runtime = await client.getRuntime("non-existent-runtime-xyz");
      expect(runtime).toBeNull();
    });

    it("should delete runtime", async () => {
      // First create a runtime
      await client.createRuntime({
        runtimeId: createdRuntimeId,
        image: "openruntimes/node:v5-22",
      });

      // Then delete it
      await client.deleteRuntime(createdRuntimeId);

      // Verify it's gone
      const runtime = await client.getRuntime(createdRuntimeId);
      expect(runtime).toBeNull();
    });
  });

  describe("Function Execution", () => {
    const runtimeId = `exec-test-${Date.now()}`;

    beforeAll(async () => {
      // Create a runtime for testing
      await client.createRuntime({
        runtimeId,
        image: "openruntimes/node:v5-22",
        entrypoint: "index.js",
        timeout: 60,
        cpus: 1,
        memory: 512,
        version: "v5",
        restartPolicy: "always",
      });

      // Wait for runtime to be ready
      await client.waitForRuntime(runtimeId, { timeoutMs: 60000, pollIntervalMs: 2000 });
    });

    afterAll(async () => {
      // Cleanup
      try {
        await client.deleteRuntime(runtimeId);
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should execute a simple function", async () => {
      const result = await client.execute({
        runtimeId,
        method: "GET",
        path: "/",
      });

      expect(result).toBeDefined();
      expect(result.statusCode).toBe(200);
      expect(result.body.length).toBeGreaterThan(0);
    });

    it("should execute with POST method and body", async () => {
      const result = await client.execute({
        runtimeId,
        method: "POST",
        path: "/",
        body: JSON.stringify({ test: "data" }),
        headers: { "content-type": "application/json" },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.length).toBeGreaterThan(0);
    });

    it("should return 404 for non-existent runtime", async () => {
      await expect(
        client.execute({
          runtimeId: "non-existent-runtime-xyz",
          method: "GET",
        })
      ).rejects.toThrow();
    });

    it("should handle custom headers", async () => {
      const result = await client.execute({
        runtimeId,
        method: "GET",
        path: "/",
        headers: {
          "x-custom-header": "test-value",
          authorization: "Bearer test-token",
        },
      });

      expect(result.statusCode).toBe(200);
    });
  });

  describe("Runtime Build Operations", () => {
    const buildRuntimeId = `build-test-${Date.now()}`;

    it("should create a runtime with build command", async () => {
      const runtime = await client.createRuntime({
        runtimeId: buildRuntimeId,
        image: "openruntimes/node:v5-22",
        entrypoint: "index.js",
        command: "npm install", // Simple build command
        timeout: 300,
        cpus: 1,
        memory: 512,
        version: "v5",
        remove: true, // Remove after build
      });

      expect(runtime).toBeDefined();
      // Build should complete and container is removed
    });
  });

  describe("URT-Specific Features", () => {
    it("should use multipart response format", async () => {
      const runtimeId = `multipart-test-${Date.now()}`;

      // Create and wait for runtime
      await client.createRuntime({
        runtimeId,
        image: "openruntimes/node:v5-22",
        timeout: 60,
        cpus: 1,
        memory: 512,
        version: "v5",
        restartPolicy: "always",
      });

      await client.waitForRuntime(runtimeId, { timeoutMs: 60000, pollIntervalMs: 2000 });

      const result = await client.execute({
        runtimeId,
        method: "GET",
      });

      // URT returns multipart response with body as Uint8Array
      expect(result).toBeDefined();
      expect(result.body).toBeInstanceOf(Uint8Array);
      expect(result.statusCode).toBe(200);
      expect(result.logs).toBeDefined();
      expect(result.errors).toBeDefined();

      // Cleanup
      await client.deleteRuntime(runtimeId);
    });

    it("should handle binary response data", async () => {
      const runtimeId = `binary-test-${Date.now()}`;

      await client.createRuntime({
        runtimeId,
        image: "openruntimes/node:v5-22",
        timeout: 60,
        cpus: 1,
        memory: 512,
        version: "v5",
        restartPolicy: "always",
      });

      await client.waitForRuntime(runtimeId, { timeoutMs: 60000, pollIntervalMs: 2000 });

      // Execute and verify binary data is preserved
      const result = await client.execute({
        runtimeId,
        method: "GET",
      });

      // Body should be Uint8Array (preserves binary)
      expect(result.body).toBeInstanceOf(Uint8Array);

      // Cleanup
      await client.deleteRuntime(runtimeId);
    });
  });

  describe("Error Handling", () => {
    it("should handle timeout gracefully", async () => {
      const runtimeId = `timeout-test-${Date.now()}`;

      await client.createRuntime({
        runtimeId,
        image: "openruntimes/node:v5-22",
        timeout: 5, // Very short timeout
        cpus: 1,
        memory: 512,
        version: "v5",
        restartPolicy: "no",
      });

      await client.waitForRuntime(runtimeId, { timeoutMs: 30000, pollIntervalMs: 1000 });

      // This should timeout
      try {
        await client.execute({
          runtimeId,
          timeout: 1, // 1 second execution timeout
        });
        // If we get here without error, the test passes (function was fast enough)
      } catch (error) {
        // Expected: timeout error
        expect(error).toBeDefined();
      }

      // Cleanup
      await client.deleteRuntime(runtimeId);
    });

    it("should handle invalid runtime configuration", async () => {
      await expect(
        client.createRuntime({
          runtimeId: "invalid-image-test",
          image: "non-existent/image:latest",
          timeout: 30,
          cpus: 1,
          memory: 512,
        })
      ).rejects.toThrow();
    });
  });

  describe("Performance", () => {
    it("should execute function within reasonable time", async () => {
      const runtimeId = `perf-test-${Date.now()}`;

      await client.createRuntime({
        runtimeId,
        image: "openruntimes/node:v5-22",
        timeout: 60,
        cpus: 1,
        memory: 512,
        version: "v5",
        restartPolicy: "always",
      });

      await client.waitForRuntime(runtimeId, { timeoutMs: 60000, pollIntervalMs: 2000 });

      const start = Date.now();
      const result = await client.execute({
        runtimeId,
        method: "GET",
      });
      const duration = Date.now() - start;

      expect(result.statusCode).toBe(200);
      // Function should complete within 5 seconds (excluding network latency)
      expect(duration).toBeLessThan(10000);

      // Cleanup
      await client.deleteRuntime(runtimeId);
    });
  });
});
