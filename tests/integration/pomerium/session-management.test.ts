/**
 * Pomerium Session Management Integration Tests
 *
 * Tests session handling, caching, expiration, and refresh using Dex OIDC.
 * NO MOCKS - these tests require the Docker test environment running.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { dexClient, TEST_USERS, type TokenResponse } from "../setup/dex-client";
import { pomeriumClient, PomeriumClient } from "../setup/pomerium-client";

describe("Pomerium Session Management", () => {
  let isDexHealthy = false;
  let isPomeriumHealthy = false;

  beforeAll(async () => {
    try {
      isDexHealthy = await dexClient.isHealthy();
      isPomeriumHealthy = await pomeriumClient.isHealthy();
    } catch {
      // Services not available
    }

    if (!isDexHealthy || !isPomeriumHealthy) {
      console.warn(
        "[SKIP] Dex or Pomerium not available. Skipping session management tests."
      );
    }
  });

  afterAll(() => {
    pomeriumClient.clearSessionCache();
    dexClient.clearCache();
  });

  // ============================================================================
  // Session Creation Tests
  // ============================================================================

  describe("Session Creation", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should create session with valid tokens", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session = await pomeriumClient.authenticate(TEST_USERS.admin);

      expect(session.tokens).toBeDefined();
      expect(session.tokens.access_token).toBeDefined();
      expect(session.tokens.id_token).toBeDefined();
      expect(session.tokens.token_type).toBe("bearer");
    });

    it("should create session with correct user info", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session = await pomeriumClient.authenticate(TEST_USERS.user);

      expect(session.user).toEqual(TEST_USERS.user);
      expect(session.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.user.email
      );
    });

    it("should create unique sessions for different users", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const adminSession = await pomeriumClient.authenticate(TEST_USERS.admin);
      const userSession = await pomeriumClient.authenticate(TEST_USERS.user);

      expect(adminSession.tokens.id_token).not.toBe(userSession.tokens.id_token);
      expect(adminSession.tokens.access_token).not.toBe(
        userSession.tokens.access_token
      );
    });

    it("should include expiration information", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session = await pomeriumClient.authenticate(TEST_USERS.admin);

      expect(session.tokens.expires_in).toBeDefined();
      expect(session.tokens.expires_in).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Session Caching Tests
  // ============================================================================

  describe("Session Caching", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should cache session on first authentication", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session1 = await pomeriumClient.authenticate(TEST_USERS.admin);
      const session2 = await pomeriumClient.authenticate(TEST_USERS.admin);

      // Should return cached session
      expect(session1.tokens.id_token).toBe(session2.tokens.id_token);
    });

    it("should cache sessions per user", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const adminSession1 = await pomeriumClient.authenticate(TEST_USERS.admin);
      const userSession1 = await pomeriumClient.authenticate(TEST_USERS.user);
      const adminSession2 = await pomeriumClient.authenticate(TEST_USERS.admin);
      const userSession2 = await pomeriumClient.authenticate(TEST_USERS.user);

      // Each user's session should be cached independently
      expect(adminSession1.tokens.id_token).toBe(adminSession2.tokens.id_token);
      expect(userSession1.tokens.id_token).toBe(userSession2.tokens.id_token);
      expect(adminSession1.tokens.id_token).not.toBe(userSession1.tokens.id_token);
    });

    it("should return new session after cache clear", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const session1 = await pomeriumClient.authenticate(TEST_USERS.admin);
      pomeriumClient.clearSessionCache();
      const session2 = await pomeriumClient.authenticate(TEST_USERS.admin);

      // New session should be created
      expect(session2.user).toEqual(TEST_USERS.admin);
    });
  });

  // ============================================================================
  // Token Validation Tests
  // ============================================================================

  describe("Token Validation", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
      dexClient.clearCache();
    });

    it("should generate valid JWT tokens", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      expect(decoded.iss).toBeDefined();
      expect(decoded.sub).toBeDefined();
      expect(decoded.aud).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });

    it("should have valid expiration time", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      const now = Math.floor(Date.now() / 1000);
      expect(decoded.exp).toBeGreaterThan(now);
    });

    it("should have valid issued-at time", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      const now = Math.floor(Date.now() / 1000);
      expect(decoded.iat).toBeLessThanOrEqual(now);
      expect(decoded.iat).toBeGreaterThan(now - 60); // Within last minute
    });

    it("should include email claim", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.user);
      const decoded = dexClient.decodeToken(tokens.id_token);

      expect(decoded.email).toBe(TEST_USERS.user.email);
    });
  });

  // ============================================================================
  // Token Refresh Tests
  // ============================================================================

  describe("Token Refresh", () => {
    beforeEach(() => {
      dexClient.clearCache();
    });

    it("should support refresh token flow", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const initialTokens = await dexClient.authenticateUser(TEST_USERS.admin);

      if (!initialTokens.refresh_token) {
        // Refresh tokens may not be enabled in test config
        ctx.skip();
        return;
      }

      const refreshedTokens = await dexClient.refreshToken(
        initialTokens.refresh_token
      );

      expect(refreshedTokens.access_token).toBeDefined();
      expect(refreshedTokens.id_token).toBeDefined();
    });

    it("should generate new access token on refresh", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const initialTokens = await dexClient.authenticateUser(TEST_USERS.admin);

      if (!initialTokens.refresh_token) {
        ctx.skip();
        return;
      }

      // Wait briefly to ensure different token generation
      await new Promise((resolve) => setTimeout(resolve, 100));

      const refreshedTokens = await dexClient.refreshToken(
        initialTokens.refresh_token
      );

      // New tokens should be generated
      expect(refreshedTokens.access_token).toBeDefined();
    });
  });

  // ============================================================================
  // User Info Endpoint Tests
  // ============================================================================

  describe("User Info", () => {
    beforeEach(() => {
      dexClient.clearCache();
    });

    it("should return user info with access token", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const userInfo = await dexClient.getUserInfo(tokens.access_token);

      expect(userInfo.email).toBe(TEST_USERS.admin.email);
      expect(userInfo.sub).toBeDefined();
    });

    it("should return consistent user info", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.user);
      const userInfo1 = await dexClient.getUserInfo(tokens.access_token);
      const userInfo2 = await dexClient.getUserInfo(tokens.access_token);

      expect(userInfo1.email).toBe(userInfo2.email);
      expect(userInfo1.sub).toBe(userInfo2.sub);
    });
  });

  // ============================================================================
  // Session Header Tests
  // ============================================================================

  describe("Session Headers", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
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

    it("should include JWT assertion in correct format", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const headers = await pomeriumClient.getAuthHeaders(TEST_USERS.user);
      const jwt = headers["X-Pomerium-Jwt-Assertion"];

      // JWT should have 3 parts separated by dots
      const parts = jwt.split(".");
      expect(parts).toHaveLength(3);
    });

    it("should generate headers for all test users", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const users = [
        TEST_USERS.admin,
        TEST_USERS.user,
        TEST_USERS.employee,
        TEST_USERS.external,
      ];

      for (const user of users) {
        const headers = await pomeriumClient.getAuthHeaders(user);

        expect(headers["X-Pomerium-Claim-Email"]).toBe(user.email);
        expect(headers["X-Pomerium-Jwt-Assertion"]).toBeDefined();
      }
    });
  });

  // ============================================================================
  // Session Isolation Tests
  // ============================================================================

  describe("Session Isolation", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should not share session state between users", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Authenticate multiple users in sequence
      const adminSession = await pomeriumClient.authenticate(TEST_USERS.admin);
      const userSession = await pomeriumClient.authenticate(TEST_USERS.user);
      const employeeSession = await pomeriumClient.authenticate(
        TEST_USERS.employee
      );

      // Each session should have the correct user
      expect(adminSession.user.email).toBe(TEST_USERS.admin.email);
      expect(userSession.user.email).toBe(TEST_USERS.user.email);
      expect(employeeSession.user.email).toBe(TEST_USERS.employee.email);

      // Headers should match users
      expect(adminSession.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.admin.email
      );
      expect(userSession.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.user.email
      );
    });

    it("should maintain session integrity after cache clear", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      await pomeriumClient.authenticate(TEST_USERS.admin);
      pomeriumClient.clearSessionCache();
      const newSession = await pomeriumClient.authenticate(TEST_USERS.user);

      // New session should be for the correct user
      expect(newSession.user.email).toBe(TEST_USERS.user.email);
      expect(newSession.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.user.email
      );
    });
  });

  // ============================================================================
  // Concurrent Session Tests
  // ============================================================================

  describe("Concurrent Sessions", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should handle concurrent authentication requests", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const [adminSession, userSession, employeeSession] = await Promise.all([
        pomeriumClient.authenticate(TEST_USERS.admin),
        pomeriumClient.authenticate(TEST_USERS.user),
        pomeriumClient.authenticate(TEST_USERS.employee),
      ]);

      expect(adminSession.user.email).toBe(TEST_USERS.admin.email);
      expect(userSession.user.email).toBe(TEST_USERS.user.email);
      expect(employeeSession.user.email).toBe(TEST_USERS.employee.email);
    });

    it("should handle concurrent token generation", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const [tokens1, tokens2, tokens3] = await Promise.all([
        dexClient.authenticateUser(TEST_USERS.admin),
        dexClient.authenticateUser(TEST_USERS.user),
        dexClient.authenticateUser(TEST_USERS.employee),
      ]);

      expect(tokens1.id_token).toBeDefined();
      expect(tokens2.id_token).toBeDefined();
      expect(tokens3.id_token).toBeDefined();

      // All tokens should be different
      expect(tokens1.id_token).not.toBe(tokens2.id_token);
      expect(tokens2.id_token).not.toBe(tokens3.id_token);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error Handling", () => {
    it("should handle invalid credentials", async (ctx) => {
      if (!isDexHealthy) {
        ctx.skip();
        return;
      }

      const invalidUser = {
        email: "invalid@test.local",
        password: "wrongpassword",
        username: "invalid",
        userId: "invalid",
      };

      await expect(dexClient.authenticateUser(invalidUser)).rejects.toThrow();
    });

    it("should handle malformed tokens", () => {
      expect(() => dexClient.decodeToken("invalid")).toThrow();
      expect(() => dexClient.decodeToken("a.b")).toThrow();
      expect(() => dexClient.decodeToken("")).toThrow();
    });

    it("should handle service unavailability gracefully", async () => {
      const badClient = new PomeriumClient({
        baseUrl: "http://nonexistent:9999",
      });

      const healthy = await badClient.isHealthy();
      expect(healthy).toBe(false);
    });
  });
});
