import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDnsProviderFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("DNS Providers API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("POST /api/dns-providers", () => {
    it("should create Cloudflare DNS provider", async () => {
      const providerData = createDnsProviderFixture("cloudflare");
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        providerData
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.name).toBe(providerData.name);
      expect(response.body.provider.type).toBe("cloudflare");
      // Credentials should not be exposed
      expect(response.body.provider.credentials).toBeUndefined();
      expect(response.body.provider.hasCredentials).toBe(true);
    });

    it("should create Namecheap DNS provider", async () => {
      const providerData = createDnsProviderFixture("namecheap");
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        providerData
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.type).toBe("namecheap");
    });

    it("should set provider as default and unset others", async () => {
      // Create first provider as default
      const provider1 = { ...createDnsProviderFixture(), isDefault: true };
      const res1 = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        provider1
      );
      expect(res1.body.provider.isDefault).toBe(true);

      // Create second provider as default
      const provider2 = { ...createDnsProviderFixture(), isDefault: true };
      const res2 = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        provider2
      );
      expect(res2.body.provider.isDefault).toBe(true);

      // First provider should no longer be default
      const checkRes = await testClient.get<{ provider: any }>(
        `/api/dns-providers/${res1.body.provider.id}`
      );
      expect(checkRes.body.provider.isDefault).toBe(false);
    });

    it("should validate Cloudflare credentials (apiToken or email+apiKey)", async () => {
      const response = await testClient.post<{ error: string }>(
        "/api/dns-providers",
        {
          name: "Invalid Provider",
          type: "cloudflare",
          credentials: {
            // Missing both apiToken and email+apiKey
          },
          isDefault: false,
        }
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/dns-providers", () => {
    it("should list all providers without exposing credentials", async () => {
      await testClient.post(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      await testClient.post(
        "/api/dns-providers",
        createDnsProviderFixture("namecheap")
      );

      const response = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(2);
      response.body.providers.forEach((p: any) => {
        expect(p.credentials).toBeUndefined();
        expect(p.hasCredentials).toBe(true);
      });
    });

    it("should return empty array when no providers exist", async () => {
      const response = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(0);
    });
  });

  describe("GET /api/dns-providers/:id", () => {
    it("should return provider without exposing credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.get<{ provider: any }>(
        `/api/dns-providers/${providerId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.provider.id).toBe(providerId);
      expect(response.body.provider.credentials).toBeUndefined();
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.get(
        "/api/dns-providers/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/dns-providers/:id", () => {
    it("should update provider name and credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.put<{ provider: any }>(
        `/api/dns-providers/${providerId}`,
        {
          name: "Updated Provider Name",
          credentials: {
            apiToken: "new-api-token",
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.provider.name).toBe("Updated Provider Name");

      // Verify credentials updated in database (not exposed via API)
      const dbProvider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, providerId),
      });
      expect(dbProvider!.credentials).toEqual({ apiToken: "new-api-token" });
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.put(
        "/api/dns-providers/non-existent-id",
        {
          name: "Test",
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/dns-providers/:id/test", () => {
    it("should test provider credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.post<{ success: boolean }>(
        `/api/dns-providers/${providerId}/test`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify lastValidated was updated
      const dbProvider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, providerId),
      });
      expect(dbProvider!.lastValidated).not.toBeNull();
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.post(
        "/api/dns-providers/non-existent-id/test"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/dns-providers/:id", () => {
    it("should delete DNS provider", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/dns-providers/${providerId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const getRes = await testClient.get(`/api/dns-providers/${providerId}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.delete(
        "/api/dns-providers/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });
});
