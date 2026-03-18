import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import { createClusterNodeFixture } from "../setup/fixtures";

describe("Cluster API", () => {
  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  // ---------------------------------------------------------------------------
  // POST /api/cluster
  // ---------------------------------------------------------------------------
  describe("POST /api/cluster", () => {
    it("should register a cluster node", async () => {
      const data = createClusterNodeFixture();
      const res = await testClient.post<{ node: any }>("/api/cluster", data);

      expect(res.status).toBe(201);
      expect(res.body.node.name).toBe(data.name);
      expect(res.body.node.apiUrl).toBe(data.apiUrl);
      expect(res.body.node.status).toBe("unknown");
      expect(res.body.node.isLocal).toBe(false);
    });

    it("should register a local node", async () => {
      const data = createClusterNodeFixture({ isLocal: true });
      const res = await testClient.post<{ node: any }>("/api/cluster", data);

      expect(res.status).toBe(201);
      expect(res.body.node.isLocal).toBe(true);
    });

    it("should reject duplicate apiUrl", async () => {
      const data = createClusterNodeFixture({ apiUrl: "http://dup.example.com" });
      await testClient.post("/api/cluster", data);

      const res2 = await testClient.post("/api/cluster", {
        ...data,
        name: "other-name",
      });
      expect(res2.status).toBe(409);
    });

    it("should reject missing name", async () => {
      const { name: _n, ...withoutName } = createClusterNodeFixture();
      const res = await testClient.post("/api/cluster", withoutName);
      expect(res.status).toBe(400);
    });

    it("should reject missing apiUrl", async () => {
      const { apiUrl: _u, ...withoutUrl } = createClusterNodeFixture();
      const res = await testClient.post("/api/cluster", withoutUrl);
      expect(res.status).toBe(400);
    });

    it("should reject missing apiKey", async () => {
      const { apiKey: _k, ...withoutKey } = createClusterNodeFixture();
      const res = await testClient.post("/api/cluster", withoutKey);
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/cluster
  // ---------------------------------------------------------------------------
  describe("GET /api/cluster", () => {
    it("should return empty list when no nodes", async () => {
      const res = await testClient.get<{ nodes: any[] }>("/api/cluster");
      expect(res.status).toBe(200);
      expect(res.body.nodes).toHaveLength(0);
    });

    it("should list registered nodes", async () => {
      await testClient.post("/api/cluster", createClusterNodeFixture({ name: "n1" }));
      await testClient.post("/api/cluster", createClusterNodeFixture({ name: "n2" }));

      const res = await testClient.get<{ nodes: any[] }>("/api/cluster");
      expect(res.status).toBe(200);
      expect(res.body.nodes).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/cluster/:id
  // ---------------------------------------------------------------------------
  describe("GET /api/cluster/:id", () => {
    it("should return a single node", async () => {
      const createRes = await testClient.post<{ node: any }>(
        "/api/cluster",
        createClusterNodeFixture()
      );
      const id = createRes.body.node.id;

      const res = await testClient.get<{ node: any }>(`/api/cluster/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.node.id).toBe(id);
    });

    it("should return 404 for non-existent id", async () => {
      const res = await testClient.get("/api/cluster/non-existent");
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/cluster/:id
  // ---------------------------------------------------------------------------
  describe("PUT /api/cluster/:id", () => {
    it("should update node name and apiKey", async () => {
      const createRes = await testClient.post<{ node: any }>(
        "/api/cluster",
        createClusterNodeFixture()
      );
      const id = createRes.body.node.id;

      const res = await testClient.put<{ node: any }>(`/api/cluster/${id}`, {
        name: "updated-name",
        apiKey: "new-secret-key",
      });
      expect(res.status).toBe(200);
      expect(res.body.node.name).toBe("updated-name");
      expect(res.body.node.apiKey).toBe("new-secret-key");
    });

    it("should return 404 for non-existent id", async () => {
      const res = await testClient.put("/api/cluster/no-such-id", {
        name: "x",
      });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/cluster/:id
  // ---------------------------------------------------------------------------
  describe("DELETE /api/cluster/:id", () => {
    it("should remove a node", async () => {
      const createRes = await testClient.post<{ node: any }>(
        "/api/cluster",
        createClusterNodeFixture()
      );
      const id = createRes.body.node.id;

      const delRes = await testClient.delete<{ success: boolean }>(
        `/api/cluster/${id}`
      );
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      const getRes = await testClient.get(`/api/cluster/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent id", async () => {
      const res = await testClient.delete("/api/cluster/no-such-id");
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/cluster/sync-all
  // ---------------------------------------------------------------------------
  describe("POST /api/cluster/sync-all", () => {
    it("should return nodesQueued=0 when no remote nodes", async () => {
      // Register only a local node
      await testClient.post("/api/cluster", createClusterNodeFixture({ isLocal: true }));

      const res = await testClient.post<{ nodesQueued: number }>(
        "/api/cluster/sync-all"
      );
      expect(res.status).toBe(200);
      expect(res.body.nodesQueued).toBe(0);
    });

    it("should return nodesQueued matching remote node count", async () => {
      await testClient.post("/api/cluster", createClusterNodeFixture({ isLocal: false }));
      await testClient.post("/api/cluster", createClusterNodeFixture({ isLocal: false }));

      const res = await testClient.post<{ nodesQueued: number }>(
        "/api/cluster/sync-all"
      );
      expect(res.status).toBe(200);
      expect(res.body.nodesQueued).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/cluster/:id/sync
  // ---------------------------------------------------------------------------
  describe("POST /api/cluster/:id/sync", () => {
    it("should enqueue sync for a specific node", async () => {
      const createRes = await testClient.post<{ node: any }>(
        "/api/cluster",
        createClusterNodeFixture({ isLocal: false })
      );
      const id = createRes.body.node.id;

      const res = await testClient.post<{ queued: boolean }>(
        `/api/cluster/${id}/sync`
      );
      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
    });

    it("should return 404 for non-existent id", async () => {
      const res = await testClient.post("/api/cluster/no-such-id/sync");
      expect(res.status).toBe(404);
    });
  });
});
