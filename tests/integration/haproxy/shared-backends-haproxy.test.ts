import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import {
  createDomainFixture,
  createSharedBackendFixture,
} from "../setup/fixtures";

describe("Shared Backends — HAProxy Config Preview", () => {
  let domainId: string;
  let sharedBackendId: string;

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

    const sbRes = await testClient.post<{ sharedBackend: any }>(
      "/api/shared-backends",
      createSharedBackendFixture({
        name: "sb-haproxy-test",
        address: "10.10.10.10",
        port: 9000,
      })
    );
    sharedBackendId = sbRes.body.sharedBackend.id;
  });

  it("should not include shared backend in config when not linked", async () => {
    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    // Domain has no backends at all — should show fallback only
    const configStr = res.body as unknown as string;
    expect(configStr).not.toContain("10.10.10.10");
  });

  it("should include shared backend server in config when linked to domain", async () => {
    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    const configStr = res.body as unknown as string;
    expect(configStr).toContain("10.10.10.10");
    expect(configStr).toContain("9000");
  });

  it("should remove shared backend from config when unlinked", async () => {
    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId,
    });

    const withLinked = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect((withLinked.body as unknown as string)).toContain("10.10.10.10");

    await testClient.delete(
      `/api/shared-backends/${sharedBackendId}/domains/${domainId}`
    );

    const withoutLinked = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect((withoutLinked.body as unknown as string)).not.toContain("10.10.10.10");
  });

  it("should exclude disabled shared backend from config", async () => {
    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId,
    });

    // Disable the shared backend
    await testClient.patch(`/api/shared-backends/${sharedBackendId}/toggle`);

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;
    expect(configStr).not.toContain("10.10.10.10");
  });

  it("should include shared backend as backup server when isBackup=true", async () => {
    await testClient.patch(`/api/shared-backends/${sharedBackendId}/backup`);
    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;
    expect(configStr).toContain("10.10.10.10");
    expect(configStr).toContain("backup");
  });

  it("should reflect updated address after PUT on shared backend", async () => {
    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId,
    });

    await testClient.put(`/api/shared-backends/${sharedBackendId}`, {
      address: "172.16.0.50",
      port: 7777,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;
    expect(configStr).toContain("172.16.0.50");
    expect(configStr).toContain("7777");
    expect(configStr).not.toContain("10.10.10.10");
  });

  it("should include shared backend in multiple domains", async () => {
    const domain2Res = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ sslEnabled: false, forceHttps: false })
    );
    const domainId2 = domain2Res.body.domain.id;

    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId,
    });
    await testClient.post(`/api/shared-backends/${sharedBackendId}/domains`, {
      domainId: domainId2,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;
    // The shared backend address should appear in server entries for both backends
    const occurrences = (configStr.match(/10\.10\.10\.10/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
