import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues, getQueueCounts } from "../setup/test-redis";
import {
  createDomainFixture,
  createBackendFixture,
  createDnsProviderFixture,
  createErrorPageFixture,
} from "../setup/fixtures";
import { QUEUES } from "../../../packages/queue/src/queues";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Domain Lifecycle E2E", () => {
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
  });

  it("should complete full domain lifecycle: create -> configure -> activate -> maintain -> delete", async () => {
    // Step 1: Create DNS Provider
    const dnsRes = await testClient.post<{ provider: any }>("/api/dns-providers", {
      ...createDnsProviderFixture("cloudflare"),
      isDefault: true,
    });
    expect(dnsRes.status).toBe(201);
    const dnsProviderId = dnsRes.body.provider.id;

    // Step 2: Create Domain
    const domainData = createDomainFixture({
      hostname: "lifecycle-test.example.com",
    });
    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      domainData
    );
    expect(domainRes.status).toBe(201);
    expect(domainRes.body.domain.status).toBe("pending");
    const domainId = domainRes.body.domain.id;

    // Step 3: Add Backends
    const backend1Res = await testClient.post<{ backend: any }>(
      "/api/backends",
      createBackendFixture(domainId, {
        name: "primary",
        address: "10.0.0.1",
        port: 8080,
        weight: 100,
      })
    );
    expect(backend1Res.status).toBe(201);

    const backend2Res = await testClient.post<{ backend: any }>(
      "/api/backends",
      createBackendFixture(domainId, {
        name: "secondary",
        address: "10.0.0.2",
        port: 8080,
        weight: 50,
      })
    );
    expect(backend2Res.status).toBe(201);

    // Step 4: Create and Assign 503 Error Page
    const errorPageRes = await testClient.post<{ errorPage: any }>(
      "/api/error-pages",
      createErrorPageFixture("503")
    );
    expect(errorPageRes.status).toBe(201);
    const errorPageId = errorPageRes.body.errorPage.id;

    const assignRes = await testClient.post<{ success: boolean }>(
      `/api/error-pages/${errorPageId}/assign/${domainId}?type=503`
    );
    expect(assignRes.status).toBe(200);

    // Step 5: Create and Assign Maintenance Page
    const maintPageRes = await testClient.post<{ errorPage: any }>(
      "/api/error-pages",
      createErrorPageFixture("maintenance")
    );
    expect(maintPageRes.status).toBe(201);
    const maintPageId = maintPageRes.body.errorPage.id;

    await testClient.post(
      `/api/error-pages/${maintPageId}/assign/${domainId}?type=maintenance`
    );

    // Step 6: Request Certificate (queues job)
    const certRes = await testClient.post<{ certificate: any }>(
      "/api/certificates",
      {
        domainId,
        dnsProviderId,
      }
    );
    expect(certRes.status).toBe(201);
    expect(certRes.body.certificate.status).toBe("pending");

    // Verify certificate issue job was queued
    const certCounts = await getQueueCounts(QUEUES.CERTIFICATE_ISSUE);
    expect(certCounts.waiting + certCounts.active).toBeGreaterThanOrEqual(1);

    // Step 7: Activate Domain
    await testDb
      .update(schema.domains)
      .set({ status: "active" })
      .where(eq(schema.domains.id, domainId));

    // Step 8: Verify HAProxy Config Contains Domain
    const configPreview = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect(configPreview.status).toBe(200);
    expect(configPreview.body).toContain("lifecycle-test.example.com");

    // Step 9: Enable Maintenance Mode
    await clearRedisQueues();
    const maintEnableRes = await testClient.post<{
      success: boolean;
      maintenanceWindowId: string;
    }>(`/api/maintenance/domains/${domainId}/enable`, {
      reason: "Lifecycle test maintenance",
      bypassIps: ["192.168.1.1"],
    });
    expect(maintEnableRes.status).toBe(200);

    // Verify HAProxy reload was queued
    const reloadCounts = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
    expect(
      reloadCounts.waiting + reloadCounts.active + reloadCounts.completed
    ).toBeGreaterThanOrEqual(1);

    // Verify config includes maintenance ACLs
    const configWithMaint = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect(configWithMaint.body).toContain("maintenance");
    expect(configWithMaint.body).toContain("192.168.1.1");

    // Step 10: Disable Maintenance
    await clearRedisQueues();
    await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

    // Verify reload was queued again
    const reloadCounts2 = await getQueueCounts(QUEUES.HAPROXY_RELOAD);
    expect(
      reloadCounts2.waiting + reloadCounts2.active + reloadCounts2.completed
    ).toBeGreaterThanOrEqual(1);

    // Step 11: Verify Full Domain State
    const fullDomain = await testClient.get<{ domain: any }>(
      `/api/domains/${domainId}`
    );
    expect(fullDomain.body.domain.status).toBe("active");
    expect(fullDomain.body.domain.backends).toHaveLength(2);
    expect(fullDomain.body.domain.errorPageId).toBe(errorPageId);
    expect(fullDomain.body.domain.maintenancePageId).toBe(maintPageId);
    expect(fullDomain.body.domain.maintenanceEnabled).toBe(false);
    expect(fullDomain.body.domain.configVersion).toBeGreaterThan(0);

    // Step 12: Delete Domain (cascades)
    const deleteRes = await testClient.delete<{ success: boolean }>(
      `/api/domains/${domainId}`
    );
    expect(deleteRes.status).toBe(200);

    // Verify cascaded deletes
    const backends = await testDb.query.backends.findMany({
      where: eq(schema.backends.domainId, domainId),
    });
    expect(backends).toHaveLength(0);

    const certificates = await testDb.query.certificates.findMany({
      where: eq(schema.certificates.domainId, domainId),
    });
    expect(certificates).toHaveLength(0);

    const windows = await testDb.query.maintenanceWindows.findMany({
      where: eq(schema.maintenanceWindows.domainId, domainId),
    });
    expect(windows).toHaveLength(0);

    // Step 13: Verify Domain Removed from Config
    const finalConfig = await testClient.get<string>(
      "/api/haproxy/config/preview"
    );
    expect(finalConfig.body).not.toContain("lifecycle-test.example.com");
  });

  it("should handle multiple domains with different configurations", async () => {
    // Create multiple domains
    const domain1Res = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ hostname: "domain1.example.com", forceHttps: true })
    );
    const domain2Res = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ hostname: "domain2.example.com", forceHttps: false })
    );

    const domain1Id = domain1Res.body.domain.id;
    const domain2Id = domain2Res.body.domain.id;

    // Activate both
    await testDb
      .update(schema.domains)
      .set({ status: "active" })
      .where(eq(schema.domains.id, domain1Id));
    await testDb
      .update(schema.domains)
      .set({ status: "active" })
      .where(eq(schema.domains.id, domain2Id));

    // Add backends
    await testClient.post(
      "/api/backends",
      createBackendFixture(domain1Id, { address: "10.0.1.1" })
    );
    await testClient.post(
      "/api/backends",
      createBackendFixture(domain2Id, { address: "10.0.2.1" })
    );

    // Enable maintenance on domain1 only
    await testClient.post(`/api/maintenance/domains/${domain1Id}/enable`, {
      reason: "Maintenance",
    });

    // Verify config has both domains with correct settings
    const config = await testClient.get<string>("/api/haproxy/config/preview");
    expect(config.body).toContain("domain1.example.com");
    expect(config.body).toContain("domain2.example.com");
    expect(config.body).toContain("10.0.1.1");
    expect(config.body).toContain("10.0.2.1");

    // Delete both
    await testClient.delete(`/api/domains/${domain1Id}`);
    await testClient.delete(`/api/domains/${domain2Id}`);

    // Verify both removed
    const listRes = await testClient.get<{ domains: any[] }>("/api/domains");
    expect(listRes.body.domains).toHaveLength(0);
  });

  it("should handle domain with multiple backends and load balancing", async () => {
    const domainRes = await testClient.post<{ domain: any }>(
      "/api/domains",
      createDomainFixture({ hostname: "loadbalanced.example.com" })
    );
    const domainId = domainRes.body.domain.id;

    // Activate domain
    await testDb
      .update(schema.domains)
      .set({ status: "active" })
      .where(eq(schema.domains.id, domainId));

    // Add multiple backends with different weights
    await testClient.post(
      "/api/backends",
      createBackendFixture(domainId, {
        name: "server-1",
        address: "10.0.0.1",
        weight: 100,
      })
    );
    await testClient.post(
      "/api/backends",
      createBackendFixture(domainId, {
        name: "server-2",
        address: "10.0.0.2",
        weight: 50,
      })
    );
    await testClient.post(
      "/api/backends",
      createBackendFixture(domainId, {
        name: "server-3",
        address: "10.0.0.3",
        weight: 25,
      })
    );

    // Verify all backends in domain
    const domainCheck = await testClient.get<{ domain: any }>(
      `/api/domains/${domainId}`
    );
    expect(domainCheck.body.domain.backends).toHaveLength(3);

    // Verify config contains all servers
    const config = await testClient.get<string>("/api/haproxy/config/preview");
    expect(config.body).toContain("10.0.0.1");
    expect(config.body).toContain("10.0.0.2");
    expect(config.body).toContain("10.0.0.3");

    // Disable one backend
    const backendsRes = await testClient.get<{ backends: any[] }>(
      "/api/backends"
    );
    const backend2 = backendsRes.body.backends.find(
      (b) => b.name === "server-2"
    );
    await testClient.put(`/api/backends/${backend2.id}`, { enabled: false });

    // Verify config reflects disabled backend
    const updatedDomain = await testClient.get<{ domain: any }>(
      `/api/domains/${domainId}`
    );
    const enabledBackends = updatedDomain.body.domain.backends.filter(
      (b: any) => b.enabled
    );
    expect(enabledBackends).toHaveLength(2);
  });
});
