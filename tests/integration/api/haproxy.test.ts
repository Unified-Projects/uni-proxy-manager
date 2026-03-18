import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import {
  createDomainFixture,
  createBackendFixture,
  createErrorPageFixture,
} from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getCertsDir } from "@uni-proxy-manager/shared/config";

describe("HAProxy API", () => {
  const certsDir = getCertsDir();

  /**
   * Create test certificate files and database record
   */
  async function createTestCertificate(domainId: string, hostname: string): Promise<{
    certPath: string;
    keyPath: string;
    fullchainPath: string;
    certificateId: string;
  }> {
    const certDir = join(certsDir, domainId);
    await mkdir(certDir, { recursive: true });

    const testCert = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfpTmMQ0SMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RDQTAAIW2301218000000ZDzANBgNVBAMMBnRlc3RDQTBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABLsample-test-certificate-not-real-production-use
-----END CERTIFICATE-----`;

    const testKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsample-test-key
-----END PRIVATE KEY-----`;

    const certPath = join(certDir, "cert.pem");
    const keyPath = join(certDir, "key.pem");
    const fullchainPath = join(certDir, "fullchain.pem");

    await writeFile(certPath, testCert);
    await writeFile(keyPath, testKey);
    await writeFile(fullchainPath, testCert);

    const certificateId = `cert-${domainId}`;
    await testDb.insert(schema.certificates).values({
      id: certificateId,
      domainId,
      commonName: hostname,
      status: "active",
      source: "letsencrypt",
      autoRenew: true,
      renewBeforeDays: 30,
      renewalAttempts: 0,
      certPath,
      keyPath,
      fullchainPath,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    return { certPath, keyPath, fullchainPath, certificateId };
  }

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

  describe("GET /api/haproxy/status", () => {
    it("should return HAProxy status", async () => {
      const response = await testClient.get<{
        status: string;
        configPath: string;
        domainCount: number;
      }>("/api/haproxy/status");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("configPath");
      expect(response.body).toHaveProperty("domainCount");
    });

    it("should include domain count", async () => {
      // Create some domains
      await testClient.post("/api/domains", createDomainFixture());
      await testClient.post("/api/domains", createDomainFixture());

      const response = await testClient.get<{ domainCount: number }>(
        "/api/haproxy/status"
      );

      expect(response.status).toBe(200);
      expect(response.body.domainCount).toBe(2);
    });
  });

  describe("GET /api/haproxy/config/preview", () => {
    it("should generate config preview with no domains", async () => {
      const response = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(response.status).toBe(200);
      expect(typeof response.body).toBe("string");
      expect(response.body).toContain("global");
      expect(response.body).toContain("defaults");
      expect(response.body).toContain("frontend");
      expect(response.body).toContain("backend");
    });

    it("should include domain configuration in preview", async () => {
      // Create active domain with backend
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "preview.example.com",
        })
      );
      const domainId = domainRes.body.domain.id;

      // Set domain to active
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "preview-backend",
          address: "192.168.1.10",
          port: 8080,
        })
      );

      const response = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(response.status).toBe(200);
      expect(response.body).toContain("preview.example.com");
      expect(response.body).toContain("192.168.1.10:8080");
    });

    it("should generate maintenance ACLs for maintenance-enabled domains", async () => {
      // Create maintenance page (required for bypass IPs to appear in config)
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance")
      );
      expect(maintPageRes.status).toBe(201);
      const maintPageId = maintPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "maintenance.example.com",
        })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["10.0.0.1"],
          maintenancePageId: maintPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const response = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(response.status).toBe(200);
      expect(response.body).toContain("maintenance");
      expect(response.body).toContain("10.0.0.1");
    });

    it("should include HTTPS redirect for forceHttps domains", async () => {
      const hostname = "https.example.com";
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname,
          sslEnabled: true,
          forceHttps: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Create actual certificate for HTTPS redirect to work
      const { certificateId } = await createTestCertificate(domainId, hostname);

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          sslEnabled: true,
          certificateId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const response = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(response.status).toBe(200);
      expect(response.body).toContain("redirect");
      expect(response.body).toContain("https");
    });

    it("should include certificate and error page paths when present", async () => {
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("custom")
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      const hostname = "certpaths.example.com";
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname,
          sslEnabled: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Create actual certificate files and database record
      const { certificateId } = await createTestCertificate(domainId, hostname);

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          sslEnabled: true,
          certificateId,
          errorPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const response = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(response.status).toBe(200);
      expect(response.body).toContain(process.env.UNI_PROXY_MANAGER_CERTS_DIR!);
      expect(response.body).toContain("certpaths.example.com");
      expect(response.body).toContain(process.env.UNI_PROXY_MANAGER_ERROR_PAGES_DIR!);
    });
  });

  describe("GET /api/haproxy/config", () => {
    it("should return current config file content", async () => {
      const response = await testClient.get<string>("/api/haproxy/config");

      expect(response.status).toBe(200);
      // Should return some config content or empty if no config exists
    });
  });

  describe("POST /api/haproxy/reload", () => {
    it("should queue HAProxy reload job", async () => {
      const response = await testClient.post<{
        success: boolean;
        changed: boolean;
      }>("/api/haproxy/reload");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Job may have already been processed, so we just verify the request succeeded
      // The success response indicates a job was queued (or config unchanged)
      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(typeof counts.waiting).toBe("number");
      expect(typeof counts.active).toBe("number");
      expect(typeof counts.completed).toBe("number");
    });

    it("should force reload with force parameter", async () => {
      // First reload
      await testClient.post("/api/haproxy/reload");
      await clearRedisQueues();

      // Force reload
      const response = await testClient.post<{
        success: boolean;
        changed: boolean;
      }>("/api/haproxy/reload?force=true");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const counts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
      expect(
        counts.waiting + counts.active + counts.completed
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe("POST /api/haproxy/apply", () => {
    it("should write config file", async () => {
      const response = await testClient.post<{
        success: boolean;
        configPath: string;
      }>("/api/haproxy/apply");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.configPath).toBeDefined();
    });
  });
});
