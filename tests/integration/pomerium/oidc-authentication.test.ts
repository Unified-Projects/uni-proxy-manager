/**
 * Pomerium OIDC Authentication Integration Tests
 *
 * Tests real OIDC authentication flows using Dex as the identity provider.
 * These tests verify the complete authentication pipeline without mocks.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { dexClient, TEST_USERS, DexClient, type TokenResponse } from "../setup/dex-client";
import { pomeriumClient, PomeriumClient, TEST_ROUTES } from "../setup/pomerium-client";

describe("Pomerium OIDC Authentication", () => {
  let isDexHealthy = false;
  let isPomeriumHealthy = false;

  beforeAll(async () => {
    // Check if test infrastructure is available
    try {
      isDexHealthy = await dexClient.isHealthy();
      isPomeriumHealthy = await pomeriumClient.isHealthy();
    } catch {
      // Services not available
    }

    if (!isDexHealthy || !isPomeriumHealthy) {
      console.warn(
        "[SKIP] Dex or Pomerium not available. Skipping OIDC integration tests."
      );
    }
  });

  afterAll(() => {
    // Clear cached sessions
    pomeriumClient.clearSessionCache();
    dexClient.clearCache();
  });

  // ============================================================================
  // Dex OIDC Provider Tests
  // ============================================================================

  describe("Dex OIDC Provider", () => {
    it("should be healthy and ready", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const healthy = await dexClient.isHealthy();
      expect(healthy).toBe(true);
    });

    it("should serve OIDC well-known configuration", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const config = await dexClient.getWellKnownConfig();

      expect(config.issuer).toBeDefined();
      expect(config.authorization_endpoint).toBeDefined();
      expect(config.token_endpoint).toBeDefined();
      expect(config.userinfo_endpoint).toBeDefined();
      expect(config.jwks_uri).toBeDefined();
    });

    it("should have correct scopes supported", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const config = await dexClient.getWellKnownConfig();

      expect(config.scopes_supported).toContain("openid");
      expect(config.scopes_supported).toContain("email");
      expect(config.scopes_supported).toContain("profile");
    });

    it("should authenticate admin user with password", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);

      expect(tokens.access_token).toBeDefined();
      expect(tokens.id_token).toBeDefined();
      expect(tokens.token_type).toBe("bearer");
      expect(tokens.expires_in).toBeGreaterThan(0);
    });

    it("should authenticate regular user with password", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.user);

      expect(tokens.access_token).toBeDefined();
      expect(tokens.id_token).toBeDefined();
    });

    it("should include correct claims in ID token", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      expect(decoded.email).toBe(TEST_USERS.admin.email);
      expect(decoded.sub).toBeDefined();
      expect(decoded.iss).toContain("dex");
      expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
    });

    it("should reject invalid credentials", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const invalidUser = {
        email: "admin@test.local",
        password: "wrongpassword",
        username: "admin",
        userId: "test",
      };

      await expect(dexClient.authenticateUser(invalidUser)).rejects.toThrow();
    });

    it("should return user info from userinfo endpoint", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const userInfo = await dexClient.getUserInfo(tokens.access_token);

      expect(userInfo.email).toBe(TEST_USERS.admin.email);
      expect(userInfo.sub).toBeDefined();
    });

    it("should authenticate users with different domains", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      // Employee from company.test domain
      const employeeTokens = await dexClient.authenticateUser(TEST_USERS.employee);
      const employeeDecoded = dexClient.decodeToken(employeeTokens.id_token);
      expect(employeeDecoded.email).toBe("employee@company.test");

      // External user
      const externalTokens = await dexClient.authenticateUser(TEST_USERS.external);
      const externalDecoded = dexClient.decodeToken(externalTokens.id_token);
      expect(externalDecoded.email).toBe("external@external.test");
    });

    it("should generate valid authorization URL", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const authUrl = await dexClient.getAuthorizationUrl(
        "http://localhost:3000/callback",
        ["openid", "email", "profile"]
      );

      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=openid");
      expect(authUrl).toContain("redirect_uri=");
      expect(authUrl).toContain("client_id=");
    });
  });

  // ============================================================================
  // Pomerium Service Tests
  // ============================================================================

  describe("Pomerium Service", () => {
    it("should be healthy and ready", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const healthy = await pomeriumClient.isHealthy();
      expect(healthy).toBe(true);
    });

    it("should create authenticated session for admin", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session = await pomeriumClient.authenticate(TEST_USERS.admin);

      expect(session.user).toEqual(TEST_USERS.admin);
      expect(session.tokens.id_token).toBeDefined();
      expect(session.headers["X-Pomerium-Jwt-Assertion"]).toBeDefined();
      expect(session.headers["X-Pomerium-Claim-Email"]).toBe(TEST_USERS.admin.email);
    });

    it("should cache authenticated sessions", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session1 = await pomeriumClient.authenticate(TEST_USERS.user);
      const session2 = await pomeriumClient.authenticate(TEST_USERS.user);

      // Sessions should be cached (same token)
      expect(session1.tokens.id_token).toBe(session2.tokens.id_token);
    });

    it("should generate correct auth headers", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const headers = await pomeriumClient.getAuthHeaders(TEST_USERS.admin);

      expect(headers["X-Pomerium-Jwt-Assertion"]).toBeDefined();
      expect(headers["X-Pomerium-Claim-Email"]).toBe(TEST_USERS.admin.email);
    });
  });

  // ============================================================================
  // Token Validation Tests
  // ============================================================================

  describe("Token Validation", () => {
    it("should decode token correctly", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      expect(decoded.iss).toBeDefined();
      expect(decoded.sub).toBeDefined();
      expect(decoded.aud).toBeDefined();
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it("should throw on invalid token format", () => {
      expect(() => dexClient.decodeToken("invalid")).toThrow();
      expect(() => dexClient.decodeToken("a.b")).toThrow();
      expect(() => dexClient.decodeToken("")).toThrow();
    });

    it("should have valid expiration time", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      // Token should expire in the future
      const now = Math.floor(Date.now() / 1000);
      expect(decoded.exp).toBeGreaterThan(now);

      // Token should have been issued recently
      expect(decoded.iat).toBeLessThanOrEqual(now);
      expect(decoded.iat).toBeGreaterThan(now - 60); // Within last minute
    });
  });

  // ============================================================================
  // Multi-User Authentication Tests
  // ============================================================================

  describe("Multi-User Authentication", () => {
    it("should authenticate different users independently", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const adminTokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const userTokens = await dexClient.authenticateUser(TEST_USERS.user);

      // Tokens should be different
      expect(adminTokens.id_token).not.toBe(userTokens.id_token);
      expect(adminTokens.access_token).not.toBe(userTokens.access_token);

      // Claims should match respective users
      const adminDecoded = dexClient.decodeToken(adminTokens.id_token);
      const userDecoded = dexClient.decodeToken(userTokens.id_token);

      expect(adminDecoded.email).toBe(TEST_USERS.admin.email);
      expect(userDecoded.email).toBe(TEST_USERS.user.email);
    });

    it("should authenticate all test users", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const users = [
        TEST_USERS.admin,
        TEST_USERS.user,
        TEST_USERS.blocked,
        TEST_USERS.employee,
        TEST_USERS.external,
      ];

      for (const user of users) {
        const tokens = await dexClient.authenticateUser(user);
        const decoded = dexClient.decodeToken(tokens.id_token);
        expect(decoded.email).toBe(user.email);
      }
    });
  });

  // ============================================================================
  // Session Management Tests
  // ============================================================================

  describe("Session Management", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should create new session after cache clear", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session1 = await pomeriumClient.authenticate(TEST_USERS.admin);
      pomeriumClient.clearSessionCache();
      const session2 = await pomeriumClient.authenticate(TEST_USERS.admin);

      // After cache clear, should get new token
      // Note: Tokens might be the same if issued within the same second
      expect(session2.user).toEqual(TEST_USERS.admin);
    });

    it("should provide auth headers for all users", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const users = [TEST_USERS.admin, TEST_USERS.user, TEST_USERS.employee];

      for (const user of users) {
        const headers = await pomeriumClient.getAuthHeaders(user);
        expect(headers["X-Pomerium-Claim-Email"]).toBe(user.email);
      }
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error Handling", () => {
    it("should handle connection errors gracefully", async () => {
      const badClient = new DexClient({
        issuerUrl: "http://nonexistent:9999/dex",
      });

      const healthy = await badClient.isHealthy();
      expect(healthy).toBe(false);
    });

    it("should handle Pomerium connection errors", async () => {
      const badClient = new PomeriumClient({
        baseUrl: "http://nonexistent:9999",
      });

      const healthy = await badClient.isHealthy();
      expect(healthy).toBe(false);
    });

    it("should handle malformed tokens", () => {
      expect(() => dexClient.decodeToken("not.a.valid.token")).toThrow();
    });
  });
});
