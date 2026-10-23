/**
 * Certificate Renewal Processor Unit Tests
 *
 * Tests for the scheduled renewal scan, the per-certificate renewal
 * processor and its retry backoff.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type {
  CertificateRenewalCheckJobData,
  CertificateRenewalJobData,
} from "@uni-proxy-manager/queue";

const { mockQueueAdd, mockSet, mockWhere, mockFindFirst, mockFindMany } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      certificates: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
    },
    update: vi.fn(() => ({ set: mockSet })),
  },
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({})),
}));

vi.mock("@uni-proxy-manager/shared/config", () => ({
  getAcmeConfig: vi.fn(() => ({ email: "admin@example.com", staging: false })),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (this: { name: string }, name: string) {
    return { name, add: mockQueueAdd };
  }),
}));

import { Queue } from "bullmq";
import {
  checkCertificatesForRenewal,
  getRenewalRetryDelayMs,
  processCertificateRenewal,
  processCertificateRenewalCheck,
} from "../../../../../apps/workers/src/processors/certificate-renewal";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-10-23T12:00:00.000Z");

function createRenewalJob(data: CertificateRenewalJobData): Job<CertificateRenewalJobData> {
  return { id: "renewal-job", data, attemptsMade: 0 } as Job<CertificateRenewalJobData>;
}

function createCheckJob(): Job<CertificateRenewalCheckJobData> {
  return {
    id: "renewal-check-job",
    data: { timestamp: NOW.toISOString() },
    attemptsMade: 0,
  } as Job<CertificateRenewalCheckJobData>;
}

function certificateRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "cert-1",
    domainId: "domain-1",
    commonName: "app.example.com",
    altNames: ["www.app.example.com"],
    status: "active",
    autoRenew: true,
    renewBeforeDays: 30,
    renewalAttempts: 0,
    expiresAt: new Date(NOW.getTime() + 6 * DAY_MS),
    nextRenewalCheck: new Date(NOW.getTime() - 24 * DAY_MS),
    dnsProviderId: "dns-1",
    ...overrides,
  };
}

describe("Certificate Renewal Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
    mockQueueAdd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getRenewalRetryDelayMs", () => {
    it("should wait 6 hours after the first attempt", () => {
      expect(getRenewalRetryDelayMs(1)).toBe(6 * HOUR_MS);
    });

    it("should double the delay for each consecutive attempt", () => {
      expect(getRenewalRetryDelayMs(2)).toBe(12 * HOUR_MS);
    });

    it("should cap the delay at 24 hours", () => {
      expect(getRenewalRetryDelayMs(3)).toBe(24 * HOUR_MS);
      expect(getRenewalRetryDelayMs(10)).toBe(24 * HOUR_MS);
    });
  });

  describe("checkCertificatesForRenewal", () => {
    it("should queue a renewal job for each due certificate", async () => {
      mockFindMany.mockResolvedValue([
        certificateRecord(),
        certificateRecord({
          id: "cert-2",
          domainId: "domain-2",
          commonName: "expired.example.com",
          expiresAt: new Date(NOW.getTime() - 3 * DAY_MS),
          dnsProviderId: null,
        }),
      ]);

      const queued = await checkCertificatesForRenewal();

      expect(queued).toBe(2);
      expect(Queue).toHaveBeenCalledWith("certificate-renewal", expect.any(Object));
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
      expect(mockQueueAdd).toHaveBeenNthCalledWith(
        1,
        "renewal-check-cert-1",
        {
          certificateId: "cert-1",
          domainId: "domain-1",
          hostname: "app.example.com",
          dnsProviderId: "dns-1",
        },
        expect.objectContaining({
          attempts: 5,
          jobId: `cert-renewal-cert-1-${NOW.getTime()}`,
        })
      );
      expect(mockQueueAdd).toHaveBeenNthCalledWith(
        2,
        "renewal-check-cert-2",
        expect.objectContaining({ certificateId: "cert-2", dnsProviderId: "" }),
        expect.objectContaining({ jobId: `cert-renewal-cert-2-${NOW.getTime()}` })
      );
    });

    it("should not create a queue when nothing is due", async () => {
      mockFindMany.mockResolvedValue([]);

      await expect(checkCertificatesForRenewal()).resolves.toBe(0);
      expect(Queue).not.toHaveBeenCalled();
    });

    it("should propagate database errors so the scheduled job fails", async () => {
      mockFindMany.mockRejectedValue(new Error("connection refused"));

      await expect(checkCertificatesForRenewal()).rejects.toThrow("connection refused");
    });
  });

  describe("processCertificateRenewalCheck", () => {
    it("should report how many renewals were queued", async () => {
      mockFindMany.mockResolvedValue([certificateRecord()]);

      const result = await processCertificateRenewalCheck(createCheckJob());

      expect(result).toEqual({ success: true, queued: 1 });
    });
  });

  describe("processCertificateRenewal", () => {
    const jobData: CertificateRenewalJobData = {
      certificateId: "cert-1",
      domainId: "domain-1",
      hostname: "app.example.com",
      dnsProviderId: "dns-1",
    };

    it("should move the next check to the renewal window when not yet due", async () => {
      const expiresAt = new Date(NOW.getTime() + 60 * DAY_MS);
      mockFindFirst.mockResolvedValue(certificateRecord({ expiresAt }));

      const result = await processCertificateRenewal(createRenewalJob(jobData));

      expect(result).toEqual({ success: true, certificateId: "cert-1" });
      expect(mockSet).toHaveBeenCalledWith({
        nextRenewalCheck: new Date(expiresAt.getTime() - 30 * DAY_MS),
        updatedAt: NOW,
      });
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it("should keep the certificate active and back off the next check when renewing", async () => {
      mockFindFirst.mockResolvedValue(certificateRecord({ renewalAttempts: 1 }));

      const result = await processCertificateRenewal(createRenewalJob(jobData));

      expect(result.success).toBe(true);
      expect(mockSet).toHaveBeenCalledTimes(1);
      const update = mockSet.mock.calls[0]![0];
      expect(update).toEqual({
        lastRenewalAttempt: NOW,
        renewalAttempts: 2,
        nextRenewalCheck: new Date(NOW.getTime() + 12 * HOUR_MS),
        updatedAt: NOW,
      });
      expect(update).not.toHaveProperty("status");
    });

    it("should queue an issue job flagged as a renewal", async () => {
      mockFindFirst.mockResolvedValue(certificateRecord());

      await processCertificateRenewal(createRenewalJob(jobData));

      expect(Queue).toHaveBeenCalledWith("certificate-issue", expect.any(Object));
      expect(mockQueueAdd).toHaveBeenCalledWith(
        "renew-issue-cert-1",
        {
          certificateId: "cert-1",
          domainId: "domain-1",
          hostname: "app.example.com",
          altNames: ["www.app.example.com"],
          dnsProviderId: "dns-1",
          acmeEmail: "admin@example.com",
          staging: false,
          isRenewal: true,
        },
        expect.objectContaining({ jobId: `cert-renew-issue-cert-1-${NOW.getTime()}` })
      );
    });

    it("should renew certificates that have already expired", async () => {
      mockFindFirst.mockResolvedValue(
        certificateRecord({ expiresAt: new Date(NOW.getTime() - 3 * DAY_MS) })
      );

      await processCertificateRenewal(createRenewalJob(jobData));

      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    });

    it("should renew when forced even if not due", async () => {
      mockFindFirst.mockResolvedValue(
        certificateRecord({ expiresAt: new Date(NOW.getTime() + 80 * DAY_MS) })
      );

      await processCertificateRenewal(createRenewalJob({ ...jobData, forceRenewal: true }));

      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    });

    it("should return an error result when the certificate does not exist", async () => {
      mockFindFirst.mockResolvedValue(undefined);

      const result = await processCertificateRenewal(createRenewalJob(jobData));

      expect(result).toEqual({
        success: false,
        certificateId: "cert-1",
        error: "Certificate not found",
      });
      expect(mockSet).not.toHaveBeenCalled();
    });
  });
});
