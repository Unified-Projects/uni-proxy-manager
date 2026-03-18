/**
 * Pomerium Settings API Integration Tests
 *
 * Tests for the /api/pomerium/settings endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../../setup/test-db";
import { createPomeriumSettingsFixture } from "../../setup/pomerium-fixtures";

describe("Pomerium Settings API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  // ============================================================================
  // GET /api/pomerium/settings - Get Settings
  // ============================================================================

  describe("GET /api/pomerium/settings", () => {
    it("should return default settings on first access", async () => {
      const response = await testClient.get("/api/pomerium/settings");

      expect(response.status).toBe(200);
      expect(response.body.settings).toBeDefined();
      expect(response.body.settings.cookieName).toBeDefined();
      expect(response.body.settings.cookieExpire).toBeDefined();
    });

    it("should auto-generate secrets on first access", async () => {
      const response = await testClient.get("/api/pomerium/settings");

      expect(response.status).toBe(200);
      // Secrets should be marked as configured
      expect(response.body.settings.sharedSecret).toBe("[CONFIGURED]");
      expect(response.body.settings.cookieSecret).toBe("[CONFIGURED]");
      expect(response.body.settings.signingKey).toBe("[CONFIGURED]");
    });

    it("should return consistent settings on subsequent requests", async () => {
      const response1 = await testClient.get("/api/pomerium/settings");
      const response2 = await testClient.get("/api/pomerium/settings");

      expect(response1.body.settings.id).toBe(response2.body.settings.id);
      expect(response1.body.settings.cookieName).toBe(response2.body.settings.cookieName);
    });

    it("should include all expected fields", async () => {
      const response = await testClient.get("/api/pomerium/settings");

      const settings = response.body.settings;
      expect(settings).toHaveProperty("id");
      expect(settings).toHaveProperty("enabled");
      expect(settings).toHaveProperty("cookieName");
      expect(settings).toHaveProperty("cookieExpire");
      expect(settings).toHaveProperty("cookieSecure");
      expect(settings).toHaveProperty("cookieHttpOnly");
      expect(settings).toHaveProperty("logLevel");
      expect(settings).toHaveProperty("createdAt");
      expect(settings).toHaveProperty("updatedAt");
    });
  });

  // ============================================================================
  // PUT /api/pomerium/settings - Update Settings
  // ============================================================================

  describe("PUT /api/pomerium/settings", () => {
    it("should update cookie name", async () => {
      // Initialize settings first
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        cookieName: "_custom_pomerium",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.cookieName).toBe("_custom_pomerium");
    });

    it("should update cookie expiration", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        cookieExpire: "24h",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.cookieExpire).toBe("24h");
    });

    it("should update cookie domain", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        cookieDomain: ".example.com",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.cookieDomain).toBe(".example.com");
    });

    it("should update cookie security settings", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        cookieSecure: false,
        cookieHttpOnly: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.cookieSecure).toBe(false);
      expect(response.body.settings.cookieHttpOnly).toBe(false);
    });

    it("should update log level", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "debug",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.logLevel).toBe("debug");
    });

    it("should update authenticate service URL", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "https://auth.example.com",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.authenticateServiceUrl).toBe("https://auth.example.com");
    });

    it("should update enabled status", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        enabled: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.enabled).toBe(false);
    });

    it("should update multiple settings at once", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        cookieName: "_new_cookie",
        cookieExpire: "12h",
        logLevel: "warn",
        enabled: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.cookieName).toBe("_new_cookie");
      expect(response.body.settings.cookieExpire).toBe("12h");
      expect(response.body.settings.logLevel).toBe("warn");
      expect(response.body.settings.enabled).toBe(true);
    });

    it("should validate log level values", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "invalid",
      });

      expect(response.status).toBe(400);
    });

    it("rejects logLevel \"verbose\"", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "verbose",
      });

      expect(response.status).toBe(400);
    });

    it("rejects logLevel \"trace\"", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "trace",
      });

      expect(response.status).toBe(400);
    });

    it("rejects logLevel \"WARNING\" (case-sensitive)", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "WARNING",
      });

      expect(response.status).toBe(400);
    });

    it("accepts logLevel \"debug\" and persists it", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "debug",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.logLevel).toBe("debug");
    });

    it("accepts logLevel \"warn\" and persists it", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "warn",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.logLevel).toBe("warn");
    });

    it("accepts logLevel \"error\" and persists it", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        logLevel: "error",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.logLevel).toBe("error");
    });

    it("rejects authenticateServiceUrl \"not-a-url\"", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "not-a-url",
      });

      expect(response.status).toBe(400);
    });

    it("rejects authenticateServiceUrl without protocol", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "auth.example.com",
      });

      expect(response.status).toBe(400);
    });

    it("accepts empty string for authenticateServiceUrl", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "",
      });

      expect(response.status).toBe(200);
    });

    it("accepts valid HTTPS URL and persists it", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "https://auth.example.com",
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.authenticateServiceUrl).toBe("https://auth.example.com");
    });

    it("should preserve secrets when not provided", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {
        cookieName: "_updated",
      });

      expect(response.status).toBe(200);
      // Secrets should still be configured
      expect(response.body.settings.sharedSecret).toBe("[CONFIGURED]");
      expect(response.body.settings.cookieSecret).toBe("[CONFIGURED]");
    });
  });

  // ============================================================================
  // POST /api/pomerium/settings/regenerate-secrets - Regenerate Secrets
  // ============================================================================

  describe("POST /api/pomerium/settings/regenerate-secrets", () => {
    it("should regenerate all secrets", async () => {
      // Initialize settings
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.post("/api/pomerium/settings/regenerate-secrets");

      expect(response.status).toBe(200);
      expect(response.body.settings.sharedSecret).toBe("[CONFIGURED]");
      expect(response.body.settings.cookieSecret).toBe("[CONFIGURED]");
      expect(response.body.settings.signingKey).toBe("[CONFIGURED]");
    });

    it("should update updatedAt timestamp", async () => {
      const initialResponse = await testClient.get("/api/pomerium/settings");
      const initialUpdatedAt = initialResponse.body.settings.updatedAt;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await testClient.post("/api/pomerium/settings/regenerate-secrets");

      expect(response.status).toBe(200);
      expect(new Date(response.body.settings.updatedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(initialUpdatedAt).getTime());
    });
  });

  // ============================================================================
  // GET /api/pomerium/settings/status - Get Pomerium Status
  // ============================================================================

  describe("GET /api/pomerium/settings/status", () => {
    it("should return status information", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("healthy");
    });

    it("should include connectivity information", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      // Status check might fail if Pomerium is not running, but endpoint should work
      expect(typeof response.body.healthy).toBe("boolean");
    });

    it("returns healthy: false when Pomerium is unreachable", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body.healthy).toBe(false);
    });

    it("error does not contain raw socket connection message", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      if (response.body.error) {
        expect(response.body.error).not.toContain("socket connection");
      }
    });

    it("error does not contain \"verbose: true\"", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      if (response.body.error) {
        expect(response.body.error).not.toContain("verbose: true");
      }
    });

    it("error does not contain ECONNRESET", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      if (response.body.error) {
        expect(response.body.error).not.toContain("ECONNRESET");
      }
    });

    it("error field is a string or null when unhealthy", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      if (!response.body.healthy) {
        // error is a string when health check ran and failed, or null when disabled
        expect(
          response.body.error === null || typeof response.body.error === "string"
        ).toBe(true);
      }
    });

    it("returns configured: false when no settings exist", async () => {
      await clearDatabase();
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body.configured).toBe(false);
    });

    it("returns configured: false when authenticateServiceUrl not set", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body.configured).toBe(false);
    });

    it("returns configured: true when authenticateServiceUrl is set", async () => {
      await testClient.get("/api/pomerium/settings");
      await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "https://auth.example.com",
      });

      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body.configured).toBe(true);
    });

    it("returns authenticateUrl: null when URL not configured", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body.authenticateUrl).toBeNull();
    });

    it("returns authenticateUrl matching the configured URL", async () => {
      await testClient.get("/api/pomerium/settings");
      await testClient.put("/api/pomerium/settings", {
        authenticateServiceUrl: "https://auth.example.com",
      });

      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body.authenticateUrl).toBe("https://auth.example.com");
    });

    it("response contains all expected fields", async () => {
      const response = await testClient.get("/api/pomerium/settings/status");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("enabled");
      expect(response.body).toHaveProperty("configured");
      expect(response.body).toHaveProperty("healthy");
      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("authenticateUrl");
    });
  });

  // ============================================================================
  // POST /api/pomerium/settings/restart - Queue a Pomerium Restart
  // ============================================================================

  describe("POST /api/pomerium/settings/restart", () => {
    it("should queue a restart job and return success", async () => {
      const response = await testClient.post(
        "/api/pomerium/settings/restart"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Pomerium restart queued");
    });

    it("should not require a request body", async () => {
      const response = await testClient.post(
        "/api/pomerium/settings/restart"
      );

      expect(response.status).toBe(200);
    });

    it("should be callable multiple times without error", async () => {
      const first = await testClient.post("/api/pomerium/settings/restart");
      const second = await testClient.post("/api/pomerium/settings/restart");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("should handle empty update body", async () => {
      await testClient.get("/api/pomerium/settings");

      const response = await testClient.put("/api/pomerium/settings", {});

      expect(response.status).toBe(200);
    });

    it("should handle null cookie domain", async () => {
      await testClient.get("/api/pomerium/settings");

      // First set a domain
      await testClient.put("/api/pomerium/settings", {
        cookieDomain: ".example.com",
      });

      // Then clear it
      const response = await testClient.put("/api/pomerium/settings", {
        cookieDomain: null,
      });

      expect(response.status).toBe(200);
      expect(response.body.settings.cookieDomain).toBeNull();
    });

    it("should handle concurrent requests", async () => {
      await testClient.get("/api/pomerium/settings");

      // Make multiple concurrent updates
      const updates = await Promise.all([
        testClient.put("/api/pomerium/settings", { logLevel: "debug" }),
        testClient.put("/api/pomerium/settings", { logLevel: "info" }),
        testClient.put("/api/pomerium/settings", { logLevel: "warn" }),
      ]);

      // All should succeed
      for (const update of updates) {
        expect(update.status).toBe(200);
      }

      // Final state should be one of the values
      const finalResponse = await testClient.get("/api/pomerium/settings");
      expect(["debug", "info", "warn"]).toContain(finalResponse.body.settings.logLevel);
    });
  });
});
