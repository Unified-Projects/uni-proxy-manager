import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  type OpenRuntimesClient,
  createOpenRuntimesClient,
  resetOpenRuntimesClient,
  isOpenRuntimesConfigured,
  type CreateRuntimeParams,
  type ExecuteFunctionParams,
} from "../src/openruntimes/client";

/**
 * Helper to create a mock fetch response with proper headers
 */
function createMockResponse(data: unknown, options: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const { ok = true, status = 200, statusText = "OK" } = options;
  return {
    ok,
    status,
    statusText,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "content-type") {
          return "application/json";
        }
        return null;
      },
    },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
  };
}

describe("OpenRuntimesClient", () => {
  let client: OpenRuntimesClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    client = createOpenRuntimesClient({
      endpoint: "http://executor:80",
      secret: "test-secret",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetOpenRuntimesClient();
  });

  describe("constructor", () => {
    it("removes trailing slash from endpoint", () => {
      const client1 = createOpenRuntimesClient({
        endpoint: "http://executor:80/",
        secret: "secret",
      });

      fetchMock.mockResolvedValueOnce(createMockResponse({ status: "pass" }));

      client1.healthCheck();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://executor:80/v1/health",
        expect.any(Object)
      );
    });
  });

  describe("createRuntime", () => {
    it("creates a runtime with correct parameters", async () => {
      const runtimeInfo = {
        runtimeId: "runtime-1",
        image: "openruntimes/node:v4-20.0",
        status: "starting",
        created: new Date().toISOString(),
        cpus: 1,
        memory: 512,
      };

      fetchMock.mockResolvedValueOnce(createMockResponse(runtimeInfo));

      const params: CreateRuntimeParams = {
        runtimeId: "runtime-1",
        image: "openruntimes/node:v4-20.0",
        source: "/storage/source.tar.gz",
        entrypoint: "index.js",
        variables: { NODE_ENV: "production" },
        timeout: 300,
        cpus: 2,
        memory: 1024,
      };

      const result = await client.createRuntime(params);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://executor:80/v1/runtimes",
        expect.objectContaining({
          method: "POST",
        })
      );

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.runtimeId).toBe("runtime-1");
      expect(callBody.image).toBe("openruntimes/node:v4-20.0");
      expect(callBody.source).toBe("/storage/source.tar.gz");
      expect(callBody.entrypoint).toBe("index.js");
      expect(callBody.variables).toEqual({ NODE_ENV: "production" });
      expect(callBody.cpus).toBe(2);
      expect(callBody.memory).toBe(1024);

      expect(result).toEqual(runtimeInfo);
    });

    it("handles runtimeEntrypoint parameter correctly", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1" }));

      await client.createRuntime({
        runtimeId: "runtime-1",
        image: "openruntimes/node:v4-20.0",
        runtimeEntrypoint: "npm start",
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.runtimeEntrypoint).toBe("npm start");
    });
  });

  describe("listRuntimes", () => {
    it("returns list of runtimes", async () => {
      const runtimes = [
        { runtimeId: "runtime-1", status: "ready" },
        { runtimeId: "runtime-2", status: "starting" },
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse({ runtimes }));

      const result = await client.listRuntimes();

      expect(fetchMock).toHaveBeenCalledWith(
        "http://executor:80/v1/runtimes",
        expect.objectContaining({
          method: "GET",
        })
      );
      expect(result).toEqual(runtimes);
    });

    it("returns empty array when no runtimes", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({}));

      const result = await client.listRuntimes();
      expect(result).toEqual([]);
    });
  });

  describe("getRuntime", () => {
    it("returns runtime info when found", async () => {
      const runtime = { runtimeId: "runtime-1", status: "ready" };

      fetchMock.mockResolvedValueOnce(createMockResponse(runtime));

      const result = await client.getRuntime("runtime-1");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://executor:80/v1/runtimes/runtime-1",
        expect.any(Object)
      );
      expect(result).toEqual(runtime);
    });

    it("returns null when runtime not found", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse("Runtime not found", { ok: false, status: 404, statusText: "Not Found" }));

      const result = await client.getRuntime("nonexistent");
      expect(result).toBeNull();
    });

    it("throws on other errors", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse("Server error", { ok: false, status: 500, statusText: "Internal Server Error" }));

      await expect(client.getRuntime("runtime-1")).rejects.toThrow(
        "URT Executor API error: 500"
      );
    });
  });

  describe("deleteRuntime", () => {
    it("deletes a runtime", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({}));

      await client.deleteRuntime("runtime-1");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://executor:80/v1/runtimes/runtime-1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("URT Compatibility", () => {
    it("uses Bearer token authentication", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ status: "pass" }));

      await client.healthCheck();

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.headers.Authorization).toBe("Bearer test-secret");
    });

    it("does not send x-opr-* headers", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ status: "pass" }));

      await client.healthCheck();

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.headers["x-opr-addressing-method"]).toBeUndefined();
      expect(callOptions.headers["x-edge-bypass-gateway"]).toBeUndefined();
      expect(callOptions.headers["x-opr-runtime-id"]).toBeUndefined();
    });

    it("uses multipart/form-data for executions", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({
        statusCode: 200,
        headers: {},
        body: new Uint8Array(),
        logs: "",
        errors: "",
      }));

      await client.execute({ runtimeId: "runtime-1" });

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.headers["Content-Type"]).toContain("multipart/form-data");
      expect(callOptions.headers["Content-Type"]).toContain("UrtBoundary");
      expect(callOptions.headers["Accept"]).toContain("multipart/form-data");
    });

    it("uses application/json for non-execution requests", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1" }));

      await client.createRuntime({
        runtimeId: "runtime-1",
        image: "openruntimes/node:v5-22",
      });

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("execute", () => {
    it("executes a function with all parameters", async () => {
      const executionResult = {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: new Uint8Array(Buffer.from('{"result": "success"}')),
        logs: "[LOG] Function executed",
        errors: "",
      };

      fetchMock.mockResolvedValueOnce(createMockResponse(executionResult));

      const params: ExecuteFunctionParams = {
        runtimeId: "runtime-1",
        body: '{"input": "test"}',
        path: "/api/process",
        method: "POST",
        headers: { "X-Custom": "value" },
        timeout: 30,
        variables: { API_KEY: "key123" },
      };

      const result = await client.execute(params);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://executor:80/v1/runtimes/runtime-1/executions",
        expect.objectContaining({
          method: "POST",
        })
      );

      expect(result.statusCode).toBe(200);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("includes duration in result", async () => {
      fetchMock.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(createMockResponse({
          statusCode: 200,
          headers: {},
          body: new Uint8Array(),
          logs: "",
          errors: "",
        })), 10))
      );

      const result = await client.execute({ runtimeId: "runtime-1" });
      expect(result.duration).toBeGreaterThanOrEqual(5);
    });
  });

  describe("healthCheck", () => {
    it("returns healthy status when API is up", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ status: "pass", version: "0.6.2" }));

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.status).toBe("pass");
      expect(result.version).toBe("0.6.2");
    });

    it("returns unhealthy status on failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe("Connection refused");
    });
  });

  describe("isRuntimeReady", () => {
    it("returns true when runtime is ready", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "ready" }));

      const result = await client.isRuntimeReady("runtime-1");
      expect(result).toBe(true);
    });

    it("returns false when runtime is not ready", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "starting" }));

      const result = await client.isRuntimeReady("runtime-1");
      expect(result).toBe(false);
    });

    it("returns false when runtime does not exist", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse("Not found", { ok: false, status: 404, statusText: "Not Found" }));

      const result = await client.isRuntimeReady("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("waitForRuntime", () => {
    it("returns true when runtime becomes ready", async () => {
      fetchMock
        .mockResolvedValueOnce(createMockResponse({ status: "starting" }))
        .mockResolvedValueOnce(createMockResponse({ status: "ready" }));

      const result = await client.waitForRuntime("runtime-1", {
        timeoutMs: 5000,
        pollIntervalMs: 10,
      });

      expect(result).toBe(true);
    });

    it("throws when runtime enters error state", async () => {
      fetchMock.mockResolvedValue(createMockResponse({ status: "error" }));

      await expect(
        client.waitForRuntime("runtime-1", { timeoutMs: 1000, pollIntervalMs: 10 })
      ).rejects.toThrow("Runtime runtime-1 failed to start");
    });

    it("throws on timeout", async () => {
      fetchMock.mockResolvedValue(createMockResponse({ status: "starting" }));

      await expect(
        client.waitForRuntime("runtime-1", { timeoutMs: 50, pollIntervalMs: 10 })
      ).rejects.toThrow("Timeout waiting for runtime runtime-1 to be ready");
    });
  });

  describe("ensureRuntime", () => {
    it("returns existing ready runtime", async () => {
      const runtime = { runtimeId: "runtime-1", status: "ready", cpus: 1, memory: 512 };

      fetchMock.mockResolvedValueOnce(createMockResponse(runtime));

      const result = await client.ensureRuntime({
        runtimeId: "runtime-1",
        image: "openruntimes/node:v4-20.0",
      });

      expect(result).toEqual(runtime);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("creates new runtime when none exists", async () => {
      fetchMock
        .mockResolvedValueOnce(createMockResponse("Not found", { ok: false, status: 404, statusText: "Not Found" }))
        .mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "starting" }))
        .mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "ready" }));

      const result = await client.ensureRuntime({
        runtimeId: "runtime-1",
        image: "openruntimes/node:v4-20.0",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("deletes and recreates failed runtime", async () => {
      fetchMock
        .mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "error" }))
        .mockResolvedValueOnce(createMockResponse({}))
        .mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "starting" }))
        .mockResolvedValueOnce(createMockResponse({ runtimeId: "runtime-1", status: "ready" }));

      await client.ensureRuntime({
        runtimeId: "runtime-1",
        image: "openruntimes/node:v4-20.0",
      });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
    });
  });
});

describe("isOpenRuntimesConfigured", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns true when SITES_EXECUTOR_SECRET is set", () => {
    process.env.SITES_EXECUTOR_SECRET = "secret";
    expect(isOpenRuntimesConfigured()).toBe(true);
  });

  it("returns true when UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET is set", () => {
    process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET = "secret";
    expect(isOpenRuntimesConfigured()).toBe(true);
  });

  it("returns false when no secrets are set", () => {
    delete process.env.SITES_EXECUTOR_SECRET;
    delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;
    expect(isOpenRuntimesConfigured()).toBe(false);
  });
});
