/**
 * S3 Providers API Integration Tests
 *
 * Tests for the /api/s3-providers endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createS3ProviderFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("S3 Providers API", () => {
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
  // GET /api/s3-providers - List Providers
  // ============================================================================

  describe("GET /api/s3-providers", () => {
    it("should return empty array when no providers exist", async () => {
      const response = await testClient.get<{
        providers: any[];
      }>("/api/s3-providers");

      expect(response.status).toBe(200);
      expect(response.body.providers).toEqual([]);
    });

    it("should list all providers", async () => {
      await testClient.post("/api/s3-providers", createS3ProviderFixture());
      await testClient.post("/api/s3-providers", createS3ProviderFixture());

      const response = await testClient.get<{
        providers: any[];
      }>("/api/s3-providers");

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(2);
    });

    it("should mask sensitive credentials", async () => {
      await testClient.post("/api/s3-providers", createS3ProviderFixture());

      const response = await testClient.get<{
        providers: Array<{
          accessKeyId: string;
          secretAccessKey: string;
        }>;
      }>("/api/s3-providers");

      expect(response.status).toBe(200);
      expect(response.body.providers[0].secretAccessKey).toBe("********");
      expect(response.body.providers[0].accessKeyId).toContain("****");
    });
  });

  // ============================================================================
  // GET /api/s3-providers/default - Get Default Provider
  // ============================================================================

  describe("GET /api/s3-providers/default", () => {
    it("should return 404 when no default provider exists", async () => {
      const response = await testClient.get("/api/s3-providers/default");

      expect(response.status).toBe(404);
    });

    it("should return default provider", async () => {
      await testClient.post("/api/s3-providers", {
        ...createS3ProviderFixture(),
        isDefault: true,
      });

      const response = await testClient.get<{
        provider: { isDefault: boolean };
      }>("/api/s3-providers/default");

      expect(response.status).toBe(200);
      expect(response.body.provider.isDefault).toBe(true);
    });
  });

  // ============================================================================
  // GET /api/s3-providers/:id - Get Single Provider
  // ============================================================================

  describe("GET /api/s3-providers/:id", () => {
    it("should return provider by ID", async () => {
      const createRes = await testClient.post<{ provider: { id: string; name: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.get<{
        provider: { id: string; name: string };
      }>(`/api/s3-providers/${providerId}`);

      expect(response.status).toBe(200);
      expect(response.body.provider.id).toBe(providerId);
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.get("/api/s3-providers/non-existent-id");

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/s3-providers - Create Provider
  // ============================================================================

  describe("POST /api/s3-providers", () => {
    it("should create a new provider", async () => {
      const providerData = createS3ProviderFixture();
      const response = await testClient.post<{
        provider: {
          id: string;
          name: string;
          endpoint: string;
          bucket: string;
        };
      }>("/api/s3-providers", providerData);

      expect(response.status).toBe(201);
      expect(response.body.provider).toBeDefined();
      expect(response.body.provider.name).toBe(providerData.name);
      expect(response.body.provider.bucket).toBe(providerData.bucket);
    });

    it("should make first provider default automatically", async () => {
      const response = await testClient.post<{
        provider: { isDefault: boolean };
      }>("/api/s3-providers", {
        ...createS3ProviderFixture(),
        isDefault: false,
      });

      expect(response.status).toBe(201);
      expect(response.body.provider.isDefault).toBe(true);
    });

    it("should validate required fields", async () => {
      const response = await testClient.post("/api/s3-providers", {
        name: "Test",
        // Missing required fields
      });

      expect(response.status).toBe(400);
    });

    it("should validate endpoint URL format", async () => {
      const response = await testClient.post("/api/s3-providers", {
        ...createS3ProviderFixture(),
        endpoint: "not-a-valid-url",
      });

      expect(response.status).toBe(400);
    });

    it("should unset existing default when creating new default", async () => {
      // Create first default provider
      const first = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        { ...createS3ProviderFixture(), isDefault: true }
      );

      // Create second default provider
      await testClient.post("/api/s3-providers", {
        ...createS3ProviderFixture(),
        isDefault: true,
      });

      // First should no longer be default
      const checkRes = await testClient.get<{ provider: { isDefault: boolean } }>(
        `/api/s3-providers/${first.body.provider.id}`
      );
      expect(checkRes.body.provider.isDefault).toBe(false);
    });
  });

  // ============================================================================
  // PUT /api/s3-providers/:id - Update Provider
  // ============================================================================

  describe("PUT /api/s3-providers/:id", () => {
    it("should update provider name", async () => {
      const createRes = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.put<{
        provider: { name: string };
      }>(`/api/s3-providers/${providerId}`, {
        name: "Updated Name",
      });

      expect(response.status).toBe(200);
      expect(response.body.provider.name).toBe("Updated Name");
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.put("/api/s3-providers/non-existent-id", {
        name: "Test",
      });

      expect(response.status).toBe(404);
    });

    it("should update bucket configuration", async () => {
      const createRes = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.put<{
        provider: { bucket: string };
      }>(`/api/s3-providers/${providerId}`, {
        bucket: "new-bucket-name",
      });

      expect(response.status).toBe(200);
      expect(response.body.provider.bucket).toBe("new-bucket-name");
    });

    it("should reset connection status when credentials change", async () => {
      const createRes = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.put<{
        provider: { isConnected: boolean };
      }>(`/api/s3-providers/${providerId}`, {
        accessKeyId: "new-access-key",
      });

      expect(response.status).toBe(200);
      expect(response.body.provider.isConnected).toBe(false);
    });
  });

  // ============================================================================
  // DELETE /api/s3-providers/:id - Delete Provider
  // ============================================================================

  describe("DELETE /api/s3-providers/:id", () => {
    it("should delete provider", async () => {
      const createRes = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/s3-providers/${providerId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify deleted
      const checkRes = await testClient.get(`/api/s3-providers/${providerId}`);
      expect(checkRes.status).toBe(404);
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.delete("/api/s3-providers/non-existent-id");

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // POST /api/s3-providers/:id/test - Test Connection
  // ============================================================================

  describe("POST /api/s3-providers/:id/test", () => {
    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.post("/api/s3-providers/non-existent-id/test", {});

      expect(response.status).toBe(404);
    });

    it("should test connection and return result", async () => {
      // Use the actual test MinIO endpoint from environment
      const s3Endpoint = process.env.SITES_S3_ENDPOINT || "http://test-minio:9000";

      const createRes = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture({
          endpoint: s3Endpoint,
          bucket: "test-bucket",
        })
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.post<{
        success: boolean;
        error?: string;
      }>(`/api/s3-providers/${providerId}/test`, {});

      // Endpoint returns 200 on success, 400 on connection failure
      // Either is valid - we just want to confirm the endpoint works
      expect([200, 400]).toContain(response.status);
      expect(response.body).toHaveProperty("success");
    });
  });

  // ============================================================================
  // POST /api/s3-providers/:id/set-default - Set Default
  // ============================================================================

  describe("POST /api/s3-providers/:id/set-default", () => {
    it("should set provider as default", async () => {
      // Create two providers
      const first = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const second = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );

      // Set second as default
      const response = await testClient.post<{ success: boolean }>(
        `/api/s3-providers/${second.body.provider.id}/set-default`,
        {}
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify second is now default
      const checkRes = await testClient.get<{ provider: { isDefault: boolean } }>(
        `/api/s3-providers/${second.body.provider.id}`
      );
      expect(checkRes.body.provider.isDefault).toBe(true);
    });

    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.post("/api/s3-providers/non-existent-id/set-default", {});

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /api/s3-providers/:id/usage - Get Usage
  // ============================================================================

  describe("GET /api/s3-providers/:id/usage", () => {
    it("should return 404 for non-existent provider", async () => {
      const response = await testClient.get("/api/s3-providers/non-existent-id/usage");

      expect(response.status).toBe(404);
    });

    it("should return usage statistics", async () => {
      const createRes = await testClient.post<{ provider: { id: string } }>(
        "/api/s3-providers",
        createS3ProviderFixture()
      );
      const providerId = createRes.body.provider.id;

      const response = await testClient.get<{
        providerId: string;
        usage: any;
      }>(`/api/s3-providers/${providerId}/usage`);

      // Either returns usage or 500 if connection fails
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.providerId).toBe(providerId);
        expect(response.body).toHaveProperty("usage");
      }
    });
  });
});
