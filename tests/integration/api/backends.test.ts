import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Backends API", () => {
  let testDomainId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    // Create a domain for backend tests
    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture()
    );
    testDomainId = domainRes.body.domain.id;
  });

  describe("POST /api/backends", () => {
    it("should create a backend for existing domain", async () => {
      const backendData = createBackendFixture(testDomainId);
      const response = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(201);
      expect(response.body.backend.name).toBe(backendData.name);
      expect(response.body.backend.address).toBe(backendData.address);
      expect(response.body.backend.port).toBe(backendData.port);
      expect(response.body.backend.protocol).toBe(backendData.protocol);

      // Verify domain configVersion was incremented
      const domainRes = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainRes.body.domain.configVersion).toBeGreaterThan(0);
    });

    it("should reject backend for non-existent domain", async () => {
      const backendData = createBackendFixture("non-existent-domain");
      const response = await testClient.post<{ error: string }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(404);
    });

    it("should validate port range", async () => {
      const backendData = createBackendFixture(testDomainId, { port: 70000 });
      const response = await testClient.post<{ error: string }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(400);
    });

    it("should validate weight range", async () => {
      const backendData = createBackendFixture(testDomainId, { weight: 300 });
      const response = await testClient.post<{ error: string }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(400);
    });

    it("should create backend with health check settings", async () => {
      const backendData = createBackendFixture(testDomainId, {
        healthCheckEnabled: true,
        healthCheckPath: "/api/health",
      });
      const response = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(201);
      expect(response.body.backend.healthCheckEnabled).toBe(true);
      expect(response.body.backend.healthCheckPath).toBe("/api/health");
    });
  });

  describe("GET /api/backends", () => {
    it("should list all backends with domain info", async () => {
      await testClient.post(
        "/api/backends",
        createBackendFixture(testDomainId, { name: "backend-1" })
      );
      await testClient.post(
        "/api/backends",
        createBackendFixture(testDomainId, { name: "backend-2" })
      );

      const response = await testClient.get<{ backends: any[] }>(
        "/api/backends"
      );

      expect(response.status).toBe(200);
      expect(response.body.backends).toHaveLength(2);
      expect(response.body.backends[0]).toHaveProperty("domain");
    });

    it("should return empty array when no backends exist", async () => {
      const response = await testClient.get<{ backends: any[] }>(
        "/api/backends"
      );

      expect(response.status).toBe(200);
      expect(response.body.backends).toHaveLength(0);
    });
  });

  describe("GET /api/backends/:id", () => {
    it("should return a single backend", async () => {
      const createRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(testDomainId)
      );
      const backendId = createRes.body.backend.id;

      const response = await testClient.get<{ backend: any }>(
        `/api/backends/${backendId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.backend.id).toBe(backendId);
    });

    it("should return 404 for non-existent backend", async () => {
      const response = await testClient.get("/api/backends/non-existent-id");

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/backends/:id", () => {
    it("should update backend settings", async () => {
      const createRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(testDomainId)
      );
      const backendId = createRes.body.backend.id;

      const response = await testClient.put<{ backend: any }>(
        `/api/backends/${backendId}`,
        {
          name: "Updated Backend",
          port: 9090,
          weight: 50,
          enabled: false,
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.backend.name).toBe("Updated Backend");
      expect(response.body.backend.port).toBe(9090);
      expect(response.body.backend.weight).toBe(50);
      expect(response.body.backend.enabled).toBe(false);
    });

    it("should update domain configVersion when backend changes", async () => {
      const createRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(testDomainId)
      );
      const backendId = createRes.body.backend.id;

      const domainBefore = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      const versionBefore = domainBefore.body.domain.configVersion;

      await testClient.put(`/api/backends/${backendId}`, { port: 9090 });

      const domainAfter = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainAfter.body.domain.configVersion).toBe(versionBefore + 1);
    });

    it("should return 404 for non-existent backend", async () => {
      const response = await testClient.put("/api/backends/non-existent-id", {
        name: "Test",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/backends/:id", () => {
    it("should delete backend and update domain configVersion", async () => {
      const createRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(testDomainId)
      );
      const backendId = createRes.body.backend.id;

      const domainBefore = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      const versionBefore = domainBefore.body.domain.configVersion;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/backends/${backendId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const domainAfter = await testClient.get<{ domain: any }>(
        `/api/domains/${testDomainId}`
      );
      expect(domainAfter.body.domain.configVersion).toBe(versionBefore + 1);

      // Verify backend is gone
      const getRes = await testClient.get(`/api/backends/${backendId}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent backend", async () => {
      const response = await testClient.delete(
        "/api/backends/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("Backup Backend Flag", () => {
    it("should create backend with isBackup flag set to true", async () => {
      const backendData = createBackendFixture(testDomainId, { isBackup: true });
      const response = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(201);
      expect(response.body.backend.isBackup).toBe(true);
    });

    it("should create backend with isBackup flag set to false by default", async () => {
      const backendData = createBackendFixture(testDomainId);
      const response = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );

      expect(response.status).toBe(201);
      expect(response.body.backend.isBackup).toBe(false);
    });

    it("should update backend isBackup flag", async () => {
      const createRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        createBackendFixture(testDomainId, { isBackup: false })
      );
      const backendId = createRes.body.backend.id;

      const updateRes = await testClient.put<{ backend: any }>(
        `/api/backends/${backendId}`,
        { isBackup: true }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.backend.isBackup).toBe(true);
    });

    it("should list backends with correct isBackup values", async () => {
      await testClient.post(
        "/api/backends",
        createBackendFixture(testDomainId, { name: "primary-1", isBackup: false })
      );
      await testClient.post(
        "/api/backends",
        createBackendFixture(testDomainId, { name: "primary-2", isBackup: false })
      );
      await testClient.post(
        "/api/backends",
        createBackendFixture(testDomainId, { name: "backup-1", isBackup: true })
      );

      const response = await testClient.get<{ backends: any[] }>(
        "/api/backends"
      );

      expect(response.status).toBe(200);
      expect(response.body.backends).toHaveLength(3);

      const primaryBackends = response.body.backends.filter(b => !b.isBackup);
      const backupBackends = response.body.backends.filter(b => b.isBackup);

      expect(primaryBackends).toHaveLength(2);
      expect(backupBackends).toHaveLength(1);
      expect(backupBackends[0].name).toBe("backup-1");
    });
  });
});
