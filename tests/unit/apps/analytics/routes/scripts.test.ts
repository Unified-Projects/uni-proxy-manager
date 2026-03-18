/**
 * Analytics Script Serving Routes Unit Tests
 *
 * Tests for the script.js and tracker.js endpoints that serve
 * analytics scripts with per-site configuration injection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config cache
vi.mock("../../../../../apps/analytics/src/services/config-cache", () => ({
  getConfigByUuid: vi.fn(),
}));

// Mock fs/promises (used by preloadScripts)
const mockReadFile = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Mock url module for ESM __dirname
vi.mock("url", () => ({
  fileURLToPath: vi.fn().mockReturnValue("/mock/path/scripts.ts"),
}));

const MOCK_BOOTSTRAP = "/*! Old banner */\nconsole.log('bootstrap');";
const MOCK_TRACKER = "/*! Old banner */\nconsole.log('tracker');";

const mockConfig = {
  id: "config-1",
  trackingUuid: "test-uuid",
  enabled: true,
  trackScrollDepth: true,
  trackSessionDuration: false,
  trackOutboundLinks: true,
};

const disabledConfig = {
  ...mockConfig,
  enabled: false,
};

function setupFsMock() {
  mockReadFile.mockImplementation((filePath: string) => {
    if (filePath.includes("bootstrap")) return Promise.resolve(MOCK_BOOTSTRAP);
    if (filePath.includes("tracker")) return Promise.resolve(MOCK_TRACKER);
    return Promise.reject(new Error("File not found"));
  });
}

describe("Analytics Script Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setupFsMock();
  });

  // ==========================================================================
  // GET /:uuid/script.js
  // ==========================================================================

  describe("GET /:uuid/script.js", () => {
    it("should return 404 for an unknown UUID", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(undefined);

      const res = await app.request("/unknown-uuid/script.js");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    });

    it("should return 404 for a disabled config", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(disabledConfig as any);

      const res = await app.request("/test-uuid/script.js");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    });

    it("should return 200 with correct Content-Type header", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/javascript; charset=utf-8",
      );
    });

    it("should return Cache-Control header set to public, max-age=3600", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");

      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("should include copyright banner in the response", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");
      const body = await res.text();

      expect(body).toContain("UPM Analytics");
      expect(body).toContain("Unified Projects LTD.");
      expect(body).toMatch(/^\/\*!/);
    });

    it("should inject window.__upmConfig with feature toggles", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");
      const body = await res.text();

      expect(body).toContain("window.__upmConfig=");
    });

    it("should reflect config values in feature toggles", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");
      const body = await res.text();

      const expectedConfig = JSON.stringify({
        scrollDepth: true,
        sessionDuration: false,
        outboundLinks: true,
      });

      expect(body).toContain(`window.__upmConfig=${expectedConfig};`);
    });

    it("should strip existing bang comment from the script", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");
      const body = await res.text();

      // The old banner should be stripped
      expect(body).not.toContain("Old banner");
      // The script content should still be present
      expect(body).toContain("console.log('bootstrap');");
    });

    it("should not re-read the files on subsequent requests (preloaded)", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      const readCountAfterPreload = mockReadFile.mock.calls.length;

      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      // Request the script twice
      await app.request("/test-uuid/script.js");
      await app.request("/test-uuid/script.js");

      // No additional file reads should occur after preloading
      expect(mockReadFile.mock.calls.length).toBe(readCountAfterPreload);
    });
  });

  // ==========================================================================
  // GET /:uuid/tracker.js
  // ==========================================================================

  describe("GET /:uuid/tracker.js", () => {
    it("should return 404 for an unknown UUID", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(undefined);

      const res = await app.request("/unknown-uuid/tracker.js");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    });

    it("should return 404 for a disabled config", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(disabledConfig as any);

      const res = await app.request("/test-uuid/tracker.js");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    });

    it("should return 200 with correct Content-Type", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/tracker.js");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/javascript; charset=utf-8",
      );
    });

    it("should return Cache-Control header set to public, max-age=3600", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/tracker.js");

      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("should include copyright banner in the response", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/tracker.js");
      const body = await res.text();

      expect(body).toContain("UPM Analytics");
      expect(body).toContain("Unified Projects LTD.");
      expect(body).toMatch(/^\/\*!/);
    });

    it("should NOT include config injection (no window.__upmConfig)", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/tracker.js");
      const body = await res.text();

      expect(body).not.toContain("window.__upmConfig");
    });

    it("should strip existing bang comment from the script", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/tracker.js");
      const body = await res.text();

      // The old banner should be stripped
      expect(body).not.toContain("Old banner");
      // The script content should still be present
      expect(body).toContain("console.log('tracker');");
    });

    it("should not re-read the files on subsequent requests (preloaded)", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      const readCountAfterPreload = mockReadFile.mock.calls.length;

      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      // Request the tracker twice
      await app.request("/test-uuid/tracker.js");
      await app.request("/test-uuid/tracker.js");

      // No additional file reads should occur after preloading
      expect(mockReadFile.mock.calls.length).toBe(readCountAfterPreload);
    });
  });

  // ==========================================================================
  // preloadScripts
  // ==========================================================================

  describe("preloadScripts", () => {
    it("should read both bootstrap.js and tracker.js", async () => {
      const { preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );

      await preloadScripts();

      expect(mockReadFile).toHaveBeenCalledTimes(2);
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("bootstrap.js"),
        "utf-8",
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("tracker.js"),
        "utf-8",
      );
    });
  });

  // ==========================================================================
  // Banner
  // ==========================================================================

  describe("Banner", () => {
    it("should contain the current year", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/script.js");
      const body = await res.text();

      const currentYear = new Date().getFullYear().toString();
      expect(body).toContain(currentYear);
    });

    it("should contain 'UPM Analytics'", async () => {
      const { default: app, preloadScripts } = await import(
        "../../../../../apps/analytics/src/routes/scripts"
      );
      const { getConfigByUuid } = await import(
        "../../../../../apps/analytics/src/services/config-cache"
      );

      await preloadScripts();
      vi.mocked(getConfigByUuid).mockReturnValue(mockConfig as any);

      const res = await app.request("/test-uuid/tracker.js");
      const body = await res.text();

      expect(body).toContain("UPM Analytics");
    });
  });
});
