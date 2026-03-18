/**
 * Pomerium Identity Providers API Integration Tests
 *
 * Tests for the /api/pomerium/idps endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../../setup/test-db";
import {
  createPomeriumIdpFixture,
  createPomeriumOidcIdpFixture,
  createPomeriumGoogleIdpFixture,
  createPomeriumAzureIdpFixture,
  createPomeriumGitHubIdpFixture,
} from "../../setup/pomerium-fixtures";

describe("Pomerium IdPs API", () => {
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
  // GET /api/pomerium/idps - List Identity Providers
  // ============================================================================

  describe("GET /api/pomerium/idps", () => {
    it("should return empty array when no IdPs exist", async () => {
      const response = await testClient.get("/api/pomerium/idps");

      expect(response.status).toBe(200);
      expect(response.body.identityProviders).toEqual([]);
    });

    it("should return all IdPs", async () => {
      // Create multiple IdPs
      await testClient.post("/api/pomerium/idps", createPomeriumOidcIdpFixture());
      await testClient.post("/api/pomerium/idps", createPomeriumGoogleIdpFixture());

      const response = await testClient.get("/api/pomerium/idps");

      expect(response.status).toBe(200);
      expect(response.body.identityProviders).toHaveLength(2);
    });

    it("should mask credentials in response", async () => {
      await testClient.post("/api/pomerium/idps", createPomeriumOidcIdpFixture({
        clientSecret: "super-secret-value",
      }));

      const response = await testClient.get("/api/pomerium/idps");

      expect(response.status).toBe(200);
      const idp = response.body.identityProviders[0];
      expect(idp.credentials.clientSecret).toBe("[CONFIGURED]");
    });
  });

  // ============================================================================
  // GET /api/pomerium/idps/:id - Get Single Identity Provider
  // ============================================================================

  describe("GET /api/pomerium/idps/:id", () => {
    it("should return 404 for non-existent IdP", async () => {
      const response = await testClient.get("/api/pomerium/idps/nonexistent-id");

      expect(response.status).toBe(404);
    });

    it("should return IdP by ID", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture({ name: "Test OIDC" })
      );
      const createdId = createResponse.body.identityProvider.id;

      const response = await testClient.get(`/api/pomerium/idps/${createdId}`);

      expect(response.status).toBe(200);
      expect(response.body.identityProvider.id).toBe(createdId);
      expect(response.body.identityProvider.name).toBe("Test OIDC");
    });

    it("should mask credentials for single IdP", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture()
      );
      const createdId = createResponse.body.identityProvider.id;

      const response = await testClient.get(`/api/pomerium/idps/${createdId}`);

      expect(response.status).toBe(200);
      expect(response.body.identityProvider.credentials.clientSecret).toBe("[CONFIGURED]");
    });
  });

  // ============================================================================
  // POST /api/pomerium/idps - Create Identity Provider
  // ============================================================================

  describe("POST /api/pomerium/idps", () => {
    describe("OIDC Provider", () => {
      it("should create OIDC identity provider", async () => {
        const idpData = createPomeriumOidcIdpFixture({
          name: "My OIDC Provider",
        });

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(201);
        expect(response.body.identityProvider.type).toBe("oidc");
        expect(response.body.identityProvider.name).toBe("My OIDC Provider");
        expect(response.body.identityProvider.id).toBeDefined();
      });

      it("should require clientId for OIDC", async () => {
        const idpData = {
          name: "Invalid OIDC",
          type: "oidc",
          credentials: {
            clientSecret: "secret",
            issuerUrl: "http://localhost:5556/dex",
          },
        };

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(400);
      });

      it("should require issuerUrl for OIDC", async () => {
        const idpData = {
          name: "Invalid OIDC",
          type: "oidc",
          credentials: {
            clientId: "test",
            clientSecret: "secret",
          },
        };

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(400);
      });
    });

    describe("Google Provider", () => {
      it("should create Google identity provider", async () => {
        const idpData = createPomeriumGoogleIdpFixture({
          name: "Google IdP",
        });

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(201);
        expect(response.body.identityProvider.type).toBe("google");
      });

      it("should accept optional hostedDomain", async () => {
        const idpData = createPomeriumGoogleIdpFixture({
          hostedDomain: "company.com",
        });

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(201);
        // hostedDomain is not a secret, so it should be returned as-is
        expect(response.body.identityProvider.credentials.hostedDomain).toBe("company.com");
      });
    });

    describe("Azure Provider", () => {
      it("should create Azure identity provider", async () => {
        const idpData = createPomeriumAzureIdpFixture({
          name: "Azure AD",
        });

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(201);
        expect(response.body.identityProvider.type).toBe("azure");
      });

      it("should require tenantId for Azure", async () => {
        const idpData = {
          name: "Invalid Azure",
          type: "azure",
          credentials: {
            clientId: "test",
            clientSecret: "secret",
          },
        };

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(400);
      });
    });

    describe("GitHub Provider", () => {
      it("should create GitHub identity provider", async () => {
        const idpData = createPomeriumGitHubIdpFixture({
          name: "GitHub IdP",
        });

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(201);
        expect(response.body.identityProvider.type).toBe("github");
      });
    });

    describe("Default Provider", () => {
      it("should set IdP as default when isDefault is true", async () => {
        const idpData = createPomeriumOidcIdpFixture({
          isDefault: true,
        });

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(201);
        expect(response.body.identityProvider.isDefault).toBe(true);
      });

      it("should unset previous default when new default is created", async () => {
        // Create first default
        const first = await testClient.post(
          "/api/pomerium/idps",
          createPomeriumOidcIdpFixture({ name: "First", isDefault: true })
        );
        expect(first.body.identityProvider.isDefault).toBe(true);

        // Create second default
        await testClient.post(
          "/api/pomerium/idps",
          createPomeriumOidcIdpFixture({ name: "Second", isDefault: true })
        );

        // Check first is no longer default
        const response = await testClient.get(`/api/pomerium/idps/${first.body.identityProvider.id}`);
        expect(response.body.identityProvider.isDefault).toBe(false);
      });
    });

    describe("Validation", () => {
      it("should require name", async () => {
        const idpData = {
          type: "oidc",
          credentials: {
            clientId: "test",
            clientSecret: "secret",
            issuerUrl: "http://localhost:5556/dex",
          },
        };

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(400);
      });

      it("should require type", async () => {
        const idpData = {
          name: "Test IdP",
          credentials: {
            clientId: "test",
            clientSecret: "secret",
          },
        };

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(400);
      });

      it("should reject invalid type", async () => {
        const idpData = {
          name: "Test IdP",
          type: "invalid",
          credentials: {},
        };

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(400);
      });

      it("should reject duplicate name", async () => {
        const idpData = createPomeriumOidcIdpFixture({ name: "Unique Name" });
        await testClient.post("/api/pomerium/idps", idpData);

        const response = await testClient.post("/api/pomerium/idps", idpData);

        expect(response.status).toBe(409);
      });
    });
  });

  // ============================================================================
  // PUT /api/pomerium/idps/:id - Update Identity Provider
  // ============================================================================

  describe("PUT /api/pomerium/idps/:id", () => {
    it("should update IdP name", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture({ name: "Original Name" })
      );
      const idpId = createResponse.body.identityProvider.id;

      const response = await testClient.put(`/api/pomerium/idps/${idpId}`, {
        name: "Updated Name",
      });

      expect(response.status).toBe(200);
      expect(response.body.identityProvider.name).toBe("Updated Name");
    });

    it("should preserve existing credentials if not provided", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture()
      );
      const idpId = createResponse.body.identityProvider.id;

      const response = await testClient.put(`/api/pomerium/idps/${idpId}`, {
        displayName: "New Display Name",
      });

      expect(response.status).toBe(200);
      // Credentials should still be configured (clientSecret is masked, clientId is not a secret)
      expect(response.body.identityProvider.credentials.clientId).toBe("test-client");
      expect(response.body.identityProvider.credentials.clientSecret).toBe("[CONFIGURED]");
    });

    it("should update credentials when provided", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture()
      );
      const idpId = createResponse.body.identityProvider.id;

      const response = await testClient.put(`/api/pomerium/idps/${idpId}`, {
        credentials: {
          clientId: "new-client-id",
          clientSecret: "new-secret",
          issuerUrl: "http://new-issuer:5556/dex",
        },
      });

      expect(response.status).toBe(200);
    });

    it("should update enabled status", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture({ enabled: true })
      );
      const idpId = createResponse.body.identityProvider.id;

      const response = await testClient.put(`/api/pomerium/idps/${idpId}`, {
        enabled: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.identityProvider.enabled).toBe(false);
    });

    it("should return 404 for non-existent IdP", async () => {
      const response = await testClient.put("/api/pomerium/idps/nonexistent-id", {
        name: "New Name",
      });

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // DELETE /api/pomerium/idps/:id - Delete Identity Provider
  // ============================================================================

  describe("DELETE /api/pomerium/idps/:id", () => {
    it("should delete IdP", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture()
      );
      const idpId = createResponse.body.identityProvider.id;

      const response = await testClient.delete(`/api/pomerium/idps/${idpId}`);

      expect(response.status).toBe(200);

      // Verify deletion
      const getResponse = await testClient.get(`/api/pomerium/idps/${idpId}`);
      expect(getResponse.status).toBe(404);
    });

    it("should return 404 for non-existent IdP", async () => {
      const response = await testClient.delete("/api/pomerium/idps/nonexistent-id");

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/pomerium/idps/:id/test - Test IdP Connection
  // ============================================================================

  describe("POST /api/pomerium/idps/:id/test", () => {
    it("should mark IdP as validated", async () => {
      const createResponse = await testClient.post(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture()
      );
      const idpId = createResponse.body.identityProvider.id;

      const response = await testClient.post(`/api/pomerium/idps/${idpId}/test`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Identity provider validated");

      // Verify the IdP was actually updated
      const getResponse = await testClient.get(`/api/pomerium/idps/${idpId}`);
      expect(getResponse.body.identityProvider.lastValidated).toBeDefined();
    });

    it("should return 404 for non-existent IdP", async () => {
      const response = await testClient.post("/api/pomerium/idps/nonexistent-id/test");

      expect(response.status).toBe(404);
    });
  });
});
