import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  OpenRuntimesClient,
  validateOpenRuntimesConfiguration,
  isOpenRuntimesConfigured,
} from "../../../packages/shared/src/openruntimes/client";

describe("OpenRuntimes Executor", () => {
  const originalEnv = { ...process.env };

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("validateOpenRuntimesConfiguration", () => {
    it("should return errors when secret is missing", () => {
      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("secret not configured");
    });

    it("should return valid when secret is set", () => {
      process.env.SITES_EXECUTOR_SECRET = "test-secret";
      // Clear endpoint to test default
      delete process.env.SITES_EXECUTOR_ENDPOINT;

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.endpoint).toBe("http://openruntimes-executor:80");

      delete process.env.SITES_EXECUTOR_SECRET;
    });

    it("should use SITES_EXECUTOR_SECRET over fallback", () => {
      process.env.SITES_EXECUTOR_SECRET = "primary-secret";
      process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET = "fallback-secret";

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(true);

      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;
    });

    it("should use fallback secret when primary is not set", () => {
      delete process.env.SITES_EXECUTOR_SECRET;
      process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET = "fallback-secret";

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(true);

      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;
    });

    it("should use custom endpoint when provided", () => {
      process.env.SITES_EXECUTOR_SECRET = "test-secret";
      process.env.SITES_EXECUTOR_ENDPOINT = "http://custom-executor:9000";

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(true);
      expect(result.endpoint).toBe("http://custom-executor:9000");

      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.SITES_EXECUTOR_ENDPOINT;
    });

    it("should validate endpoint URL format", () => {
      process.env.SITES_EXECUTOR_SECRET = "test-secret";
      process.env.SITES_EXECUTOR_ENDPOINT = "not-a-valid-url";

      const result = validateOpenRuntimesConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid"))).toBe(true);

      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.SITES_EXECUTOR_ENDPOINT;
    });
  });

  describe("isOpenRuntimesConfigured", () => {
    it("should return false when no secret is set", () => {
      delete process.env.SITES_EXECUTOR_SECRET;
      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;

      expect(isOpenRuntimesConfigured()).toBe(false);
    });

    it("should return true when SITES_EXECUTOR_SECRET is set", () => {
      process.env.SITES_EXECUTOR_SECRET = "test-secret";

      expect(isOpenRuntimesConfigured()).toBe(true);

      delete process.env.SITES_EXECUTOR_SECRET;
    });

    it("should return true when fallback secret is set", () => {
      process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET = "test-secret";

      expect(isOpenRuntimesConfigured()).toBe(true);

      delete process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;
    });
  });

  describe("OpenRuntimesClient", () => {
    let client: OpenRuntimesClient;

    beforeAll(() => {
      client = new OpenRuntimesClient({
        endpoint: "http://localhost:9900",
        secret: "test-secret",
      });
    });

    it("should construct with valid config", () => {
      expect(client).toBeInstanceOf(OpenRuntimesClient);
    });

    it("should strip trailing slash from endpoint", () => {
      const clientWithSlash = new OpenRuntimesClient({
        endpoint: "http://localhost:9900/",
        secret: "test-secret",
      });
      expect(clientWithSlash).toBeInstanceOf(OpenRuntimesClient);
    });

    it("should handle health check failure gracefully", async () => {
      const result = await client.healthCheck();

      expect(result).toHaveProperty("healthy");
      expect(typeof result.healthy).toBe("boolean");
      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return null for non-existent runtime", async () => {
      try {
        const runtime = await client.getRuntime("non-existent-runtime");
        expect(runtime).toBeNull();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
