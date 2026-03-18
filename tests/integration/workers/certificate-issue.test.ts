import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createDnsProviderFixture, createCertificateRequestFixture } from "../setup/fixtures";
import { processCertificateIssue } from "../../../apps/workers/src/processors/certificate-issue";
import { type Job } from "bullmq";
import type { CertificateIssueJobData } from "@uni-proxy-manager/queue";
import { access, rm, mkdir } from "fs/promises";
import { join } from "path";
import { getCertsDir } from "@uni-proxy-manager/shared/config";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

/**
 * Certificate Issue Worker Integration Tests
 *
 * These tests use Pebble (Let's Encrypt test ACME server) for real certificate issuance.
 * Pebble is configured with PEBBLE_VA_ALWAYS_VALID=1 so all challenges are auto-validated.
 *
 * The tests use a "test" DNS provider type that doesn't actually set DNS records,
 * since Pebble auto-validates challenges.
 */

// Helper to check if Pebble is available
async function isPebbleAvailable(): Promise<boolean> {
  const pebbleUrl = process.env.ACME_DIRECTORY_URL;
  if (!pebbleUrl) return false;

  try {
    const response = await fetch(pebbleUrl, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe("Certificate Issue Worker", () => {
  const certsDir = getCertsDir();
  let pebbleAvailable = false;

  beforeAll(async () => {
    await clearDatabase();
    pebbleAvailable = await isPebbleAvailable();
    if (!pebbleAvailable) {
      console.warn("[CertIssue Tests] Pebble ACME server not available - some tests will be skipped");
    }
    // Ensure certs directory exists
    await mkdir(certsDir, { recursive: true });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  /**
   * Create a mock BullMQ job
   */
  function createMockJob(data: CertificateIssueJobData): Job<CertificateIssueJobData> {
    return {
      id: "test-job-id",
      name: "certificate-issue",
      data,
      opts: {},
      attemptsMade: 0,
      timestamp: Date.now(),
      returnvalue: undefined,
      failedReason: undefined,
      getState: async () => "active",
      updateProgress: async () => {},
      log: async () => {},
    } as unknown as Job<CertificateIssueJobData>;
  }

  describe("Certificate Issuance Flow", () => {
    it("should create certificate files on successful issuance", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "cert-test.example.com" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      expect(providerRes.status).toBe(201);
      const providerId = providerRes.body.provider.id;

      // Request certificate (creates DB record)
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(domainId, providerId)
      );
      expect(certRes.status).toBe(201);
      const certificateId = certRes.body.certificate.id;
      const hostname = "cert-test.example.com";

      // Run the worker
      const job = createMockJob({
        certificateId,
        domainId,
        hostname,
        altNames: [],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      });

      const result = await processCertificateIssue(job);

      if (!result.success) {
        console.error("Certificate issue failed:", result.error);
      }
      expect(result.success).toBe(true);
      expect(result.certificateId).toBe(certificateId);
      expect(result.certPath).toBeDefined();
      expect(result.keyPath).toBeDefined();
      expect(result.fullchainPath).toBeDefined();

      // Verify certificate files were created
      const certDir = join(certsDir, domainId);
      await access(join(certDir, "cert.pem"));
      await access(join(certDir, "key.pem"));
      await access(join(certDir, "chain.pem"));
      await access(join(certDir, "fullchain.pem"));

      // Cleanup
      await rm(certDir, { recursive: true, force: true });
    });

    it("should update database status to active on success", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(domainId, providerId)
      );
      const certificateId = certRes.body.certificate.id;

      // Run the worker
      const job = createMockJob({
        certificateId,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      });

      await processCertificateIssue(job);

      // Check database status
      const cert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, certificateId),
      });

      expect(cert?.status).toBe("active");
      expect(cert?.issuedAt).toBeDefined();
      expect(cert?.expiresAt).toBeDefined();
      expect(cert?.certPath).toBeDefined();
      expect(cert?.keyPath).toBeDefined();

      // Cleanup
      await rm(join(certsDir, domainId), { recursive: true, force: true });
    });

    it("should set correct expiry date (90 days for Let's Encrypt)", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(domainId, providerId)
      );
      const certificateId = certRes.body.certificate.id;

      // Run the worker
      const job = createMockJob({
        certificateId,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      });

      const result = await processCertificateIssue(job);

      // Check expiry is approximately 90 days from now
      if (result.expiresAt) {
        const daysUntilExpiry = Math.floor(
          (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        expect(daysUntilExpiry).toBeGreaterThanOrEqual(89);
        expect(daysUntilExpiry).toBeLessThanOrEqual(91);
      }

      // Cleanup
      await rm(join(certsDir, domainId), { recursive: true, force: true });
    });

    it("should set next renewal check 30 days before expiry", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(domainId, providerId)
      );
      const certificateId = certRes.body.certificate.id;

      // Run the worker
      await processCertificateIssue(createMockJob({
        certificateId,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      }));

      // Check database
      const cert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, certificateId),
      });

      if (cert?.expiresAt && cert?.nextRenewalCheck) {
        const daysBeforeExpiry = Math.floor(
          (cert.expiresAt.getTime() - cert.nextRenewalCheck.getTime()) / (1000 * 60 * 60 * 24)
        );
        expect(daysBeforeExpiry).toBeGreaterThanOrEqual(29);
        expect(daysBeforeExpiry).toBeLessThanOrEqual(31);
      }

      // Cleanup
      await rm(join(certsDir, domainId), { recursive: true, force: true });
    });
  });

  describe("Error Handling", () => {
    it("should update database status to failed on error", async () => {
      // Create domain but no DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create certificate record directly (simulating a pending certificate)
      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "pending",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
        })
        .returning();

      // Run the worker with non-existent DNS provider
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: "non-existent-provider",
        acmeEmail: "test@example.com",
        staging: true,
      });

      const result = await processCertificateIssue(job);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Check database status
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });

      expect(updatedCert?.status).toBe("failed");
      expect(updatedCert?.lastError).toBeDefined();
    });

    it("should track renewal attempts on failure", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create certificate record
      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "pending",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
        })
        .returning();

      // Run the worker (should fail)
      await processCertificateIssue(createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: "non-existent",
        acmeEmail: "test@example.com",
        staging: true,
      }));

      // Check renewal attempts increased
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });

      expect(updatedCert?.renewalAttempts).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Certificate with Alt Names", () => {
    it("should handle certificate with subject alternative names", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "main.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate with alt names
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          ...createCertificateRequestFixture(domainId, providerId),
          altNames: ["www.example.com", "api.example.com"],
        }
      );
      const certificateId = certRes.body.certificate.id;

      // Run the worker
      const job = createMockJob({
        certificateId,
        domainId,
        hostname: "main.example.com",
        altNames: ["www.example.com", "api.example.com"],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      });

      const result = await processCertificateIssue(job);

      expect(result.success).toBe(true);

      // Cleanup
      await rm(join(certsDir, domainId), { recursive: true, force: true });
    });
  });

  describe("Staging vs Production", () => {
    it("should accept staging flag", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(domainId, providerId)
      );
      const certificateId = certRes.body.certificate.id;

      // Run with staging = true
      const stagingResult = await processCertificateIssue(createMockJob({
        certificateId,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      }));

      expect(stagingResult.success).toBe(true);

      // Cleanup
      await rm(join(certsDir, domainId), { recursive: true, force: true });
    });
  });

  describe("Status Transitions", () => {
    it("should transition from pending to issuing to active", async () => {
      if (!pebbleAvailable) {
        console.log("Skipping - Pebble not available");
        return;
      }

      // Create domain and DNS provider
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const providerRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const providerId = providerRes.body.provider.id;

      // Request certificate (starts as pending)
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(domainId, providerId)
      );
      const certificateId = certRes.body.certificate.id;

      // Verify initial status
      let cert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, certificateId),
      });
      // Status might already be "issuing" if job was processed
      expect(["pending", "issuing"]).toContain(cert?.status);

      // Run the worker
      await processCertificateIssue(createMockJob({
        certificateId,
        domainId,
        hostname: domainRes.body.domain.hostname,
        altNames: [],
        dnsProviderId: providerId,
        acmeEmail: "test@example.com",
        staging: true,
      }));

      // Verify final status
      cert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, certificateId),
      });
      expect(cert?.status).toBe("active");

      // Cleanup
      await rm(join(certsDir, domainId), { recursive: true, force: true });
    });
  });
});
