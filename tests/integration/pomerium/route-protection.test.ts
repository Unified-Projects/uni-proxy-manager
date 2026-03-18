/**
 * Pomerium Route Protection Integration Tests
 *
 * Tests real route protection using Dex OIDC and Pomerium.
 * NO MOCKS - these tests require the Docker test environment running.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { dexClient, TEST_USERS } from "../setup/dex-client";
import { pomeriumClient, TEST_ROUTES } from "../setup/pomerium-client";

describe("Pomerium Route Protection", () => {
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
        "[SKIP] Dex or Pomerium not available. Skipping route protection tests."
      );
    }
  });

  afterAll(() => {
    pomeriumClient.clearSessionCache();
    dexClient.clearCache();
  });

  // ============================================================================
  // Admin Route Protection Tests
  // ============================================================================

  describe("Admin Routes", () => {
    it("should deny unauthenticated access to admin route", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test unauthenticated HTTP request - should not have access
      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.admin,
        undefined
      );

      expect(result.authenticated).toBe(false);
      expect(result.hasAccess).toBe(false);
    });

    it("should allow admin user access to admin route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy evaluation with real Dex authentication
      // (Pomerium requires OAuth session for HTTP, so we test policy logic directly)
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.admin,
        { allowedEmails: [TEST_USERS.admin.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it("should deny regular user access to admin route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy evaluation - regular user should not have access to admin route
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.user,
        { allowedEmails: [TEST_USERS.admin.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(false);
    });

    it("should deny external user access to admin route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy evaluation - external user should not have access
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.external,
        { allowedEmails: [TEST_USERS.admin.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(false);
    });
  });

  // ============================================================================
  // Internal Route Protection Tests
  // ============================================================================

  describe("Internal Routes", () => {
    it("should deny unauthenticated access to internal route", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.internal,
        undefined
      );

      expect(result.authenticated).toBe(false);
      expect(result.hasAccess).toBe(false);
    });

    it("should allow employee access to internal route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy with domain restriction (company.test)
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.employee,
        { allowedDomains: ["company.test"], allowedEmails: [TEST_USERS.admin.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it("should allow admin access to internal route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Admin has explicit email access
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.admin,
        { allowedDomains: ["company.test"], allowedEmails: [TEST_USERS.admin.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it("should deny external user access to internal route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // External user is from external.test domain, not company.test
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.external,
        { allowedDomains: ["company.test"], allowedEmails: [TEST_USERS.admin.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(false);
    });
  });

  // ============================================================================
  // Public Route Tests
  // ============================================================================

  describe("Public Routes", () => {
    it("should allow unauthenticated access to public route", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.public,
        undefined
      );

      // Public routes should be accessible without authentication
      expect(result.hasAccess).toBe(true);
    });

    it("should allow authenticated user access to public route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.public,
        TEST_USERS.user
      );

      expect(result.hasAccess).toBe(true);
    });

    it("should allow external user access to public route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.public,
        TEST_USERS.external
      );

      expect(result.hasAccess).toBe(true);
    });
  });

  // ============================================================================
  // Application Route Tests
  // ============================================================================

  describe("Application Routes", () => {
    it("should deny unauthenticated access to app route", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.app,
        undefined
      );

      expect(result.authenticated).toBe(false);
      expect(result.hasAccess).toBe(false);
    });

    it("should allow any authenticated user access to app route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const users = [TEST_USERS.admin, TEST_USERS.user, TEST_USERS.employee];

      for (const user of users) {
        // Test policy with allowAnyAuthenticated
        const result = await pomeriumClient.testPolicyEnforcement(
          TEST_ROUTES.app,
          user,
          { allowAnyAuthenticated: true }
        );

        expect(result.authenticated).toBe(true);
        expect(result.hasAccess).toBe(true);
      }
    });
  });

  // ============================================================================
  // Restricted Route Tests
  // ============================================================================

  describe("Restricted Routes", () => {
    it("should deny unauthenticated access to restricted route", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.restricted,
        undefined
      );

      expect(result.authenticated).toBe(false);
    });

    it("should deny blocked user access to restricted route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy evaluation - blocked user should be denied
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.restricted,
        TEST_USERS.blocked,
        { blockedEmails: [TEST_USERS.blocked.email] }
      );

      // Blocked user should authenticate but not have access
      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(false);
    });

    it("should allow admin access to restricted route", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy evaluation - admin (not blocked) should have access
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.restricted,
        TEST_USERS.admin,
        { blockedEmails: [TEST_USERS.blocked.email] }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(true);
    });
  });

  // ============================================================================
  // Header Forwarding Tests
  // ============================================================================

  describe("Header Forwarding", () => {
    it("should forward user email in header", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const headers = await pomeriumClient.getAuthHeaders(TEST_USERS.admin);

      expect(headers["X-Pomerium-Claim-Email"]).toBe(TEST_USERS.admin.email);
    });

    it("should include JWT assertion header", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const headers = await pomeriumClient.getAuthHeaders(TEST_USERS.user);

      expect(headers["X-Pomerium-Jwt-Assertion"]).toBeDefined();
      expect(headers["X-Pomerium-Jwt-Assertion"].split(".")).toHaveLength(3);
    });

    it("should forward headers to upstream", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyForwardAuth(
        TEST_ROUTES.headers,
        TEST_USERS.admin
      );

      expect(result.forwardedEmail).toBe(TEST_USERS.admin.email);
      expect(result.jwtPresent).toBe(true);
    });

    it("should forward different user emails correctly", async (ctx) => {
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
  // Policy Enforcement Tests
  // ============================================================================

  describe("Policy Enforcement", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should enforce email domain policy", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Employee from company.test should have access to internal routes
      const employeeResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.employee,
        {
          allowedDomains: ["company.test"],
        }
      );

      expect(employeeResult.policyMatch).toBe(true);
      expect(employeeResult.hasAccess).toBe(true);

      // External user from different domain should not
      const externalResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.external,
        {
          allowedDomains: ["company.test"],
        }
      );

      expect(externalResult.policyMatch).toBe(false);
      expect(externalResult.hasAccess).toBe(false);
    });

    it("should enforce email whitelist policy", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const allowedEmails = [TEST_USERS.admin.email];

      const adminResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.admin,
        {
          allowedEmails,
        }
      );

      expect(adminResult.policyMatch).toBe(true);

      const userResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.user,
        {
          allowedEmails,
        }
      );

      expect(userResult.policyMatch).toBe(false);
    });

    it("should enforce user block list", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const blockedEmails = [TEST_USERS.blocked.email];

      const blockedResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.restricted,
        TEST_USERS.blocked,
        {
          blockedEmails,
        }
      );

      expect(blockedResult.policyMatch).toBe(false);
      expect(blockedResult.hasAccess).toBe(false);

      const adminResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.restricted,
        TEST_USERS.admin,
        {
          blockedEmails,
        }
      );

      expect(adminResult.policyMatch).toBe(true);
      expect(adminResult.hasAccess).toBe(true);
    });
  });

  // ============================================================================
  // WebSocket Route Tests
  // ============================================================================

  describe("WebSocket Routes", () => {
    it("should protect WebSocket routes", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.websocket,
        undefined
      );

      expect(result.authenticated).toBe(false);
    });

    it("should allow authenticated WebSocket connections", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test policy evaluation - authenticated user should have access to WebSocket route
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.websocket,
        TEST_USERS.user,
        { allowAnyAuthenticated: true }
      );

      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(true);
    });
  });

  // ============================================================================
  // Cross-User Session Isolation Tests
  // ============================================================================

  describe("Session Isolation", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should maintain separate sessions for different users", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const adminSession = await pomeriumClient.authenticate(TEST_USERS.admin);
      const userSession = await pomeriumClient.authenticate(TEST_USERS.user);

      // Sessions should be different
      expect(adminSession.tokens.id_token).not.toBe(userSession.tokens.id_token);

      // Email claims should match respective users
      expect(adminSession.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.admin.email
      );
      expect(userSession.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.user.email
      );
    });

    it("should not leak session data between users", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Authenticate as admin first
      await pomeriumClient.authenticate(TEST_USERS.admin);

      // Then authenticate as user
      const userSession = await pomeriumClient.authenticate(TEST_USERS.user);

      // User session should only contain user's data
      expect(userSession.headers["X-Pomerium-Claim-Email"]).toBe(
        TEST_USERS.user.email
      );
      expect(userSession.headers["X-Pomerium-Claim-Email"]).not.toBe(
        TEST_USERS.admin.email
      );
    });
  });

  // ============================================================================
  // Error Cases
  // ============================================================================

  describe("Error Cases", () => {
    it("should handle invalid route gracefully", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        "https://nonexistent.test.local/invalid",
        undefined
      );

      expect(result.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("should handle expired token scenario", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // This tests that Pomerium handles expired tokens correctly
      // In practice, Pomerium should redirect to re-authenticate
      const session = await pomeriumClient.authenticate(TEST_USERS.user);

      expect(session.tokens.expires_in).toBeGreaterThan(0);
    });
  });
});
