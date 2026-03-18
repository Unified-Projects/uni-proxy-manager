import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import {
  createDomainFixture,
  createSharedBackendFixture,
} from "../setup/fixtures";

describe("Shared Backends API", () => {
  let domainId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    const res = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture()
    );
    domainId = res.body.domain.id;
  });

  // ---------------------------------------------------------------------------
  // POST /api/shared-backends
  // ---------------------------------------------------------------------------
  describe("POST /api/shared-backends", () => {
    it("should create a shared backend", async () => {
      const data = createSharedBackendFixture();
      const res = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        data
      );

      expect(res.status).toBe(201);
      expect(res.body.sharedBackend.name).toBe(data.name);
      expect(res.body.sharedBackend.address).toBe(data.address);
      expect(res.body.sharedBackend.port).toBe(data.port);
      expect(res.body.sharedBackend.protocol).toBe(data.protocol);
      expect(res.body.sharedBackend.enabled).toBe(true);
      expect(res.body.sharedBackend.isBackup).toBe(false);
    });

    it("should reject duplicate name", async () => {
      const data = createSharedBackendFixture({ name: "duplicate-sb" });
      await testClient.post("/api/shared-backends", data);

      const res2 = await testClient.post("/api/shared-backends", {
        ...data,
        address: "10.0.0.2",
      });
      expect(res2.status).toBe(409);
    });

    it("should reject invalid port", async () => {
      const res = await testClient.post("/api/shared-backends", {
        ...createSharedBackendFixture(),
        port: 99999,
      });
      expect(res.status).toBe(400);
    });

    it("should reject invalid weight", async () => {
      const res = await testClient.post("/api/shared-backends", {
        ...createSharedBackendFixture(),
        weight: 300,
      });
      expect(res.status).toBe(400);
    });

    it("should reject missing address", async () => {
      const { address: _a, ...withoutAddress } = createSharedBackendFixture();
      const res = await testClient.post("/api/shared-backends", withoutAddress);
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/shared-backends
  // ---------------------------------------------------------------------------
  describe("GET /api/shared-backends", () => {
    it("should return empty list when no shared backends", async () => {
      const res = await testClient.get<{ sharedBackends: any[] }>(
        "/api/shared-backends"
      );
      expect(res.status).toBe(200);
      expect(res.body.sharedBackends).toHaveLength(0);
    });

    it("should list all shared backends with domain count", async () => {
      await testClient.post(
        "/api/shared-backends",
        createSharedBackendFixture({ name: "sb-list-1" })
      );
      await testClient.post(
        "/api/shared-backends",
        createSharedBackendFixture({ name: "sb-list-2" })
      );

      const res = await testClient.get<{ sharedBackends: any[] }>(
        "/api/shared-backends"
      );
      expect(res.status).toBe(200);
      expect(res.body.sharedBackends).toHaveLength(2);
      expect(res.body.sharedBackends[0]).toHaveProperty("domainCount");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/shared-backends/:id
  // ---------------------------------------------------------------------------
  describe("GET /api/shared-backends/:id", () => {
    it("should return a shared backend by id", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      const res = await testClient.get<{ sharedBackend: any }>(
        `/api/shared-backends/${id}`
      );
      expect(res.status).toBe(200);
      expect(res.body.sharedBackend.id).toBe(id);
    });

    it("should return 404 for non-existent id", async () => {
      const res = await testClient.get("/api/shared-backends/non-existent");
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/shared-backends/:id
  // ---------------------------------------------------------------------------
  describe("PUT /api/shared-backends/:id", () => {
    it("should update fields", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      const res = await testClient.put<{ sharedBackend: any }>(
        `/api/shared-backends/${id}`,
        { address: "10.99.0.1", port: 9090, weight: 50 }
      );
      expect(res.status).toBe(200);
      expect(res.body.sharedBackend.address).toBe("10.99.0.1");
      expect(res.body.sharedBackend.port).toBe(9090);
      expect(res.body.sharedBackend.weight).toBe(50);
    });

    it("should return 404 for non-existent id", async () => {
      const res = await testClient.put("/api/shared-backends/no-such-id", {
        address: "1.2.3.4",
      });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/shared-backends/:id
  // ---------------------------------------------------------------------------
  describe("DELETE /api/shared-backends/:id", () => {
    it("should delete an unlinked shared backend", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      const delRes = await testClient.delete<{ success: boolean }>(
        `/api/shared-backends/${id}`
      );
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      const getRes = await testClient.get(`/api/shared-backends/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("should reject deletion when linked to domains without force", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      // Link to domain
      await testClient.post(`/api/shared-backends/${id}/domains`, {
        domainId,
      });

      const delRes = await testClient.delete(`/api/shared-backends/${id}`);
      expect(delRes.status).toBe(409);
    });

    it("should force-delete even when linked with ?force=true", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      await testClient.post(`/api/shared-backends/${id}/domains`, {
        domainId,
      });

      const delRes = await testClient.delete(
        `/api/shared-backends/${id}?force=true`
      );
      expect(delRes.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Domain linking
  // ---------------------------------------------------------------------------
  describe("POST /api/shared-backends/:id/domains", () => {
    it("should link a domain to a shared backend", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      const linkRes = await testClient.post(`/api/shared-backends/${id}/domains`, {
        domainId,
      });
      expect(linkRes.status).toBe(201);

      const domainsRes = await testClient.get<{ domains: any[] }>(
        `/api/shared-backends/${id}/domains`
      );
      expect(domainsRes.status).toBe(200);
      expect(domainsRes.body.domains.some((d: any) => d.id === domainId)).toBe(
        true
      );
    });

    it("should reject duplicate link", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      await testClient.post(`/api/shared-backends/${id}/domains`, { domainId });
      const res2 = await testClient.post(
        `/api/shared-backends/${id}/domains`,
        { domainId }
      );
      expect(res2.status).toBe(409);
    });
  });

  describe("DELETE /api/shared-backends/:id/domains/:domainId", () => {
    it("should unlink a domain", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;

      await testClient.post(`/api/shared-backends/${id}/domains`, { domainId });

      const unlinkRes = await testClient.delete(
        `/api/shared-backends/${id}/domains/${domainId}`
      );
      expect(unlinkRes.status).toBe(200);

      const domainsRes = await testClient.get<{ domains: any[] }>(
        `/api/shared-backends/${id}/domains`
      );
      expect(domainsRes.body.domains.some((d: any) => d.id === domainId)).toBe(
        false
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH toggles
  // ---------------------------------------------------------------------------
  describe("PATCH /api/shared-backends/:id/toggle", () => {
    it("should toggle enabled state", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;
      expect(createRes.body.sharedBackend.enabled).toBe(true);

      const res = await testClient.patch<{ sharedBackend: any }>(
        `/api/shared-backends/${id}/toggle`
      );
      expect(res.status).toBe(200);
      expect(res.body.sharedBackend.enabled).toBe(false);

      const res2 = await testClient.patch<{ sharedBackend: any }>(
        `/api/shared-backends/${id}/toggle`
      );
      expect(res2.body.sharedBackend.enabled).toBe(true);
    });
  });

  describe("PATCH /api/shared-backends/:id/backup", () => {
    it("should toggle isBackup state", async () => {
      const createRes = await testClient.post<{ sharedBackend: any }>(
        "/api/shared-backends",
        createSharedBackendFixture()
      );
      const id = createRes.body.sharedBackend.id;
      expect(createRes.body.sharedBackend.isBackup).toBe(false);

      const res = await testClient.patch<{ sharedBackend: any }>(
        `/api/shared-backends/${id}/backup`
      );
      expect(res.status).toBe(200);
      expect(res.body.sharedBackend.isBackup).toBe(true);
    });
  });
});
