import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import { createMockBackend, type MockBackendServer } from "../setup/mock-backend";
import { processHealthCheck } from "../../../apps/workers/src/processors/health-check";
import { type Job } from "bullmq";
import type { HealthCheckJobData } from "@uni-proxy-manager/queue";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Health Check Worker", () => {
  let mockBackend: MockBackendServer;
  let mockBackendPort: number;

  beforeAll(async () => {
    await clearDatabase();
    // Start mock backend server
    mockBackend = await createMockBackend();
    mockBackendPort = mockBackend.getPort();
  });

  afterAll(async () => {
    await mockBackend.stop();
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    mockBackend.reset();
    mockBackend.setResponse("/health", { status: 200, body: "OK" });
  });

  afterEach(() => {
    mockBackend.clearLogs();
  });

  /**
   * Create a mock BullMQ job
   */
  function createMockJob(data: HealthCheckJobData): Job<HealthCheckJobData> {
    return {
      id: "test-job-id",
      name: "health-check",
      data,
      opts: {},
      attemptsMade: 0,
      timestamp: Date.now(),
      returnvalue: undefined,
      failedReason: undefined,
      getState: async () => "active",
      updateProgress: async () => {},
      log: async () => {},
    } as unknown as Job<HealthCheckJobData>;
  }

  describe("Single Backend Health Check", () => {
    it("should mark backend as healthy when health check succeeds", async () => {
      // Create domain and backend pointing to mock server
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      expect(backendRes.status).toBe(201);
      const backendId = backendRes.body.backend.id;

      // Set mock to return healthy response
      mockBackend.setResponse("/health", { status: 200, body: "OK" });

      // Run health check
      const job = createMockJob({
        scope: "backend",
        backendId,
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.checkedCount).toBe(1);
      expect(result.healthyCount).toBe(1);
      expect(result.unhealthyCount).toBe(0);

      // Verify backend status in database
      const backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(true);
      expect(backend?.lastHealthCheck).toBeDefined();
    });

    it("should mark backend as unhealthy when health check fails", async () => {
      // Create domain and backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      const backendId = backendRes.body.backend.id;

      // Set mock to return 503
      mockBackend.setResponse("/health", { status: 503, body: "Service Unavailable" });

      // Run health check
      const job = createMockJob({
        scope: "backend",
        backendId,
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.checkedCount).toBe(1);
      expect(result.healthyCount).toBe(0);
      expect(result.unhealthyCount).toBe(1);

      // Verify backend status in database
      const backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(false);
      expect(backend?.lastHealthError).toBe("Health check failed");
    });

    it("should mark backend as unhealthy when connection refused", async () => {
      // Create domain and backend pointing to non-existent port
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: 59999, // Non-existent port
        healthCheckPath: "/health",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      const backendId = backendRes.body.backend.id;

      // Run health check
      const job = createMockJob({
        scope: "backend",
        backendId,
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.unhealthyCount).toBe(1);

      // Verify backend status in database
      const backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(false);
    });

    it("should mark backend as unhealthy when timeout occurs", async () => {
      // Create domain and backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/slow",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      const backendId = backendRes.body.backend.id;

      // Set mock to respond slowly (longer than default 2s timeout)
      mockBackend.setResponse("/slow", { status: 200, body: "OK", delay: 5000 });

      // Run health check
      const job = createMockJob({
        scope: "backend",
        backendId,
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.unhealthyCount).toBe(1);

      // Verify backend status in database
      const backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(false);
    });
  });

  describe("Domain Health Check", () => {
    it("should check all backends for a domain", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create multiple backends
      const backend1 = createBackendFixture(domainId, {
        name: "backend-1",
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      });
      const backend2 = createBackendFixture(domainId, {
        name: "backend-2",
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health2",
      });

      await testClient.post("/api/backends", backend1);
      await testClient.post("/api/backends", backend2);

      // Set different responses
      mockBackend.setResponse("/health", { status: 200, body: "OK" });
      mockBackend.setResponse("/health2", { status: 503, body: "Down" });

      // Run health check for domain
      const job = createMockJob({
        scope: "domain",
        domainId,
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.checkedCount).toBe(2);
      expect(result.healthyCount).toBe(1);
      expect(result.unhealthyCount).toBe(1);
    });

    it("should skip backends with health check disabled", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create backend with health check disabled
      const backend = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
        healthCheckEnabled: false,
      });
      await testClient.post("/api/backends", backend);

      // Run health check
      const job = createMockJob({
        scope: "domain",
        domainId,
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.checkedCount).toBe(0);
    });
  });

  describe("Global Health Check", () => {
    it("should check all backends across all domains", async () => {
      // Create multiple domains with backends
      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );

      await testClient.post("/api/backends", createBackendFixture(domain1Res.body.domain.id, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      }));
      await testClient.post("/api/backends", createBackendFixture(domain2Res.body.domain.id, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      }));

      mockBackend.setResponse("/health", { status: 200, body: "OK" });

      // Run global health check
      const job = createMockJob({
        scope: "all",
      });

      const result = await processHealthCheck(job);

      expect(result.success).toBe(true);
      expect(result.checkedCount).toBe(2);
      expect(result.healthyCount).toBe(2);
    });
  });

  describe("Health Status Changes", () => {
    it("should update database when health status changes from healthy to unhealthy", async () => {
      // Create domain and backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      const backendId = backendRes.body.backend.id;

      // First check - healthy
      mockBackend.setResponse("/health", { status: 200, body: "OK" });
      await processHealthCheck(createMockJob({ scope: "backend", backendId }));

      let backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(true);

      // Second check - unhealthy
      mockBackend.setResponse("/health", { status: 503, body: "Down" });
      await processHealthCheck(createMockJob({ scope: "backend", backendId }));

      backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(false);
      expect(backend?.lastHealthError).toBe("Health check failed");
    });

    it("should update database when health status changes from unhealthy to healthy", async () => {
      // Create domain and backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/health",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      const backendId = backendRes.body.backend.id;

      // First check - unhealthy
      mockBackend.setResponse("/health", { status: 503, body: "Down" });
      await processHealthCheck(createMockJob({ scope: "backend", backendId }));

      let backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(false);

      // Second check - healthy (recovered)
      mockBackend.setResponse("/health", { status: 200, body: "OK" });
      await processHealthCheck(createMockJob({ scope: "backend", backendId }));

      backend = await testDb.query.backends.findFirst({
        where: eq(schema.backends.id, backendId),
      });
      expect(backend?.isHealthy).toBe(true);
      expect(backend?.lastHealthError).toBeNull();
    });
  });

  describe("Custom Health Check Paths", () => {
    it("should use configured health check path", async () => {
      // Create domain and backend with custom path
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/custom-health-check",
      });
      await testClient.post("/api/backends", backendData);

      // Set response for custom path
      mockBackend.setResponse("/custom-health-check", { status: 200, body: "Healthy" });

      // Run health check
      await processHealthCheck(createMockJob({ scope: "all" }));

      // Verify the custom path was called
      const requests = mockBackend.getRequestsTo("/custom-health-check");
      expect(requests.length).toBe(1);
    });
  });

  describe("HTTP Response Codes", () => {
    it.each([
      [200, true],
      [201, true],
      [204, true],
      [301, true],
      [302, true],
      [400, false],
      [401, false],
      [403, false],
      [404, false],
      [500, false],
      [502, false],
      [503, false],
    ])("should treat HTTP %i as %s", async (statusCode, expectedHealthy) => {
      // Create domain and backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const backendData = createBackendFixture(domainId, {
        address: "127.0.0.1",
        port: mockBackendPort,
        healthCheckPath: "/status",
      });
      const backendRes = await testClient.post<{ backend: any }>(
        "/api/backends",
        backendData
      );
      const backendId = backendRes.body.backend.id;

      mockBackend.setResponse("/status", { status: statusCode, body: `Status ${statusCode}` });

      const result = await processHealthCheck(createMockJob({ scope: "backend", backendId }));

      if (expectedHealthy) {
        expect(result.healthyCount).toBe(1);
        expect(result.unhealthyCount).toBe(0);
      } else {
        expect(result.healthyCount).toBe(0);
        expect(result.unhealthyCount).toBe(1);
      }
    });
  });
});
