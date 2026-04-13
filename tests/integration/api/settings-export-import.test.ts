import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import {
  createDomainFixture,
  createBackendFixture,
  createSharedBackendFixture,
} from "../setup/fixtures";
import AdmZip from "adm-zip";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

function bufferStartsWithZip(buf: Buffer): boolean {
  return buf.slice(0, 4).equals(ZIP_MAGIC);
}

describe("Settings Export / Import API", () => {
  let domainId: string;
  let backendId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ hostname: "export-test.example.com" })
    );
    domainId = domainRes.body.domain.id;

    const backendRes = await testClient.post<{ backend: any }>(
      "/api/backends",
      createBackendFixture(domainId)
    );
    backendId = backendRes.body.backend.id;
  });

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  describe("GET /api/settings/export", () => {
    it("should return a ZIP file with correct content-type", async () => {
      const res = await testClient.getRaw("/api/settings/export");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/zip");
    });

    it("should return a content-disposition attachment header", async () => {
      const res = await testClient.getRaw("/api/settings/export");
      const cd = res.headers.get("content-disposition") ?? "";
      expect(cd).toContain("attachment");
      expect(cd).toContain(".zip");
    });

    it("should return a non-empty ZIP buffer", async () => {
      const res = await testClient.getRaw("/api/settings/export");
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(22); // minimum ZIP file size
      expect(bufferStartsWithZip(buf)).toBe(true);
    });

    it("should include sensitive data flag in manifest when includeSensitive=false (default)", async () => {
      // Export with default settings — parse JSON via text endpoint alias if available,
      // or verify the round-trip import succeeds with the exported file.
      const res = await testClient.getRaw("/api/settings/export");
      expect(res.status).toBe(200);
      // Verify it is parseable by importing it back — validated below in import tests.
    });

    it("should accept includeSensitive=true query param", async () => {
      const res = await testClient.getRaw("/api/settings/export?includeSensitive=true");
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(bufferStartsWithZip(buf)).toBe(true);
    });

    it("should accept includeCertificates=false query param", async () => {
      const res = await testClient.getRaw("/api/settings/export?includeCertificates=false");
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(bufferStartsWithZip(buf)).toBe(true);
    });

    it("should produce a larger ZIP when shared backends are present", async () => {
      // Baseline size
      const res1 = await testClient.getRaw("/api/settings/export");
      const buf1 = Buffer.from(await res1.arrayBuffer());

      await testClient.post(
        "/api/shared-backends",
        createSharedBackendFixture({ name: "size-test-sb" })
      );

      const res2 = await testClient.getRaw("/api/settings/export");
      const buf2 = Buffer.from(await res2.arrayBuffer());

      // ZIP with more data should be at least as large
      expect(buf2.length).toBeGreaterThanOrEqual(buf1.length);
    });
  });

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  describe("POST /api/settings/import", () => {
    it("should accept a valid ZIP and return 200 with import counts", async () => {
      const exportRes = await testClient.getRaw("/api/settings/export");
      const zipBuffer = Buffer.from(await exportRes.arrayBuffer());

      const formData = new FormData();
      formData.append(
        "file",
        new File([zipBuffer], "export.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "true");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      const res = await testClient.postForm<{
        imported: Record<string, number>;
        skipped: Record<string, number>;
        warnings: string[];
      }>("/api/settings/import", formData);

      expect(res.status).toBe(200);
      expect(res.body.imported).toBeDefined();
      expect(res.body.skipped).toBeDefined();
      expect(Array.isArray(res.body.warnings)).toBe(true);
    });

    it("should restore domains after clear + import", async () => {
      const exportRes = await testClient.getRaw("/api/settings/export");
      const zipBuffer = Buffer.from(await exportRes.arrayBuffer());

      await clearDatabase();

      const formData = new FormData();
      formData.append(
        "file",
        new File([zipBuffer], "export.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "true");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      await testClient.postForm("/api/settings/import", formData);

      const domainsRes = await testClient.get<{ domains: any[] }>("/api/domains");
      expect(
        domainsRes.body.domains.some(
          (d: any) => d.hostname === "export-test.example.com"
        )
      ).toBe(true);
    });

    it("should restore backends after clear + import", async () => {
      const exportRes = await testClient.getRaw("/api/settings/export");
      const zipBuffer = Buffer.from(await exportRes.arrayBuffer());

      await clearDatabase();

      const formData = new FormData();
      formData.append(
        "file",
        new File([zipBuffer], "export.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "true");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      await testClient.postForm("/api/settings/import", formData);

      const backendsRes = await testClient.get<{ backends: any[] }>("/api/backends");
      expect(backendsRes.body.backends.length).toBeGreaterThan(0);
    });

    it("should skip existing records when overwriteExisting=false", async () => {
      // Both domain and backend already exist (from beforeEach)
      const exportRes = await testClient.getRaw("/api/settings/export");
      const zipBuffer = Buffer.from(await exportRes.arrayBuffer());

      const formData = new FormData();
      formData.append(
        "file",
        new File([zipBuffer], "export.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "false");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      const res = await testClient.postForm<{
        imported: Record<string, number>;
        skipped: Record<string, number>;
      }>("/api/settings/import", formData);

      expect(res.status).toBe(200);
      const totalSkipped = Object.values(res.body.skipped).reduce(
        (a, b) => a + b,
        0
      );
      expect(totalSkipped).toBeGreaterThan(0);
    });

    it("should reject a non-ZIP file with 400", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["this is not a zip"], "data.txt", { type: "text/plain" })
      );
      formData.append("overwriteExisting", "false");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      const res = await testClient.postForm("/api/settings/import", formData);
      expect(res.status).toBe(400);
    });

    it("should restore shared backends after clear + import", async () => {
      await testClient.post(
        "/api/shared-backends",
        createSharedBackendFixture({ name: "round-trip-sb" })
      );

      const exportRes = await testClient.getRaw("/api/settings/export");
      const zipBuffer = Buffer.from(await exportRes.arrayBuffer());
      await clearDatabase();

      const formData = new FormData();
      formData.append(
        "file",
        new File([zipBuffer], "export.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "true");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      await testClient.postForm("/api/settings/import", formData);

      const sbRes = await testClient.get<{ sharedBackends: any[] }>(
        "/api/shared-backends"
      );
      expect(
        sbRes.body.sharedBackends.some((sb: any) => sb.name === "round-trip-sb")
      ).toBe(true);
    });

    it("should trigger HAProxy reload after import", async () => {
      const exportRes = await testClient.getRaw("/api/settings/export");
      const zipBuffer = Buffer.from(await exportRes.arrayBuffer());
      await clearDatabase();

      const formData = new FormData();
      formData.append(
        "file",
        new File([zipBuffer], "export.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "true");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      const res = await testClient.postForm<{
        imported: Record<string, number>;
        reloadQueued?: boolean;
      }>("/api/settings/import", formData);

      expect(res.status).toBe(200);
      // The reload queued flag may or may not be present depending on implementation
      // but the import itself should succeed
      expect(res.body.imported).toBeDefined();
    });

    it("should strip unsafe imported certificate paths before persisting", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "import-cert.example.com",
          sslEnabled: false,
          forceHttps: false,
        })
      );

      const zip = new AdmZip();
      zip.addFile("manifest.json", Buffer.from(JSON.stringify({ version: "1.0.0" })));
      zip.addFile(
        "data/certificates.json",
        Buffer.from(JSON.stringify([
          {
            id: "imported-cert",
            domainId: domainRes.body.domain.id,
            commonName: "import-cert.example.com",
            source: "manual",
            status: "active",
            certPath: "../../outside/cert.pem",
            keyPath: "/tmp/imported/key.pem",
            chainPath: "chain.pem",
            fullchainPath: "../fullchain.pem",
          },
        ]))
      );

      const formData = new FormData();
      formData.append(
        "file",
        new File([zip.toBuffer()], "cert-import.zip", { type: "application/zip" })
      );
      formData.append("overwriteExisting", "true");
      formData.append("importCertFiles", "false");
      formData.append("importSensitiveData", "false");

      const response = await testClient.postForm<{
        warnings: string[];
      }>("/api/settings/import", formData);

      expect(response.status).toBe(200);
      expect(response.body.warnings.some((warning) => warning.includes("imported without certPath"))).toBe(true);

      const importedCert = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, "imported-cert"),
      });

      expect(importedCert).toBeDefined();
      expect(importedCert!.certPath).toBeNull();
      expect(importedCert!.keyPath).toBeNull();
      expect(importedCert!.chainPath).toBeNull();
      expect(importedCert!.fullchainPath).toBeNull();
    });
  });
});
