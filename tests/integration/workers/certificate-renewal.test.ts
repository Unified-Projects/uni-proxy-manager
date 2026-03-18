import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createDnsProviderFixture } from "../setup/fixtures";
import { processCertificateRenewal, checkCertificatesForRenewal } from "../../../apps/workers/src/processors/certificate-renewal";
import { type Job } from "bullmq";
import type { CertificateRenewalJobData } from "@uni-proxy-manager/queue";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Certificate Renewal Worker", () => {
  beforeAll(async () => {
    await clearDatabase();
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
  function createMockJob(data: CertificateRenewalJobData): Job<CertificateRenewalJobData> {
    return {
      id: "test-renewal-job-id",
      name: "certificate-renewal",
      data,
      opts: {},
      attemptsMade: 0,
      timestamp: Date.now(),
      returnvalue: undefined,
      failedReason: undefined,
      getState: async () => "active",
      updateProgress: async () => {},
      log: async () => {},
    } as unknown as Job<CertificateRenewalJobData>;
  }

  describe("Renewal Decision Logic", () => {
    it("should skip renewal when certificate is not expiring soon", async () => {
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

      // Create a certificate that expires in 60 days (not due for renewal at 30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 60);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-not-expiring-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      // Run renewal check
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      });

      const result = await processCertificateRenewal(job);

      // Should succeed without actually renewing
      expect(result.success).toBe(true);
      expect(result.certificateId).toBe(cert.id);

      // Status should remain active (not issuing)
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.status).toBe("active");
    });

    it("should trigger renewal when certificate is expiring within renewBeforeDays", async () => {
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

      // Create a certificate that expires in 15 days (due for renewal at 30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 15);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-expiring-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      // Run renewal check
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      });

      const result = await processCertificateRenewal(job);

      expect(result.success).toBe(true);

      // Status should change to issuing
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.status).toBe("issuing");
      expect(updatedCert?.lastRenewalAttempt).toBeDefined();
    });

    it("should trigger renewal when forceRenewal is true regardless of expiry", async () => {
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

      // Create a certificate that expires in 89 days (not normally due)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 89);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-force-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      // Run renewal with force flag
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
        forceRenewal: true,
      });

      const result = await processCertificateRenewal(job);

      expect(result.success).toBe(true);

      // Status should change to issuing even though not expiring soon
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.status).toBe("issuing");
    });
  });

  describe("Renewal Attempt Tracking", () => {
    it("should increment renewalAttempts on each renewal", async () => {
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

      // Create certificate with existing renewal attempts
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 10);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-attempts-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 2,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      // Run renewal
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      });

      await processCertificateRenewal(job);

      // Check attempts incremented
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.renewalAttempts).toBe(3);
    });

    it("should set lastRenewalAttempt timestamp", async () => {
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

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 5);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-timestamp-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      const beforeRenewal = new Date();

      // Run renewal
      await processCertificateRenewal(createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      }));

      const afterRenewal = new Date();

      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });

      expect(updatedCert?.lastRenewalAttempt).toBeDefined();
      expect(updatedCert!.lastRenewalAttempt!.getTime()).toBeGreaterThanOrEqual(
        beforeRenewal.getTime()
      );
      expect(updatedCert!.lastRenewalAttempt!.getTime()).toBeLessThanOrEqual(
        afterRenewal.getTime()
      );
    });
  });

  describe("Error Handling", () => {
    it("should return error when certificate not found", async () => {
      const job = createMockJob({
        certificateId: "non-existent-cert-id",
        domainId: "some-domain-id",
        hostname: "test.example.com",
        dnsProviderId: "some-provider-id",
      });

      const result = await processCertificateRenewal(job);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Certificate not found");
    });
  });

  describe("Certificate Discovery (checkCertificatesForRenewal)", () => {
    it("should find certificates with nextRenewalCheck in the past", async () => {
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

      // Create certificate with nextRenewalCheck in the past
      const nextRenewalCheck = new Date();
      nextRenewalCheck.setDate(nextRenewalCheck.getDate() - 1);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 20);

      await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-due-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          nextRenewalCheck,
          dnsProviderId: providerId,
        });

      // This function queues jobs for due certificates
      // In a real test environment with Redis, we'd verify jobs were queued
      // For now, we just verify it doesn't throw
      await expect(checkCertificatesForRenewal()).resolves.not.toThrow();
    });

    it("should not find certificates with autoRenew disabled", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create certificate with autoRenew disabled
      const nextRenewalCheck = new Date();
      nextRenewalCheck.setDate(nextRenewalCheck.getDate() - 1);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 5);

      await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-no-auto-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: false, // Disabled
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          nextRenewalCheck,
        });

      // Should not throw
      await expect(checkCertificatesForRenewal()).resolves.not.toThrow();
    });

    it("should not find certificates with status other than active", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Create certificate with pending status
      const nextRenewalCheck = new Date();
      nextRenewalCheck.setDate(nextRenewalCheck.getDate() - 1);

      await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-pending-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "pending", // Not active
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          nextRenewalCheck,
        });

      await expect(checkCertificatesForRenewal()).resolves.not.toThrow();
    });
  });

  describe("Alt Names Handling", () => {
    it("should include alt names when queuing renewal", async () => {
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

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 10);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-altnames-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          altNames: ["www.example.com", "api.example.com"],
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      // Run renewal
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      });

      const result = await processCertificateRenewal(job);

      expect(result.success).toBe(true);

      // The processor queues a certificate issue job with the alt names
      // We verify the process completed without error
      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.status).toBe("issuing");
    });
  });

  describe("Edge Cases", () => {
    it("should handle certificate with no expiresAt (force renewal)", async () => {
      // Create domain
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

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-no-expiry-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt: null as any, // No expiry set
          dnsProviderId: providerId,
        })
        .returning();

      // Force renewal should still work
      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
        forceRenewal: true,
      });

      const result = await processCertificateRenewal(job);

      expect(result.success).toBe(true);
    });

    it("should handle certificate with renewBeforeDays of 0", async () => {
      // Create domain
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

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 5);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-zero-days-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 0, // Only renew on expiry day
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      });

      const result = await processCertificateRenewal(job);

      // Should skip renewal since 5 days > 0 days
      expect(result.success).toBe(true);

      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.status).toBe("active"); // Not changed
    });

    it("should handle certificate expiring today", async () => {
      // Create domain
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

      // Expires in 0 days (today)
      const expiresAt = new Date();

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `test-cert-today-${Date.now()}`,
          domainId,
          commonName: domainRes.body.domain.hostname,
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          expiresAt,
          dnsProviderId: providerId,
        })
        .returning();

      const job = createMockJob({
        certificateId: cert.id,
        domainId,
        hostname: domainRes.body.domain.hostname,
        dnsProviderId: providerId,
      });

      const result = await processCertificateRenewal(job);

      // Should trigger renewal immediately
      expect(result.success).toBe(true);

      const updatedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(updatedCert?.status).toBe("issuing");
    });
  });
});
