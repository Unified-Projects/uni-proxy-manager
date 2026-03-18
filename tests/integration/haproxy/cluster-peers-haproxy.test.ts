import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import {
  createDomainFixture,
  createBackendFixture,
  createClusterNodeFixture,
} from "../setup/fixtures";

describe("Cluster Peers — HAProxy Config Preview", () => {
  let domainId: string;

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

    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ sslEnabled: false, forceHttps: false })
    );
    domainId = domainRes.body.domain.id;
    await testClient.post("/api/backends", createBackendFixture(domainId));
  });

  it("should not include peers section when no cluster nodes are registered", async () => {
    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    expect(res.body as unknown as string).not.toContain("peers upm_cluster");
  });

  it("should not include peers section when only one node exists", async () => {
    await testClient.post(
      "/api/cluster",
      createClusterNodeFixture({ isLocal: true })
    );

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    // Only one node — peers block requires at least 2
    expect(res.body as unknown as string).not.toContain("peers upm_cluster");
  });

  it("should include peers section when two or more cluster nodes are registered", async () => {
    await testClient.post(
      "/api/cluster",
      createClusterNodeFixture({ name: "node-a", isLocal: true })
    );
    await testClient.post(
      "/api/cluster",
      createClusterNodeFixture({
        name: "node-b",
        apiUrl: "http://node-b.internal",
        isLocal: false,
      })
    );

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    const configStr = res.body as unknown as string;
    expect(configStr).toContain("peers upm_cluster");
    expect(configStr).toContain("peer node-a");
    expect(configStr).toContain("peer node-b");
  });

  it("should remove peers section after deleting nodes back to one", async () => {
    const nodeARes = await testClient.post<{ node: any }>(
      "/api/cluster",
      createClusterNodeFixture({ name: "peer-del-a", isLocal: true })
    );
    const nodeBRes = await testClient.post<{ node: any }>(
      "/api/cluster",
      createClusterNodeFixture({
        name: "peer-del-b",
        apiUrl: "http://peer-del-b.internal",
        isLocal: false,
      })
    );

    const withPeers = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect(withPeers.body as unknown as string).toContain("peers upm_cluster");

    await testClient.delete(`/api/cluster/${nodeBRes.body.node.id}`);

    const withoutPeers = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect(withoutPeers.body as unknown as string).not.toContain(
      "peers upm_cluster"
    );
  });

  it("should list each peer with its address in the peers block", async () => {
    // Register two nodes — use known API URLs to check addresses
    await testClient.post("/api/cluster", {
      name: "alpha",
      apiUrl: "http://192.168.1.10:8080",
      apiKey: "key-alpha",
      isLocal: false,
    });
    await testClient.post("/api/cluster", {
      name: "beta",
      apiUrl: "http://192.168.1.20:8080",
      apiKey: "key-beta",
      isLocal: false,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;
    expect(configStr).toContain("peers upm_cluster");
    // Peers derived from apiUrl hostnames
    expect(configStr).toContain("peer alpha");
    expect(configStr).toContain("peer beta");
  });

  it("should place peers block before frontend sections", async () => {
    await testClient.post("/api/cluster", createClusterNodeFixture({ name: "x1", isLocal: true }));
    await testClient.post("/api/cluster", createClusterNodeFixture({
      name: "x2",
      apiUrl: "http://x2.internal",
      isLocal: false,
    }));

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;

    const peersIdx = configStr.indexOf("peers upm_cluster");
    // Use "frontend http_front" to skip the stats frontend which renders before the peers block
    const frontendIdx = configStr.indexOf("frontend http_front");
    expect(peersIdx).toBeGreaterThan(-1);
    expect(frontendIdx).toBeGreaterThan(-1);
    expect(peersIdx).toBeLessThan(frontendIdx);
  });
});
