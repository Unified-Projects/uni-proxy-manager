/**
 * Config/Env Unit Tests
 *
 * Tests for the environment configuration utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Mock fs module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

describe("Config/Env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ============================================================================
  // readFileSecret Tests
  // ============================================================================

  describe("readFileSecret", () => {
    it("should return environment variable when _FILE variant not set", async () => {
      process.env.TEST_VAR = "direct-value";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { readFileSecret } = await import("../../../../packages/shared/src/config/env");

      const result = readFileSecret("TEST_VAR");
      expect(result).toBe("direct-value");
    });

    it("should read from file when _FILE variant is set", async () => {
      process.env.TEST_VAR_FILE = "/secrets/test-var";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("file-value\n");

      vi.resetModules();
      const { readFileSecret } = await import("../../../../packages/shared/src/config/env");

      const result = readFileSecret("TEST_VAR");
      expect(result).toBe("file-value");
    });

    it("should trim whitespace from file content", async () => {
      process.env.TEST_VAR_FILE = "/secrets/test-var";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("  value-with-spaces  \n");

      vi.resetModules();
      const { readFileSecret } = await import("../../../../packages/shared/src/config/env");

      const result = readFileSecret("TEST_VAR");
      expect(result).toBe("value-with-spaces");
    });

    it("should throw when file does not exist", async () => {
      process.env.TEST_VAR_FILE = "/secrets/missing-file";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      vi.resetModules();
      const { readFileSecret } = await import("../../../../packages/shared/src/config/env");

      expect(() => readFileSecret("TEST_VAR")).toThrow("Secret file not found");
    });

    it("should return undefined when neither set", async () => {
      delete process.env.TEST_VAR;
      delete process.env.TEST_VAR_FILE;

      vi.resetModules();
      const { readFileSecret } = await import("../../../../packages/shared/src/config/env");

      const result = readFileSecret("TEST_VAR");
      expect(result).toBeUndefined();
    });
  });

  // ============================================================================
  // readSecretFile Tests
  // ============================================================================

  describe("readSecretFile", () => {
    it("should read and trim file content", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("secret-content\n");

      vi.resetModules();
      const { readSecretFile } = await import("../../../../packages/shared/src/config/env");

      const result = readSecretFile("/path/to/secret");
      expect(result).toBe("secret-content");
    });

    it("should throw when file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      vi.resetModules();
      const { readSecretFile } = await import("../../../../packages/shared/src/config/env");

      expect(() => readSecretFile("/missing/file")).toThrow("Secret file not found");
    });
  });

  // ============================================================================
  // getEnv Tests
  // ============================================================================

  describe("getEnv", () => {
    it("should return default values when not set", async () => {
      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();

      expect(env.UNI_PROXY_MANAGER_URL).toBe("http://localhost");
      expect(env.UNI_PROXY_MANAGER_API_PORT).toBe(3001);
    });

    it("should parse custom URL", async () => {
      process.env.UNI_PROXY_MANAGER_URL = "https://example.com";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_URL).toBe("https://example.com");
    });

    it("should parse custom API port", async () => {
      process.env.UNI_PROXY_MANAGER_API_PORT = "8080";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_API_PORT).toBe(8080);
    });

    it("should cache parsed environment", async () => {
      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env1 = getEnv();
      const env2 = getEnv();

      expect(env1).toBe(env2);
    });
  });

  // ============================================================================
  // Boolean Coercion Tests
  // ============================================================================

  describe("boolean coercion", () => {
    it("should coerce 'true' to true", async () => {
      process.env.UNI_PROXY_MANAGER_ACME_STAGING = "true";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_ACME_STAGING).toBe(true);
    });

    it("should coerce '1' to true", async () => {
      process.env.UNI_PROXY_MANAGER_CORS_ENABLED = "1";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_CORS_ENABLED).toBe(true);
    });

    it("should coerce 'false' to false", async () => {
      process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "false";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_AUTH_ENABLED).toBe(false);
    });

    it("should coerce '0' to false", async () => {
      process.env.UNI_PROXY_MANAGER_ACME_STAGING = "0";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_ACME_STAGING).toBe(false);
    });

    it("should coerce 'yes' to true", async () => {
      process.env.UNI_PROXY_MANAGER_CORS_ENABLED = "yes";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_CORS_ENABLED).toBe(true);
    });

    it("should coerce 'no' to false", async () => {
      process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "no";

      vi.resetModules();
      const { getEnv, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const env = getEnv();
      expect(env.UNI_PROXY_MANAGER_AUTH_ENABLED).toBe(false);
    });
  });

  // ============================================================================
  // Convenience Getter Tests
  // ============================================================================

  describe("getAppUrl", () => {
    it("should return URL without trailing slash", async () => {
      process.env.UNI_PROXY_MANAGER_URL = "https://example.com/";

      vi.resetModules();
      const { getAppUrl, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      expect(getAppUrl()).toBe("https://example.com");
    });
  });

  describe("getDatabaseUrl", () => {
    it("should return DATABASE_URL when set", async () => {
      delete process.env.UNI_PROXY_MANAGER_DB_URL;
      process.env.DATABASE_URL = "postgresql://localhost:5432/db";

      vi.resetModules();
      const { getDatabaseUrl, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      expect(getDatabaseUrl()).toBe("postgresql://localhost:5432/db");
    });

    it("should prefer UNI_PROXY_MANAGER_DB_URL over DATABASE_URL", async () => {
      process.env.DATABASE_URL = "postgresql://fallback/db";
      process.env.UNI_PROXY_MANAGER_DB_URL = "postgresql://primary/db";

      vi.resetModules();
      const { getDatabaseUrl, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      expect(getDatabaseUrl()).toBe("postgresql://primary/db");
    });

    it("should throw when not set", async () => {
      delete process.env.DATABASE_URL;
      delete process.env.UNI_PROXY_MANAGER_DB_URL;

      vi.resetModules();
      const { getDatabaseUrl, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      expect(() => getDatabaseUrl()).toThrow("DATABASE_URL");
    });
  });

  describe("getRedisUrl", () => {
    it("should return default when not set", async () => {
      delete process.env.REDIS_URL;
      delete process.env.UNI_PROXY_MANAGER_REDIS_URL;

      vi.resetModules();
      const { getRedisUrl, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      expect(getRedisUrl()).toBe("redis://localhost:6379");
    });

    it("should return REDIS_URL when set", async () => {
      process.env.REDIS_URL = "redis://custom:6380";

      vi.resetModules();
      const { getRedisUrl, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      expect(getRedisUrl()).toBe("redis://custom:6380");
    });
  });

  describe("getAcmeConfig", () => {
    it("should return production directory URL by default", async () => {
      process.env.UNI_PROXY_MANAGER_ACME_STAGING = "false";

      vi.resetModules();
      const { getAcmeConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getAcmeConfig();
      expect(config.directoryUrl).toContain("acme-v02.api.letsencrypt.org");
      expect(config.staging).toBe(false);
    });

    it("should return staging directory URL when staging enabled", async () => {
      process.env.UNI_PROXY_MANAGER_ACME_STAGING = "true";

      vi.resetModules();
      const { getAcmeConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getAcmeConfig();
      expect(config.directoryUrl).toContain("acme-staging-v02");
      expect(config.staging).toBe(true);
    });

    it("should allow custom directory URL", async () => {
      process.env.UNI_PROXY_MANAGER_ACME_DIRECTORY_URL = "https://custom-acme.example.com";

      vi.resetModules();
      const { getAcmeConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getAcmeConfig();
      expect(config.directoryUrl).toBe("https://custom-acme.example.com");
    });
  });

  describe("getCorsConfig", () => {
    it("should include default origins", async () => {
      vi.resetModules();
      const { getCorsConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getCorsConfig();
      expect(config.origins).toContain("http://localhost:3000");
    });

    it("should parse custom origins from comma-separated string", async () => {
      process.env.UNI_PROXY_MANAGER_CORS_ORIGINS = "https://app1.com,https://app2.com";

      vi.resetModules();
      const { getCorsConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getCorsConfig();
      expect(config.origins).toContain("https://app1.com");
      expect(config.origins).toContain("https://app2.com");
    });

    it("should deduplicate origins", async () => {
      process.env.UNI_PROXY_MANAGER_CORS_ORIGINS = "http://localhost:3000,http://localhost:3000";

      vi.resetModules();
      const { getCorsConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getCorsConfig();
      const localhost3000Count = config.origins.filter(o => o === "http://localhost:3000").length;
      expect(localhost3000Count).toBe(1);
    });
  });

  describe("getAuthConfig", () => {
    it("should return disabled when no API key set", async () => {
      delete process.env.UNI_PROXY_MANAGER_API_KEY;

      vi.resetModules();
      const { getAuthConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getAuthConfig();
      expect(config.enabled).toBe(false);
      expect(config.apiKey).toBe("");
    });

    it("should return enabled when API key set", async () => {
      process.env.UNI_PROXY_MANAGER_API_KEY = "a".repeat(32);
      process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "true";

      vi.resetModules();
      const { getAuthConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getAuthConfig();
      expect(config.enabled).toBe(true);
      expect(config.apiKey).toBe("a".repeat(32));
    });
  });

  describe("getStatsConfig", () => {
    it("should return default user", async () => {
      vi.resetModules();
      const { getStatsConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getStatsConfig();
      expect(config.user).toBe("admin");
    });

    it("should return custom user when set", async () => {
      process.env.UNI_PROXY_MANAGER_STATS_USER = "custom-user";

      vi.resetModules();
      const { getStatsConfig, resetEnvCache } = await import("../../../../packages/shared/src/config/env");
      resetEnvCache();

      const config = getStatsConfig();
      expect(config.user).toBe("custom-user");
    });
  });
});
