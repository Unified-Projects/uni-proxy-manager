/**
 * Analytics Config Cache Service Unit Tests
 *
 * Tests for the in-memory configuration cache that maps tracking
 * UUIDs and config IDs to analytics configuration data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database module
const mockFindMany = vi.fn();

vi.mock("../../../../../packages/database/src/index", () => ({
  db: {
    query: {
      analyticsConfig: {
        findMany: mockFindMany,
      },
    },
  },
}));

// Helper: build a mock database config row
function makeMockDbConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "config-1",
    domainId: "domain-1",
    trackingUuid: "uuid-aaa-bbb",
    enabled: true,
    domain: { hostname: "example.com" },
    allowedOrigins: ["https://example.com"],
    ignoredPaths: ["/health"],
    maxBreakdownEntries: 500,
    rawRetentionDays: 30,
    aggregateRetentionDays: 365,
    trackScrollDepth: true,
    trackSessionDuration: true,
    trackOutboundLinks: false,
    captureUtmParams: true,
    ...overrides,
  };
}

describe("Analytics Config Cache Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================================
  // getConfigByUuid
  // ============================================================================

  describe("getConfigByUuid", () => {
    it("should return undefined when the cache is empty", async () => {
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      expect(getConfigByUuid("non-existent-uuid")).toBeUndefined();
    });
  });

  // ============================================================================
  // getConfigById
  // ============================================================================

  describe("getConfigById", () => {
    it("should return undefined when the cache is empty", async () => {
      const { getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      expect(getConfigById("non-existent-id")).toBeUndefined();
    });
  });

  // ============================================================================
  // refreshConfigCache
  // ============================================================================

  describe("refreshConfigCache", () => {
    it("should populate both maps from the database query", async () => {
      const dbConfig = makeMockDbConfig();
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigByUuid, getConfigById } =
        await import(
          "../../../../../apps/analytics/src/services/config-cache"
        );

      await refreshConfigCache();

      expect(getConfigByUuid("uuid-aaa-bbb")).toBeDefined();
      expect(getConfigById("config-1")).toBeDefined();
    });

    it("should map all config fields correctly", async () => {
      const dbConfig = makeMockDbConfig({
        id: "cfg-42",
        domainId: "dom-7",
        trackingUuid: "track-xyz",
        enabled: false,
        domain: { hostname: "analytics.test" },
        allowedOrigins: ["https://a.com", "https://b.com"],
        ignoredPaths: ["/ping", "/robots.txt"],
        maxBreakdownEntries: 250,
        rawRetentionDays: 14,
        aggregateRetentionDays: 180,
        trackScrollDepth: false,
        trackSessionDuration: false,
        trackOutboundLinks: true,
        captureUtmParams: false,
      });
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();
      const cached = getConfigById("cfg-42");

      expect(cached).toEqual({
        id: "cfg-42",
        domainId: "dom-7",
        trackingUuid: "track-xyz",
        enabled: false,
        hostname: "analytics.test",
        allowedOrigins: ["https://a.com", "https://b.com"],
        ignoredPaths: ["/ping", "/robots.txt"],
        maxBreakdownEntries: 250,
        rawRetentionDays: 14,
        aggregateRetentionDays: 180,
        trackScrollDepth: false,
        trackSessionDuration: false,
        trackOutboundLinks: true,
        captureUtmParams: false,
        apiTokenSha256: null,
      });
    });

    it("should set hostname from the domain relation", async () => {
      const dbConfig = makeMockDbConfig({
        domain: { hostname: "my-site.co.uk" },
      });
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(getConfigById("config-1")?.hostname).toBe("my-site.co.uk");
    });

    it("should use an empty string when the domain relation is null", async () => {
      const dbConfig = makeMockDbConfig({ domain: null });
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(getConfigById("config-1")?.hostname).toBe("");
    });

    it("should use an empty string when the domain relation is undefined", async () => {
      const dbConfig = makeMockDbConfig({ domain: undefined });
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(getConfigById("config-1")?.hostname).toBe("");
    });

    it("should handle database errors gracefully without clearing the cache", async () => {
      // First, seed the cache with valid data
      mockFindMany.mockResolvedValue([makeMockDbConfig()]);

      const { refreshConfigCache, getConfigByUuid, getConfigById } =
        await import(
          "../../../../../apps/analytics/src/services/config-cache"
        );

      await refreshConfigCache();
      expect(getConfigByUuid("uuid-aaa-bbb")).toBeDefined();
      expect(getConfigById("config-1")).toBeDefined();

      // Now simulate a database error on the next refresh
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFindMany.mockRejectedValue(new Error("Connection lost"));

      await refreshConfigCache();

      // Old cached data must still be available
      expect(getConfigByUuid("uuid-aaa-bbb")).toBeDefined();
      expect(getConfigById("config-1")).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        "[Analytics] Failed to refresh config cache:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("should log the number of configs after a successful refresh", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockFindMany.mockResolvedValue([
        makeMockDbConfig({ id: "c1", trackingUuid: "u1" }),
        makeMockDbConfig({ id: "c2", trackingUuid: "u2" }),
      ]);

      const { refreshConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Analytics] Config cache refreshed: 2 configs",
      );

      consoleSpy.mockRestore();
    });

    it("should call db.query.analyticsConfig.findMany with the domain relation", async () => {
      mockFindMany.mockResolvedValue([]);

      const { refreshConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(mockFindMany).toHaveBeenCalledWith({
        with: { domain: true },
      });
    });
  });

  // ============================================================================
  // startConfigCache
  // ============================================================================

  describe("startConfigCache", () => {
    it("should call refreshConfigCache immediately", async () => {
      vi.useFakeTimers();
      mockFindMany.mockResolvedValue([]);

      const { startConfigCache, stopConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await startConfigCache();

      expect(mockFindMany).toHaveBeenCalledTimes(1);

      stopConfigCache();
    });

    it("should set up a 60-second refresh interval", async () => {
      vi.useFakeTimers();
      mockFindMany.mockResolvedValue([]);

      const { startConfigCache, stopConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await startConfigCache();
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      // Advance time by 60 seconds -- the interval should fire
      vi.advanceTimersByTime(60_000);
      expect(mockFindMany).toHaveBeenCalledTimes(2);

      // Advance another 60 seconds
      vi.advanceTimersByTime(60_000);
      expect(mockFindMany).toHaveBeenCalledTimes(3);

      stopConfigCache();
    });

    it("should not fire the interval before 60 seconds", async () => {
      vi.useFakeTimers();
      mockFindMany.mockResolvedValue([]);

      const { startConfigCache, stopConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await startConfigCache();
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(59_999);
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      stopConfigCache();
    });
  });

  // ============================================================================
  // stopConfigCache
  // ============================================================================

  describe("stopConfigCache", () => {
    it("should clear the interval so no further refreshes occur", async () => {
      vi.useFakeTimers();
      mockFindMany.mockResolvedValue([]);

      const { startConfigCache, stopConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await startConfigCache();
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      stopConfigCache();

      // Advance well past the interval -- should not trigger another call
      vi.advanceTimersByTime(300_000);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call multiple times", async () => {
      vi.useFakeTimers();
      mockFindMany.mockResolvedValue([]);

      const { startConfigCache, stopConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await startConfigCache();
      stopConfigCache();
      stopConfigCache();
      stopConfigCache();

      // No error should be thrown and timers should be clear
      vi.advanceTimersByTime(300_000);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call without ever starting the cache", async () => {
      const { stopConfigCache } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      // Should not throw when there is no active interval
      expect(() => stopConfigCache()).not.toThrow();
    });
  });

  // ============================================================================
  // Lookup after refresh
  // ============================================================================

  describe("Lookup after refresh", () => {
    it("should return the correct config via getConfigByUuid after refresh", async () => {
      const dbConfig = makeMockDbConfig({
        id: "cfg-abc",
        trackingUuid: "uuid-lookup-test",
        enabled: true,
        domain: { hostname: "lookup.test" },
      });
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      const result = getConfigByUuid("uuid-lookup-test");
      expect(result).toBeDefined();
      expect(result!.id).toBe("cfg-abc");
      expect(result!.hostname).toBe("lookup.test");
      expect(result!.enabled).toBe(true);
    });

    it("should return the correct config via getConfigById after refresh", async () => {
      const dbConfig = makeMockDbConfig({
        id: "cfg-id-lookup",
        trackingUuid: "uuid-999",
        domain: { hostname: "byid.test" },
      });
      mockFindMany.mockResolvedValue([dbConfig]);

      const { refreshConfigCache, getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      const result = getConfigById("cfg-id-lookup");
      expect(result).toBeDefined();
      expect(result!.trackingUuid).toBe("uuid-999");
      expect(result!.hostname).toBe("byid.test");
    });

    it("should store multiple configs correctly", async () => {
      const configs = [
        makeMockDbConfig({
          id: "cfg-1",
          trackingUuid: "uuid-1",
          domain: { hostname: "one.test" },
        }),
        makeMockDbConfig({
          id: "cfg-2",
          trackingUuid: "uuid-2",
          domain: { hostname: "two.test" },
        }),
        makeMockDbConfig({
          id: "cfg-3",
          trackingUuid: "uuid-3",
          domain: { hostname: "three.test" },
        }),
      ];
      mockFindMany.mockResolvedValue(configs);

      const { refreshConfigCache, getConfigByUuid, getConfigById } =
        await import(
          "../../../../../apps/analytics/src/services/config-cache"
        );

      await refreshConfigCache();

      // Verify all three via UUID lookup
      expect(getConfigByUuid("uuid-1")?.hostname).toBe("one.test");
      expect(getConfigByUuid("uuid-2")?.hostname).toBe("two.test");
      expect(getConfigByUuid("uuid-3")?.hostname).toBe("three.test");

      // Verify all three via ID lookup
      expect(getConfigById("cfg-1")?.trackingUuid).toBe("uuid-1");
      expect(getConfigById("cfg-2")?.trackingUuid).toBe("uuid-2");
      expect(getConfigById("cfg-3")?.trackingUuid).toBe("uuid-3");
    });

    it("should return undefined for a UUID that does not exist in a populated cache", async () => {
      mockFindMany.mockResolvedValue([makeMockDbConfig()]);

      const { refreshConfigCache, getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(getConfigByUuid("no-such-uuid")).toBeUndefined();
    });

    it("should return undefined for an ID that does not exist in a populated cache", async () => {
      mockFindMany.mockResolvedValue([makeMockDbConfig()]);

      const { refreshConfigCache, getConfigById } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await refreshConfigCache();

      expect(getConfigById("no-such-id")).toBeUndefined();
    });
  });

  // ============================================================================
  // Swap-on-success pattern
  // ============================================================================

  describe("Swap-on-success pattern", () => {
    it("should preserve old cache data when a refresh fails", async () => {
      const original = makeMockDbConfig({
        id: "original-id",
        trackingUuid: "original-uuid",
      });
      mockFindMany.mockResolvedValue([original]);

      const { refreshConfigCache, getConfigByUuid, getConfigById } =
        await import(
          "../../../../../apps/analytics/src/services/config-cache"
        );

      await refreshConfigCache();
      expect(getConfigByUuid("original-uuid")).toBeDefined();
      expect(getConfigById("original-id")).toBeDefined();

      // Fail the next refresh
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFindMany.mockRejectedValue(new Error("DB down"));

      await refreshConfigCache();

      // Original data must survive
      expect(getConfigByUuid("original-uuid")).toBeDefined();
      expect(getConfigById("original-id")).toBeDefined();

      consoleSpy.mockRestore();
    });

    it("should replace old entries with new data on a successful refresh", async () => {
      // Initial load
      mockFindMany.mockResolvedValue([
        makeMockDbConfig({
          id: "old-cfg",
          trackingUuid: "old-uuid",
          domain: { hostname: "old.test" },
        }),
      ]);

      const { refreshConfigCache, getConfigByUuid, getConfigById } =
        await import(
          "../../../../../apps/analytics/src/services/config-cache"
        );

      await refreshConfigCache();
      expect(getConfigByUuid("old-uuid")?.hostname).toBe("old.test");

      // Refresh with entirely new data
      mockFindMany.mockResolvedValue([
        makeMockDbConfig({
          id: "new-cfg",
          trackingUuid: "new-uuid",
          domain: { hostname: "new.test" },
        }),
      ]);

      await refreshConfigCache();

      // Old entries should be gone
      expect(getConfigByUuid("old-uuid")).toBeUndefined();
      expect(getConfigById("old-cfg")).toBeUndefined();

      // New entries should be present
      expect(getConfigByUuid("new-uuid")?.hostname).toBe("new.test");
      expect(getConfigById("new-cfg")?.hostname).toBe("new.test");
    });

    it("should handle an empty result set without error", async () => {
      // Seed with data first
      mockFindMany.mockResolvedValue([makeMockDbConfig()]);

      const { refreshConfigCache, getConfigByUuid, getConfigById } =
        await import(
          "../../../../../apps/analytics/src/services/config-cache"
        );

      await refreshConfigCache();
      expect(getConfigByUuid("uuid-aaa-bbb")).toBeDefined();

      // Refresh with empty result -- this is a successful query returning zero rows
      mockFindMany.mockResolvedValue([]);

      await refreshConfigCache();

      // Cache should now be empty (successful swap with zero configs)
      expect(getConfigByUuid("uuid-aaa-bbb")).toBeUndefined();
      expect(getConfigById("config-1")).toBeUndefined();
    });
  });
});
