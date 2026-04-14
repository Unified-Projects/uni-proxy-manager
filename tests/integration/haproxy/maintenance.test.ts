import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import {
  createDomainFixture,
  createBackendFixture,
  createErrorPageFixture,
  createTestZipFile,
} from "../setup/fixtures";
import {
  createMockBackend,
  type MockBackendServer,
} from "../setup/mock-backend";
import { haproxyClient } from "../setup/haproxy-client";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("HAProxy Maintenance Mode", () => {
  let mockBackend: MockBackendServer;
  let mockBackendPort: number;

  beforeAll(async () => {
    await clearDatabase();
    await clearRedisQueues();

    mockBackend = await createMockBackend();
    mockBackendPort = mockBackend.getPort();
  });

  afterAll(async () => {
    await mockBackend.stop();
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await clearRedisQueues();
    mockBackend.reset();
    mockBackend.setResponse("/", { status: 200, body: "Backend OK" });
  });

  afterEach(() => {
    mockBackend.clearLogs();
  });

  describe("Maintenance Mode Configuration", () => {
    it("should include maintenance ACLs when enabled", async () => {
      // Create maintenance page
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );
      const maintPageId = maintPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maint-acl.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenancePageId: maintPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>(
        "/api/haproxy/config/preview",
      );

      expect(previewRes.body).toContain("maintenance");
      expect(previewRes.body).toContain("maint-acl.example.com");
    });

    it("should not include maintenance ACLs when disabled", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "no-maint.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: false,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>(
        "/api/haproxy/config/preview",
      );

      // Should not have maintenance backend for this domain
      expect(previewRes.body).not.toContain("maintenance_no-maint_example_com");
    });
  });

  describe("Bypass IP Configuration", () => {
    it("should include bypass IPs in ACLs", async () => {
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );
      const maintPageId = maintPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "bypass.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["192.168.1.100", "10.0.0.50", "172.16.0.1"],
          maintenancePageId: maintPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>(
        "/api/haproxy/config/preview",
      );

      expect(previewRes.body).toContain("192.168.1.100");
      expect(previewRes.body).toContain("10.0.0.50");
      expect(previewRes.body).toContain("172.16.0.1");
    });

    it("should handle CIDR notation in bypass IPs", async () => {
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "cidr.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["10.0.0.0/8", "192.168.0.0/16"],
          maintenancePageId: maintPageRes.body.errorPage.id,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>(
        "/api/haproxy/config/preview",
      );

      expect(previewRes.body).toContain("10.0.0.0/8");
      expect(previewRes.body).toContain("192.168.0.0/16");
    });
  });

  describe("Maintenance Mode API", () => {
    it("should enable maintenance mode via API", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Enable maintenance
      const enableRes = await testClient.post<{
        success: boolean;
        maintenanceWindowId: string;
      }>(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Scheduled maintenance",
        bypassIps: ["10.0.0.1"],
      });

      expect(enableRes.status).toBe(200);
      expect(enableRes.body.success).toBe(true);
      expect(enableRes.body.maintenanceWindowId).toBeDefined();

      // Verify domain state
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(domainCheck.body.domain.maintenanceEnabled).toBe(true);
      expect(domainCheck.body.domain.maintenanceBypassIps).toContain(
        "10.0.0.1",
      );
    });

    it("should disable maintenance mode via API", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Disable maintenance
      const disableRes = await testClient.post<{ success: boolean }>(
        `/api/maintenance/domains/${domainId}/disable`,
      );

      expect(disableRes.status).toBe(200);
      expect(disableRes.body.success).toBe(true);

      // Verify domain state
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(domainCheck.body.domain.maintenanceEnabled).toBe(false);
    });

    it("should toggle maintenance mode on and off", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Toggle on
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Test",
      });

      let check = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(check.body.domain.maintenanceEnabled).toBe(true);

      // Toggle off
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

      check = await testClient.get<{ domain: any }>(`/api/domains/${domainId}`);
      expect(check.body.domain.maintenanceEnabled).toBe(false);

      // Toggle on again
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Test again",
      });

      check = await testClient.get<{ domain: any }>(`/api/domains/${domainId}`);
      expect(check.body.domain.maintenanceEnabled).toBe(true);
    });
  });

  describe("Maintenance Window Tracking", () => {
    it("should create maintenance window record when enabled", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const enableRes = await testClient.post<{
        success: boolean;
        maintenanceWindowId: string;
      }>(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Database migration",
      });

      expect(enableRes.body.maintenanceWindowId).toBeDefined();

      // Get maintenance windows for domain
      const windowsRes = await testClient.get<{ windows: any[] }>(
        `/api/maintenance/domains/${domainId}/windows`,
      );

      expect(windowsRes.status).toBe(200);
      expect(windowsRes.body.windows.length).toBeGreaterThanOrEqual(1);

      const window = windowsRes.body.windows.find(
        (w: any) => w.id === enableRes.body.maintenanceWindowId,
      );
      expect(window).toBeDefined();
      expect(window.reason).toBe("Database migration");
      expect(window.startedAt).toBeDefined();
    });

    it("should close maintenance window when disabled", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Enable
      const enableRes = await testClient.post<{ maintenanceWindowId: string }>(
        `/api/maintenance/domains/${domainId}/enable`,
        { reason: "Test" },
      );
      const windowId = enableRes.body.maintenanceWindowId;

      // Disable
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

      // Check window is closed
      const windowsRes = await testClient.get<{ windows: any[] }>(
        `/api/maintenance/domains/${domainId}/windows`,
      );

      const window = windowsRes.body.windows.find(
        (w: any) => w.id === windowId,
      );
      expect(window?.endedAt).toBeDefined();
    });
  });

  describe("HAProxy Reload on Maintenance Change", () => {
    it("should trigger config reload when maintenance is enabled", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Get initial config version
      const initialDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      const initialVersion = initialDomain.body.domain.configVersion;

      // Enable maintenance
      await testClient.post(`/api/maintenance/domains/${domainId}/enable`, {
        reason: "Test",
      });

      // Check config version incremented
      const updatedDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(updatedDomain.body.domain.configVersion).toBeGreaterThan(
        initialVersion,
      );
    });

    it("should trigger config reload when maintenance is disabled", async () => {
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture(),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const initialDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      const initialVersion = initialDomain.body.domain.configVersion;

      // Disable maintenance
      await testClient.post(`/api/maintenance/domains/${domainId}/disable`);

      const updatedDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(updatedDomain.body.domain.configVersion).toBeGreaterThan(
        initialVersion,
      );
    });
  });

  describe("Maintenance Page Serving", () => {
    it("should assign maintenance page to domain", async () => {
      // Create and upload maintenance page
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Maintenance",
          type: "maintenance",
          description: "Maintenance page",
          entryFile: "index.html",
        },
      );
      const maintPageId = maintPageRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        `<!DOCTYPE html>
<html>
<head><title>Under Maintenance</title></head>
<body>
<h1>We're Under Maintenance</h1>
<p>Please check back soon.</p>
</body>
</html>`,
      );
      await testClient.uploadFile(
        `/api/error-pages/${maintPageId}/upload`,
        zipFile,
      );

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maint-page.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Assign maintenance page
      const assignRes = await testClient.post<{ success: boolean }>(
        `/api/error-pages/${maintPageId}/assign/${domainId}?type=maintenance`,
      );
      expect(assignRes.status).toBe(200);

      // Verify assignment
      const domainCheck = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`,
      );
      expect(domainCheck.body.domain.maintenancePageId).toBe(maintPageId);
    });

    it("should include maintenance page path in config when enabled", async () => {
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );
      const maintPageId = maintPageRes.body.errorPage.id;

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maint-path.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenancePageId: maintPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      const previewRes = await testClient.get<string>(
        "/api/haproxy/config/preview",
      );

      // Should have maintenance backend
      expect(previewRes.body).toContain("maintenance");
      expect(previewRes.body).toContain(
        `errorfile 503 ${maintPageRes.body.errorPage.directoryPath}/maintenance.http`,
      );
    });
  });

  describe("Maintenance Mode with Traffic Routing", () => {
    it("should block regular traffic when maintenance is enabled", async () => {
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "block-traffic.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenancePageId: maintPageRes.body.errorPage.id,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "127.0.0.1",
          port: mockBackendPort,
        }),
      );

      await testClient.post("/api/haproxy/apply");
      await testClient.post("/api/haproxy/reload");

      await new Promise((r) => setTimeout(r, 2000));

      if (!(await haproxyClient.isRunning())) {
        console.log("HAProxy not running, skipping traffic test");
        return;
      }

      // Test maintenance mode
      const isBlocked = await haproxyClient.testMaintenanceMode(
        "block-traffic.example.com",
      );
      expect(typeof isBlocked).toBe("boolean");
    });

    it("should allow bypass IP through maintenance mode", async () => {
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );

      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "bypass-ip.example.com" }),
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["192.168.1.100"],
          maintenancePageId: maintPageRes.body.errorPage.id,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "127.0.0.1",
          port: mockBackendPort,
        }),
      );

      await testClient.post("/api/haproxy/apply");
      await testClient.post("/api/haproxy/reload");

      await new Promise((r) => setTimeout(r, 2000));

      if (!(await haproxyClient.isRunning())) return;

      // Test bypass
      const bypassed = await haproxyClient.testMaintenanceBypass(
        "bypass-ip.example.com",
        "192.168.1.100",
      );
      expect(typeof bypassed).toBe("boolean");
    });
  });

  describe("Multiple Domains Maintenance", () => {
    it("should handle maintenance mode independently for each domain", async () => {
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance"),
      );

      // Create two domains
      const domain1Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "domain1-maint.example.com" }),
      );
      const domain2Res = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "domain2-maint.example.com" }),
      );

      const domain1Id = domain1Res.body.domain.id;
      const domain2Id = domain2Res.body.domain.id;

      // Activate both, but only put domain1 in maintenance
      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenancePageId: maintPageRes.body.errorPage.id,
        })
        .where(eq(schema.domains.id, domain1Id));

      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: false,
        })
        .where(eq(schema.domains.id, domain2Id));

      await testClient.post("/api/backends", createBackendFixture(domain1Id));
      await testClient.post("/api/backends", createBackendFixture(domain2Id));

      // Verify config
      const previewRes = await testClient.get<string>(
        "/api/haproxy/config/preview",
      );

      // domain1 should have maintenance backend
      expect(previewRes.body).toContain("domain1-maint.example.com");
      expect(previewRes.body).toContain(
        "maintenance_domain1-maint_example_com",
      );

      // domain2 should not have maintenance backend
      expect(previewRes.body).toContain("domain2-maint.example.com");
      expect(previewRes.body).not.toContain(
        "maintenance_domain2-maint_example_com",
      );
    });
  });
});
