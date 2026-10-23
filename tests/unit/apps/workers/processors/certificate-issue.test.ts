/**
 * Certificate Issue Processor Unit Tests
 *
 * Covers how the issue processor records state for first issuance versus
 * renewal, the DNS-01 records it publishes and removes for an order, and the
 * HAProxy reload it queues after a successful issue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { CertificateIssueJobData } from "@uni-proxy-manager/queue";
import { createFakeCloudflare, type FakeCloudflare } from "../fake-cloudflare";

const {
  mockQueueAdd,
  mockSet,
  mockWhere,
  mockFindProvider,
  mockAcmeClient,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockFindProvider: vi.fn(),
  mockAcmeClient: {
    createAccount: vi.fn(),
    createOrder: vi.fn(),
    getAuthorizations: vi.fn(),
    getChallengeKeyAuthorization: vi.fn(),
    completeChallenge: vi.fn(),
    waitForValidStatus: vi.fn(),
    finalizeOrder: vi.fn(),
    getCertificate: vi.fn(),
  },
}));

vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      dnsProviders: {
        findFirst: mockFindProvider,
      },
    },
    update: vi.fn(() => ({ set: mockSet })),
  },
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({})),
}));

vi.mock("@uni-proxy-manager/shared/config", () => ({
  getAcmeConfig: vi.fn(() => ({
    email: "admin@example.com",
    staging: false,
    directoryUrl: "https://acme.example/directory",
    dnsPropagation: { maxChecks: 3, intervalMs: 5000 },
  })),
  getCertsDir: vi.fn(() => "/data/certs"),
}));

vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("account-key")),
}));

// acme-client is a dependency of the workers app only, so it is mocked by
// path to match the module the processor resolves.
vi.mock("../../../../../apps/workers/node_modules/acme-client", () => ({
  directory: {
    letsencrypt: {
      staging: "https://acme-staging.example/directory",
      production: "https://acme.example/directory",
    },
  },
  Client: vi.fn(function () {
    return mockAcmeClient;
  }),
  crypto: {
    createCsr: vi.fn().mockResolvedValue([Buffer.from("cert-key"), Buffer.from("csr")]),
    createPrivateKey: vi.fn().mockResolvedValue(Buffer.from("account-key")),
  },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (this: { name: string }, name: string) {
    return { name, add: mockQueueAdd };
  }),
}));

import { processCertificateIssue } from "../../../../../apps/workers/src/processors/certificate-issue";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const ISSUED_CERT = "-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n";

function createJob(overrides: Partial<CertificateIssueJobData> = {}): Job<CertificateIssueJobData> {
  return {
    id: "issue-job",
    attemptsMade: 0,
    data: {
      certificateId: "cert-1",
      domainId: "domain-1",
      hostname: "app.example.com",
      altNames: [],
      dnsProviderId: "dns-1",
      acmeEmail: "admin@example.com",
      staging: false,
      ...overrides,
    },
  } as Job<CertificateIssueJobData>;
}

describe("Certificate Issue Processor", () => {
  const originalDirectoryUrl = process.env.ACME_DIRECTORY_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Pebble mode skips the external DNS provider and propagation calls
    process.env.ACME_DIRECTORY_URL = "https://pebble:14000/dir";

    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
    mockQueueAdd.mockResolvedValue(undefined);
    mockFindProvider.mockResolvedValue({ id: "dns-1", type: "cloudflare", credentials: {} });

    mockAcmeClient.createAccount.mockResolvedValue({ status: "valid" });
    mockAcmeClient.createOrder.mockResolvedValue({ status: "pending" });
    mockAcmeClient.getAuthorizations.mockResolvedValue([
      {
        identifier: { value: "app.example.com" },
        challenges: [{ type: "dns-01", status: "pending" }],
      },
    ]);
    mockAcmeClient.getChallengeKeyAuthorization.mockResolvedValue("key-auth");
    mockAcmeClient.completeChallenge.mockResolvedValue(undefined);
    mockAcmeClient.waitForValidStatus.mockImplementation(async (resource: unknown) => resource);
    mockAcmeClient.finalizeOrder.mockResolvedValue({ status: "valid" });
    mockAcmeClient.getCertificate.mockResolvedValue(ISSUED_CERT);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalDirectoryUrl === undefined) {
      delete process.env.ACME_DIRECTORY_URL;
    } else {
      process.env.ACME_DIRECTORY_URL = originalDirectoryUrl;
    }
  });

  describe("first issuance", () => {
    it("should mark the certificate as issuing before contacting the CA", async () => {
      await processCertificateIssue(createJob());

      expect(mockSet.mock.calls[0]![0]).toEqual({ status: "issuing", updatedAt: NOW });
    });

    it("should mark the certificate as failed when issuance fails", async () => {
      mockFindProvider.mockResolvedValue(undefined);

      const result = await processCertificateIssue(createJob());

      expect(result).toEqual({
        success: false,
        certificateId: "cert-1",
        error: "DNS provider not found",
      });
      expect(mockSet).toHaveBeenLastCalledWith({
        status: "failed",
        lastError: "DNS provider not found",
        renewalAttempts: 1,
        updatedAt: NOW,
      });
    });
  });

  describe("renewal", () => {
    it("should not change the status of the current certificate while renewing", async () => {
      await processCertificateIssue(createJob({ isRenewal: true }));

      const statuses = mockSet.mock.calls.map(([values]) => values.status).filter(Boolean);
      expect(statuses).toEqual(["active"]);
    });

    it("should leave the current certificate active when renewal fails", async () => {
      mockFindProvider.mockResolvedValue(undefined);

      const result = await processCertificateIssue(createJob({ isRenewal: true }));

      expect(result.success).toBe(false);
      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith({
        lastError: "DNS provider not found",
        updatedAt: NOW,
      });
    });

    it("should reset the attempt counter and schedule the next check after success", async () => {
      const result = await processCertificateIssue(createJob({ isRenewal: true }));

      expect(result.success).toBe(true);
      const certificateUpdate = mockSet.mock.calls
        .map(([values]) => values)
        .find((values) => values.status === "active");
      const expiresAt = new Date(NOW);
      expiresAt.setDate(expiresAt.getDate() + 90);
      expect(certificateUpdate).toMatchObject({
        expiresAt,
        nextRenewalCheck: new Date(expiresAt.getTime() - 30 * 24 * 60 * 60 * 1000),
        renewalAttempts: 0,
        lastError: null,
      });
    });
  });

  describe("DNS-01 challenges", () => {
    const RECORD_NAME = "_acme-challenge.example.com";
    let cloudflare: FakeCloudflare;

    function createApexAndWildcardJob(): Job<CertificateIssueJobData> {
      return createJob({ hostname: "example.com", altNames: ["*.example.com"] });
    }

    beforeEach(() => {
      delete process.env.ACME_DIRECTORY_URL;
      cloudflare = createFakeCloudflare();
      vi.stubGlobal("fetch", cloudflare.fetch);

      mockFindProvider.mockResolvedValue({
        id: "dns-1",
        type: "cloudflare",
        credentials: { apiToken: "token" },
      });
      mockAcmeClient.getAuthorizations.mockResolvedValue([
        {
          identifier: { value: "example.com" },
          challenges: [{ type: "dns-01", status: "pending", url: "challenge-apex" }],
        },
        {
          identifier: { value: "example.com" },
          wildcard: true,
          challenges: [{ type: "dns-01", status: "pending", url: "challenge-wildcard" }],
        },
      ]);
      mockAcmeClient.getChallengeKeyAuthorization.mockImplementation(
        async (challenge: { url: string }) =>
          challenge.url === "challenge-apex" ? "value-apex" : "value-wildcard"
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should publish every TXT value before completing any challenge", async () => {
      const visibleAtCompletion: string[][] = [];
      mockAcmeClient.completeChallenge.mockImplementation(async () => {
        visibleAtCompletion.push(cloudflare.publishedValues(RECORD_NAME));
      });

      const result = await processCertificateIssue(createApexAndWildcardJob());

      expect(result.success).toBe(true);
      expect(mockAcmeClient.completeChallenge).toHaveBeenCalledTimes(2);
      expect(visibleAtCompletion).toEqual([
        ["value-apex", "value-wildcard"],
        ["value-apex", "value-wildcard"],
      ]);
    });

    it("should keep the records until the order is finalised", async () => {
      let valuesAtFinalise: string[] = [];
      mockAcmeClient.finalizeOrder.mockImplementation(async () => {
        valuesAtFinalise = cloudflare.publishedValues(RECORD_NAME);
        return { status: "valid" };
      });

      await processCertificateIssue(createApexAndWildcardJob());

      expect(valuesAtFinalise).toEqual(["value-apex", "value-wildcard"]);
    });

    it("should wait for both values to propagate before completing challenges", async () => {
      cloudflare.unpropagated.add("value-wildcard");
      mockAcmeClient.completeChallenge.mockImplementation(async () => {
        expect(cloudflare.unpropagated.size).toBe(0);
      });

      const issuing = processCertificateIssue(createApexAndWildcardJob());
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockAcmeClient.completeChallenge).not.toHaveBeenCalled();

      cloudflare.unpropagated.clear();
      await vi.advanceTimersByTimeAsync(5000);
      const result = await issuing;

      expect(result.success).toBe(true);
      expect(mockAcmeClient.completeChallenge).toHaveBeenCalledTimes(2);
    });

    it("should delete both records by id after a successful issue", async () => {
      const unrelated = cloudflare.seed(RECORD_NAME, "value-other-order");

      const result = await processCertificateIssue(createApexAndWildcardJob());

      expect(result.success).toBe(true);
      expect(cloudflare.deletedIds).toHaveLength(2);
      expect(cloudflare.deletedIds).not.toContain(unrelated.id);
      expect(cloudflare.publishedValues(RECORD_NAME)).toEqual(["value-other-order"]);
    });

    it("should delete both records when validation fails", async () => {
      mockAcmeClient.waitForValidStatus.mockImplementation(async (resource: { url?: string }) => {
        if (resource.url === "challenge-wildcard") {
          throw new Error("Incorrect TXT record");
        }
        return resource;
      });

      const result = await processCertificateIssue(createApexAndWildcardJob());

      expect(result).toMatchObject({ success: false, error: "Incorrect TXT record" });
      expect(mockAcmeClient.finalizeOrder).not.toHaveBeenCalled();
      expect(cloudflare.deletedIds).toHaveLength(2);
      expect(cloudflare.records.size).toBe(0);
    });

    it("should delete both records when finalising the order fails", async () => {
      mockAcmeClient.finalizeOrder.mockRejectedValue(new Error("Order not ready"));

      const result = await processCertificateIssue(createApexAndWildcardJob());

      expect(result).toMatchObject({ success: false, error: "Order not ready" });
      expect(cloudflare.records.size).toBe(0);
    });

    it("should delete both records when propagation times out", async () => {
      cloudflare.unpropagated.add("value-wildcard");

      const issuing = processCertificateIssue(createApexAndWildcardJob());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await issuing;

      expect(result).toMatchObject({
        success: false,
        error: `DNS propagation timeout for ${RECORD_NAME}`,
      });
      expect(mockAcmeClient.completeChallenge).not.toHaveBeenCalled();
      expect(cloudflare.records.size).toBe(0);
    });

    it("should delete the records already created when a later create fails", async () => {
      const createRecord = cloudflare.fetch.getMockImplementation()!;
      let posts = 0;
      cloudflare.fetch.mockImplementation(async (input, init) => {
        if (init?.method === "POST" && ++posts === 2) {
          return new Response("rate limited", { status: 429 });
        }
        return createRecord(input, init);
      });

      const result = await processCertificateIssue(createApexAndWildcardJob());

      expect(result).toMatchObject({ success: false, error: "Failed to create DNS record: rate limited" });
      expect(cloudflare.deletedIds).toHaveLength(1);
      expect(cloudflare.records.size).toBe(0);
    });
  });

  describe("HAProxy reload", () => {
    it("should queue a reload with a unique job id after every successful issue", async () => {
      await processCertificateIssue(createJob({ isRenewal: true }));
      vi.setSystemTime(new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000));
      await processCertificateIssue(createJob({ isRenewal: true }));

      const reloadCalls = mockQueueAdd.mock.calls.filter(([name]) => name === "reload-cert-cert-1");
      expect(reloadCalls).toHaveLength(2);

      const jobIds = reloadCalls.map(([, , opts]) => opts.jobId);
      expect(jobIds[0]).not.toBe(jobIds[1]);
      expect(reloadCalls[0]![1]).toEqual({
        reason: "Certificate issued for app.example.com",
        triggeredBy: "certificate",
        affectedDomainIds: ["domain-1"],
      });
      expect(reloadCalls[0]![2]).toMatchObject({ attempts: 3, removeOnComplete: expect.any(Object) });
    });

    it("should not queue a reload when issuance fails", async () => {
      mockFindProvider.mockResolvedValue(undefined);

      await processCertificateIssue(createJob({ isRenewal: true }));

      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });
});
