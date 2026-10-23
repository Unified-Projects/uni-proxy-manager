/**
 * DNS-01 Helper Unit Tests
 *
 * Covers TXT record creation and removal through the Cloudflare API and the
 * public DNS propagation check, including record names that hold several
 * challenge values at once (an apex and its wildcard).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCloudflareChallengeRecord,
  deleteCloudflareChallengeRecord,
  deleteCloudflareChallengeRecordsByValue,
  getChallengeRecordName,
  parseTxtData,
  txtRecordSetContains,
  waitForDnsPropagation,
} from "../../../../../apps/workers/src/lib/dns-01";
import { createFakeCloudflare, type FakeCloudflare } from "../fake-cloudflare";

const RECORD_NAME = "_acme-challenge.example.com";
const CREDENTIALS = { apiToken: "token" };

describe("DNS-01 helpers", () => {
  let cloudflare: FakeCloudflare;

  beforeEach(() => {
    cloudflare = createFakeCloudflare();
    vi.stubGlobal("fetch", cloudflare.fetch);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("getChallengeRecordName", () => {
    it("should use the same name for an apex and its wildcard", () => {
      expect(getChallengeRecordName("example.com")).toBe(RECORD_NAME);
      expect(getChallengeRecordName("*.example.com")).toBe(RECORD_NAME);
    });
  });

  describe("parseTxtData", () => {
    it("should strip quotes and join split character-strings", () => {
      expect(parseTxtData('"abc"')).toBe("abc");
      expect(parseTxtData('"abc" "def"')).toBe("abcdef");
      expect(parseTxtData("abc")).toBe("abc");
    });
  });

  describe("txtRecordSetContains", () => {
    it("should accept an RRset that contains the expected value among others", async () => {
      cloudflare.seed(RECORD_NAME, "value-apex");
      cloudflare.seed(RECORD_NAME, "value-wildcard");

      await expect(txtRecordSetContains(RECORD_NAME, ["value-wildcard"])).resolves.toBe(true);
    });

    it("should require every expected value to be present", async () => {
      cloudflare.seed(RECORD_NAME, "value-apex");
      cloudflare.seed(RECORD_NAME, "value-wildcard");

      await expect(
        txtRecordSetContains(RECORD_NAME, ["value-apex", "value-wildcard"])
      ).resolves.toBe(true);

      cloudflare.unpropagated.add("value-wildcard");

      await expect(
        txtRecordSetContains(RECORD_NAME, ["value-apex", "value-wildcard"])
      ).resolves.toBe(false);
    });

    it("should return false when the name has no TXT records", async () => {
      await expect(txtRecordSetContains(RECORD_NAME, ["value-apex"])).resolves.toBe(false);
    });

    it("should return false when the resolver request fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      cloudflare.fetch.mockRejectedValueOnce(new Error("network down"));

      await expect(txtRecordSetContains(RECORD_NAME, ["value-apex"])).resolves.toBe(false);
    });
  });

  describe("waitForDnsPropagation", () => {
    it("should wait until every value at a shared name is visible", async () => {
      vi.useFakeTimers();
      cloudflare.seed(RECORD_NAME, "value-apex");
      cloudflare.seed(RECORD_NAME, "value-wildcard");
      cloudflare.unpropagated.add("value-wildcard");

      let settled = false;
      const waiting = waitForDnsPropagation(
        [
          { recordName: RECORD_NAME, value: "value-apex" },
          { recordName: RECORD_NAME, value: "value-wildcard" },
        ],
        { maxChecks: 10, intervalMs: 5000 }
      ).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(settled).toBe(false);

      cloudflare.unpropagated.delete("value-wildcard");
      await vi.advanceTimersByTimeAsync(5000);
      await waiting;

      expect(settled).toBe(true);
      const dohRequests = cloudflare.fetch.mock.calls.filter(([input]) =>
        String(input).startsWith("https://cloudflare-dns.com/")
      );
      expect(dohRequests).toHaveLength(4);
    });

    it("should time out after the configured number of checks", async () => {
      vi.useFakeTimers();
      cloudflare.seed(RECORD_NAME, "value-apex");

      const waiting = waitForDnsPropagation(
        [
          { recordName: RECORD_NAME, value: "value-apex" },
          { recordName: RECORD_NAME, value: "value-wildcard" },
        ],
        { maxChecks: 3, intervalMs: 5000 }
      );
      const assertion = expect(waiting).rejects.toThrow(
        `DNS propagation timeout for ${RECORD_NAME}`
      );

      await vi.advanceTimersByTimeAsync(10000);
      await assertion;

      const dohRequests = cloudflare.fetch.mock.calls.filter(([input]) =>
        String(input).startsWith("https://cloudflare-dns.com/")
      );
      expect(dohRequests).toHaveLength(3);
    });

    it("should return immediately when there are no records", async () => {
      await waitForDnsPropagation([], { maxChecks: 3, intervalMs: 5000 });

      expect(cloudflare.fetch).not.toHaveBeenCalled();
    });
  });

  describe("Cloudflare records", () => {
    it("should add a record without removing other values at the same name", async () => {
      const existing = cloudflare.seed(RECORD_NAME, "value-apex");

      const record = await createCloudflareChallengeRecord(CREDENTIALS, "*.example.com", "value-wildcard");

      expect(record).toEqual({
        recordName: RECORD_NAME,
        value: "value-wildcard",
        zoneId: "zone-1",
        recordId: expect.any(String),
      });
      expect(cloudflare.deletedIds).toEqual([]);
      expect(cloudflare.publishedValues(RECORD_NAME)).toEqual(["value-apex", "value-wildcard"]);
      expect(cloudflare.records.has(existing.id)).toBe(true);
    });

    it("should send the API token as a bearer token", async () => {
      await createCloudflareChallengeRecord(CREDENTIALS, "example.com", "value-apex");

      const [, init] = cloudflare.fetch.mock.calls.find(([, options]) => options?.method === "POST")!;
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
    });

    it("should reject credentials without a token or key", async () => {
      await expect(createCloudflareChallengeRecord({}, "example.com", "value-apex")).rejects.toThrow(
        "Invalid Cloudflare credentials"
      );
    });

    it("should fail when no zone matches the hostname", async () => {
      await expect(
        createCloudflareChallengeRecord(CREDENTIALS, "example.org", "value-apex")
      ).rejects.toThrow("Zone not found for example.org");
    });

    it("should delete only the record with the given id", async () => {
      const apex = await createCloudflareChallengeRecord(CREDENTIALS, "example.com", "value-apex");
      await createCloudflareChallengeRecord(CREDENTIALS, "*.example.com", "value-wildcard");

      await deleteCloudflareChallengeRecord(CREDENTIALS, apex);

      expect(cloudflare.deletedIds).toEqual([apex.recordId]);
      expect(cloudflare.publishedValues(RECORD_NAME)).toEqual(["value-wildcard"]);
    });

    it("should treat an already deleted record as removed", async () => {
      const apex = await createCloudflareChallengeRecord(CREDENTIALS, "example.com", "value-apex");
      await deleteCloudflareChallengeRecord(CREDENTIALS, apex);

      await expect(deleteCloudflareChallengeRecord(CREDENTIALS, apex)).resolves.toBeUndefined();
    });

    it("should delete by value without touching other values", async () => {
      cloudflare.seed(RECORD_NAME, "value-apex");
      cloudflare.seed(RECORD_NAME, "value-wildcard");

      const deleted = await deleteCloudflareChallengeRecordsByValue(
        CREDENTIALS,
        "example.com",
        "value-apex"
      );

      expect(deleted).toBe(1);
      expect(cloudflare.publishedValues(RECORD_NAME)).toEqual(["value-wildcard"]);
    });
  });
});
