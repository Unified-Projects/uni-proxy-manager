import { describe, it, expect } from "vitest";
import {
  checkHaproxyHealth,
  checkHaproxyHealthHttp,
  isHaproxyRunning,
  HaproxyHealthResult,
} from "../../../packages/shared/src/haproxy/stats-socket";

describe("HAProxy Health Checks", () => {
  describe("checkHaproxyHealthHttp", () => {
    it("should return unhealthy when HAProxy is not running", async () => {
      const result = await checkHaproxyHealthHttp("http://localhost:8404/stats");

      expect(result).toHaveProperty("healthy");
      expect(typeof result.healthy).toBe("boolean");
    });

    it("should handle connection refused gracefully", async () => {
      const result = await checkHaproxyHealthHttp("http://localhost:19999/stats");

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle timeout gracefully", async () => {
      const result = await checkHaproxyHealthHttp("http://10.255.255.1:8404/stats");

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should accept custom endpoint", async () => {
      const result = await checkHaproxyHealthHttp("http://custom-host:9999/health");

      expect(result).toHaveProperty("healthy");
      expect(result).toHaveProperty("error");
    });
  });

  describe("checkHaproxyHealth", () => {
    it("should return result with method property", async () => {
      const result = await checkHaproxyHealth();

      expect(result).toHaveProperty("healthy");
      expect(result).toHaveProperty("method");
      expect(["http", "socket", "none"]).toContain(result.method);
    });

    it("should return error when both methods fail", async () => {
      const result = await checkHaproxyHealth();

      if (!result.healthy) {
        expect(result.method).toBe("none");
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("isHaproxyRunning", () => {
    it("should return boolean", async () => {
      const result = await isHaproxyRunning();
      expect(typeof result).toBe("boolean");
    });
  });
});
