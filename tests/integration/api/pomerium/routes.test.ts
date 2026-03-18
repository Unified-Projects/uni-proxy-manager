/**
 * Pomerium Routes API Integration Tests
 *
 * Tests for the /api/pomerium/routes endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../../setup/test-db";
import {
  createDomainFixture,
  createPomeriumRouteFixture,
  createPomeriumOidcIdpFixture,
  createAdminRouteFixture,
  createPublicRouteFixture,
  POLICY_PRESETS,
} from "../../setup/fixtures";

describe("Pomerium Routes API", () => {
  let testDomainId: string;
  let testIdpId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Create a domain for route testing
    const domainResponse = await testClient.post("/api/domains", createDomainFixture());
    if (domainResponse.status !== 201) {
      throw new Error(`Failed to create domain: ${JSON.stringify(domainResponse.body)}`);
    }
    testDomainId = domainResponse.body.domain.id;

    // Create an IdP for route testing
    const idpResponse = await testClient.post(
      "/api/pomerium/idps",
      createPomeriumOidcIdpFixture({ isDefault: true })
    );
    if (idpResponse.status !== 201) {
      throw new Error(`Failed to create IdP: ${JSON.stringify(idpResponse.body)}`);
    }
    testIdpId = idpResponse.body.identityProvider.id;
  });

  // ============================================================================
  // GET /api/pomerium/routes - List Routes
  // ============================================================================

  describe("GET /api/pomerium/routes", () => {
    it("should return empty array when no routes exist", async () => {
      const response = await testClient.get("/api/pomerium/routes");

      expect(response.status).toBe(200);
      expect(response.body.routes).toEqual([]);
    });

    it("should return all routes", async () => {
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Route 1", pathPattern: "/route1/*" })
      );
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Route 2", pathPattern: "/route2/*" })
      );

      const response = await testClient.get("/api/pomerium/routes");

      expect(response.status).toBe(200);
      expect(response.body.routes).toHaveLength(2);
    });

    it("should filter routes by domainId", async () => {
      // Create another domain
      const domain2Response = await testClient.post("/api/domains", createDomainFixture());
      const domain2Id = domain2Response.body.domain.id;

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Domain 1 Route", pathPattern: "/domain1/*" })
      );
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domain2Id, { name: "Domain 2 Route", pathPattern: "/domain2/*" })
      );

      const response = await testClient.get(`/api/pomerium/routes?domainId=${testDomainId}`);

      expect(response.status).toBe(200);
      expect(response.body.routes).toHaveLength(1);
      expect(response.body.routes[0].name).toBe("Domain 1 Route");
    });

    it("should include domain information in response", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { pathPattern: "/domain-info/*" })
      );
      if (createResponse.status !== 201) {
        throw new Error(`Failed to create route: ${JSON.stringify(createResponse.body)}`);
      }

      const response = await testClient.get("/api/pomerium/routes");

      expect(response.status).toBe(200);
      expect(response.body.routes).toHaveLength(1);
      expect(response.body.routes[0].domainId).toBe(testDomainId);
      expect(response.body.routes[0].domain).toBeDefined();
    });
  });

  // ============================================================================
  // GET /api/pomerium/routes/:id - Get Single Route
  // ============================================================================

  describe("GET /api/pomerium/routes/:id", () => {
    it("should return 404 for non-existent route", async () => {
      const response = await testClient.get("/api/pomerium/routes/nonexistent-id");

      expect(response.status).toBe(404);
    });

    it("should return route by ID", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Test Route" })
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.get(`/api/pomerium/routes/${routeId}`);

      expect(response.status).toBe(200);
      expect(response.body.route.id).toBe(routeId);
      expect(response.body.route.name).toBe("Test Route");
    });
  });

  // ============================================================================
  // POST /api/pomerium/routes - Create Route
  // ============================================================================

  describe("POST /api/pomerium/routes", () => {
    describe("basic creation", () => {
      it("should create a protected route", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          name: "Admin Route",
          pathPattern: "/admin/*",
          protection: "protected",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.name).toBe("Admin Route");
        expect(response.body.route.pathPattern).toBe("/admin/*");
        expect(response.body.route.protection).toBe("protected");
      });

      it("should create a public route", async () => {
        const routeData = createPublicRouteFixture(testDomainId);

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.protection).toBe("public");
      });

      it("should create a passthrough route", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          protection: "passthrough",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.protection).toBe("passthrough");
      });
    });

    describe("path patterns", () => {
      it("should accept wildcard path pattern", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          pathPattern: "/*",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.pathPattern).toBe("/*");
      });

      it("should accept recursive wildcard pattern", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          pathPattern: "/api/**",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.pathPattern).toBe("/api/**");
      });

      it("should accept specific path pattern", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          pathPattern: "/admin/dashboard",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.pathPattern).toBe("/admin/dashboard");
      });
    });

    describe("policy configuration", () => {
      it("should accept allowedUsers policy", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          policyConfig: {
            allowedUsers: ["admin@test.local", "user@test.local"],
            passIdentityHeaders: true,
          },
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.policyConfig.allowedUsers).toContain("admin@test.local");
      });

      it("should accept allowedDomains policy", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          policyConfig: {
            allowedDomains: ["company.test", "partner.test"],
          },
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.policyConfig.allowedDomains).toContain("company.test");
      });

      it("should accept allowedGroups policy", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          policyConfig: {
            allowedGroups: ["admins", "developers"],
          },
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
      });

      it("should accept websocket configuration", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          policyConfig: {
            websocketsEnabled: true,
            passIdentityHeaders: true,
          },
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.policyConfig.websocketsEnabled).toBe(true);
      });
    });

    describe("identity provider assignment", () => {
      it("should create route with specific IdP", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          identityProviderId: testIdpId,
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.identityProviderId).toBe(testIdpId);
      });

      it("should allow null IdP (use default)", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          identityProviderId: null,
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.identityProviderId).toBeNull();
      });

      it("should reject non-existent IdP", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          identityProviderId: "nonexistent-idp",
          pathPattern: "/reject-idp/*",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        // API returns 404 when the referenced IdP doesn't exist
        expect(response.status).toBe(404);
      });
    });

    describe("priority", () => {
      it("should set default priority", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId);
        delete (routeData as Record<string, unknown>).priority;

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.priority).toBeDefined();
      });

      it("should accept custom priority", async () => {
        const routeData = createPomeriumRouteFixture(testDomainId, {
          priority: 10,
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(201);
        expect(response.body.route.priority).toBe(10);
      });
    });

    describe("validation", () => {
      it("should require domainId", async () => {
        const routeData = {
          name: "Test Route",
          pathPattern: "/*",
          protection: "protected",
        };

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(400);
      });

      it("should validate domain exists", async () => {
        const routeData = createPomeriumRouteFixture("nonexistent-domain", {
          pathPattern: "/validate-domain/*",
        });

        const response = await testClient.post("/api/pomerium/routes", routeData);

        // API returns 404 when the referenced domain doesn't exist
        expect(response.status).toBe(404);
      });

      it("should require name", async () => {
        const routeData = {
          domainId: testDomainId,
          pathPattern: "/*",
          protection: "protected",
        };

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(400);
      });

      it("should reject invalid protection level", async () => {
        const routeData = {
          ...createPomeriumRouteFixture(testDomainId),
          protection: "invalid",
        };

        const response = await testClient.post("/api/pomerium/routes", routeData);

        expect(response.status).toBe(400);
      });
    });
  });

  // ============================================================================
  // PUT /api/pomerium/routes/:id - Update Route
  // ============================================================================

  describe("PUT /api/pomerium/routes/:id", () => {
    it("should update route name", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Original" })
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.put(`/api/pomerium/routes/${routeId}`, {
        name: "Updated",
      });

      expect(response.status).toBe(200);
      expect(response.body.route.name).toBe("Updated");
    });

    it("should update path pattern", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { pathPattern: "/old/*" })
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.put(`/api/pomerium/routes/${routeId}`, {
        pathPattern: "/new/**",
      });

      expect(response.status).toBe(200);
      expect(response.body.route.pathPattern).toBe("/new/**");
    });

    it("should update protection level", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { protection: "protected" })
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.put(`/api/pomerium/routes/${routeId}`, {
        protection: "public",
      });

      expect(response.status).toBe(200);
      expect(response.body.route.protection).toBe("public");
    });

    it("should update policy config", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, {
          policyConfig: { allowedUsers: ["user1@test.local"] },
        })
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.put(`/api/pomerium/routes/${routeId}`, {
        policyConfig: {
          allowedUsers: ["user2@test.local", "user3@test.local"],
          passIdentityHeaders: true,
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.route.policyConfig.allowedUsers).toContain("user2@test.local");
    });

    it("should update enabled status", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { enabled: true })
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.put(`/api/pomerium/routes/${routeId}`, {
        enabled: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.route.enabled).toBe(false);
    });

    it("should return 404 for non-existent route", async () => {
      const response = await testClient.put("/api/pomerium/routes/nonexistent-id", {
        name: "New Name",
      });

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // DELETE /api/pomerium/routes/:id - Delete Route
  // ============================================================================

  describe("DELETE /api/pomerium/routes/:id", () => {
    it("should delete route", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId)
      );
      const routeId = createResponse.body.route.id;

      const response = await testClient.delete(`/api/pomerium/routes/${routeId}`);

      expect(response.status).toBe(200);

      // Verify deletion
      const getResponse = await testClient.get(`/api/pomerium/routes/${routeId}`);
      expect(getResponse.status).toBe(404);
    });

    it("should return 404 for non-existent route", async () => {
      const response = await testClient.delete("/api/pomerium/routes/nonexistent-id");

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/pomerium/routes/:id/toggle - Toggle Route
  // ============================================================================

  describe("POST /api/pomerium/routes/:id/toggle", () => {
    it("should toggle route from enabled to disabled", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { enabled: true, pathPattern: "/toggle-enabled/*" })
      );
      if (createResponse.status !== 201) {
        throw new Error(`Failed to create route: ${JSON.stringify(createResponse.body)}`);
      }
      const routeId = createResponse.body.route.id;

      const response = await testClient.post(`/api/pomerium/routes/${routeId}/toggle`);

      expect(response.status).toBe(200);
      expect(response.body.route.enabled).toBe(false);
    });

    it("should toggle route from disabled to enabled", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { enabled: false, pathPattern: "/toggle-disabled/*" })
      );
      if (createResponse.status !== 201) {
        throw new Error(`Failed to create route: ${JSON.stringify(createResponse.body)}`);
      }
      const routeId = createResponse.body.route.id;

      const response = await testClient.post(`/api/pomerium/routes/${routeId}/toggle`);

      expect(response.status).toBe(200);
      expect(response.body.route.enabled).toBe(true);
    });

    it("should return 404 for non-existent route", async () => {
      const response = await testClient.post("/api/pomerium/routes/nonexistent-id/toggle");

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /api/pomerium/routes/domain/:domainId - Routes by Domain
  // ============================================================================

  describe("GET /api/pomerium/routes/domain/:domainId", () => {
    it("should return routes for specific domain", async () => {
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Route 1", pathPattern: "/route1/*" })
      );
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Route 2", pathPattern: "/route2/*" })
      );

      const response = await testClient.get(`/api/pomerium/routes/domain/${testDomainId}`);

      expect(response.status).toBe(200);
      expect(response.body.routes).toHaveLength(2);
    });

    it("should return empty array for domain with no routes", async () => {
      const response = await testClient.get(`/api/pomerium/routes/domain/${testDomainId}`);

      expect(response.status).toBe(200);
      expect(response.body.routes).toEqual([]);
    });

    it("should not include routes from other domains", async () => {
      // Create another domain
      const domain2Response = await testClient.post("/api/domains", createDomainFixture());
      const domain2Id = domain2Response.body.domain.id;

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(testDomainId, { name: "Domain 1 Route", pathPattern: "/domain1/*" })
      );
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domain2Id, { name: "Domain 2 Route", pathPattern: "/domain2/*" })
      );

      const response = await testClient.get(`/api/pomerium/routes/domain/${testDomainId}`);

      expect(response.status).toBe(200);
      expect(response.body.routes).toHaveLength(1);
      expect(response.body.routes[0].name).toBe("Domain 1 Route");
    });
  });
});
