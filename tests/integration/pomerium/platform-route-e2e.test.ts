/**
 * Pomerium Platform Route E2E Tests
 *
 * Tests the complete platform pipeline end-to-end:
 *   1. Create domain + backend via the platform API
 *   2. Configure a Dex OIDC identity provider via the platform API
 *   3. Create a Pomerium route protecting that domain via the platform API
 *   4. Run processPomeriumConfig to generate and write the Pomerium config
 *   5. Wait for Pomerium to reload the config (SIGHUP via Docker socket)
 *   6. Verify unauthenticated access → OAuth redirect, not 503
 *   7. Verify allowed user can reach the route
 *   8. Verify non-allowed user is denied
 *
 * Config generation tests skip when POMERIUM_CONFIG_PATH is not set.
 * HTTP tests skip when Pomerium or Dex containers are not healthy.
 * When the infrastructure IS available, tests fail hard on any misbehaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "fs/promises";
import * as yaml from "yaml";
import type { Job } from "bullmq";
import type { PomeriumConfigJobData } from "@uni-proxy-manager/queue";
import { testClient } from "../setup/test-client";
import { clearDatabase, closeTestDb } from "../setup/test-db";
import { dexClient, TEST_USERS } from "../setup/dex-client";
import { pomeriumClient } from "../setup/pomerium-client";
import { createDomainFixture, createBackendFixture } from "../setup/fixtures";
import { createPomeriumOidcIdpFixture } from "../setup/pomerium-fixtures";
import { processPomeriumConfig } from "../../../apps/pomerium-workers/src/processors/pomerium-config";

const POMERIUM_CONFIG_PATH = process.env.POMERIUM_CONFIG_PATH;
const DEX_ISSUER_URL =
  process.env.DEX_ISSUER_URL || "http://test-dex:5556/dex";
const POMERIUM_INTERNAL_URL =
  process.env.POMERIUM_INTERNAL_URL || "http://test-pomerium:80";

const E2E_HOSTNAME = "e2e-platform.test.local";
const RELOAD_TIMEOUT_MS = 15_000;
const RELOAD_POLL_INTERVAL_MS = 1_000;

function createMockJob(data: PomeriumConfigJobData): Job<PomeriumConfigJobData> {
  return {
    id: "e2e-test-job",
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
 * Poll until Pomerium starts routing the hostname (not 503/404).
 * Returns true if it picked up the route within the timeout, false otherwise.
 */
async function waitForRouteReload(hostname: string): Promise<boolean> {
  const deadline = Date.now() + RELOAD_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${POMERIUM_INTERNAL_URL}/`, {
        redirect: "manual",
        headers: { Host: hostname },
        signal: AbortSignal.timeout(3000),
      });

      if (response.status !== 503 && response.status !== 404) {
        return true;
      }
    } catch {
      // Network error — keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, RELOAD_POLL_INTERVAL_MS));
  }

  return false;
}

describe("Pomerium Platform Route E2E", () => {
  let isDexHealthy = false;
  let isPomeriumHealthy = false;
  let pomeriumPickedUpRoute = false;
  let configResult: Awaited<ReturnType<typeof processPomeriumConfig>>;

  beforeAll(async () => {
    await clearDatabase();

    // Health checks — non-throwing, tests skip individually based on these
    try { isDexHealthy = await dexClient.isHealthy(); } catch { isDexHealthy = false; }
    try { isPomeriumHealthy = await pomeriumClient.isHealthy(); } catch { isPomeriumHealthy = false; }

    // Platform setup — always runs so config-generation tests work without live Pomerium
    const domainRes = await testClient.post(
      "/api/domains",
      createDomainFixture({ hostname: E2E_HOSTNAME })
    );
    if (domainRes.status !== 201) {
      throw new Error(`Failed to create domain: ${JSON.stringify(domainRes.body)}`);
    }
    const domainId: string = domainRes.body.domain.id;

    const backendRes = await testClient.post(
      "/api/backends",
      createBackendFixture(domainId, { address: "10.0.1.100", port: 8080 })
    );
    if (backendRes.status !== 201) {
      throw new Error(`Failed to create backend: ${JSON.stringify(backendRes.body)}`);
    }

    const settingsRes = await testClient.put("/api/pomerium/settings", {
      enabled: true,
      authenticateServiceUrl: POMERIUM_INTERNAL_URL,
      cookieSecure: false,
    });
    if (settingsRes.status !== 200) {
      throw new Error(`Failed to update settings: ${JSON.stringify(settingsRes.body)}`);
    }

    const idpRes = await testClient.post(
      "/api/pomerium/idps",
      createPomeriumOidcIdpFixture({
        name: "E2E Dex OIDC",
        clientId: "pomerium-e2e",
        clientSecret: "pomerium-e2e-secret",
        issuerUrl: DEX_ISSUER_URL,
        enabled: true,
        isDefault: true,
      })
    );
    if (idpRes.status !== 201) {
      throw new Error(`Failed to create IdP: ${JSON.stringify(idpRes.body)}`);
    }

    const routeRes = await testClient.post("/api/pomerium/routes", {
      name: "E2E Admin Route",
      domainId,
      pathPattern: "/*",
      protection: "protected",
      policyConfig: {
        allowedUsers: [TEST_USERS.admin.email],
        passIdentityHeaders: true,
      },
      priority: 100,
      enabled: true,
    });
    if (routeRes.status !== 201) {
      throw new Error(`Failed to create route: ${JSON.stringify(routeRes.body)}`);
    }

    // Generate config (writes file + sends SIGHUP if Docker socket available)
    configResult = await processPomeriumConfig(
      createMockJob({ reason: "e2e test", triggeredBy: "test" })
    );

    // Wait for Pomerium to reload — only if it's running
    if (isPomeriumHealthy) {
      pomeriumPickedUpRoute = await waitForRouteReload(E2E_HOSTNAME);
    }
  });

  afterAll(async () => {
    pomeriumClient.clearSessionCache();
    dexClient.clearCache();
    await closeTestDb();
  });

  // ============================================================================
  // Config generation — skips when POMERIUM_CONFIG_PATH is not set
  // ============================================================================

  describe("config generation", () => {
    it("processPomeriumConfig succeeds", (ctx) => {
      if (!POMERIUM_CONFIG_PATH) ctx.skip();
      expect(configResult.success).toBe(true);
    });

    it("configures exactly 1 route and 1 IdP", (ctx) => {
      if (!POMERIUM_CONFIG_PATH) ctx.skip();
      expect(configResult.routesConfigured).toBe(1);
      expect(configResult.idpsConfigured).toBe(1);
    });

    it("writes the correct from URL for the domain hostname", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) ctx.skip();
      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      const route = routes.find((r) => (r.from as string)?.includes(E2E_HOSTNAME));
      expect(route, `No route with from: https://${E2E_HOSTNAME}`).toBeDefined();
      expect(route!.from).toBe(`https://${E2E_HOSTNAME}`);
    });

    it("writes allowed_users containing the admin email", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) ctx.skip();
      const config = await readPomeriumConfig();
      const routes = config.routes as Array<Record<string, unknown>>;
      const route = routes.find((r) => (r.from as string)?.includes(E2E_HOSTNAME));
      expect(route).toBeDefined();
      // Code generates PPL policy blocks with email conditions
      const policy = route!.policy as Array<{ allow: { or: Array<Record<string, unknown>> } }>;
      expect(policy).toBeDefined();
      const orConditions = policy?.[0]?.allow?.or ?? [];
      expect(orConditions.some((c) => (c.email as Record<string, string>)?.is === TEST_USERS.admin.email)).toBe(true);
    });

    it("writes idp_provider: oidc pointing to Dex", async (ctx) => {
      if (!POMERIUM_CONFIG_PATH) ctx.skip();
      const config = await readPomeriumConfig();
      expect(config.idp_provider).toBe("oidc");
      expect(config.idp_provider_url).toBe(DEX_ISSUER_URL);
      expect(config.idp_client_id).toBe("pomerium-e2e");
    });
  });

  // ============================================================================
  // HTTP behaviour — skips when Pomerium/Dex not available or route not loaded
  // ============================================================================

  describe("route protection via Pomerium", () => {
    it("Pomerium picked up the new route after config reload", (ctx) => {
      if (!isPomeriumHealthy) ctx.skip();
      expect(
        pomeriumPickedUpRoute,
        `Pomerium did not serve ${E2E_HOSTNAME} within ${RELOAD_TIMEOUT_MS}ms`
      ).toBe(true);
    });

    it("unauthenticated request → OAuth redirect, not 503", async (ctx) => {
      if (!isPomeriumHealthy || !pomeriumPickedUpRoute) ctx.skip();

      const response = await fetch(`${POMERIUM_INTERNAL_URL}/`, {
        redirect: "manual",
        headers: { Host: E2E_HOSTNAME },
      });

      expect(response.status).not.toBe(503);

      const isAuthResponse =
        response.status === 302 ||
        response.status === 303 ||
        response.status === 401 ||
        response.status === 403;
      expect(isAuthResponse, `Expected auth response but got ${response.status}`).toBe(true);

      if (response.status === 302 || response.status === 303) {
        const location = response.headers.get("Location") ?? "";
        const isOAuthRedirect =
          location.includes("authenticate") ||
          location.includes("oauth2") ||
          location.includes("dex") ||
          location.includes(".pomerium");
        expect(isOAuthRedirect, `Location "${location}" is not an OAuth redirect`).toBe(true);
      }
    });

    it("allowed user (admin) has access", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy || !pomeriumPickedUpRoute) ctx.skip();

      const result = await pomeriumClient.testPolicyEnforcement(
        E2E_HOSTNAME,
        TEST_USERS.admin,
        { allowedEmails: [TEST_USERS.admin.email] }
      );
      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it("non-allowed user (regular user) is denied", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy || !pomeriumPickedUpRoute) ctx.skip();

      const result = await pomeriumClient.testPolicyEnforcement(
        E2E_HOSTNAME,
        TEST_USERS.user,
        { allowedEmails: [TEST_USERS.admin.email] }
      );
      expect(result.authenticated).toBe(true);
      expect(result.hasAccess).toBe(false);
    });

    it("allowed user has JWT identity headers", async (ctx) => {
      if (!isDexHealthy || !isPomeriumHealthy || !pomeriumPickedUpRoute) ctx.skip();

      const headers = await pomeriumClient.getAuthHeaders(TEST_USERS.admin);
      expect(headers["X-Pomerium-Claim-Email"]).toBe(TEST_USERS.admin.email);
      expect(headers["X-Pomerium-Jwt-Assertion"]).toBeDefined();
      expect(headers["X-Pomerium-Jwt-Assertion"].split(".")).toHaveLength(3);
    });
  });

  // ============================================================================
  // Platform API consistency — always runs
  // ============================================================================

  describe("platform API consistency", () => {
    it("GET /api/pomerium/routes returns the e2e route", async () => {
      const response = await testClient.get("/api/pomerium/routes");
      expect(response.status).toBe(200);
      const routes = response.body.routes as Array<Record<string, unknown>>;
      const route = routes.find((r) => {
        const pc = r.policyConfig as { allowedUsers?: string[] } | null;
        return pc?.allowedUsers?.includes(TEST_USERS.admin.email);
      });
      expect(route, "Route with admin allowedUsers not found").toBeDefined();
    });

    it("GET /api/pomerium/idps returns the Dex OIDC IdP as default", async () => {
      const response = await testClient.get("/api/pomerium/idps");
      expect(response.status).toBe(200);
      const idps = response.body.identityProviders as Array<Record<string, unknown>>;
      const defaultIdp = idps.find((idp) => idp.isDefault === true);
      expect(defaultIdp, "No default IdP found").toBeDefined();
      expect(defaultIdp!.type).toBe("oidc");
    });

    it("GET /api/pomerium/settings shows enabled: true", async () => {
      const response = await testClient.get("/api/pomerium/settings");
      expect(response.status).toBe(200);
      expect(response.body.settings.enabled).toBe(true);
    });
  });
});
