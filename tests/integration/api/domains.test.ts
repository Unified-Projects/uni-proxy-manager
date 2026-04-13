import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { access, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("Domains API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("POST /api/domains", () => {
    it("should create a new domain", async () => {
      const domainData = createDomainFixture();
      const response = await testClient.post<{ domain: any }>(
        "/api/domains",
        domainData
      );

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("domain");
      expect(response.body.domain.hostname).toBe(domainData.hostname);
      expect(response.body.domain.status).toBe("pending");

      // Verify in database
      const dbDomain = await testDb.query.domains.findFirst({
        where: eq(schema.domains.hostname, domainData.hostname),
      });
      expect(dbDomain).toBeDefined();
      expect(dbDomain!.sslEnabled).toBe(domainData.sslEnabled);
    });

    it("should reject duplicate hostname", async () => {
      const domainData = createDomainFixture();
      await testClient.post("/api/domains", domainData);
      const response = await testClient.post<{ error: string }>(
        "/api/domains",
        domainData
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("already exists");
    });

    it("should validate hostname format", async () => {
      const response = await testClient.post<{ error: string }>("/api/domains", {
        hostname: "invalid hostname!@#",
        sslEnabled: true,
      });

      expect(response.status).toBe(400);
    });

    it("should create domain with default settings (SSL disabled)", async () => {
      const response = await testClient.post<{ domain: any }>("/api/domains", {
        hostname: `default-${Date.now()}.example.com`,
      });

      expect(response.status).toBe(201);
      expect(response.body.domain.sslEnabled).toBe(false);
      expect(response.body.domain.forceHttps).toBe(false);
      expect(response.body.domain.acmeVerificationMethod).toBe("none");
    });

    it("should link auto-created certificates back to the domain", async () => {
      const dnsProviderId = "auto-cert-dns-provider";
      await testDb.insert(schema.dnsProviders).values({
        id: dnsProviderId,
        name: "Auto Cert DNS",
        type: "cloudflare",
        credentials: { apiToken: "token" },
      });

      const hostname = `auto-cert-${Date.now()}.example.com`;
      const response = await testClient.post<{ domain: any }>("/api/domains", {
        hostname,
        sslEnabled: true,
        forceHttps: true,
        acmeVerificationMethod: "dns-01",
        acmeDnsProviderId: dnsProviderId,
      });

      expect(response.status).toBe(201);

      const createdDomain = await testDb.query.domains.findFirst({
        where: eq(schema.domains.id, response.body.domain.id),
      });
      expect(createdDomain?.certificateId).toBeTruthy();

      const linkedCertificate = await testDb.query.certificates.findFirst({
        where: eq(schema.certificates.id, createdDomain!.certificateId!),
      });
      expect(linkedCertificate?.domainId).toBe(response.body.domain.id);
      expect(linkedCertificate?.commonName).toBe(hostname);
    });
  });

  describe("GET /api/domains", () => {
    it("should list all domains with their backends", async () => {
      // Create test data
      const domain1 = createDomainFixture();
      const domain2 = createDomainFixture();
      await testClient.post("/api/domains", domain1);
      const res2 = await testClient.post<{ domain: any }>(
        "/api/domains",
        domain2
      );

      // Add backend to domain2
      await testClient.post(
        "/api/backends",
        createBackendFixture(res2.body.domain.id)
      );

      const response = await testClient.get<{ domains: any[] }>("/api/domains");

      expect(response.status).toBe(200);
      expect(response.body.domains).toHaveLength(2);

      const d2 = response.body.domains.find(
        (d: any) => d.hostname === domain2.hostname
      );
      expect(d2.backends).toHaveLength(1);
    });

    it("should return empty array when no domains exist", async () => {
      const response = await testClient.get<{ domains: any[] }>("/api/domains");

      expect(response.status).toBe(200);
      expect(response.body.domains).toHaveLength(0);
    });

    it("should not mark the Pomerium authenticate hostname as no-backends", async () => {
      await testDb.insert(schema.pomeriumSettings).values({
        id: "default",
        authenticateServiceUrl: "https://auth.example.com",
      });

      await testClient.post("/api/domains", createDomainFixture({
        hostname: "auth.example.com",
        sslEnabled: false,
        forceHttps: false,
      }));

      const response = await testClient.get<{ domains: any[] }>("/api/domains");

      expect(response.status).toBe(200);

      const authDomain = response.body.domains.find(
        (domain) => domain.hostname === "auth.example.com"
      );

      expect(authDomain).toBeDefined();
      expect(authDomain.statusComputed).not.toBe("no-backends");
    });
  });

  describe("GET /api/domains/:id", () => {
    it("should return domain with backends", async () => {
      const domainData = createDomainFixture();
      const createRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        domainData
      );
      const domainId = createRes.body.domain.id;

      const backendData = createBackendFixture(domainId);
      await testClient.post("/api/backends", backendData);

      const response = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.domain.id).toBe(domainId);
      expect(response.body.domain.backends).toHaveLength(1);
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.get("/api/domains/non-existent-id");

      expect(response.status).toBe(404);
    });

    it("should treat the configured Pomerium authenticate hostname as alternative routing", async () => {
      await testDb.insert(schema.pomeriumSettings).values({
        id: "default",
        authenticateServiceUrl: "https://auth.example.com",
      });

      const createRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "auth.example.com",
          sslEnabled: false,
          forceHttps: false,
        })
      );

      const response = await testClient.get<{ domain: any }>(
        `/api/domains/${createRes.body.domain.id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.domain.statusComputed).not.toBe("no-backends");
    });
  });

  describe("PUT /api/domains/:id", () => {
    it("should update domain settings", async () => {
      const domainData = createDomainFixture();
      const createRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        domainData
      );
      const domainId = createRes.body.domain.id;

      const response = await testClient.put<{ domain: any }>(
        `/api/domains/${domainId}`,
        {
          displayName: "Updated Name",
          forceHttps: false,
          maintenanceEnabled: true,
          maintenanceBypassIps: ["192.168.1.100"],
        }
      );

      expect(response.status).toBe(200);
      expect(response.body.domain.displayName).toBe("Updated Name");
      expect(response.body.domain.forceHttps).toBe(false);
      expect(response.body.domain.maintenanceEnabled).toBe(true);
      expect(response.body.domain.maintenanceBypassIps).toContain(
        "192.168.1.100"
      );
      expect(response.body.domain.configVersion).toBe(1);
    });

    it("should increment configVersion on each update", async () => {
      const domainData = createDomainFixture();
      const createRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        domainData
      );
      const domainId = createRes.body.domain.id;

      await testClient.put(`/api/domains/${domainId}`, { displayName: "V1" });
      await testClient.put(`/api/domains/${domainId}`, { displayName: "V2" });
      const response = await testClient.put<{ domain: any }>(
        `/api/domains/${domainId}`,
        {
          displayName: "V3",
        }
      );

      expect(response.body.domain.configVersion).toBe(3);
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.put("/api/domains/non-existent-id", {
        displayName: "Test",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/domains/:id", () => {
    it("should delete domain and cascade to backends", async () => {
      const domainData = createDomainFixture();
      const createRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        domainData
      );
      const domainId = createRes.body.domain.id;

      // Add backends
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, { name: "backend-1" })
      );
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, { name: "backend-2" })
      );

      // Verify backends exist
      const backendsRes = await testClient.get<{ backends: any[] }>(
        `/api/domains/${domainId}/backends`
      );
      expect(backendsRes.body.backends).toHaveLength(2);

      // Delete domain
      const response = await testClient.delete<{ success: boolean }>(
        `/api/domains/${domainId}`
      );
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify domain is deleted
      const getRes = await testClient.get(`/api/domains/${domainId}`);
      expect(getRes.status).toBe(404);

      // Verify backends are cascade deleted
      const dbBackends = await testDb.query.backends.findMany({
        where: eq(schema.backends.domainId, domainId),
      });
      expect(dbBackends).toHaveLength(0);
    });

    it("should return 404 for non-existent domain", async () => {
      const response = await testClient.delete("/api/domains/non-existent-id");

      expect(response.status).toBe(404);
    });

    it("should not delete unmanaged absolute certificate directories when deleting a domain", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "delete-domain-cert.example.com",
          sslEnabled: false,
          forceHttps: false,
        })
      );
      const domainId = domainRes.body.domain.id;
      const outsideDir = await mkdtemp(join(tmpdir(), "upm-domain-cert-"));

      try {
        const outsideCertPath = join(outsideDir, "cert.pem");
        await writeFile(outsideCertPath, "outside-cert");

        await testDb.insert(schema.certificates).values({
          id: "domain-outside-cert",
          domainId,
          commonName: "delete-domain-cert.example.com",
          source: "manual",
          status: "active",
          certPath: outsideCertPath,
        });
        await testDb
          .update(schema.domains)
          .set({ certificateId: "domain-outside-cert" })
          .where(eq(schema.domains.id, domainId));

        const response = await testClient.delete<{ success: boolean }>(
          `/api/domains/${domainId}`
        );

        expect(response.status).toBe(200);
        await expect(access(outsideDir)).resolves.toBeUndefined();
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
