import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts, getQueueJobs } from "../setup/test-redis";
import {
  createDomainFixture,
  createDnsProviderFixture,
  createCertificateRequestFixture,
} from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Certificates API", () => {
  let testDomainId: string;
  let testDnsProviderId: string;

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

    // Create domain and DNS provider
    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture()
    );
    testDomainId = domainRes.body.domain.id;

    const dnsRes = await testClient.post<{ provider: any }>(
      "/api/dns-providers",
      createDnsProviderFixture()
    );
    testDnsProviderId = dnsRes.body.provider.id;
  });

  describe("POST /api/certificates", () => {
    it("should create certificate request and queue issuance job", async () => {
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      const response = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        certData
      );

      expect(response.status).toBe(201);
      expect(response.body.certificate.status).toBe("pending");
      expect(response.body.certificate.domainId).toBe(testDomainId);

      // Verify job was queued
      const counts = await getQueueCounts(QUEUES.CERTIFICATE_ISSUE);
      expect(counts.waiting + counts.active).toBeGreaterThanOrEqual(1);
    });

    it("queues DNS-01 metadata with provider and alt names", async () => {
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      certData.altNames = ["alt.example.com"];

      await testClient.post("/api/certificates", certData);

      const jobs = await getQueueJobs<{ domainId: string; dnsProviderId?: string; altNames?: string[] }>(
        QUEUES.CERTIFICATE_ISSUE
      );

      expect(jobs.length).toBeGreaterThan(0);
      const job = jobs[0];
      expect(job.data.domainId).toBe(testDomainId);
      expect(job.data.dnsProviderId).toBe(testDnsProviderId);
      expect(job.data.altNames).toContain("alt.example.com");
    });

    it("should reject duplicate certificate for same domain", async () => {
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      await testClient.post("/api/certificates", certData);
      const response = await testClient.post<{ error: string }>(
        "/api/certificates",
        certData
      );

      expect(response.status).toBe(409);
    });

    it("should reject certificate for non-existent domain", async () => {
      const response = await testClient.post<{ error: string }>(
        "/api/certificates",
        {
          domainId: "non-existent",
          dnsProviderId: testDnsProviderId,
        }
      );

      expect(response.status).toBe(404);
    });

    it("should reject certificate for non-existent DNS provider", async () => {
      const response = await testClient.post<{ error: string }>(
        "/api/certificates",
        {
          domainId: testDomainId,
          dnsProviderId: "non-existent",
        }
      );

      expect(response.status).toBe(404);
    });

    it("should create certificate with alt names", async () => {
      const response = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        {
          domainId: testDomainId,
          dnsProviderId: testDnsProviderId,
          altNames: ["www.example.com", "api.example.com"],
        }
      );

      expect(response.status).toBe(201);
      expect(response.body.certificate.altNames).toContain("www.example.com");
      expect(response.body.certificate.altNames).toContain("api.example.com");
    });
  });

  describe("GET /api/certificates", () => {
    it("should list all certificates with domain info", async () => {
      await testClient.post(
        "/api/certificates",
        createCertificateRequestFixture(testDomainId, testDnsProviderId)
      );

      const response = await testClient.get<{ certificates: any[] }>(
        "/api/certificates"
      );

      expect(response.status).toBe(200);
      expect(response.body.certificates).toHaveLength(1);
      expect(response.body.certificates[0]).toHaveProperty("domain");
    });

    it("should return empty array when no certificates exist", async () => {
      const response = await testClient.get<{ certificates: any[] }>(
        "/api/certificates"
      );

      expect(response.status).toBe(200);
      expect(response.body.certificates).toHaveLength(0);
    });
  });

  describe("GET /api/certificates/:id", () => {
    it("should return a single certificate", async () => {
      const createRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        createCertificateRequestFixture(testDomainId, testDnsProviderId)
      );
      const certId = createRes.body.certificate.id;

      const response = await testClient.get<{ certificate: any }>(
        `/api/certificates/${certId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.certificate.id).toBe(certId);
    });

    it("should return 404 for non-existent certificate", async () => {
      const response = await testClient.get(
        "/api/certificates/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/certificates/:id/renew", () => {
    it("should queue renewal job for existing certificate", async () => {
      // Create certificate first
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      const createRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        certData
      );
      const certId = createRes.body.certificate.id;

      // Mark it as active (simulate issued state)
      await testDb
        .update(schema.certificates)
        .set({ status: "active" })
        .where(eq(schema.certificates.id, certId));

      await clearRedisQueues();

      const response = await testClient.post<{ success: boolean }>(
        `/api/certificates/${certId}/renew`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify renewal job was queued
      const counts = await getQueueCounts(QUEUES.CERTIFICATE_RENEWAL);
      expect(counts.waiting + counts.active).toBeGreaterThanOrEqual(1);
    });

    it("should return 404 for non-existent certificate", async () => {
      const response = await testClient.post(
        "/api/certificates/non-existent-id/renew"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/certificates/:id", () => {
    it("should update certificate settings", async () => {
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      const createRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        certData
      );
      const certId = createRes.body.certificate.id;

      const response = await testClient.put<{ certificate: any }>(
        `/api/certificates/${certId}`,
        {
          autoRenew: false,
          renewBeforeDays: 14,
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.certificate.autoRenew).toBe(false);
      expect(response.body.certificate.renewBeforeDays).toBe(14);
    });

    it("should validate renewBeforeDays range", async () => {
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      const createRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        certData
      );
      const certId = createRes.body.certificate.id;

      const response = await testClient.put<{ error: string }>(
        `/api/certificates/${certId}`,
        {
          renewBeforeDays: 100,
        }
      );

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent certificate", async () => {
      const response = await testClient.put(
        "/api/certificates/non-existent-id",
        {
          autoRenew: false,
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/certificates/:id", () => {
    it("should delete certificate", async () => {
      const certData = createCertificateRequestFixture(
        testDomainId,
        testDnsProviderId
      );
      const createRes = await testClient.post<{ certificate: any }>(
        "/api/certificates",
        certData
      );
      const certId = createRes.body.certificate.id;

      const response = await testClient.delete<{ success: boolean }>(
        `/api/certificates/${certId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const getRes = await testClient.get(`/api/certificates/${certId}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent certificate", async () => {
      const response = await testClient.delete(
        "/api/certificates/non-existent-id"
      );

      expect(response.status).toBe(404);
    });
  });
});
