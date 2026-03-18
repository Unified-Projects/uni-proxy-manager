/**
 * HAProxy Template Unit Tests
 *
 * Tests for the HAProxy configuration template generation utilities.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeIdentifier,
  getDefaultGlobalConfig,
  getDefaultDefaultsConfig,
  generateHAProxyConfig,
  renderHAProxyConfig,
  generateHAProxyConfigString,
  generatePomeriumBackend,
  generateSitesLookupBackend,
  generateHAProxyConfigWithSites,
  generateHAProxyConfigWithPomerium,
  generateCompleteHAProxyConfig,
} from "../../../../packages/shared/src/haproxy/template";
import type {
  DomainConfig,
  SiteConfig,
  SitesExecutorConfig,
  PomeriumConfig,
  HAProxyConfig,
} from "../../../../packages/shared/src/haproxy/types";

// Mock the env module
vi.mock("../../../../packages/shared/src/config/env", () => ({
  getStatsConfig: vi.fn().mockReturnValue({
    user: "admin",
    password: "secret123",
  }),
}));

describe("HAProxy Template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // sanitizeIdentifier Tests
  // ============================================================================

  describe("sanitizeIdentifier", () => {
    it("should convert to lowercase", () => {
      expect(sanitizeIdentifier("EXAMPLE")).toBe("example");
      expect(sanitizeIdentifier("ExAmPlE")).toBe("example");
    });

    it("should replace dots with underscores", () => {
      expect(sanitizeIdentifier("example.com")).toBe("example_com");
      expect(sanitizeIdentifier("sub.example.com")).toBe("sub_example_com");
    });

    it("should replace special characters with underscores", () => {
      expect(sanitizeIdentifier("test@domain!")).toBe("test_domain_");
      expect(sanitizeIdentifier("a#b$c%d")).toBe("a_b_c_d");
    });

    it("should preserve alphanumeric, underscore and hyphen", () => {
      expect(sanitizeIdentifier("test-name_123")).toBe("test-name_123");
      expect(sanitizeIdentifier("my-domain")).toBe("my-domain");
    });

    it("should handle empty string", () => {
      expect(sanitizeIdentifier("")).toBe("");
    });

    it("should handle complex hostnames", () => {
      expect(sanitizeIdentifier("api.v2.example.com")).toBe("api_v2_example_com");
    });
  });

  // ============================================================================
  // Default Config Tests
  // ============================================================================

  describe("getDefaultGlobalConfig", () => {
    it("should return default global configuration", () => {
      const config = getDefaultGlobalConfig();

      expect(config.maxConnections).toBe(4096);
      expect(config.logFormat).toBe("raw");
      expect(config.statsSocket).toContain("/var/run/haproxy/haproxy.sock");
    });

    it("should include admin mode in stats socket", () => {
      const config = getDefaultGlobalConfig();

      expect(config.statsSocket).toContain("level admin");
    });
  });

  describe("getDefaultDefaultsConfig", () => {
    it("should return default defaults configuration", () => {
      const config = getDefaultDefaultsConfig();

      expect(config.mode).toBe("http");
      expect(config.connectTimeout).toBe("5s");
      expect(config.clientTimeout).toBe("50s");
      expect(config.serverTimeout).toBe("50s");
      expect(config.httpKeepAlive).toBe(true);
    });
  });

  // ============================================================================
  // generateHAProxyConfig Tests
  // ============================================================================

  describe("generateHAProxyConfig", () => {
    const createDomain = (overrides: Partial<DomainConfig> = {}): DomainConfig => ({
      id: "domain-1",
      hostname: "example.com",
      sslEnabled: false,
      forceHttps: false,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      backends: [
        {
          id: "backend-1",
          name: "Primary",
          backendType: "static",
          address: "192.168.1.100",
          port: 8080,
          protocol: "http",
          siteId: null,
          weight: 100,
          healthCheckEnabled: true,
          healthCheckPath: "/health",
          healthCheckInterval: 5,
          healthCheckTimeout: 2,
          healthCheckFall: 3,
          healthCheckRise: 2,
          enabled: true,
          isBackup: false,
        },
      ],
      ...overrides,
    });

    it("should generate config with HTTP frontend", () => {
      const domains = [createDomain()];
      const config = generateHAProxyConfig(domains);

      expect(config.frontends).toHaveLength(1);
      expect(config.frontends[0]?.name).toBe("http_front");
      expect(config.frontends[0]?.binds[0]?.port).toBe(80);
    });

    it("should generate config with HTTPS frontend when SSL is enabled", () => {
      const domains = [
        createDomain({
          sslEnabled: true,
          certificatePath: "/certs/example.com.pem",
        }),
      ];
      const config = generateHAProxyConfig(domains);

      expect(config.frontends).toHaveLength(2);
      const httpsFrontend = config.frontends.find(f => f.name === "https_front");
      expect(httpsFrontend).toBeDefined();
      expect(httpsFrontend?.binds[0]?.port).toBe(443);
      expect(httpsFrontend?.binds[0]?.ssl).toBe(true);
    });

    it("should add HTTPS redirect for forceHttps domains", () => {
      const domains = [
        createDomain({
          sslEnabled: true,
          forceHttps: true,
          certificatePath: "/certs/example.com.pem",
        }),
      ];
      const config = generateHAProxyConfig(domains);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.httpRequestRules?.some(r => r.includes("redirect scheme https"))).toBe(true);
    });

    it("should generate backend with servers", () => {
      const domains = [createDomain()];
      const config = generateHAProxyConfig(domains);

      const backend = config.backends.find(b => b.name === "backend_example_com");
      expect(backend).toBeDefined();
      expect(backend?.servers).toHaveLength(1);
      expect(backend?.servers[0]?.address).toBe("192.168.1.100");
      expect(backend?.servers[0]?.port).toBe(8080);
    });

    it("should generate maintenance backend when enabled", () => {
      const domains = [
        createDomain({
          maintenanceEnabled: true,
          maintenancePagePath: "/error-pages/maintenance.html",
        }),
      ];
      const config = generateHAProxyConfig(domains);

      const maintenanceBackend = config.backends.find(b => b.name === "maintenance_example_com");
      expect(maintenanceBackend).toBeDefined();
    });

    it("should handle maintenance bypass IPs", () => {
      const domains = [
        createDomain({
          maintenanceEnabled: true,
          maintenancePagePath: "/error-pages/maintenance.html",
          maintenanceBypassIps: ["192.168.1.1", "10.0.0.0/8"],
        }),
      ];
      const config = generateHAProxyConfig(domains);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.acls.some(a => a.name.includes("bypass"))).toBe(true);
    });

    it("should include fallback backend", () => {
      const domains = [createDomain()];
      const config = generateHAProxyConfig(domains);

      const fallbackBackend = config.backends.find(b => b.name === "fallback_backend");
      expect(fallbackBackend).toBeDefined();
    });

    it("should skip domains without valid backends", () => {
      const domains = [
        createDomain({
          backends: [], // No backends
        }),
      ];
      const config = generateHAProxyConfig(domains);

      // Should not have a backend for this domain
      const domainBackend = config.backends.find(b => b.name === "backend_example_com");
      expect(domainBackend).toBeUndefined();
    });

    it("should handle multiple domains", () => {
      const domains = [
        createDomain({ id: "domain-1", hostname: "example.com" }),
        createDomain({ id: "domain-2", hostname: "api.example.com" }),
      ];
      const config = generateHAProxyConfig(domains);

      expect(config.backends.filter(b => b.name.startsWith("backend_"))).toHaveLength(2);
    });
  });

  // ============================================================================
  // renderHAProxyConfig Tests
  // ============================================================================

  describe("renderHAProxyConfig", () => {
    it("should render global section", () => {
      const config: HAProxyConfig = {
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [],
      };

      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("global");
      expect(rendered).toContain("maxconn 4096");
      expect(rendered).toContain("stats socket");
    });

    it("should render defaults section", () => {
      const config: HAProxyConfig = {
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [],
      };

      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("defaults");
      expect(rendered).toContain("mode http");
      expect(rendered).toContain("timeout connect 5s");
    });

    it("should render stats frontend with authentication", () => {
      const config: HAProxyConfig = {
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [],
      };

      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("frontend stats");
      expect(rendered).toContain("bind *:8404");
      expect(rendered).toContain("stats auth admin:secret123");
    });

    it("should render frontends with ACLs and use_backend", () => {
      const config: HAProxyConfig = {
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [
          {
            name: "http_front",
            mode: "http",
            binds: [{ address: "*", port: 80 }],
            acls: [{ name: "host_example", condition: "hdr(host) -i example.com" }],
            useBackends: [{ backendName: "backend_example", condition: "host_example" }],
            defaultBackend: "fallback_backend",
          },
        ],
        backends: [],
      };

      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("frontend http_front");
      expect(rendered).toContain("bind *:80");
      expect(rendered).toContain("acl host_example hdr(host) -i example.com");
      expect(rendered).toContain("use_backend backend_example if host_example");
    });

    it("should render backends with servers", () => {
      const config: HAProxyConfig = {
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [
          {
            name: "backend_example",
            mode: "http",
            loadBalanceMethod: "roundrobin",
            servers: [
              {
                name: "srv1",
                address: "192.168.1.100",
                port: 8080,
                weight: 100,
                healthCheck: {
                  enabled: true,
                  path: "/health",
                  interval: 5,
                  timeout: 2,
                  fall: 3,
                  rise: 2,
                },
              },
            ],
          },
        ],
      };

      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("backend backend_example");
      expect(rendered).toContain("balance roundrobin");
      expect(rendered).toContain("server srv1 192.168.1.100:8080 weight 100 check inter 5s fall 3 rise 2");
    });
  });

  // ============================================================================
  // Pomerium Backend Tests
  // ============================================================================

  describe("generatePomeriumBackend", () => {
    it("should generate backend with default values", () => {
      const backend = generatePomeriumBackend();

      expect(backend.name).toBe("pomerium_backend");
      expect(backend.mode).toBe("http");
      expect(backend.servers).toHaveLength(1);
      expect(backend.servers[0]?.name).toBe("pomerium");
    });

    it("should parse HTTP URL", () => {
      const backend = generatePomeriumBackend("http://pomerium:8080");

      expect(backend.servers[0]?.address).toBe("pomerium");
      expect(backend.servers[0]?.port).toBe(8080);
    });

    it("should parse HTTPS URL", () => {
      const backend = generatePomeriumBackend("https://pomerium.example.com");

      expect(backend.servers[0]?.address).toBe("pomerium.example.com");
      expect(backend.servers[0]?.port).toBe(443);
    });

    it("should use hostname directly without protocol", () => {
      const backend = generatePomeriumBackend("pomerium");

      expect(backend.servers[0]?.address).toBe("pomerium");
      expect(backend.servers[0]?.port).toBe(80);
    });

    it("should include health check configuration", () => {
      const backend = generatePomeriumBackend();

      expect(backend.httpCheck?.path).toBe("/.pomerium/ping");
      expect(backend.httpCheck?.expectStatus).toBe("200-499");
    });
  });

  // ============================================================================
  // Sites Lookup Backend Tests
  // ============================================================================

  describe("generateSitesLookupBackend", () => {
    it("should generate sites-lookup backend", () => {
      const backend = generateSitesLookupBackend();

      expect(backend.name).toBe("sites_lookup_backend");
      expect(backend.servers[0]?.address).toBe("sites-lookup");
      expect(backend.servers[0]?.port).toBe(3002);
    });

    it("should include health check", () => {
      const backend = generateSitesLookupBackend();

      expect(backend.httpCheck?.path).toBe("/health");
    });
  });

  // ============================================================================
  // generateHAProxyConfigWithSites Tests
  // ============================================================================

  describe("generateHAProxyConfigWithSites", () => {
    const createSite = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
      id: "site-1",
      slug: "my-site",
      hostname: "site.example.com",
      sslEnabled: false,
      activeSlot: "blue",
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      ...overrides,
    });

    const executorConfig: SitesExecutorConfig = {
      endpoint: "http://executor:80",
      port: 80,
      secret: "secret",
    };

    it("should add sites-lookup backend when sites exist", () => {
      const sites = [createSite()];
      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      const lookupBackend = config.backends.find(b => b.name === "sites_lookup_backend");
      expect(lookupBackend).toBeDefined();
    });

    it("should route site traffic to sites-lookup backend", () => {
      const sites = [createSite()];
      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.useBackends.some(u => u.backendName === "sites_lookup_backend")).toBe(true);
    });

    it("should add HTTPS redirect for SSL-enabled sites", () => {
      const sites = [createSite({ sslEnabled: true })];
      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.httpRequestRules?.some(r => r.includes("redirect scheme https"))).toBe(true);
    });

    it("should create HTTPS frontend for SSL sites", () => {
      const sites = [createSite({ sslEnabled: true })];
      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      const httpsFrontend = config.frontends.find(f => f.name === "https_front");
      expect(httpsFrontend).toBeDefined();
    });

    it("should handle site maintenance mode", () => {
      const sites = [
        createSite({
          maintenanceEnabled: true,
          maintenancePagePath: "/maintenance.html",
        }),
      ];
      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      const maintenanceBackend = config.backends.find(b => b.name === "site_maintenance_site-1");
      expect(maintenanceBackend).toBeDefined();
    });

    it("should filter out domain backends when a site handles the same hostname", () => {
      const domain: DomainConfig = {
        id: "domain-1",
        hostname: "site.example.com", // Same as site hostname
        sslEnabled: false,
        forceHttps: false,
        maintenanceEnabled: false,
        maintenanceBypassIps: [],
        backends: [
          {
            id: "backend-1",
            name: "Primary",
            backendType: "static",
            address: "192.168.1.100",
            port: 8080,
            protocol: "http",
            siteId: null,
            weight: 100,
            healthCheckEnabled: false,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
            enabled: true,
            isBackup: false,
          },
        ],
      };

      const sites = [createSite()];
      const config = generateHAProxyConfigWithSites([domain], sites, executorConfig);

      // When a site handles the same hostname, the domain is filtered out
      // and routed through the sites-lookup backend instead.
      const domainBackend = config.backends.find(b => b.name === "backend_site_example_com");
      expect(domainBackend).toBeUndefined();

      // The sites-lookup backend should handle the hostname
      const sitesLookup = config.backends.find(b => b.name === "sites_lookup_backend");
      expect(sitesLookup).toBeDefined();
    });
  });

  // ============================================================================
  // generateHAProxyConfigWithPomerium Tests
  // ============================================================================

  describe("generateHAProxyConfigWithPomerium", () => {
    const createDomain = (): DomainConfig => ({
      id: "domain-1",
      hostname: "example.com",
      sslEnabled: false,
      forceHttps: false,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      backends: [
        {
          id: "backend-1",
          name: "Primary",
          backendType: "static",
          address: "192.168.1.100",
          port: 8080,
          protocol: "http",
          siteId: null,
          weight: 100,
          healthCheckEnabled: false,
          healthCheckPath: "/health",
          healthCheckInterval: 5,
          healthCheckTimeout: 2,
          healthCheckFall: 3,
          healthCheckRise: 2,
          enabled: true,
          isBackup: false,
        },
      ],
    });

    it("should add Pomerium backend when enabled", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            name: "Admin Route",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const pomeriumBackend = config.backends.find(b => b.name === "pomerium_backend");
      expect(pomeriumBackend).toBeDefined();
    });

    it("should not add Pomerium backend when disabled", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: false,
        internalUrl: "http://pomerium:80",
        routes: [],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const pomeriumBackend = config.backends.find(b => b.name === "pomerium_backend");
      expect(pomeriumBackend).toBeUndefined();
    });

    it("should add ACL for protected routes", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            name: "Admin Route",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.acls.some(a => a.name.includes("pomerium"))).toBe(true);
    });

    it("protected route generates use_backend entry pointing to pomerium_backend", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            name: "Protected",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(
        httpFrontend?.useBackends.some(u => u.backendName === "pomerium_backend")
      ).toBe(true);
    });

    it("public route does NOT generate a Pomerium ACL", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-pub",
            name: "Public",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/*",
            protection: "public",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.acls.some(a => a.name.includes("pomerium"))).toBe(false);
      expect(
        httpFrontend?.useBackends.some(u => u.backendName === "pomerium_backend")
      ).toBe(false);
    });

    it("passthrough route does NOT generate a Pomerium ACL", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-pt",
            name: "Passthrough",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/*",
            protection: "passthrough",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.acls.some(a => a.name.includes("pomerium"))).toBe(false);
    });

    it("disabled route does NOT generate a Pomerium ACL", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-disabled",
            name: "Disabled",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/secret/*",
            protection: "protected",
            enabled: false,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend?.acls.some(a => a.name.includes("pomerium"))).toBe(false);
    });

    it("wildcard path /* generates only a host ACL (no path ACL)", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-wild",
            name: "Wildcard",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/*",
            protection: "protected",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const pomeriumAcls = httpFrontend?.acls.filter(a => a.name.includes("pomerium")) ?? [];

      // Protected routes always generate: route host ACL + internal host ACL + internal path ACL
      // The wildcard /* should NOT produce a route-level path_reg ACL
      expect(pomeriumAcls.some(a => a.condition.includes("hdr(host)"))).toBe(true);
      // No path_reg for the route itself — only the internal /.pomerium/ path_beg is present
      const pathRegAcls = pomeriumAcls.filter(a => a.condition.includes("path_reg"));
      expect(pathRegAcls).toHaveLength(0);
      // The internal /.pomerium/ catch-all path ACL should be present
      expect(pomeriumAcls.some(a => a.condition.includes("path_beg") && a.condition.includes("/.pomerium/"))).toBe(true);
    });

    it("specific path /admin/* generates both host and path ACLs", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-admin",
            name: "Admin",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const pomeriumAcls = httpFrontend?.acls.filter(a => a.name.includes("pomerium")) ?? [];

      // Should have a host ACL and a path ACL
      expect(pomeriumAcls.length).toBeGreaterThanOrEqual(2);
      expect(pomeriumAcls.some(a => a.condition.includes("hdr(host)"))).toBe(true);
      expect(pomeriumAcls.some(a => a.condition.includes("path_reg"))).toBe(true);
    });

    it("routes with lower priority number appear first in the use_backends list", () => {
      // In HAProxy config generation, routes are sorted descending by priority value
      // then unshifted, meaning the route with the lowest priority *number* ends up
      // first (highest precedence) in the use_backend list.
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-low-num",
            name: "Low priority number (high precedence)",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/low/*",
            protection: "protected",
            enabled: true,
            priority: 10,
          },
          {
            id: "route-high-num",
            name: "High priority number (low precedence)",
            domainId: "domain-1",
            hostname: "example.com",
            pathPattern: "/high/*",
            protection: "protected",
            enabled: true,
            priority: 200,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([createDomain()], pomeriumConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const pomeriumUseBackends = httpFrontend?.useBackends.filter(
        u => u.backendName === "pomerium_backend"
      ) ?? [];

      // Both routes should produce use_backend entries
      expect(pomeriumUseBackends.length).toBeGreaterThanOrEqual(2);

      // Route with lower priority number (10) appears before route with higher number (200)
      const lowNumIndex = pomeriumUseBackends.findIndex(u =>
        u.condition?.includes(sanitizeIdentifier("route-low-num"))
      );
      const highNumIndex = pomeriumUseBackends.findIndex(u =>
        u.condition?.includes(sanitizeIdentifier("route-high-num"))
      );
      expect(lowNumIndex).toBeLessThan(highNumIndex);
    });
  });

  // ============================================================================
  // generateCompleteHAProxyConfig Tests
  // ============================================================================

  describe("generateCompleteHAProxyConfig", () => {
    it("should generate config with domains only", () => {
      const domain: DomainConfig = {
        id: "domain-1",
        hostname: "example.com",
        sslEnabled: false,
        forceHttps: false,
        maintenanceEnabled: false,
        maintenanceBypassIps: [],
        backends: [
          {
            id: "backend-1",
            name: "Primary",
            backendType: "static",
            address: "192.168.1.100",
            port: 8080,
            protocol: "http",
            siteId: null,
            weight: 100,
            healthCheckEnabled: false,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
            enabled: true,
            isBackup: false,
          },
        ],
      };

      const config = generateCompleteHAProxyConfig([domain]);

      expect(config.frontends.length).toBeGreaterThan(0);
      expect(config.backends.length).toBeGreaterThan(0);
    });

    it("should combine sites and Pomerium", () => {
      const site: SiteConfig = {
        id: "site-1",
        slug: "my-site",
        hostname: "site.example.com",
        sslEnabled: false,
        activeSlot: "blue",
        maintenanceEnabled: false,
        maintenanceBypassIps: [],
      };

      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            name: "Protected",
            domainId: "site-1",
            hostname: "site.example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            enabled: true,
            priority: 100,
          },
        ],
      };

      const config = generateCompleteHAProxyConfig([], {
        sites: [site],
        executorConfig: { endpoint: "http://executor:80", port: 80, secret: "secret" },
        pomerium: pomeriumConfig,
      });

      // Should have both backends
      expect(config.backends.find(b => b.name === "sites_lookup_backend")).toBeDefined();
      expect(config.backends.find(b => b.name === "pomerium_backend")).toBeDefined();
    });
  });

  // ============================================================================
  // generatePomeriumBackend — rendered config string
  // ============================================================================

  describe("generatePomeriumBackend — rendered config string", () => {
    it("contains backend section header", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("backend pomerium_backend");
    });

    it("contains HTTP health check path", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("option httpchk");
      expect(rendered).toContain("http-check send meth GET uri /.pomerium/ping ver HTTP/1.0");
    });

    it("contains health check status assertion", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("http-check expect status 200-499");
    });

    it("contains default server address", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("server pomerium pomerium:80");
    });

    it("contains health check timing flags", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("check inter 5s fall 3 rise 2");
    });

    it("contains init-addr none", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("init-addr none");
    });

    it("contains balance algorithm", () => {
      const backend = generatePomeriumBackend();
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("balance roundrobin");
    });

    it("uses correct server address for HTTP URL", () => {
      const backend = generatePomeriumBackend("http://myproxy:9090");
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("server pomerium myproxy:9090");
    });

    it("uses correct server address for HTTPS URL", () => {
      const backend = generatePomeriumBackend("https://secure.proxy.internal");
      const rendered = renderHAProxyConfig({
        global: getDefaultGlobalConfig(),
        defaults: getDefaultDefaultsConfig(),
        frontends: [],
        backends: [backend],
      });
      expect(rendered).toContain("server pomerium secure.proxy.internal:443");
    });
  });

  // ============================================================================
  // authenticate service URL auto-routing tests
  // ============================================================================

  describe("authenticate service URL auto-routing", () => {
    const baseDomain: DomainConfig = {
      id: "dom-1",
      hostname: "app.example.com",
      sslEnabled: false,
      forceHttps: false,
      certificatePath: null,
      errorPagePath: null,
      maintenanceEnabled: false,
      maintenancePagePath: null,
      maintenanceBypassIps: [],
      backends: [
        {
          id: "be-1",
          name: "backend",
          address: "127.0.0.1",
          port: 8080,
          protocol: "http",
          weight: 100,
          isBackup: false,
          enabled: true,
          backendType: "static",
          healthCheckEnabled: false,
          healthCheckPath: "/",
          healthCheckInterval: 5,
          healthCheckTimeout: 2,
          healthCheckFall: 3,
          healthCheckRise: 2,
        },
      ],
    };

    it("adds pomerium_backend when only authenticateServiceUrl is set and no routes", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const backend = config.backends.find((b) => b.name === "pomerium_backend");
      expect(backend).toBeDefined();
    });

    it("does not add pomerium_backend when disabled and no routes", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: false,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const backend = config.backends.find((b) => b.name === "pomerium_backend");
      expect(backend).toBeUndefined();
    });

    it("adds host ACL for authenticate service URL in HTTP frontend", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      const authAcl = httpFrontend!.acls.find(
        (a) => a.name.startsWith("pomerium_auth_host_") && a.condition.includes("auth.example.com")
      );
      expect(authAcl).toBeDefined();
    });

    it("routes authenticate hostname to pomerium_backend in HTTP frontend", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      const authUseBackend = httpFrontend!.useBackends.find(
        (ub) => ub.backendName === "pomerium_backend" && ub.condition?.startsWith("pomerium_auth_host_")
      );
      expect(authUseBackend).toBeDefined();
    });

    it("adds host ACL for authenticate service URL in HTTPS frontend when SSL domain exists", () => {
      const sslDomain: DomainConfig = {
        ...baseDomain,
        sslEnabled: true,
        certificatePath: "/certs/app.pem",
      };
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([sslDomain], pomeriumConfig, { certsDir: "/certs" });
      const httpsFrontend = config.frontends.find((f) => f.name === "https_front");
      expect(httpsFrontend).toBeDefined();
      const authAcl = httpsFrontend!.acls.find(
        (a) => a.name.startsWith("pomerium_auth_host_") && a.condition.includes("auth.example.com")
      );
      expect(authAcl).toBeDefined();
    });

    it("works alongside protected routes — both auth host and route ACLs are present", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            domainId: "dom-1",
            hostname: "app.example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            priority: 100,
            enabled: true,
          },
        ],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      const authAcl = httpFrontend!.acls.find((a) => a.name.startsWith("pomerium_auth_host_"));
      const routeAcl = httpFrontend!.acls.find(
        (a) => a.name.startsWith("pomerium_host_") && !a.name.startsWith("pomerium_auth_host_")
      );
      expect(authAcl).toBeDefined();
      expect(routeAcl).toBeDefined();
    });

    it("rendered config contains the authenticate hostname ACL condition", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const rendered = renderHAProxyConfig(config);
      expect(rendered).toContain("hdr(host) -i auth.example.com");
    });

    it("rendered config routes authenticate hostname to pomerium_backend", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const rendered = renderHAProxyConfig(config);
      expect(rendered).toMatch(/use_backend pomerium_backend if pomerium_auth_host_/);
    });

    it("handles http authenticate service URL", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "http://auth.internal:8080",
      };
      const config = generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig);
      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      const authAcl = httpFrontend!.acls.find(
        (a) => a.condition.includes("auth.internal")
      );
      expect(authAcl).toBeDefined();
    });

    it("ignores malformed authenticateServiceUrl without throwing", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "not-a-url",
      };
      expect(() => generateHAProxyConfigWithPomerium([baseDomain], pomeriumConfig)).not.toThrow();
    });

    it("generateCompleteHAProxyConfig also routes authenticate hostname when no routes configured", () => {
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [],
        authenticateServiceUrl: "https://auth.example.com",
      };
      const config = generateCompleteHAProxyConfig([baseDomain], { pomerium: pomeriumConfig });
      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      const authAcl = httpFrontend!.acls.find((a) => a.name.startsWith("pomerium_auth_host_"));
      expect(authAcl).toBeDefined();
      const backend = config.backends.find((b) => b.name === "pomerium_backend");
      expect(backend).toBeDefined();
    });
  });
});
