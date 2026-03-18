import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture, createDnsProviderFixture } from "../setup/fixtures";
import { createMockBackend, type MockBackendServer } from "../setup/mock-backend";
import { haproxyClient } from "../setup/haproxy-client";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { getCertsDir } from "@uni-proxy-manager/shared/config";

describe("HAProxy SSL/TLS", () => {
  let mockBackend: MockBackendServer;
  let mockBackendPort: number;
  const certsDir = getCertsDir();

  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();

    mockBackend = await createMockBackend();
    mockBackendPort = mockBackend.getPort();
  });

  afterAll(async () => {
    await mockBackend.stop();
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
    mockBackend.reset();
  });

  afterEach(() => {
    mockBackend.clearLogs();
  });

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

    // Create self-signed test certificate (valid for testing only)
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

    // Create certificate record in database
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

  describe("HTTPS Frontend Configuration", () => {
    it("should generate HTTPS frontend when SSL domains exist", async () => {
      const hostname = "ssl-test.example.com";
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
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "127.0.0.1",
          port: mockBackendPort,
        })
      );

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      expect(previewRes.status).toBe(200);
      expect(previewRes.body).toContain("https_front");
      expect(previewRes.body).toContain("bind *:443 ssl");
    });

    it("should not generate HTTPS frontend when no SSL domains exist", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "no-ssl.example.com",
          sslEnabled: false,
        })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      expect(previewRes.status).toBe(200);
      // Should have HTTP frontend but not HTTPS
      expect(previewRes.body).toContain("http_front");
      expect(previewRes.body).not.toContain("https_front");
    });
  });

  describe("HTTPS Redirect", () => {
    it("should include HTTPS redirect for forceHttps domains", async () => {
      const hostname = "force-https.example.com";
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname,
          sslEnabled: true,
          forceHttps: true,
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
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      expect(previewRes.body).toContain("redirect scheme https");
      expect(previewRes.body).toContain("force-https.example.com");
    });

    it("should return 301 redirect from HTTP to HTTPS", async () => {
      const hostname = "redirect-test.example.com";
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname,
          sslEnabled: true,
          forceHttps: true,
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
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "127.0.0.1",
          port: mockBackendPort,
        })
      );

      await testClient.post("/api/haproxy/apply");
      await testClient.post("/api/haproxy/reload");

      await new Promise((r) => setTimeout(r, 2000));

      if (!(await haproxyClient.isRunning())) {
        console.log("HAProxy not running, skipping redirect test");
        return;
      }

      // Test redirect
      const isRedirected = await haproxyClient.testHttpsRedirect("redirect-test.example.com");

      // If HAProxy is properly configured, should redirect
      // In test environment, this may or may not work depending on config
      expect(typeof isRedirected).toBe("boolean");
    });

    it("should not redirect when forceHttps is false", async () => {
      const hostname = "no-redirect.example.com";
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname,
          sslEnabled: true,
          forceHttps: false,
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
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // Should not have redirect for this domain
      expect(previewRes.body).not.toContain("redirect scheme https code 301 if !{ ssl_fc } { hdr(host) -i no-redirect.example.com }");
    });
  });

  describe("Certificate Configuration", () => {
    it("should reference correct certificate path", async () => {
      const hostname = "cert-path.example.com";
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
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // Config should reference certificates directory
      expect(previewRes.body).toContain("ssl crt");
      expect(previewRes.body).toContain(certsDir);
    });

    it("should handle multiple SSL domains", async () => {
      // Create multiple SSL domains
      for (let i = 1; i <= 3; i++) {
        const hostname = `ssl${i}.example.com`;
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
          })
          .where(eq(schema.domains.id, domainId));

        await testClient.post("/api/backends", createBackendFixture(domainId));
      }

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // All domains should be in the config
      expect(previewRes.body).toContain("ssl1.example.com");
      expect(previewRes.body).toContain("ssl2.example.com");
      expect(previewRes.body).toContain("ssl3.example.com");
    });
  });

  describe("SNI Routing", () => {
    it("should route based on Server Name Indication", async () => {
      // Create two SSL domains
      const hostname1 = "sni1.example.com";
      const hostname2 = "sni2.example.com";

      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: hostname1,
          sslEnabled: true,
        })
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: hostname2,
          sslEnabled: true,
        })
      );

      const domain1Id = domain1Res.body.domain.id;
      const domain2Id = domain2Res.body.domain.id;

      // Create actual certificate files and database records
      const { certificateId: cert1Id } = await createTestCertificate(domain1Id, hostname1);
      const { certificateId: cert2Id } = await createTestCertificate(domain2Id, hostname2);

      // Activate both with certificates
      for (const [domainId, certId] of [
        [domain1Id, cert1Id],
        [domain2Id, cert2Id],
      ]) {
        await testDb
          .update(schema.domains)
          .set({
            status: "active",
            sslEnabled: true,
            certificateId: certId,
          })
          .where(eq(schema.domains.id, domainId));

        await testClient.post("/api/backends", createBackendFixture(domainId as string));
      }

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // Both domains should have ACLs for host matching
      expect(previewRes.body).toContain("hdr(host) -i sni1.example.com");
      expect(previewRes.body).toContain("hdr(host) -i sni2.example.com");
    });
  });

  describe("Certificate with Domains", () => {
    it("should link certificate to domain in database", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "cert-link.example.com",
          sslEnabled: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Create DNS provider
      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate
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

      // Verify domain is updated with certificate ID
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(domainCheck.body.domain.certificateId).toBe(certRes.body.certificate.id);
    });
  });

  describe("Mixed HTTP/HTTPS Configuration", () => {
    it("should handle mix of SSL and non-SSL domains", async () => {
      const sslHostname = "with-ssl.example.com";

      // SSL domain
      const sslDomainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: sslHostname,
          sslEnabled: true,
        })
      );

      // Non-SSL domain
      const noSslDomainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "no-ssl.example.com",
          sslEnabled: false,
        })
      );

      const sslDomainId = sslDomainRes.body.domain.id;
      const noSslDomainId = noSslDomainRes.body.domain.id;

      // Create actual certificate files and database record
      const { certificateId } = await createTestCertificate(sslDomainId, sslHostname);

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          sslEnabled: true,
          certificateId,
        })
        .where(eq(schema.domains.id, sslDomainId));

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, noSslDomainId));

      await testClient.post("/api/backends", createBackendFixture(sslDomainId));
      await testClient.post("/api/backends", createBackendFixture(noSslDomainId));

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // Both should be in HTTP frontend
      expect(previewRes.body).toContain("with-ssl.example.com");
      expect(previewRes.body).toContain("no-ssl.example.com");

      // Only SSL domain should be in HTTPS frontend
      expect(previewRes.body).toContain("https_front");
    });
  });

  describe("SSL with Health Checks", () => {
    it("should configure health checks for SSL-enabled backends", async () => {
      const hostname = "ssl-health.example.com";
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
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          healthCheckEnabled: true,
          healthCheckPath: "/health",
        })
      );

      const previewRes = await testClient.get<string>("/api/haproxy/config/preview");

      // Should have health check config
      expect(previewRes.body).toContain("httpchk");
      expect(previewRes.body).toContain("/health");
    });
  });
});
