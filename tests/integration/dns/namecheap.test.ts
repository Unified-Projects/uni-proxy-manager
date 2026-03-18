import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Namecheap DNS Provider", () => {
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
    it("should create Namecheap provider with required credentials", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap Production",
          type: "namecheap",
          credentials: {
            apiUser: "nc_user",
            apiKey: "nc_api_key_12345",
            clientIp: "192.168.1.100",
          },
          isDefault: false,
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.name).toBe("Namecheap Production");
      expect(response.body.provider.type).toBe("namecheap");
      expect(response.body.provider.credentials).toBeUndefined();
      expect(response.body.provider.hasCredentials).toBe(true);
    });

    it("should create Namecheap provider with optional username", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap with Username",
          type: "namecheap",
          credentials: {
            apiUser: "nc_api_user",
            apiKey: "nc_api_key",
            clientIp: "10.0.0.1",
            username: "nc_username",
          },
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.type).toBe("namecheap");
    });

    it("should reject Namecheap provider without apiUser", async () => {
      const response = await testClient.post("/api/dns-providers", {
        name: "Invalid Namecheap",
        type: "namecheap",
        credentials: {
          apiKey: "key",
          clientIp: "1.2.3.4",
        },
      });

      expect(response.status).toBe(400);
    });

    it("should reject Namecheap provider without apiKey", async () => {
      const response = await testClient.post("/api/dns-providers", {
        name: "Invalid Namecheap",
        type: "namecheap",
        credentials: {
          apiUser: "user",
          clientIp: "1.2.3.4",
        },
      });

      expect(response.status).toBe(400);
    });

    it("should reject Namecheap provider without clientIp", async () => {
      const response = await testClient.post("/api/dns-providers", {
        name: "Invalid Namecheap",
        type: "namecheap",
        credentials: {
          apiUser: "user",
          apiKey: "key",
        },
      });

      expect(response.status).toBe(400);
    });

    it("should list Namecheap providers without exposing credentials", async () => {
      await testClient.post("/api/dns-providers", {
        name: "Namecheap List Test",
        type: "namecheap",
        credentials: {
          apiUser: "user",
          apiKey: "secret_key",
          clientIp: "1.2.3.4",
        },
      });

      const response = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      expect(response.status).toBe(200);
      expect(response.body.providers.length).toBe(1);
      expect(response.body.providers[0].credentials).toBeUndefined();
      expect(response.body.providers[0].type).toBe("namecheap");
    });

    it("should update Namecheap provider credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap Update Test",
          type: "namecheap",
          credentials: {
            apiUser: "old_user",
            apiKey: "old_key",
            clientIp: "1.1.1.1",
          },
        }
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/dns-providers/${providerId}`,
        {
          credentials: {
            apiUser: "new_user",
            apiKey: "new_key",
            clientIp: "2.2.2.2",
          },
        }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.hasCredentials).toBe(true);

      // Verify in database
      const provider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, providerId),
      });

      const creds = provider?.credentials as any;
      expect(creds.apiUser).toBe("new_user");
      expect(creds.clientIp).toBe("2.2.2.2");
    });

    it("should delete Namecheap provider", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap Delete Test",
          type: "namecheap",
          credentials: {
            apiUser: "user",
            apiKey: "key",
            clientIp: "1.2.3.4",
          },
        }
      );
      const providerId = createRes.body.provider.id;

      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/dns-providers/${providerId}`
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      const checkRes = await testClient.get(`/api/dns-providers/${providerId}`);
      expect(checkRes.status).toBe(404);
    });
  });

  describe("Credential Validation", () => {
    it("should test Namecheap provider credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap Test Creds",
          type: "namecheap",
          credentials: {
            apiUser: "test_user",
            apiKey: "test_key",
            clientIp: "10.0.0.1",
          },
        }
      );
      const providerId = createRes.body.provider.id;

      const testRes = await testClient.post<{ success: boolean }>(
        `/api/dns-providers/${providerId}/test`
      );

      expect(testRes.status).toBe(200);
      expect(testRes.body.success).toBe(true);
    });

    it("should record validation timestamp", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap Timestamp Test",
          type: "namecheap",
          credentials: {
            apiUser: "user",
            apiKey: "key",
            clientIp: "1.1.1.1",
          },
        }
      );
      const providerId = createRes.body.provider.id;

      await testClient.post(`/api/dns-providers/${providerId}/test`);

      const provider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, providerId),
      });

      expect(provider?.lastValidated).toBeDefined();
    });
  });

  describe("Provider with Certificates", () => {
    it("should use Namecheap provider for certificate requests", async () => {
      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap Cert Provider",
          type: "namecheap",
          credentials: {
            apiUser: "cert_user",
            apiKey: "cert_key",
            clientIp: "1.2.3.4",
          },
        }
      );
      const providerId = providerRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        {
          hostname: "nc-cert.example.com",
          displayName: "NC Cert Test",
          sslEnabled: true,
        }
      );
      const domainId = domainRes.body.domain.id;

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

  describe("IP Whitelisting", () => {
    it("should store client IP for API access", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap IP Test",
          type: "namecheap",
          credentials: {
            apiUser: "user",
            apiKey: "key",
            clientIp: "203.0.113.50",
          },
        }
      );

      expect(response.status).toBe(201);

      const provider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, response.body.provider.id),
      });

      const creds = provider?.credentials as any;
      expect(creds.clientIp).toBe("203.0.113.50");
    });

    it("should allow updating client IP", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        {
          name: "Namecheap IP Update",
          type: "namecheap",
          credentials: {
            apiUser: "user",
            apiKey: "key",
            clientIp: "1.1.1.1",
          },
        }
      );
      const providerId = createRes.body.provider.id;

      await testClient.put(`/api/dns-providers/${providerId}`, {
        credentials: {
          apiUser: "user",
          apiKey: "key",
          clientIp: "8.8.8.8",
        },
      });

      const provider = await testDb.query.dnsProviders.findFirst({
        where: eq(schema.dnsProviders.id, providerId),
      });

      const creds = provider?.credentials as any;
      expect(creds.clientIp).toBe("8.8.8.8");
    });
  });

  describe("Multiple Namecheap Providers", () => {
    it("should support multiple Namecheap providers", async () => {
      await testClient.post("/api/dns-providers", {
        name: "Namecheap Account 1",
        type: "namecheap",
        credentials: {
          apiUser: "user1",
          apiKey: "key1",
          clientIp: "1.1.1.1",
        },
      });

      await testClient.post("/api/dns-providers", {
        name: "Namecheap Account 2",
        type: "namecheap",
        credentials: {
          apiUser: "user2",
          apiKey: "key2",
          clientIp: "2.2.2.2",
        },
      });

      const listRes = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      const ncProviders = listRes.body.providers.filter(
        (p: any) => p.type === "namecheap"
      );
      expect(ncProviders.length).toBe(2);
    });
  });

  describe("Mixed Provider Types", () => {
    it("should handle both Cloudflare and Namecheap providers", async () => {
      await testClient.post("/api/dns-providers", {
        name: "Cloudflare Mixed",
        type: "cloudflare",
        credentials: { apiToken: "cf_token" },
      });

      await testClient.post("/api/dns-providers", {
        name: "Namecheap Mixed",
        type: "namecheap",
        credentials: {
          apiUser: "nc_user",
          apiKey: "nc_key",
          clientIp: "1.2.3.4",
        },
      });

      const listRes = await testClient.get<{ providers: any[] }>(
        "/api/dns-providers"
      );

      expect(listRes.body.providers.length).toBe(2);

      const types = listRes.body.providers.map((p: any) => p.type);
      expect(types).toContain("cloudflare");
      expect(types).toContain("namecheap");
    });
  });
});
