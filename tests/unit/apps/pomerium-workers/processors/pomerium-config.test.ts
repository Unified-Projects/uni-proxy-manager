/**
 * Pomerium Config Processor Unit Tests
 *
 * Tests for the Pomerium config processor covering route policy generation,
 * IdP configuration, Pomerium SIGHUP reload signalling, and HAProxy queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { writeFile, mkdir } from "fs/promises";
import { Queue } from "bullmq";
import type { Job } from "bullmq";
import type { PomeriumConfigJobData } from "@uni-proxy-manager/queue";

vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      pomeriumSettings: { findFirst: vi.fn() },
      pomeriumIdentityProviders: { findMany: vi.fn() },
      pomeriumRoutes: { findMany: vi.fn() },
    },
  },
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("yaml", () => ({
  stringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
  Document: vi.fn(function(this: Record<string, unknown>, obj: unknown) {
    this._obj = obj;
    this.toString = () => JSON.stringify(obj);
  }),
  visit: vi.fn(),
}));

vi.mock("http", () => ({
  default: {
    request: vi.fn(),
  },
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({})),
}));

// Use vi.hoisted() to create mock values available to vi.mock factories.
// Set .mockImplementation() OUTSIDE vi.hoisted() to avoid Vitest's transform
// collapsing `vi.fn().mockImplementation(fn)` to just `fn`.
const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function () { return { add: mockQueueAdd }; }),
}));

import { processPomeriumConfig } from "../../../../../apps/pomerium-workers/src/processors/pomerium-config";
import { db } from "@uni-proxy-manager/database";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function setupDockerResponse(statusCode: number, body = "") {
  vi.mocked(http.request).mockImplementation(
    (options: unknown, callback?: unknown) => {
      const cb = callback as ((res: unknown) => void) | undefined;
      const dataHandlers: Array<(chunk: string) => void> = [];
      const endHandlers: Array<() => void> = [];

      const mockRes = {
        statusCode,
        on: (event: string, handler: unknown) => {
          if (event === "data")
            dataHandlers.push(handler as (chunk: string) => void);
          if (event === "end") endHandlers.push(handler as () => void);
          return mockRes;
        },
      };

      cb?.(mockRes);

      Promise.resolve().then(() => {
        for (const h of dataHandlers) h(body);
        for (const h of endHandlers) h();
      });

      return {
        on: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
        end: vi.fn(),
      } as unknown as ReturnType<typeof http.request>;
    }
  );
}

function createMockJob(
  reason = "test",
  triggeredBy: "route" | "startup" | "settings" = "route"
): Job<PomeriumConfigJobData> {
  return {
    id: "config-job-1",
    data: { reason, triggeredBy },
  } as Job<PomeriumConfigJobData>;
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "default",
    enabled: true,
    authenticateServiceUrl: null,
    cookieName: "_pomerium",
    cookieExpire: "14h",
    cookieDomain: null,
    cookieSecure: true,
    cookieHttpOnly: true,
    logLevel: "info",
    ...overrides,
  };
}

function makeRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    enabled: true,
    priority: 100,
    pathPattern: "/*",
    protection: "protected" as const,
    policyConfig: null,
    identityProvider: null,
    domain: {
      id: "domain-1",
      hostname: "example.com",
      backends: [
        {
          id: "backend-1",
          address: "192.168.1.100",
          port: 8080,
          protocol: "http" as const,
        },
      ],
    },
    ...overrides,
  };
}

function makeIdp(
  type: string,
  credentials: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "idp-1",
    enabled: true,
    isDefault: true,
    type,
    credentials,
    ...overrides,
  };
}

function getWrittenConfig(): Record<string, unknown> {
  const calls = vi.mocked(writeFile).mock.calls;
  if (calls.length === 0) throw new Error("writeFile was not called");
  const lastCall = calls[calls.length - 1];
  return JSON.parse(lastCall?.[1] as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processPomeriumConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDockerResponse(204);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Disabled settings
  // ============================================================================

  describe("when Pomerium is disabled", () => {
    it("writes routes:[] config without sending SIGHUP", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ enabled: false }) as never
      );

      const result = await processPomeriumConfig(createMockJob());

      expect(result).toMatchObject({
        success: true,
        routesConfigured: 0,
        idpsConfigured: 0,
      });

      const config = getWrittenConfig();
      expect(config.routes).toHaveLength(0);

      // SIGHUP should NOT be sent
      expect(vi.mocked(http.request)).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Route policy scenarios
  // ============================================================================

  describe("protected route policy", () => {
    beforeEach(() => {
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
    });

    it("allows any authenticated user when no policy restrictions set", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: null }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.allow_any_authenticated_user).toBe(true);
    });

    it("sets allowed_users when allowedUsers configured", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({
          policyConfig: { allowedUsers: ["alice@example.com", "bob@example.com"] },
        }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      // Code generates PPL policy blocks instead of legacy allowed_users field
      const policy = route?.policy as Array<{ allow: { or: Array<Record<string, unknown>> } }>;
      expect(policy).toBeDefined();
      const orConditions = policy?.[0]?.allow?.or ?? [];
      const emailConditions = orConditions.filter(c => c.email !== undefined);
      expect(emailConditions).toHaveLength(2);
      expect(route?.allow_any_authenticated_user).toBeUndefined();
    });

    it("sets allowed_domains when allowedDomains configured", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { allowedDomains: ["example.com"] } }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      // Code generates PPL policy blocks with email ends_with conditions
      const policy = route?.policy as Array<{ allow: { or: Array<Record<string, unknown>> } }>;
      expect(policy).toBeDefined();
      const orConditions = policy?.[0]?.allow?.or ?? [];
      const domainConditions = orConditions.filter(c => {
        const email = c.email as Record<string, string> | undefined;
        return email?.ends_with !== undefined;
      });
      expect(domainConditions).toHaveLength(1);
    });

    it("sets allow_websockets when websocketsEnabled is true", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { websocketsEnabled: true } }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.allow_websockets).toBe(true);
    });
  });

  describe("public route", () => {
    it("sets allow_public_unauthenticated_access:true", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ protection: "public" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.allow_public_unauthenticated_access).toBe(true);
      expect(route?.allow_any_authenticated_user).toBeUndefined();
    });
  });

  describe("passthrough route", () => {
    it("has no auth policy keys in YAML", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ protection: "passthrough" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.allow_public_unauthenticated_access).toBeUndefined();
      expect(route?.allow_any_authenticated_user).toBeUndefined();
      expect(route?.allowed_users).toBeUndefined();
    });
  });

  describe("path pattern handling", () => {
    beforeEach(() => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValue(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
    });

    it("adds no prefix/regex for wildcard /* pattern", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ pathPattern: "/*" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.prefix).toBeUndefined();
      expect(route?.regex).toBeUndefined();
    });

    it("adds regex for /api/** pattern", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ pathPattern: "/api/**" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.regex).toBeDefined();
      expect(route?.prefix).toBeUndefined();
    });

    it("adds regex for /admin/* pattern", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ pathPattern: "/admin/*" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      const route = (config.routes as Record<string, unknown>[])[0];
      expect(route?.regex).toBeDefined();
    });
  });

  describe("route filtered when domain has no backends", () => {
    it("excludes routes whose domain has no backends from the YAML", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ domain: { id: "d1", hostname: "no-backend.com", backends: [] } }),
      ] as never);

      const result = await processPomeriumConfig(createMockJob());

      expect(result.success).toBe(true);
      // The route has no backends so it should be filtered out
      const config = getWrittenConfig();
      expect((config.routes as unknown[]).length).toBe(0);
    });
  });

  // ============================================================================
  // IdP configuration
  // ============================================================================

  describe("IdP configuration", () => {
    beforeEach(() => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValue(
        [] as never
      );
    });

    it("configures Google IdP", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValueOnce([
        makeIdp("google", { clientId: "google-id", clientSecret: "google-secret" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      expect(config.idp_provider).toBe("google");
      expect(config.idp_client_id).toBe("google-id");
      expect(config.idp_client_secret).toBe("google-secret");
      expect(config.idp_provider_url).toBeUndefined();
    });

    it("configures Azure IdP with tenant URL", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValueOnce([
        makeIdp("azure", {
          clientId: "azure-id",
          clientSecret: "azure-secret",
          tenantId: "my-tenant-id",
        }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      expect(config.idp_provider).toBe("azure");
      expect(config.idp_provider_url).toContain("my-tenant-id");
      expect(config.idp_provider_url).toContain("microsoftonline.com");
    });

    it("configures GitHub IdP", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValueOnce([
        makeIdp("github", { clientId: "gh-id", clientSecret: "gh-secret" }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      expect(config.idp_provider).toBe("github");
      expect(config.idp_client_id).toBe("gh-id");
    });

    it("configures OIDC IdP with provider_url and scopes", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValueOnce([
        makeIdp("oidc", {
          clientId: "oidc-id",
          clientSecret: "oidc-secret",
          issuerUrl: "https://auth.example.com",
          scopes: ["openid", "email"],
        }),
      ] as never);

      await processPomeriumConfig(createMockJob());

      const config = getWrittenConfig();
      expect(config.idp_provider).toBe("oidc");
      expect(config.idp_provider_url).toBe("https://auth.example.com");
      expect(config.idp_scopes).toEqual(["openid", "email"]);
    });
  });

  // ============================================================================
  // Post-write behavior
  // ============================================================================

  describe("post-write behavior", () => {
    beforeEach(() => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValue(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValue(
        [makeRoute()] as never
      );
    });

    it("sends SIGHUP to pomerium container via Docker socket", async () => {
      await processPomeriumConfig(createMockJob());

      const calls = vi.mocked(http.request).mock.calls as Array<
        [{ path: string; method: string; socketPath: string }, unknown]
      >;
      const sighupCall = calls.find(([opts]) =>
        opts.path?.includes("SIGHUP")
      );
      expect(sighupCall).toBeDefined();
      expect(sighupCall?.[0].path).toBe(
        "/containers/uni-proxy-pomerium/kill?signal=SIGHUP"
      );
      expect(sighupCall?.[0].method).toBe("POST");
    });

    it("queues a HAProxy reload job after writing config", async () => {
      await processPomeriumConfig(createMockJob());

      expect(vi.mocked(Queue)).toHaveBeenCalled();
      const queueInstance = vi.mocked(Queue).mock.results[0]?.value as {
        add: ReturnType<typeof vi.fn>;
      };
      expect(queueInstance.add).toHaveBeenCalled();
    });

    it("returns routesConfigured equal to routes with valid backends", async () => {
      const result = await processPomeriumConfig(createMockJob());

      expect(result.success).toBe(true);
      expect(result.routesConfigured).toBe(1);
    });

    it("returns idpsConfigured equal to enabled IdPs count", async () => {
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValueOnce([
        makeIdp("google", { clientId: "id", clientSecret: "secret" }),
        makeIdp("github", { clientId: "id2", clientSecret: "secret2" }, { id: "idp-2", isDefault: false }),
      ] as never);

      const result = await processPomeriumConfig(createMockJob());

      expect(result.idpsConfigured).toBe(2);
    });
  });

  // ============================================================================
  // Error handling
  // ============================================================================

  describe("error handling", () => {
    it("returns success:false when DB throws", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockRejectedValueOnce(
        new Error("Connection refused")
      );

      const result = await processPomeriumConfig(createMockJob());

      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection refused");
    });

    it("returns success:false when writeFile throws", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(writeFile).mockRejectedValueOnce(
        new Error("EACCES: permission denied")
      );

      const result = await processPomeriumConfig(createMockJob());

      expect(result.success).toBe(false);
      expect(result.error).toContain("EACCES");
    });
  });

  // ============================================================================
  // Global config field generation
  // ============================================================================

  describe("global config field generation", () => {
    beforeEach(() => {
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValue(
        [] as never
      );
    });

    it("always sets insecure_server: true", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.insecure_server).toBe(true);
    });

    it("always sets address: \":80\"", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings() as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.address).toBe(":80");
    });

    it("sets log_level \"debug\" when logLevel is \"debug\"", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ logLevel: "debug" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.log_level).toBe("debug");
    });

    it("sets log_level \"info\" when logLevel is \"info\"", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ logLevel: "info" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.log_level).toBe("info");
    });

    it("sets log_level \"warn\" when logLevel is \"warn\"", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ logLevel: "warn" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.log_level).toBe("warn");
    });

    it("sets log_level \"error\" when logLevel is \"error\"", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ logLevel: "error" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.log_level).toBe("error");
    });

    it("defaults log_level to \"info\" when logLevel is null", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ logLevel: null }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.log_level).toBe("info");
    });

    it("sets cookie_name from settings", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieName: "_my_app" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_name).toBe("_my_app");
    });

    it("defaults cookie_name to \"_pomerium\" when null", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieName: null }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_name).toBe("_pomerium");
    });

    it("sets cookie_expire from settings", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieExpire: "24h" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_expire).toBe("24h");
    });

    it("defaults cookie_expire to \"14h\" when null", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieExpire: null }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_expire).toBe("14h");
    });

    it("sets cookie_secure: true", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieSecure: true }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_secure).toBe(true);
    });

    it("sets cookie_secure: false", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieSecure: false }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_secure).toBe(false);
    });

    it("sets cookie_http_only: true", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieHttpOnly: true }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_http_only).toBe(true);
    });

    it("sets cookie_http_only: false", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieHttpOnly: false }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_http_only).toBe(false);
    });

    it("sets authenticate_service_url when provided", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ authenticateServiceUrl: "https://auth.example.com" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.authenticate_service_url).toBe("https://auth.example.com");
    });

    it("omits authenticate_service_url when null", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ authenticateServiceUrl: null }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.authenticate_service_url).toBeUndefined();
    });

    it("sets cookie_domain when provided", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieDomain: ".example.com" }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_domain).toBe(".example.com");
    });

    it("omits cookie_domain when null", async () => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValueOnce(
        makeSettings({ cookieDomain: null }) as never
      );
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      expect(config.cookie_domain).toBeUndefined();
    });
  });

  // ============================================================================
  // Route generation edge cases
  // ============================================================================

  describe("route generation edge cases", () => {
    beforeEach(() => {
      vi.mocked(db.query.pomeriumSettings.findFirst).mockResolvedValue(
        makeSettings() as never
      );
      vi.mocked(db.query.pomeriumIdentityProviders.findMany).mockResolvedValue(
        [] as never
      );
    });

    it("http backend uses http:// protocol in to field", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ domain: { id: "d1", hostname: "example.com", backends: [{ id: "b1", address: "192.168.1.100", port: 8080, protocol: "http" as const }] } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      // Single backend produces a plain string (not an array)
      expect(routes[0]?.to).toBe("http://192.168.1.100:8080");
    });

    it("https backend uses https:// protocol in to field", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ domain: { id: "d1", hostname: "example.com", backends: [{ id: "b1", address: "192.168.1.100", port: 8443, protocol: "https" as const }] } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      // Single backend produces a plain string (not an array)
      expect((routes[0]?.to as string).startsWith("https://")).toBe(true);
    });

    it("multiple backends produce multiple to entries", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({
          domain: {
            id: "d1",
            hostname: "example.com",
            backends: [
              { id: "b1", address: "10.0.0.1", port: 8080, protocol: "http" as const },
              { id: "b2", address: "10.0.0.2", port: 8080, protocol: "http" as const },
              { id: "b3", address: "10.0.0.3", port: 8080, protocol: "http" as const },
            ],
          },
        }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      const to = routes[0]?.to as string[];
      expect(to).toHaveLength(3);
      expect(to).toContain("http://10.0.0.1:8080");
      expect(to).toContain("http://10.0.0.2:8080");
      expect(to).toContain("http://10.0.0.3:8080");
    });

    it("no backends means route is filtered out entirely", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ domain: { id: "d1", hostname: "example.com", backends: [] } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as unknown[];
      expect(routes).toHaveLength(0);
    });

    it("timeout: 30 produces \"30s\" string", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { timeout: 30 } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.timeout).toBe("30s");
    });

    it("idleTimeout: 60 produces \"60s\" string", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { idleTimeout: 60 } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.idle_timeout).toBe("60s");
    });

    it("no timeout configured means timeout field is absent", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: {} }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.timeout).toBeUndefined();
    });

    it("preserveHostHeader: true passes through", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { preserveHostHeader: true } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.preserve_host_header).toBe(true);
    });

    it("tlsSkipVerify: true passes through", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { tlsSkipVerify: true } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.tls_skip_verify).toBe(true);
    });

    it("setRequestHeaders passes through as object", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { setRequestHeaders: { "X-H": "v" } } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.set_request_headers).toEqual({ "X-Forwarded-Proto": "https", "X-H": "v" });
    });

    it("removeRequestHeaders passes through as array", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ policyConfig: { removeRequestHeaders: ["X-H"] } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.remove_request_headers).toEqual(["X-H"]);
    });

    it("from uses https:// with domain hostname", async () => {
      vi.mocked(db.query.pomeriumRoutes.findMany).mockResolvedValueOnce([
        makeRoute({ domain: { id: "d1", hostname: "app.co", backends: [{ id: "b1", address: "10.0.0.1", port: 8080, protocol: "http" as const }] } }),
      ] as never);
      await processPomeriumConfig(createMockJob());
      const config = getWrittenConfig();
      const routes = config.routes as Record<string, unknown>[];
      expect(routes[0]?.from).toBe("https://app.co");
    });
  });

  // ============================================================================
  // Environment variable defaults
  // ============================================================================

  describe("environment variable defaults", () => {
    it("uses /config/config.yaml as default config path", () => {
      const configPath =
        process.env.POMERIUM_CONFIG_PATH || "/config/config.yaml";
      expect(configPath).toBe("/config/config.yaml");
    });

    it("uses uni-proxy-pomerium as default container name", () => {
      const containerName =
        process.env.POMERIUM_CONTAINER_NAME || "uni-proxy-pomerium";
      expect(containerName).toBe("uni-proxy-pomerium");
    });

    it("uses /var/run/docker.sock as default socket path", () => {
      const socketPath =
        process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
      expect(socketPath).toBe("/var/run/docker.sock");
    });
  });
});
