/**
 * Redis Client Unit Tests
 *
 * Tests for the Redis client utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() to create shared mock values available to vi.mock factories.
// IMPORTANT: do NOT call .mockImplementation(fn) inside vi.hoisted() - Vitest's
// transform reduces `vi.fn().mockImplementation(fn)` to just `fn` in that
// context. Set the implementation as a separate module-level statement instead.
const { mockRedisInstance } = vi.hoisted(() => ({
  mockRedisInstance: {
    on: vi.fn().mockReturnThis(),
    ping: vi.fn().mockResolvedValue("PONG"),
    quit: vi.fn().mockResolvedValue("OK"),
  },
}));

vi.mock("ioredis", () => ({
  default: vi.fn(function () { return mockRedisInstance; }),
}));

// Mock the env module
vi.mock("../../../../packages/shared/src/config/env.js", () => ({
  getRedisUrl: vi.fn().mockReturnValue("redis://localhost:6379"),
}));

describe("Redis Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module to clear singleton
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Module Import Tests
  // ============================================================================

  describe("module imports", () => {
    it("should export getRedisClient function", async () => {
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");
      expect(typeof getRedisClient).toBe("function");
    });

    it("should export closeRedisConnection function", async () => {
      const { closeRedisConnection } = await import("../../../../packages/shared/src/redis/client");
      expect(typeof closeRedisConnection).toBe("function");
    });

    it("should export pingRedis function", async () => {
      const { pingRedis } = await import("../../../../packages/shared/src/redis/client");
      expect(typeof pingRedis).toBe("function");
    });
  });

  // ============================================================================
  // Redis Configuration Tests
  // ============================================================================

  describe("Redis configuration", () => {
    it("should use Redis URL from environment", async () => {
      const { getRedisUrl } = await import("../../../../packages/shared/src/config/env.js");
      expect(getRedisUrl()).toBe("redis://localhost:6379");
    });

    it("should configure retry strategy", async () => {
      // The retry strategy is configured in the Redis constructor
      // We verify it through the mock call parameters
      const Redis = (await import("ioredis")).default;
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient();

      expect(Redis).toHaveBeenCalledWith(
        "redis://localhost:6379",
        expect.objectContaining({
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        })
      );
    });
  });

  // ============================================================================
  // Event Handler Tests
  // ============================================================================

  describe("Redis event handlers", () => {
    it("should register error event handler", async () => {
      vi.resetModules();
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient();

      expect(mockRedisInstance.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("should register connect event handler", async () => {
      vi.resetModules();
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient();

      expect(mockRedisInstance.on).toHaveBeenCalledWith("connect", expect.any(Function));
    });

    it("should register reconnecting event handler", async () => {
      vi.resetModules();
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient();

      expect(mockRedisInstance.on).toHaveBeenCalledWith("reconnecting", expect.any(Function));
    });
  });

  // ============================================================================
  // Singleton Tests
  // ============================================================================

  describe("Redis singleton", () => {
    it("should return same instance on multiple calls", async () => {
      vi.resetModules();
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      const client1 = getRedisClient();
      const client2 = getRedisClient();

      expect(client1).toBe(client2);
    });
  });

  // ============================================================================
  // Ping Tests
  // ============================================================================

  describe("pingRedis", () => {
    it("should return true when ping succeeds", async () => {
      vi.resetModules();
      mockRedisInstance.ping.mockResolvedValue("PONG");
      const { pingRedis } = await import("../../../../packages/shared/src/redis/client");

      const result = await pingRedis();

      expect(result).toBe(true);
    });

    it("should return false when ping fails", async () => {
      vi.resetModules();
      mockRedisInstance.ping.mockRejectedValue(new Error("Connection failed"));
      const { pingRedis } = await import("../../../../packages/shared/src/redis/client");

      const result = await pingRedis();

      expect(result).toBe(false);
    });

    it("should return false when ping returns unexpected value", async () => {
      vi.resetModules();
      mockRedisInstance.ping.mockResolvedValue("NOT_PONG");
      const { pingRedis } = await import("../../../../packages/shared/src/redis/client");

      const result = await pingRedis();

      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // Connection Close Tests
  // ============================================================================

  describe("closeRedisConnection", () => {
    it("should call quit on redis client", async () => {
      vi.resetModules();
      const { getRedisClient, closeRedisConnection } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient(); // Initialize the client
      await closeRedisConnection();

      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it("should handle close when no client exists", async () => {
      vi.resetModules();
      const { closeRedisConnection } = await import("../../../../packages/shared/src/redis/client");

      // Should not throw
      await expect(closeRedisConnection()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // Retry Strategy Tests
  // ============================================================================

  describe("retry strategy", () => {
    it("should return null after 10 retries", async () => {
      const Redis = (await import("ioredis")).default;
      vi.resetModules();
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient();

      // Get the retry strategy from the constructor call
      const constructorCall = (Redis as ReturnType<typeof vi.fn>).mock.calls[0];
      const options = constructorCall?.[1];
      const retryStrategy = options?.retryStrategy;

      expect(retryStrategy).toBeDefined();
      expect(retryStrategy(11)).toBeNull();
    });

    it("should return increasing delay up to max of 1000ms (at 10 retries)", async () => {
      const Redis = (await import("ioredis")).default;
      vi.resetModules();
      const { getRedisClient } = await import("../../../../packages/shared/src/redis/client");

      getRedisClient();

      const constructorCall = (Redis as ReturnType<typeof vi.fn>).mock.calls[0];
      const options = constructorCall?.[1];
      const retryStrategy = options?.retryStrategy;

      expect(retryStrategy(1)).toBe(100);
      expect(retryStrategy(5)).toBe(500);
      expect(retryStrategy(10)).toBe(1000);
      // After 10 retries, returns null to stop
      expect(retryStrategy(11)).toBeNull();
    });
  });
});
