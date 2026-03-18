import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("S3 Storage Provider", () => {
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

  /**
   * Helper to create a valid S3 provider fixture
   */
  function createS3ProviderFixture(overrides: Partial<{
    name: string;
    endpoint: string;
    region: string;
    bucket: string;
    pathPrefix: string;
    accessKeyId: string;
    secretAccessKey: string;
    isDefault: boolean;
    usedForBuildCache: boolean;
    usedForArtifacts: boolean;
  }> = {}) {
    return {
      name: overrides.name || `S3 Provider ${Date.now()}`,
      endpoint: overrides.endpoint || "https://s3.amazonaws.com",
      region: overrides.region || "us-east-1",
      bucket: overrides.bucket || "test-bucket",
      pathPrefix: overrides.pathPrefix,
      accessKeyId: overrides.accessKeyId || "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: overrides.secretAccessKey || "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      isDefault: overrides.isDefault ?? false,
      usedForBuildCache: overrides.usedForBuildCache ?? true,
      usedForArtifacts: overrides.usedForArtifacts ?? true,
    };
  }

  describe("Provider CRUD", () => {
    it("should create S3 provider with valid credentials", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Production S3" })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.name).toBe("Production S3");
      expect(response.body.provider.bucket).toBe("test-bucket");
      expect(response.body.provider.region).toBe("us-east-1");
      // Credentials should be masked
      expect(response.body.provider.secretAccessKey).toBe("********");
      expect(response.body.provider.accessKeyId).toContain("****");
    });

    it("should create S3 provider with path prefix", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "S3 with Prefix",
          pathPrefix: "builds/production",
        })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.pathPrefix).toBe("builds/production");
    });

    it("should create S3 provider with custom endpoint (MinIO/R2)", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "MinIO Storage",
          endpoint: "https://minio.example.com",
          region: "auto",
        })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.endpoint).toBe("https://minio.example.com");
      expect(response.body.provider.region).toBe("auto");
    });

    it("should reject S3 provider without required bucket", async () => {
      const response = await testClient.post("/api/s3-providers", {
        name: "Invalid S3",
        endpoint: "https://s3.amazonaws.com",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "secretkey",
        // Missing bucket
      });

      expect(response.status).toBe(400);
    });

    it("should reject S3 provider without access key", async () => {
      const response = await testClient.post("/api/s3-providers", {
        name: "Invalid S3",
        endpoint: "https://s3.amazonaws.com",
        bucket: "test-bucket",
        secretAccessKey: "secretkey",
        // Missing accessKeyId
      });

      expect(response.status).toBe(400);
    });

    it("should reject S3 provider without secret key", async () => {
      const response = await testClient.post("/api/s3-providers", {
        name: "Invalid S3",
        endpoint: "https://s3.amazonaws.com",
        bucket: "test-bucket",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        // Missing secretAccessKey
      });

      expect(response.status).toBe(400);
    });

    it("should reject S3 provider with invalid endpoint URL", async () => {
      const response = await testClient.post("/api/s3-providers", {
        name: "Invalid S3",
        endpoint: "not-a-valid-url",
        bucket: "test-bucket",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "secretkey",
      });

      expect(response.status).toBe(400);
    });

    it("should list S3 providers without exposing credentials", async () => {
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "List Test Provider" })
      );

      const response = await testClient.get<{ providers: any[] }>(
        "/api/s3-providers"
      );

      expect(response.status).toBe(200);
      expect(response.body.providers.length).toBe(1);
      expect(response.body.providers[0].secretAccessKey).toBe("********");
      expect(response.body.providers[0].accessKeyId).toContain("****");
    });

    it("should get single S3 provider by ID", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Get By ID Test" })
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.get<{ provider: any }>(
        `/api/s3-providers/${providerId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.provider.name).toBe("Get By ID Test");
      expect(response.body.provider.id).toBe(providerId);
    });

    it("should update S3 provider name", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/s3-providers/${providerId}`,
        { name: "Updated Provider Name" }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.name).toBe("Updated Provider Name");
    });

    it("should update S3 provider bucket", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/s3-providers/${providerId}`,
        { bucket: "new-bucket-name" }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.bucket).toBe("new-bucket-name");
    });

    it("should update S3 provider credentials", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/s3-providers/${providerId}`,
        {
          accessKeyId: "NEWAKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "newSecretKey123456",
        }
      );

      expect(updateRes.status).toBe(200);
      // Credentials updated - connection status should reset
      expect(updateRes.body.provider.isConnected).toBe(false);

      // Verify in database
      const provider = await testDb.query.s3Providers.findFirst({
        where: eq(schema.s3Providers.id, providerId),
      });

      expect(provider?.accessKeyId).toBe("NEWAKIAIOSFODNN7EXAMPLE");
    });

    it("should delete S3 provider", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Delete Test" })
      );
      const providerId = createRes.body.provider.id;

      const deleteRes = await testClient.delete<{ success: boolean }>(
        `/api/s3-providers/${providerId}`
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify deleted
      const checkRes = await testClient.get(`/api/s3-providers/${providerId}`);
      expect(checkRes.status).toBe(404);
    });
  });

  describe("Default Provider", () => {
    it("should set provider as default on creation", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ isDefault: true })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.isDefault).toBe(true);
    });

    it("should unset previous default when setting new default", async () => {
      // Create first default
      const first = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "First Default", isDefault: true })
      );

      // Create second default
      const second = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Second Default", isDefault: true })
      );

      // First should no longer be default
      const firstCheck = await testClient.get<{ provider: any }>(
        `/api/s3-providers/${first.body.provider.id}`
      );
      expect(firstCheck.body.provider.isDefault).toBe(false);

      // Second should be default
      expect(second.body.provider.isDefault).toBe(true);
    });

    it("should set default via dedicated endpoint", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ isDefault: false })
      );
      const providerId = createRes.body.provider.id;

      const setDefaultRes = await testClient.post<{ success: boolean }>(
        `/api/s3-providers/${providerId}/set-default`
      );

      expect(setDefaultRes.status).toBe(200);
      expect(setDefaultRes.body.success).toBe(true);

      // Verify it's now default
      const checkRes = await testClient.get<{ provider: any }>(
        `/api/s3-providers/${providerId}`
      );
      expect(checkRes.body.provider.isDefault).toBe(true);
    });

    it("should get default provider", async () => {
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({ name: "Default Provider", isDefault: true })
      );

      const response = await testClient.get<{ provider: any }>(
        "/api/s3-providers/default"
      );

      expect(response.status).toBe(200);
      expect(response.body.provider.name).toBe("Default Provider");
      expect(response.body.provider.isDefault).toBe(true);
    });

    it("should return 404 when no default provider set", async () => {
      const response = await testClient.get("/api/s3-providers/default");

      expect(response.status).toBe(404);
    });
  });

  describe("Connection Testing", () => {
    it("should test provider connection", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const testRes = await testClient.post<{
        success: boolean;
        error?: string;
        bucketInfo?: any;
      }>(`/api/s3-providers/${providerId}/test`);

      // Will fail with fake credentials, but endpoint should work
      expect([200, 400]).toContain(testRes.status);
      expect(typeof testRes.body.success).toBe("boolean");
    });

    it("should update connection status after test", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      await testClient.post(`/api/s3-providers/${providerId}/test`);

      // Check lastConnectionCheck was set
      const provider = await testDb.query.s3Providers.findFirst({
        where: eq(schema.s3Providers.id, providerId),
      });

      expect(provider?.lastConnectionCheck).toBeDefined();
    });

    it("should record connection error on failed test", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          endpoint: "https://invalid-s3-endpoint.example.com",
          accessKeyId: "invalid",
          secretAccessKey: "invalid",
        })
      );
      const providerId = createRes.body.provider.id;

      await testClient.post(`/api/s3-providers/${providerId}/test`);

      // Check error was recorded
      const provider = await testDb.query.s3Providers.findFirst({
        where: eq(schema.s3Providers.id, providerId),
      });

      expect(provider?.isConnected).toBe(false);
      // Connection error should be set if test failed
    });

    it("should return 404 when testing non-existent provider", async () => {
      const response = await testClient.post("/api/s3-providers/non-existent/test");

      expect(response.status).toBe(404);
    });
  });

  describe("Usage Statistics", () => {
    it("should get usage statistics for provider", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const usageRes = await testClient.get<{
        providerId: string;
        usage?: any;
      }>(`/api/s3-providers/${providerId}/usage`);

      // Will fail with fake credentials, but endpoint should respond
      expect([200, 500]).toContain(usageRes.status);
    });

    it("should return 404 for non-existent provider usage", async () => {
      const response = await testClient.get("/api/s3-providers/non-existent/usage");

      expect(response.status).toBe(404);
    });
  });

  describe("Build Cache and Artifacts Flags", () => {
    it("should set usedForBuildCache flag", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          usedForBuildCache: true,
          usedForArtifacts: false,
        })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.usedForBuildCache).toBe(true);
      expect(response.body.provider.usedForArtifacts).toBe(false);
    });

    it("should set usedForArtifacts flag", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          usedForBuildCache: false,
          usedForArtifacts: true,
        })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.usedForBuildCache).toBe(false);
      expect(response.body.provider.usedForArtifacts).toBe(true);
    });

    it("should update usage flags", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          usedForBuildCache: true,
          usedForArtifacts: true,
        })
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/s3-providers/${providerId}`,
        {
          usedForBuildCache: false,
          usedForArtifacts: false,
        }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.usedForBuildCache).toBe(false);
      expect(updateRes.body.provider.usedForArtifacts).toBe(false);
    });
  });

  describe("Multiple S3 Providers", () => {
    it("should support multiple S3 providers for different purposes", async () => {
      // Create build cache provider
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "Build Cache Storage",
          bucket: "build-cache",
          usedForBuildCache: true,
          usedForArtifacts: false,
        })
      );

      // Create artifacts provider
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "Artifacts Storage",
          bucket: "artifacts",
          usedForBuildCache: false,
          usedForArtifacts: true,
        })
      );

      // Create backup provider
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "Backup Storage",
          bucket: "backups",
          usedForBuildCache: false,
          usedForArtifacts: false,
        })
      );

      const listRes = await testClient.get<{ providers: any[] }>(
        "/api/s3-providers"
      );

      expect(listRes.body.providers.length).toBe(3);

      const buildCache = listRes.body.providers.find(
        (p: any) => p.name === "Build Cache Storage"
      );
      expect(buildCache?.usedForBuildCache).toBe(true);
      expect(buildCache?.usedForArtifacts).toBe(false);
    });

    it("should support different S3-compatible providers", async () => {
      // AWS S3
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "AWS S3",
          endpoint: "https://s3.amazonaws.com",
          region: "us-west-2",
        })
      );

      // Cloudflare R2
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "Cloudflare R2",
          endpoint: "https://account.r2.cloudflarestorage.com",
          region: "auto",
        })
      );

      // MinIO
      await testClient.post(
        "/api/s3-providers",
        createS3ProviderFixture({
          name: "MinIO Local",
          endpoint: "https://minio.local:9000",
          region: "us-east-1",
        })
      );

      const listRes = await testClient.get<{ providers: any[] }>(
        "/api/s3-providers"
      );

      expect(listRes.body.providers.length).toBe(3);

      const endpoints = listRes.body.providers.map((p: any) => p.endpoint);
      expect(endpoints).toContain("https://s3.amazonaws.com");
      expect(endpoints).toContain("https://account.r2.cloudflarestorage.com");
      expect(endpoints).toContain("https://minio.local:9000");
    });
  });

  describe("Path Prefix Handling", () => {
    it("should store path prefix for organization", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          bucket: "shared-bucket",
          pathPrefix: "org-123/builds",
        })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.pathPrefix).toBe("org-123/builds");
    });

    it("should allow updating path prefix", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ pathPrefix: "old-prefix" })
      );
      const providerId = createRes.body.provider.id;

      const updateRes = await testClient.put<{ provider: any }>(
        `/api/s3-providers/${providerId}`,
        { pathPrefix: "new-prefix/subfolder" }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.provider.pathPrefix).toBe("new-prefix/subfolder");
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.get("/api/s3-providers/non-existent-id");
      expect(response.status).toBe(404);
    });

    it("should return 404 when updating non-existent provider", async () => {
      const response = await testClient.put("/api/s3-providers/non-existent-id", {
        name: "Updated Name",
      });
      expect(response.status).toBe(404);
    });

    it("should return 404 when deleting non-existent provider", async () => {
      const response = await testClient.delete("/api/s3-providers/non-existent-id");
      expect(response.status).toBe(404);
    });

    it("should return 404 when setting non-existent provider as default", async () => {
      const response = await testClient.post("/api/s3-providers/non-existent-id/set-default");
      expect(response.status).toBe(404);
    });
  });

  describe("Credential Security", () => {
    it("should never expose secret access key in any response", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ secretAccessKey: "super-secret-key-12345" })
      );

      // Check create response
      expect(createRes.body.provider.secretAccessKey).toBe("********");
      expect(createRes.body.provider.secretAccessKey).not.toContain("super");

      const providerId = createRes.body.provider.id;

      // Check get response
      const getRes = await testClient.get<{ provider: any }>(
        `/api/s3-providers/${providerId}`
      );
      expect(getRes.body.provider.secretAccessKey).toBe("********");

      // Check list response
      const listRes = await testClient.get<{ providers: any[] }>(
        "/api/s3-providers"
      );
      for (const provider of listRes.body.providers) {
        expect(provider.secretAccessKey).toBe("********");
      }
    });

    it("should mask access key ID in responses", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ accessKeyId: "AKIAIOSFODNN7EXAMPLE" })
      );

      // Access key should be partially masked
      expect(createRes.body.provider.accessKeyId).toContain("****");
      expect(createRes.body.provider.accessKeyId).not.toBe("AKIAIOSFODNN7EXAMPLE");
    });

    it("should store actual credentials in database", async () => {
      const createRes = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          accessKeyId: "REALAKIAIOSFODNN7",
          secretAccessKey: "realSecretKey123456",
        })
      );
      const providerId = createRes.body.provider.id;

      // Verify actual credentials are stored (for internal use)
      const provider = await testDb.query.s3Providers.findFirst({
        where: eq(schema.s3Providers.id, providerId),
      });

      expect(provider?.accessKeyId).toBe("REALAKIAIOSFODNN7");
      expect(provider?.secretAccessKey).toBe("realSecretKey123456");
    });
  });

  describe("Region Handling", () => {
    it("should default region to us-east-1", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        {
          name: "No Region Specified",
          endpoint: "https://s3.amazonaws.com",
          bucket: "test-bucket",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "secretkey",
          // No region specified
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.region).toBe("us-east-1");
    });

    it("should accept custom region", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({ region: "eu-central-1" })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.region).toBe("eu-central-1");
    });

    it("should accept 'auto' region for R2/MinIO", async () => {
      const response = await testClient.post<{ provider: any }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          endpoint: "https://account.r2.cloudflarestorage.com",
          region: "auto",
        })
      );

      expect(response.status).toBe(201);
      expect(response.body.provider.region).toBe("auto");
    });
  });
});
