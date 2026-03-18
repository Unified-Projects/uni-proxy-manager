/**
 * OpenRuntimes Client Unit Tests
 *
 * Tests for the OpenRuntimes executor client utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenRuntimesClient,
  getOpenRuntimesClient,
  isOpenRuntimesConfigured,
  validateOpenRuntimesConfiguration,
  createOpenRuntimesClient,
  resetOpenRuntimesClient,
  type OpenRuntimesConfig,
  type CreateRuntimeParams,
  type ExecuteFunctionParams,
  type BuildRuntimeParams,
  type RuntimeInfo,
  type ExecutionResult,
} from "../../../../packages/shared/src/openruntimes/client";

// Mock fetch
global.fetch = vi.fn();

describe("OpenRuntimes Client", () => {
  const testConfig: OpenRuntimesConfig = {
    endpoint: "http://openruntimes-executor:80",
    secret: "test-secret-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetOpenRuntimesClient();
    delete process.env.SITES_EXECUTOR_ENDPOINT;
    delete process.env.SITES_EXECUTOR_SECRET;
    delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_ENDPOINT;
    delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetOpenRuntimesClient();
  });

  // ============================================================================
  // Constructor Tests
  // ============================================================================

  describe("OpenRuntimesClient constructor", () => {
    it("should create a new client instance", () => {
      const client = new OpenRuntimesClient(testConfig);
      expect(client).toBeInstanceOf(OpenRuntimesClient);
    });

    it("should strip trailing slash from endpoint", () => {
      const client = new OpenRuntimesClient({
        ...testConfig,
        endpoint: "http://executor:80/",
      });
      expect(client).toBeInstanceOf(OpenRuntimesClient);
    });
  });

  // ============================================================================
  // Configuration Check Tests
  // ============================================================================

  describe("isOpenRuntimesConfigured", () => {
    it("should return true when SITES_EXECUTOR_SECRET is set", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";
      expect(isOpenRuntimesConfigured()).toBe(true);
    });

    it("should return true when UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET is set", () => {
      process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET = "secret";
      expect(isOpenRuntimesConfigured()).toBe(true);
    });

    it("should return false when no secret is set", () => {
      expect(isOpenRuntimesConfigured()).toBe(false);
    });
  });

  describe("validateOpenRuntimesConfiguration", () => {
    it("should return valid when secret is set", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.endpoint).toBe("http://openruntimes-executor:80");
    });

    it("should return errors when secret is missing", () => {
      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.endpoint).toBeNull();
    });

    it("should use custom endpoint when set", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";
      process.env.SITES_EXECUTOR_ENDPOINT = "http://custom:8080";

      const result = validateOpenRuntimesConfiguration();

      expect(result.endpoint).toBe("http://custom:8080");
    });

    it("should validate endpoint URL format", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";
      process.env.SITES_EXECUTOR_ENDPOINT = "not-a-valid-url";

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid"))).toBe(true);
    });
  });

  // ============================================================================
  // Singleton Tests
  // ============================================================================

  describe("getOpenRuntimesClient", () => {
    it("should throw when not configured", () => {
      expect(() => getOpenRuntimesClient()).toThrow("OpenRuntimes secret not configured");
    });

    it("should return client when configured", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";
      const client = getOpenRuntimesClient();
      expect(client).toBeInstanceOf(OpenRuntimesClient);
    });

    it("should return same instance on multiple calls", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";
      const client1 = getOpenRuntimesClient();
      const client2 = getOpenRuntimesClient();
      expect(client1).toBe(client2);
    });
  });

  describe("createOpenRuntimesClient", () => {
    it("should create new client with custom config", () => {
      const client = createOpenRuntimesClient(testConfig);
      expect(client).toBeInstanceOf(OpenRuntimesClient);
    });
  });

  describe("resetOpenRuntimesClient", () => {
    it("should clear singleton instance", () => {
      process.env.SITES_EXECUTOR_SECRET = "secret";
      const client1 = getOpenRuntimesClient();
      resetOpenRuntimesClient();
      const client2 = getOpenRuntimesClient();
      expect(client1).not.toBe(client2);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("CreateRuntimeParams type", () => {
    it("should have required fields", () => {
      const params: CreateRuntimeParams = {
        runtimeId: "runtime-123",
        image: "openruntimes/node:v4-20.0",
      };

      expect(params.runtimeId).toBe("runtime-123");
      expect(params.image).toContain("openruntimes");
    });

    it("should accept optional fields", () => {
      const params: CreateRuntimeParams = {
        runtimeId: "runtime-123",
        image: "openruntimes/node:v4-20.0",
        source: "/storage/code.tar.gz",
        destination: "/storage/builds",
        entrypoint: "index.js",
        variables: { NODE_ENV: "production" },
        timeout: 300,
        cpus: 2,
        memory: 1024,
        version: "v5",
      };

      expect(params.timeout).toBe(300);
      expect(params.cpus).toBe(2);
      expect(params.memory).toBe(1024);
      expect(params.version).toBe("v5");
    });
  });

  describe("ExecuteFunctionParams type", () => {
    it("should have required runtimeId", () => {
      const params: ExecuteFunctionParams = {
        runtimeId: "runtime-123",
      };

      expect(params.runtimeId).toBe("runtime-123");
    });

    it("should accept all execution options", () => {
      const params: ExecuteFunctionParams = {
        runtimeId: "runtime-123",
        body: JSON.stringify({ key: "value" }),
        path: "/api/hello",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: 30,
        variables: { API_KEY: "secret" },
        logging: true,
        restartPolicy: "always",
      };

      expect(params.method).toBe("POST");
      expect(params.path).toBe("/api/hello");
      expect(params.restartPolicy).toBe("always");
    });

    it("should allow all HTTP methods", () => {
      const methods: ExecuteFunctionParams["method"][] = [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "OPTIONS",
      ];

      methods.forEach(method => {
        const params: ExecuteFunctionParams = {
          runtimeId: "runtime-123",
          method,
        };
        expect(params.method).toBe(method);
      });
    });
  });

  describe("BuildRuntimeParams type", () => {
    it("should have all required fields", () => {
      const params: BuildRuntimeParams = {
        deploymentId: "deploy-123",
        projectId: "project-456",
        source: "/storage/source.tar.gz",
        image: "openruntimes/node:v5-20.0",
        version: "v5",
        cpus: 2,
        memory: 2048,
        timeout: 600,
        destination: "/storage/builds/project-456",
        command: "npm install && npm run build",
      };

      expect(params.deploymentId).toBe("deploy-123");
      expect(params.projectId).toBe("project-456");
      expect(params.command).toContain("npm run build");
    });

    it("should accept optional fields", () => {
      const params: BuildRuntimeParams = {
        deploymentId: "deploy-123",
        projectId: "project-456",
        source: "/storage/source.tar.gz",
        image: "openruntimes/node:v5-20.0",
        version: "v5",
        cpus: 2,
        memory: 2048,
        timeout: 600,
        destination: "/storage/builds",
        command: "npm run build",
        remove: true,
        entrypoint: "server.js",
        variables: { NODE_ENV: "production" },
        outputDirectory: ".next",
        runtimeEntrypoint: "start.sh",
      };

      expect(params.remove).toBe(true);
      expect(params.outputDirectory).toBe(".next");
    });
  });

  describe("RuntimeInfo type", () => {
    it("should represent runtime state", () => {
      const runtime: RuntimeInfo = {
        runtimeId: "runtime-123",
        name: "Node.js Runtime",
        image: "openruntimes/node:v5-20.0",
        status: "ready",
        created: Date.now(),
        updated: Date.now(),
        cpus: 2,
        memory: 1024,
        listening: 1,
        initialised: 1,
      };

      expect(runtime.status).toBe("ready");
      expect(runtime.listening).toBe(1);
    });
  });

  describe("ExecutionResult type", () => {
    it("should represent execution response", () => {
      const result: ExecutionResult = {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: new TextEncoder().encode('{"success": true}'),
        logs: "Function executed successfully",
        errors: "",
        duration: 150,
      };

      expect(result.statusCode).toBe(200);
      expect(result.duration).toBe(150);
    });

    it("should handle error response", () => {
      const result: ExecutionResult = {
        statusCode: 500,
        headers: {},
        body: new Uint8Array(),
        logs: "",
        errors: "Runtime error: undefined is not a function",
        duration: 50,
      };

      expect(result.statusCode).toBe(500);
      expect(result.errors).toContain("Runtime error");
    });
  });

  // ============================================================================
  // Health Check Tests
  // ============================================================================

  describe("healthCheck", () => {
    it("should return healthy when API responds correctly", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ status: "pass", version: "1.0.0" }),
      } as Response);

      const client = new OpenRuntimesClient(testConfig);
      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.status).toBe("pass");
    });

    it("should return unhealthy when API fails", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error("Connection refused"));

      const client = new OpenRuntimesClient(testConfig);
      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
