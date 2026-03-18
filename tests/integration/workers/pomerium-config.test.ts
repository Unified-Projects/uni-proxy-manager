/**
 * Pomerium Config Worker Integration Tests
 *
 * Tests the pomerium-config processor end-to-end against a real database.
 * Validates that the YAML file written to POMERIUM_CONFIG_PATH is correct.
 *
 * Requires the Docker test environment (test-runner container).
 * Skips when POMERIUM_CONFIG_PATH is not set.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFile } from "fs/promises";
import * as yaml from "yaml";
import type { Job } from "bullmq";
import type { PomeriumConfigJobData } from "@uni-proxy-manager/queue";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import {
  createDomainFixture,
  createBackendFixture,
  createPomeriumRouteFixture,
  createPomeriumOidcIdpFixture,
} from "../setup/fixtures";
import { processPomeriumConfig } from "../../../apps/pomerium-workers/src/processors/pomerium-config";

const POMERIUM_CONFIG_PATH = process.env.POMERIUM_CONFIG_PATH;

function createMockJob(data: PomeriumConfigJobData): Job<PomeriumConfigJobData> {
  return {
    id: "test-job-id",
    name: "pomerium-config",
    data,
    opts: {},
    attemptsMade: 0,
    timestamp: Date.now(),
    returnvalue: undefined,
    failedReason: undefined,
    getState: async () => "active",
    updateProgress: async () => {},
    log: async () => {},
  } as unknown as Job<PomeriumConfigJobData>;
}

async function readPomeriumConfig(): Promise<Record<string, unknown>> {
  const content = await readFile(POMERIUM_CONFIG_PATH!, "utf-8");
  return yaml.parse(content) as Record<string, unknown>;
}

/**
 * Enable Pomerium in settings and return the settings response.
 * Uses the API upsert pattern so no prior row is required.
 */
async function enablePomerium(): Promise<void> {
  const res = await testClient.put("/api/pomerium/settings", {
    enabled: true,
    authenticateServiceUrl: "http://test-pomerium:80",
    cookieSecure: false,
  });
  expect(res.status).toBe(200);
}

describe("Pomerium Config Worker", () => {
  beforeAll(async () => {
    if (!POMERIUM_CONFIG_PATH) {
      return;
    }
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    if (!POMERIUM_CONFIG_PATH) {
      return;
    }
    await clearDatabase();
  });

  it("skips all tests when POMERIUM_CONFIG_PATH is not set", (ctx) => {
    if (POMERIUM_CONFIG_PATH) {
      // Path is set - this is just a no-op guard test
      expect(POMERIUM_CONFIG_PATH).toBeTruthy();
      return;
    }
    ctx.skip();
  });

  describe("Empty state", () => {
    it("writes a routes: [] file when no pomerium settings row exists", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      // No settings row, no routes, no IdPs
      const job = createMockJob({ reason: "test", triggeredBy: "startup" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);
      expect(result.routesConfigured).toBe(0);

      const config = await readPomeriumConfig();
      expect(Array.isArray(config.routes)).toBe(true);
      expect((config.routes as unknown[]).length).toBe(0);
    });

    it("writes a routes: [] file when pomerium is disabled", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      // Create settings with enabled=false
      await testClient.put("/api/pomerium/settings", { enabled: false });

      const job = createMockJob({ reason: "test", triggeredBy: "settings" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);
      expect(result.routesConfigured).toBe(0);

      const config = await readPomeriumConfig();
      expect(Array.isArray(config.routes)).toBe(true);
      expect((config.routes as unknown[]).length).toBe(0);
    });
  });

  describe("Single public route", () => {
    it("generates allow_public_unauthenticated_access: true for a public route", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      const domainRes = await testClient.post<{ domain: { id: string } }>(
        "/api/domains",
        createDomainFixture({ hostname: "public.test.local" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        address: "10.0.0.10",
        port: 8080,
      }));

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "Public Route",
          pathPattern: "/*",
          protection: "public",
          policyConfig: {},
        })
      );

      const job = createMockJob({ reason: "test", triggeredBy: "route" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);
      expect(result.routesConfigured).toBe(1);

      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      expect(routes.length).toBe(1);
      expect(routes[0].from).toBe("https://public.test.local");
      expect(routes[0].allow_public_unauthenticated_access).toBe(true);
    });
  });

  describe("Protected route with email policy", () => {
    it("writes allowed_users when allowedUsers is configured", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      const domainRes = await testClient.post<{ domain: { id: string } }>(
        "/api/domains",
        createDomainFixture({ hostname: "admin.test.local" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        address: "10.0.0.20",
        port: 8080,
      }));

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "Admin Route",
          pathPattern: "/*",
          protection: "protected",
          policyConfig: {
            allowedUsers: ["admin@test.local"],
            passIdentityHeaders: true,
          },
        })
      );

      const job = createMockJob({ reason: "test", triggeredBy: "route" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);

      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      expect(routes.length).toBe(1);
      // Code generates PPL policy blocks with email conditions
      const policy = routes[0].policy as Array<{ allow: { or: Array<Record<string, unknown>> } }>;
      expect(policy).toBeDefined();
      const orConditions = policy?.[0]?.allow?.or ?? [];
      expect(orConditions.some((c) => (c.email as Record<string, string>)?.is === "admin@test.local")).toBe(true);
      expect(routes[0].pass_identity_headers).toBe(true);
    });
  });

  describe("Domain-restricted route", () => {
    it("writes allowed_domains when allowedDomains is configured", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      const domainRes = await testClient.post<{ domain: { id: string } }>(
        "/api/domains",
        createDomainFixture({ hostname: "internal.test.local" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        address: "10.0.0.30",
        port: 8080,
      }));

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "Internal Route",
          pathPattern: "/*",
          protection: "protected",
          policyConfig: {
            allowedDomains: ["company.test"],
            passIdentityHeaders: true,
          },
        })
      );

      const job = createMockJob({ reason: "test", triggeredBy: "route" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);

      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      expect(routes.length).toBe(1);
      // Code generates PPL policy blocks with email ends_with conditions
      const policy = routes[0].policy as Array<{ allow: { or: Array<Record<string, unknown>> } }>;
      expect(policy).toBeDefined();
      const orConditions = policy?.[0]?.allow?.or ?? [];
      expect(orConditions.some((c) => (c.email as Record<string, string>)?.ends_with === "@company.test")).toBe(true);
    });
  });

  describe("WebSocket route", () => {
    it("writes allow_websockets: true when websocketsEnabled is set", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      const domainRes = await testClient.post<{ domain: { id: string } }>(
        "/api/domains",
        createDomainFixture({ hostname: "ws.test.local" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        address: "10.0.0.40",
        port: 8080,
      }));

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "WebSocket Route",
          pathPattern: "/*",
          protection: "protected",
          policyConfig: {
            websocketsEnabled: true,
            passIdentityHeaders: true,
          },
        })
      );

      const job = createMockJob({ reason: "test", triggeredBy: "route" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);

      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      expect(routes.length).toBe(1);
      expect(routes[0].allow_websockets).toBe(true);
    });
  });

  describe("Disabled route excluded", () => {
    it("does not include disabled routes in generated YAML", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      const domainRes = await testClient.post<{ domain: { id: string } }>(
        "/api/domains",
        createDomainFixture({ hostname: "mixed.test.local" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        address: "10.0.0.50",
        port: 8080,
      }));

      // Create one enabled route
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "Enabled Route",
          pathPattern: "/*",
          protection: "public",
          enabled: true,
          policyConfig: {},
        })
      );

      // Create one disabled route
      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "Disabled Route",
          pathPattern: "/hidden/*",
          protection: "protected",
          enabled: false,
          policyConfig: {},
        })
      );

      const job = createMockJob({ reason: "test", triggeredBy: "route" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);
      expect(result.routesConfigured).toBe(1);

      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      expect(routes.length).toBe(1);
      expect(routes[0].allow_public_unauthenticated_access).toBe(true);
    });
  });

  describe("Disabled IdP excluded from global config", () => {
    it("does not set global idp_provider when only a disabled IdP exists", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      // Create a disabled OIDC IdP
      const idpRes = await testClient.post<{ idp: { id: string } }>(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture({
          name: "Disabled OIDC",
          enabled: false,
          isDefault: false,
        })
      );
      expect(idpRes.status).toBe(201);

      const domainRes = await testClient.post<{ domain: { id: string } }>(
        "/api/domains",
        createDomainFixture({ hostname: "noidp.test.local" })
      );
      expect(domainRes.status).toBe(201);
      const domainId = domainRes.body.domain.id;

      await testClient.post("/api/backends", createBackendFixture(domainId, {
        address: "10.0.0.60",
        port: 8080,
      }));

      await testClient.post(
        "/api/pomerium/routes",
        createPomeriumRouteFixture(domainId, {
          name: "Any Auth Route",
          pathPattern: "/*",
          protection: "protected",
          policyConfig: { passIdentityHeaders: true },
        })
      );

      const job = createMockJob({ reason: "test", triggeredBy: "idp" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);
      expect(result.idpsConfigured).toBe(0);

      const config = await readPomeriumConfig();
      // No enabled IdP → no global idp_provider field
      expect(config.idp_provider).toBeUndefined();
    });
  });

  describe("OIDC IdP in global config", () => {
    it("sets idp_provider, idp_client_id, idp_provider_url from enabled default IdP", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) {
        ctx.skip();
        return;
      }

      await enablePomerium();

      const idpRes = await testClient.post<{ idp: { id: string } }>(
        "/api/pomerium/idps",
        createPomeriumOidcIdpFixture({
          name: "Default OIDC",
          clientId: "pomerium-test",
          clientSecret: "pomerium-test-secret",
          issuerUrl: "http://test-dex:5556/dex",
          enabled: true,
          isDefault: true,
        })
      );
      expect(idpRes.status).toBe(201);

      const job = createMockJob({ reason: "test", triggeredBy: "idp" });
      const result = await processPomeriumConfig(job);

      expect(result.success).toBe(true);
      expect(result.idpsConfigured).toBe(1);

      const config = await readPomeriumConfig();
      expect(config.idp_provider).toBe("oidc");
      expect(config.idp_client_id).toBe("pomerium-test");
      expect(config.idp_provider_url).toBe("http://test-dex:5556/dex");
    });
  });
});
