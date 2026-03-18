import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("WWW Toggle — HAProxy Config Preview", () => {
  let domainId: string;
  let hostname: string;

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

    hostname = `www-test-${Date.now()}.example.com`;
    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ hostname, sslEnabled: false, forceHttps: false })
    );
    domainId = domainRes.body.domain.id;
    await testClient.post("/api/backends", createBackendFixture(domainId));
  });

  it("should not include www alias ACL when wwwRedirectEnabled is false", async () => {
    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(`www.${hostname}`);
  });

  it("should include www alias in config when wwwRedirectEnabled is enabled", async () => {
    await testClient.put(`/api/domains/${domainId}`, {
      wwwRedirectEnabled: true,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    expect(res.body).toContain(`www.${hostname}`);
  });

  it("should remove www alias from config when wwwRedirectEnabled is disabled again", async () => {
    await testClient.put(`/api/domains/${domainId}`, {
      wwwRedirectEnabled: true,
    });

    const withWww = await testClient.get<string>("/api/haproxy/config/preview");
    expect(withWww.body).toContain(`www.${hostname}`);

    await testClient.put(`/api/domains/${domainId}`, {
      wwwRedirectEnabled: false,
    });

    const withoutWww = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect(withoutWww.body).not.toContain(`www.${hostname}`);
  });

  it("should include arbitrary subdomainAliases in config", async () => {
    await testClient.put(`/api/domains/${domainId}`, {
      subdomainAliases: [`app.${hostname}`, `api.${hostname}`],
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    expect(res.status).toBe(200);
    expect(res.body).toContain(`app.${hostname}`);
    expect(res.body).toContain(`api.${hostname}`);
  });

  it("should route alias traffic to same backend as primary hostname", async () => {
    await testClient.put(`/api/domains/${domainId}`, {
      wwwRedirectEnabled: true,
    });

    const res = await testClient.get<string>("/api/haproxy/config/preview");
    const configStr = res.body as unknown as string;

    // The alias ACL and use_backend for it should reference the same backend name
    const sanitized = hostname.replace(/\./g, "_").replace(/-/g, "-");
    expect(configStr).toContain(`backend_${sanitized.toLowerCase()}`);
  });

  it("should persist www alias across multiple config previews", async () => {
    await testClient.put(`/api/domains/${domainId}`, {
      wwwRedirectEnabled: true,
    });

    const res1 = await testClient.get<string>("/api/haproxy/config/preview");
    const res2 = await testClient.get<string>("/api/haproxy/config/preview");

    expect(res1.body).toContain(`www.${hostname}`);
    expect(res2.body).toContain(`www.${hostname}`);
  });
});
