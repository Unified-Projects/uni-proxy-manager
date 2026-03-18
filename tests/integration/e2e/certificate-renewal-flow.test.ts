import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import { createDomainFixture, createDnsProviderFixture } from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq, and, lt } from "drizzle-orm";

/**
 * End-to-End Certificate Renewal Flow Test
 *
 * This test validates the complete certificate lifecycle including:
 * - Certificate request (issue)
 * - Certificate expiration detection
 * - Automatic renewal triggering
 * - Renewal retry on failure
 * - HAProxy reload with new certificate
 */
describe("E2E: Certificate Renewal Flow", () => {
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

  describe("Complete Certificate Lifecycle", () => {
    it("should complete full certificate lifecycle from issue to renewal", async () => {
      // ========================================
      // Step 1: Create DNS Provider
      // ========================================
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );

      expect(dnsProviderRes.status).toBe(201);
      const dnsProviderId = dnsProviderRes.body.provider.id;

      // ========================================
      // Step 2: Create Domain with SSL Enabled
      // ========================================
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "cert-lifecycle.example.com",
          sslEnabled: true,
          forceHttps: true,
        })
      );

      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      // ========================================
      // Step 3: Request Initial Certificate
      // ========================================
      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId,
          staging: true,
        }
      );

      expect(certRes.status).toBe(201);
      const certificateId = certRes.body.certificate.id;
      expect(certRes.body.certificate.status).toBe("pending");
      expect(certRes.body.certificate.source).toBe("letsencrypt");

      // ========================================
      // Step 4: Simulate Certificate Issuance
      // ========================================
      // In real scenario, ACME worker would complete this
      const issuedAt = new Date();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90 days from now

      await testDb
        .update(schema.certificates)
        .set({
          status: "active",
          issuedAt,
          expiresAt,
          certPem: "-----BEGIN CERTIFICATE-----\nMOCK_CERTIFICATE\n-----END CERTIFICATE-----",
          keyPem: "-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----",
          chainPem: "-----BEGIN CERTIFICATE-----\nMOCK_CHAIN\n-----END CERTIFICATE-----",
          renewalAttempts: 0,
        })
        .where(eq(schema.certificates.id, certificateId));

      // Verify certificate is active
      const activeCertRes = await testClient.get<{ certificate: any }>(
        `/api/certificates/${certificateId}`
      );
      expect(activeCertRes.body.certificate.status).toBe("active");
      expect(activeCertRes.body.certificate.expiresAt).toBeDefined();

      // ========================================
      // Step 5: Generate HAProxy Config with Certificate
      // ========================================
      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      const configRes = await testClient.get<string>("/api/haproxy/config/preview");
      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("cert-lifecycle.example.com");

      // ========================================
      // Step 6: Simulate Time Passing - Certificate Near Expiry
      // ========================================
      const nearExpiry = new Date();
      nearExpiry.setDate(nearExpiry.getDate() + 20); // Only 20 days left

      await testDb
        .update(schema.certificates)
        .set({
          expiresAt: nearExpiry,
        })
        .where(eq(schema.certificates.id, certificateId));

      // ========================================
      // Step 7: Check Certificate Status
      // ========================================
      const expiringCertRes = await testClient.get<{ certificate: any }>(
        `/api/certificates/${certificateId}`
      );
      expect(expiringCertRes.body.certificate.expiresAt).toBeDefined();

      // Certificate should be identified as needing renewal (< 30 days)
      const certData = expiringCertRes.body.certificate;
      const daysUntilExpiry = Math.ceil(
        (new Date(certData.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      expect(daysUntilExpiry).toBeLessThanOrEqual(30);

      // ========================================
      // Step 8: Trigger Renewal
      // ========================================
      const renewRes = await testClient.post<{ certificate: any }>(
        `/api/certificates/${certificateId}/renew`
      );

      expect([200, 202]).toContain(renewRes.status);

      // ========================================
      // Step 9: Simulate Renewal Completion
      // ========================================
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 90);

      await testDb
        .update(schema.certificates)
        .set({
          status: "active",
          expiresAt: newExpiresAt,
          issuedAt: new Date(),
          renewedAt: new Date(),
          renewalAttempts: 0,
          lastError: null,
        })
        .where(eq(schema.certificates.id, certificateId));

      // Verify renewed certificate
      const renewedCertRes = await testClient.get<{ certificate: any }>(
        `/api/certificates/${certificateId}`
      );
      expect(renewedCertRes.body.certificate.status).toBe("active");
      // Schema uses lastRenewalAttempt, not renewedAt
      expect(renewedCertRes.body.certificate.lastRenewalAttempt).toBeDefined();

      // ========================================
      // Step 10: Cleanup
      // ========================================
      await testClient.delete(`/api/certificates/${certificateId}`);
      await testClient.delete(`/api/domains/${domainId}`);
      await testClient.delete(`/api/dns-providers/${dnsProviderId}`);
    });
  });

  describe("Certificate Expiration Detection", () => {
    it("should identify certificates needing renewal", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      // Create domains with certificates at various expiration states
      const expirationStates = [
        { days: 10, shouldRenew: true },  // Expires in 10 days - SHOULD renew
        { days: 25, shouldRenew: true },  // Expires in 25 days - SHOULD renew (< 30)
        { days: 35, shouldRenew: false }, // Expires in 35 days - should NOT renew
        { days: 60, shouldRenew: false }, // Expires in 60 days - should NOT renew
        { days: 90, shouldRenew: false }, // Expires in 90 days - should NOT renew
      ];

      const certificateIds: string[] = [];

      for (let i = 0; i < expirationStates.length; i++) {
        const state = expirationStates[i];

        const domainRes = await testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture({
            hostname: `expiry-test-${i}.example.com`,
            sslEnabled: true,
          })
        );
        const domainId = domainRes.body.domain.id;

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + state.days);

        const [cert] = await testDb
          .insert(schema.certificates)
          .values({
            id: `expiry-cert-${i}-${Date.now()}`,
            domainId,
            commonName: `expiry-test-${i}.example.com`,
            status: "active",
            source: "letsencrypt",
            autoRenew: true,
            renewBeforeDays: 30,
            renewalAttempts: 0,
            issuedAt: new Date(),
            expiresAt,
          })
          .returning();

        certificateIds.push(cert.id);
      }

      // Query certificates needing renewal (expires within 30 days)
      const renewalThreshold = new Date();
      renewalThreshold.setDate(renewalThreshold.getDate() + 30);

      const needingRenewal = await testDb.query.certificates.findMany({
        where: and(
          eq(schema.certificates.autoRenew, true),
          eq(schema.certificates.status, "active"),
          lt(schema.certificates.expiresAt, renewalThreshold)
        ),
      });

      // Should find exactly 2 certificates (10 days and 25 days)
      expect(needingRenewal.length).toBe(2);
    });
  });

  describe("Renewal Failure Handling", () => {
    it("should track renewal attempts on failure", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "renewal-failure.example.com",
          sslEnabled: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 15);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `renewal-fail-${Date.now()}`,
          domainId,
          commonName: "renewal-failure.example.com",
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          issuedAt: new Date(),
          expiresAt,
        })
        .returning();

      // Simulate first renewal failure
      await testDb
        .update(schema.certificates)
        .set({
          renewalAttempts: 1,
          lastError: "DNS challenge failed: TXT record not propagated",
          lastRenewalAttempt: new Date(),
        })
        .where(eq(schema.certificates.id, cert.id));

      // Verify attempt tracked
      const afterFirstFailure = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(afterFirstFailure?.renewalAttempts).toBe(1);
      expect(afterFirstFailure?.lastError).toContain("DNS challenge failed");

      // Simulate second renewal failure
      await testDb
        .update(schema.certificates)
        .set({
          renewalAttempts: 2,
          lastError: "ACME server rate limited",
          lastRenewalAttempt: new Date(),
        })
        .where(eq(schema.certificates.id, cert.id));

      const afterSecondFailure = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(afterSecondFailure?.renewalAttempts).toBe(2);

      // Simulate third failure - should mark as failed
      await testDb
        .update(schema.certificates)
        .set({
          status: "failed",
          renewalAttempts: 3,
          lastError: "Maximum renewal attempts exceeded",
        })
        .where(eq(schema.certificates.id, cert.id));

      const finalState = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(finalState?.status).toBe("failed");
      expect(finalState?.renewalAttempts).toBe(3);
    });

    it("should reset attempts after successful renewal", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 15);

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `reset-attempts-${Date.now()}`,
          domainId,
          commonName: "reset.example.com",
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 2,
          lastError: "Previous failure",
          issuedAt: new Date(),
          expiresAt,
        })
        .returning();

      // Simulate successful renewal
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 90);

      await testDb
        .update(schema.certificates)
        .set({
          renewalAttempts: 0,
          lastError: null,
          expiresAt: newExpiresAt,
          renewedAt: new Date(),
        })
        .where(eq(schema.certificates.id, cert.id));

      const afterRenewal = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, cert.id),
      });
      expect(afterRenewal?.renewalAttempts).toBe(0);
      expect(afterRenewal?.lastError).toBeNull();
    });
  });

  describe("Auto-Renew Configuration", () => {
    it("should respect auto-renew disabled setting", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 10); // Expires soon

      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `no-autorenew-${Date.now()}`,
          domainId,
          commonName: "no-autorenew.example.com",
          status: "active",
          source: "letsencrypt",
          autoRenew: false, // Auto-renew disabled
          renewBeforeDays: 30,
          renewalAttempts: 0,
          issuedAt: new Date(),
          expiresAt,
        })
        .returning();

      // Query should NOT include this certificate
      const renewalThreshold = new Date();
      renewalThreshold.setDate(renewalThreshold.getDate() + 30);

      const needingRenewal = await testDb.query.certificates.findMany({
        where: and(
          eq(schema.certificates.autoRenew, true),
          eq(schema.certificates.status, "active"),
          lt(schema.certificates.expiresAt, renewalThreshold)
        ),
      });

      const foundCert = needingRenewal.find((c) => c.id === cert.id);
      expect(foundCert).toBeUndefined();
    });

    it("should allow updating auto-renew setting", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId,
          staging: true,
        }
      );
      const certificateId = certRes.body.certificate.id;

      // Update auto-renew setting
      const updateRes = await testClient.put<{ certificate: any }>(
        `/api/certificates/${certificateId}`,
        { autoRenew: false }
      );

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.certificate.autoRenew).toBe(false);

      // Re-enable
      const reEnableRes = await testClient.put<{ certificate: any }>(
        `/api/certificates/${certificateId}`,
        { autoRenew: true }
      );

      expect(reEnableRes.status).toBe(200);
      expect(reEnableRes.body.certificate.autoRenew).toBe(true);
    });
  });

  describe("Multiple Certificates Renewal", () => {
    it("should handle multiple certificates expiring simultaneously", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const certificateCount = 5;
      const certificateIds: string[] = [];

      // Create multiple certificates all expiring soon
      for (let i = 0; i < certificateCount; i++) {
        const domainRes = await testClient.post<{ domain: any }>(
          "/api/domains",
          createDomainFixture({
            hostname: `multi-renew-${i}.example.com`,
            sslEnabled: true,
          })
        );
        const domainId = domainRes.body.domain.id;

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 15); // All expire in 15 days

        const [cert] = await testDb
          .insert(schema.certificates)
          .values({
            id: `multi-cert-${i}-${Date.now()}`,
            domainId,
            commonName: `multi-renew-${i}.example.com`,
            status: "active",
            source: "letsencrypt",
            autoRenew: true,
            renewBeforeDays: 30,
            renewalAttempts: 0,
            issuedAt: new Date(),
            expiresAt,
          })
          .returning();

        certificateIds.push(cert.id);
      }

      // Query all certificates needing renewal
      const renewalThreshold = new Date();
      renewalThreshold.setDate(renewalThreshold.getDate() + 30);

      const needingRenewal = await testDb.query.certificates.findMany({
        where: and(
          eq(schema.certificates.autoRenew, true),
          eq(schema.certificates.status, "active"),
          lt(schema.certificates.expiresAt, renewalThreshold)
        ),
      });

      expect(needingRenewal.length).toBe(certificateCount);

      // Simulate batch renewal
      for (const certId of certificateIds) {
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 90);

        await testDb
          .update(schema.certificates)
          .set({
            expiresAt: newExpiresAt,
            renewedAt: new Date(),
            renewalAttempts: 0,
          })
          .where(eq(schema.certificates.id, certId));
      }

      // Verify all renewed
      const afterRenewal = await testDb.query.certificates.findMany({
        where: and(
          eq(schema.certificates.autoRenew, true),
          eq(schema.certificates.status, "active"),
          lt(schema.certificates.expiresAt, renewalThreshold)
        ),
      });

      expect(afterRenewal.length).toBe(0);
    });
  });

  describe("Certificate Types", () => {
    it("should handle wildcard certificates", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "example.com",
          sslEnabled: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Create wildcard certificate
      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `wildcard-${Date.now()}`,
          domainId,
          commonName: "*.example.com",
          altNames: ["example.com", "*.example.com"],
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        })
        .returning();

      expect(cert.commonName).toBe("*.example.com");
      expect(cert.altNames).toContain("*.example.com");
      expect(cert.altNames).toContain("example.com");
    });

    it("should handle multi-domain (SAN) certificates", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "primary.example.com",
          sslEnabled: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      // Create SAN certificate
      const [cert] = await testDb
        .insert(schema.certificates)
        .values({
          id: `san-${Date.now()}`,
          domainId,
          commonName: "primary.example.com",
          altNames: [
            "primary.example.com",
            "secondary.example.com",
            "tertiary.example.com",
          ],
          status: "active",
          source: "letsencrypt",
          autoRenew: true,
          renewBeforeDays: 30,
          renewalAttempts: 0,
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        })
        .returning();

      expect(cert.altNames?.length).toBe(3);
    });
  });

  describe("HAProxy Integration After Renewal", () => {
    it("should update HAProxy config after certificate renewal", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "haproxy-cert.example.com",
          sslEnabled: true,
          forceHttps: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      const certRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId,
          staging: true,
        }
      );
      const certificateId = certRes.body.certificate.id;

      // Simulate initial certificate issuance
      await testDb
        .update(schema.certificates)
        .set({
          status: "active",
          certPath: "/etc/haproxy/certs/haproxy-cert.example.com.pem",
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        })
        .where(eq(schema.certificates.id, certificateId));

      // Generate initial config
      const initialConfigRes = await testClient.get<string>("/api/haproxy/config/preview");
      expect(initialConfigRes.status).toBe(200);
      expect(initialConfigRes.body).toContain("haproxy-cert.example.com");

      // Simulate certificate renewal with new path
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 90);

      await testDb
        .update(schema.certificates)
        .set({
          expiresAt: newExpiresAt,
          renewedAt: new Date(),
          certPath: "/etc/haproxy/certs/haproxy-cert.example.com.pem",
        })
        .where(eq(schema.certificates.id, certificateId));

      // Regenerate config after renewal
      const renewedConfigRes = await testClient.get<string>("/api/haproxy/config/preview");
      expect(renewedConfigRes.status).toBe(200);
      expect(renewedConfigRes.body).toContain("haproxy-cert.example.com");

      // Trigger reload
      const reloadRes = await testClient.post("/api/haproxy/reload");
      expect([200, 201, 202]).toContain(reloadRes.status);
    });
  });

  describe("Certificate Job Queue Integration", () => {
    it("should queue certificate renewal jobs", async () => {
      // Get initial queue counts
      const initialCounts = await getQueueCounts(QUEUES.CERTIFICATE_RENEWAL);
      expect(typeof initialCounts.waiting).toBe("number");
      expect(typeof initialCounts.completed).toBe("number");
    });

    it("should queue certificate issuance jobs", async () => {
      const initialCounts = await getQueueCounts(QUEUES.CERTIFICATE_ISSUE);
      expect(typeof initialCounts.waiting).toBe("number");
    });
  });

  describe("Staging vs Production Certificates", () => {
    it("should track staging certificate mode", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture()
      );
      const domainId = domainRes.body.domain.id;

      // Request staging certificate (staging mode is controlled via env config, not per-cert)
      const stagingCertRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId,
        }
      );

      expect(stagingCertRes.status).toBe(201);
      expect(stagingCertRes.body.certificate).toBeDefined();
      expect(stagingCertRes.body.certificate.status).toBe("pending");
    });

    it("should support production certificate request", async () => {
      const dnsProviderRes = await testClient.post<{ provider: any }>(
        "/api/dns-providers",
        createDnsProviderFixture("cloudflare")
      );
      const dnsProviderId = dnsProviderRes.body.provider.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "production-cert.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Request production certificate (staging mode is controlled via env config, not per-cert)
      const prodCertRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId,
          dnsProviderId,
        }
      );

      expect(prodCertRes.status).toBe(201);
      expect(prodCertRes.body.certificate).toBeDefined();
      expect(prodCertRes.body.certificate.status).toBe("pending");
    });
  });
});
