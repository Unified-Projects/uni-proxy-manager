/**
 * Pomerium Policy Enforcement Integration Tests
 *
 * Tests real policy enforcement using Dex OIDC and Pomerium.
 * NO MOCKS - these tests require the Docker test environment running.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { dexClient, TEST_USERS } from "../setup/dex-client";
import { pomeriumClient, TEST_ROUTES } from "../setup/pomerium-client";

describe("Pomerium Policy Enforcement", () => {
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
        "[SKIP] Dex or Pomerium not available. Skipping policy enforcement tests."
      );
    }
  });

  afterAll(() => {
    pomeriumClient.clearSessionCache();
    dexClient.clearCache();
  });

  // ============================================================================
  // Email-Based Policies
  // ============================================================================

  describe("Email-Based Policies", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should allow access when email matches allowed list", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.admin,
        {
          allowedEmails: [TEST_USERS.admin.email],
        }
      );

      expect(result.policyMatch).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it("should deny access when email not in allowed list", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.user,
        {
          allowedEmails: [TEST_USERS.admin.email],
        }
      );

      expect(result.policyMatch).toBe(false);
      expect(result.hasAccess).toBe(false);
    });

    it("should support multiple allowed emails", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const allowedEmails = [TEST_USERS.admin.email, TEST_USERS.user.email];

      for (const user of [TEST_USERS.admin, TEST_USERS.user]) {
        const result = await pomeriumClient.testPolicyEnforcement(
          TEST_ROUTES.app,
          user,
          { allowedEmails }
        );

        expect(result.policyMatch).toBe(true);
      }
    });

    it("should deny blocked email even if in allowed list", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.restricted,
        TEST_USERS.blocked,
        {
          allowedEmails: [TEST_USERS.blocked.email, TEST_USERS.admin.email],
          blockedEmails: [TEST_USERS.blocked.email],
        }
      );

      // Blocked list should take precedence
      expect(result.hasAccess).toBe(false);
    });
  });

  // ============================================================================
  // Domain-Based Policies
  // ============================================================================

  describe("Domain-Based Policies", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should allow access for users from allowed domain", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // employee@company.test should have access when company.test is allowed
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.employee,
        {
          allowedDomains: ["company.test"],
        }
      );

      expect(result.policyMatch).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it("should deny access for users from non-allowed domain", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // external@external.test should not have access when only company.test is allowed
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.external,
        {
          allowedDomains: ["company.test"],
        }
      );

      expect(result.policyMatch).toBe(false);
      expect(result.hasAccess).toBe(false);
    });

    it("should support multiple allowed domains", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.app,
        TEST_USERS.external,
        {
          allowedDomains: ["company.test", "external.test"],
        }
      );

      expect(result.policyMatch).toBe(true);
    });

    it("should handle wildcard domain matching", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test subdomain matching
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.app,
        TEST_USERS.employee,
        {
          allowedDomains: ["*.test"],
        }
      );

      // company.test should match *.test
      expect(result.policyMatch).toBe(true);
    });
  });

  // ============================================================================
  // Group-Based Policies
  // ============================================================================

  describe("Group-Based Policies", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should allow access for users in allowed group", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.admin,
        {
          allowedGroups: ["admins"],
        }
      );

      expect(result.policyMatch).toBe(true);
    });

    it("should deny access for users not in allowed group", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.user,
        {
          allowedGroups: ["admins"],
        }
      );

      expect(result.policyMatch).toBe(false);
    });

    it("should support multiple allowed groups", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.employee,
        {
          allowedGroups: ["admins", "employees"],
        }
      );

      expect(result.policyMatch).toBe(true);
    });
  });

  // ============================================================================
  // Combined Policies (AND/OR Logic)
  // ============================================================================

  describe("Combined Policies", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should enforce AND logic for multiple conditions", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // User must be from company.test AND in employees group
      const employeeResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.employee,
        {
          allowedDomains: ["company.test"],
          allowedGroups: ["employees"],
          logicOperator: "AND",
        }
      );

      expect(employeeResult.policyMatch).toBe(true);

      // External user is not from company.test domain
      const externalResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.internal,
        TEST_USERS.external,
        {
          allowedDomains: ["company.test"],
          allowedGroups: ["employees"],
          logicOperator: "AND",
        }
      );

      expect(externalResult.policyMatch).toBe(false);
    });

    it("should enforce OR logic for multiple conditions", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // User can be from company.test OR in admins group
      const adminResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.app,
        TEST_USERS.admin,
        {
          allowedDomains: ["company.test"],
          allowedGroups: ["admins"],
          logicOperator: "OR",
        }
      );

      expect(adminResult.policyMatch).toBe(true);

      // Employee matches domain condition
      const employeeResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.app,
        TEST_USERS.employee,
        {
          allowedDomains: ["company.test"],
          allowedGroups: ["admins"],
          logicOperator: "OR",
        }
      );

      expect(employeeResult.policyMatch).toBe(true);
    });
  });

  // ============================================================================
  // Allow Any Authenticated User
  // ============================================================================

  describe("Allow Any Authenticated", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should allow any authenticated user when policy is open", async (ctx) => {
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
        const result = await pomeriumClient.testPolicyEnforcement(
          TEST_ROUTES.app,
          user,
          {
            allowAnyAuthenticated: true,
          }
        );

        expect(result.authenticated).toBe(true);
        expect(result.hasAccess).toBe(true);
      }
    });

    it("should still require authentication even for open policy", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.app,
        undefined,
        {
          allowAnyAuthenticated: true,
        }
      );

      expect(result.authenticated).toBe(false);
      expect(result.hasAccess).toBe(false);
    });
  });

  // ============================================================================
  // Public Access Policy
  // ============================================================================

  describe("Public Access Policy", () => {
    it("should allow unauthenticated access for public routes", async (ctx) => {
      if (!isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyRouteProtection(
        TEST_ROUTES.public,
        undefined
      );

      expect(result.hasAccess).toBe(true);
    });

    it("should still work with authenticated users on public routes", async (ctx) => {
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
  });

  // ============================================================================
  // Deny All Policy
  // ============================================================================

  describe("Deny All Policy", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should deny all users when blockedEmails includes all", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const allEmails = [
        TEST_USERS.admin.email,
        TEST_USERS.user.email,
        TEST_USERS.employee.email,
        TEST_USERS.external.email,
      ];

      for (const user of [TEST_USERS.admin, TEST_USERS.user]) {
        const result = await pomeriumClient.testPolicyEnforcement(
          TEST_ROUTES.restricted,
          user,
          {
            blockedEmails: allEmails,
          }
        );

        expect(result.hasAccess).toBe(false);
      }
    });
  });

  // ============================================================================
  // Claim-Based Policies
  // ============================================================================

  describe("Claim-Based Policies", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should validate user claims are present in token", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const tokens = await dexClient.authenticateUser(TEST_USERS.admin);
      const decoded = dexClient.decodeToken(tokens.id_token);

      // Standard OIDC claims should be present
      expect(decoded.email).toBe(TEST_USERS.admin.email);
      expect(decoded.sub).toBeDefined();
      expect(decoded.iss).toBeDefined();
    });

    it("should forward claims to backend via headers", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      const result = await pomeriumClient.verifyForwardAuth(
        TEST_ROUTES.headers,
        TEST_USERS.admin
      );

      expect(result.forwardedEmail).toBe(TEST_USERS.admin.email);
    });
  });

  // ============================================================================
  // Policy Priority and Ordering
  // ============================================================================

  describe("Policy Priority", () => {
    beforeEach(() => {
      pomeriumClient.clearSessionCache();
    });

    it("should apply more specific policies first", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Specific email block should override domain allow
      const result = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.restricted,
        TEST_USERS.blocked,
        {
          allowedDomains: ["test.local"], // Would normally allow
          blockedEmails: [TEST_USERS.blocked.email], // Specific deny
        }
      );

      expect(result.hasAccess).toBe(false);
    });

    it("should handle policy evaluation order correctly", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy) {
        ctx.skip();
        return;
      }

      // Test that deny takes precedence over allow
      const adminResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.admin,
        {
          allowedGroups: ["admins"],
          blockedEmails: [], // Empty block list
        }
      );

      expect(adminResult.hasAccess).toBe(true);

      // Now block the admin
      const blockedAdminResult = await pomeriumClient.testPolicyEnforcement(
        TEST_ROUTES.admin,
        TEST_USERS.admin,
        {
          allowedGroups: ["admins"],
          blockedEmails: [TEST_USERS.admin.email],
        }
      );

      expect(blockedAdminResult.hasAccess).toBe(false);
    });
  });
});
