/**
 * Extensions API Integration Tests
 *
 * Tests for the /api/extensions endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";

describe("Extensions API", () => {
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
  // GET /api/extensions - List Extensions
  // ============================================================================

  describe("GET /api/extensions", () => {
    it("should return extension status", async () => {
      const response = await testClient.get<{
        extensions: Record<string, { enabled: boolean; configured: boolean }>;
      }>("/api/extensions");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("extensions");
      expect(typeof response.body.extensions).toBe("object");
    });

    it("should include sites extension status", async () => {
      const response = await testClient.get<{
        extensions: {
          sites?: boolean | { enabled: boolean; configured: boolean };
        };
      }>("/api/extensions");

      expect(response.status).toBe(200);
      // Extension can be a boolean (enabled=true/false) or an object with enabled/configured
      if (response.body.extensions.sites !== undefined) {
        const sitesExt = response.body.extensions.sites;
        if (typeof sitesExt === "object") {
          expect(sitesExt).toHaveProperty("enabled");
          expect(sitesExt).toHaveProperty("configured");
        } else {
          expect(typeof sitesExt).toBe("boolean");
        }
      }
    });

    it("should include pomerium extension status", async () => {
      const response = await testClient.get<{
        extensions: {
          pomerium?: boolean | { enabled: boolean; configured: boolean };
        };
      }>("/api/extensions");

      expect(response.status).toBe(200);
      // Extension can be a boolean (enabled=true/false) or an object with enabled/configured
      if (response.body.extensions.pomerium !== undefined) {
        const pomeriumExt = response.body.extensions.pomerium;
        if (typeof pomeriumExt === "object") {
          expect(pomeriumExt).toHaveProperty("enabled");
          expect(pomeriumExt).toHaveProperty("configured");
        } else {
          expect(typeof pomeriumExt).toBe("boolean");
        }
      }
    });
  });

  // ============================================================================
  // GET /api/extensions/config - Extension Configuration
  // ============================================================================

  describe("GET /api/extensions/config", () => {
    it("should return extension configuration", async () => {
      const response = await testClient.get<{
        config: Record<string, unknown>;
      }>("/api/extensions/config");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("config");
      expect(typeof response.body.config).toBe("object");
    });

    it("should mask sensitive values", async () => {
      const response = await testClient.get<{
        config: Record<string, any>;
      }>("/api/extensions/config");

      expect(response.status).toBe(200);
      // Sensitive values like secrets should be masked
      const configStr = JSON.stringify(response.body.config);
      // Should not contain full secrets
      expect(configStr).not.toMatch(/secret.*[a-zA-Z0-9]{32,}/i);
    });
  });

  // ============================================================================
  // GET /api/extensions/:name/validate - Validate Extension
  // ============================================================================

  describe("GET /api/extensions/:name/validate", () => {
    it("should validate sites extension", async () => {
      const response = await testClient.get<{
        valid: boolean;
        errors?: string[];
        warnings?: string[];
      }>("/api/extensions/sites/validate");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("valid");
      expect(typeof response.body.valid).toBe("boolean");
    });

    it("should return 404 for unknown extension", async () => {
      const response = await testClient.get("/api/extensions/unknown-extension/validate");

      expect(response.status).toBe(404);
    });

    it("should include validation errors if invalid", async () => {
      const response = await testClient.get<{
        valid: boolean;
        errors?: string[];
      }>("/api/extensions/sites/validate");

      expect(response.status).toBe(200);
      if (!response.body.valid) {
        expect(response.body.errors).toBeDefined();
        expect(Array.isArray(response.body.errors)).toBe(true);
      }
    });

    it("should include validation warnings", async () => {
      const response = await testClient.get<{
        valid: boolean;
        warnings?: string[];
      }>("/api/extensions/sites/validate");

      expect(response.status).toBe(200);
      if (response.body.warnings) {
        expect(Array.isArray(response.body.warnings)).toBe(true);
      }
    });
  });
});
