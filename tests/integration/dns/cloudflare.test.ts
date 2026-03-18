import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import { createDnsProviderFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Cloudflare DNS Provider", () => {
  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
  });

  describe("Provider CRUD", () => {
    it("should create Cloudflare provider with API token", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Cloudflare Production",
          type: "cloudflare",
          credentials: {
            apiToken: "cf_test_token_12345",
          },
          isDefault: false,
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.name).toBe("Cloudflare Production");
      expect(response.body.provider.type).toBe("cloudflare");
      // Credentials should not be exposed
      expect(response.body.provider.credentials).toBeUndefined();
      expect(response.body.provider.hasCredentials).toBe(true);
    });

    it("should create Cloudflare provider with email and API key", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Cloudflare Legacy",
          type: "cloudflare",
          credentials: {
            email: "admin@example.com",
            apiKey: "legacy_api_key_12345",
          },
          isDefault: false,
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.type).toBe("cloudflare");
    });

    it("should reject Cloudflare provider without valid credentials", async () => {
      const response = await testClient.post("/api/dns-providers", {
        name: "Invalid Cloudflare",
        type: "cloudflare",
        credentials: {},
        isDefault: false,
      });

      expect(response.status).toBe(400);
    });

    it("should list Cloudflare providers without exposing credentials", async () => {
      // Create provider
      await testClient.post("/api/dns-providers", {
        name: "List Test Provider",
        type: "cloudflare",
        credentials: { apiToken: "secret_token" },
      });

      const response = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      expect(response.status).toBe(200);
      expect(response.body.providers.length).toBe(1);
      expect(response.body.providers[0].credentials).toBeUndefined();
    });

    it("should update Cloudflare provider name", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/dns-providers/${providerId}`,
        { name: "Updated Cloudflare Name" }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.name).toBe("Updated Cloudflare Name");
    });

    it("should update Cloudflare provider credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/dns-providers/${providerId}`,
        {
          credentials: { apiToken: "new_token_67890" },
        }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.hasCredentials).toBe(true);
    });

    it("should delete Cloudflare provider", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/dns-providers/${providerId}`
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify deleted
      const checkRes = await testClient.get(`/api/dns-providers/${providerId}`);
      expect(checkRes.status).toBe(404);
    });
  });

  describe("Default Provider", () => {
    it("should set provider as default", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          ...createDnsProviderFixture("cloudflare"),
          isDefault: true,
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.isDefault).toBe(true);
    });

    it("should unset previous default when setting new default", async () => {
      // Create first default
      const first = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "First Default",
          type: "cloudflare",
          credentials: { apiToken: "token1" },
          isDefault: true,
        }
      );

      // Create second default
      const second = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Second Default",
          type: "cloudflare",
          credentials: { apiToken: "token2" },
          isDefault: true,
        }
      );

      // First should no longer be default
      const firstCheck = await testClient.get<{ provider: any }>(
        `/api/dns-providers/${first.body.provider.id}`
      );
      expect(firstCheck.body.provider.isDefault).toBe(false);

      // Second should be default
      expect(second.body.provider.isDefault).toBe(true);
    });
  });

  describe("Credential Validation", () => {
    it("should test provider credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      const testRes = await testClient.post<{ success: boolean; message: string }>(
        `/api/dns-providers/${providerId}/test`
      );

      expect(testRes.status).toBe(200);
      expect(testRes.body.success).toBe(true);
    });

    it("should update lastValidated on successful test", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      // Test credentials
      await testClient.post(`/api/dns-providers/${providerId}/test`);

      // Check lastValidated was set
      const provider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, providerId),
      });

      expect(provider?.lastValidated).toBeDefined();
    });
  });

  describe("Provider with Certificates", () => {
    it("should use Cloudflare provider for certificate requests", async () => {
      // Create provider
      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        {
          hostname: "cf-cert.example.com",
          displayName: "CF Cert Test",
          sslEnabled: true,
        }
      );
      const domainId = domainRes.body.domain.id;

      // Request certificate using this provider
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId: providerId,
          staging: true,
        }
      );

      expect(certRes.status).toBe(201);
      expect(certRes.body.certificate.domainId).toBe(domainId);
    });
  });

  describe("Zone Lookup Simulation", () => {
    it("should store zone information in credentials", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Cloudflare with Zone",
          type: "cloudflare",
          credentials: {
            apiToken: "cf_token_with_zone",
          },
        }
      );

      expect(response.status).toBe(201);

      // Verify stored in database (without exposing via API)
      const provider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, response.body.provider.id),
      });

      expect(provider?.credentials).toBeDefined();
    });
  });

  describe("Multiple Cloudflare Providers", () => {
    it("should support multiple Cloudflare providers for different zones", async () => {
      // Create multiple providers
      const provider1 = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Cloudflare Zone 1",
          type: "cloudflare",
          credentials: { apiToken: "token_zone_1" },
        }
      );

      const provider2 = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Cloudflare Zone 2",
          type: "cloudflare",
          credentials: { apiToken: "token_zone_2" },
        }
      );

      // List all providers
      const listRes = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      expect(listRes.body.providers.length).toBe(2);

      const cfProviders = listRes.body.providers.filter(
        (p: any) => p.type === "cloudflare"
      );
      expect(cfProviders.length).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.get("/api/dns-providers/non-existent-id");
      expect(response.status).toBe(404);
    });

    it("should return 404 when testing non-existent provider", async () => {
      const response = await testClient.post("/api/dns-providers/non-existent-id/test");
      expect(response.status).toBe(404);
    });

    it("should return 404 when deleting non-existent provider", async () => {
      const response = await testClient.delete("/api/dns-providers/non-existent-id");
      expect(response.status).toBe(404);
    });
  });
});
