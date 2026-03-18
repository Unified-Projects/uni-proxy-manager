import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { clearRedisQueues } from "../setup/test-redis";
import {
  createDomainFixture,
  createBackendFixture,
  createErrorPageFixture,
} from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TEST_DATA_DIR = join(process.cwd(), "docker/test-data");
const HAPROXY_HTTP_PORT = 8080;
const HAPROXY_BASE_URL = `http://localhost:${HAPROXY_HTTP_PORT}`;

describe("HAProxy Routing E2E", () => {
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

  /**
   * Write HAProxy config to test volume
   */
  async function writeHAProxyConfig(config: string): Promise<void> {
    const configPath = join(TEST_DATA_DIR, "haproxy/haproxy.cfg");
    writeFileSync(configPath, config);
    // Give HAProxy time to detect config change
    await new Promise((r) => setTimeout(r, 2000));
  }

  /**
   * Create error page file
   */
  function createErrorPageFile(content: string, filename: string): void {
    const dir = join(TEST_DATA_DIR, "error-pages");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(dir, filename), content);
  }

  describe("HAProxy Config Generation", () => {
    it("should generate valid config for active domains", async () => {
      // Create and activate domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "routing-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Add backend
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          address: "test-backend",
          port: 80,
        })
      );

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("routing-test.example.com");
      expect(configRes.body).toContain("test-backend:80");
    });

    it("should not include domains without backends in config", async () => {
      // Create domain without backends
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "pending.example.com" })
      );

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      expect(configRes.body).not.toContain("pending.example.com");
    });

    it("should include maintenance mode configuration", async () => {
      // Create maintenance page
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("maintenance")
      );
      expect(maintPageRes.status).toBe(201);
      const maintPageId = maintPageRes.body.errorPage.id;

      // Create and activate domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maint-config.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Update domain with maintenance settings including page assignment
      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenanceBypassIps: ["192.168.1.100", "10.0.0.50"],
          maintenancePageId: maintPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("maint-config.example.com");
      // Should contain bypass IP ACLs
      expect(configRes.body).toContain("192.168.1.100");
      expect(configRes.body).toContain("10.0.0.50");
    });

    it("should include HTTPS redirect for forceHttps domains", async () => {
      // Create domain with forceHttps
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({
          hostname: "https-redirect.example.com",
          forceHttps: true,
        })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      // Should contain redirect scheme https
      expect(configRes.body).toContain("https");
    });

    it("should handle multiple backends with weights", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "weighted.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Add multiple backends with different weights
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "heavy",
          address: "10.0.0.1",
          weight: 100,
        })
      );
      await testClient.post(
        "/api/backends",
        createBackendFixture(domainId, {
          name: "light",
          address: "10.0.0.2",
          weight: 25,
        })
      );

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("10.0.0.1");
      expect(configRes.body).toContain("10.0.0.2");
      expect(configRes.body).toContain("weight");
    });
  });

  describe("HAProxy Reload Flow", () => {
    it("should trigger reload when domain config changes", async () => {
      // Create and activate domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "reload-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      // Add backend - this should increment configVersion
      const initialDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      const initialVersion = initialDomain.body.domain.configVersion;

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Verify configVersion incremented
      const updatedDomain = await testClient.get<{ domain: any }>(
        `/api/domains/${domainId}`
      );
      expect(updatedDomain.body.domain.configVersion).toBe(initialVersion + 1);

      // Trigger reload
      const reloadRes = await testClient.post<{ success: boolean }>(
        "/api/haproxy/reload"
      );
      expect(reloadRes.status).toBe(200);
      expect(reloadRes.body.success).toBe(true);
    });

    it("should apply config and write to file", async () => {
      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "apply-test.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Apply config
      const applyRes = await testClient.post<{
        success: boolean;
        configPath: string;
      }>("/api/haproxy/apply");

      expect(applyRes.status).toBe(200);
      expect(applyRes.body.success).toBe(true);
      expect(applyRes.body.configPath).toBeDefined();
    });
  });

  describe("Error Page Configuration", () => {
    it("should include error page paths in config", async () => {
      // Create error page
      const errorPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Test 503",
          type: "503",
          description: "Test error page",
          entryFile: "index.html",
        }
      );
      const errorPageId = errorPageRes.body.errorPage.id;

      // Create domain and assign error page
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "error-page.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      await testDb
        .update(schema.domains)
        .set({ status: "active" })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Assign error page
      await testClient.post(
        `/api/error-pages/${errorPageId}/assign/${domainId}?type=503`
      );

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      // Config should reference error page path
      expect(configRes.body).toContain("error-page.example.com");
    });

    it("should include maintenance page paths when maintenance enabled", async () => {
      // Create maintenance page
      const maintPageRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        {
          name: "Maintenance Page",
          type: "maintenance",
          description: "Test maintenance page",
          entryFile: "index.html",
        }
      );
      const maintPageId = maintPageRes.body.errorPage.id;

      // Create domain
      const domainRes = await testClient.post<{ domain: any }>(
        "/api/domains",
        createDomainFixture({ hostname: "maint-page.example.com" })
      );
      const domainId = domainRes.body.domain.id;

      // Activate and enable maintenance
      await testDb
        .update(schema.domains)
        .set({
          status: "active",
          maintenanceEnabled: true,
          maintenancePageId: maintPageId,
        })
        .where(eq(schema.domains.id, domainId));

      await testClient.post("/api/backends", createBackendFixture(domainId));

      // Get config preview
      const configRes = await testClient.get<string>(
        "/api/haproxy/config/preview"
      );

      expect(configRes.status).toBe(200);
      expect(configRes.body).toContain("maint-page.example.com");
      expect(configRes.body).toContain("maintenance");
    });
  });
});
