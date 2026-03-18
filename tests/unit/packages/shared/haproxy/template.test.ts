/**
 * HAProxy Template Generation Unit Tests
 *
 * Tests for the HAProxy configuration generation module.
 * Covers all public functions and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getDefaultGlobalConfig,
  getDefaultDefaultsConfig,
  sanitizeIdentifier,
  generateHAProxyConfig,
  renderHAProxyConfig,
  generateHAProxyConfigString,
  generatePomeriumBackend,
  generateSitesLookupBackend,
  generateHAProxyConfigWithSites,
  generateHAProxyConfigWithSitesString,
  generateHAProxyConfigWithPomerium,
  generateHAProxyConfigWithPomeriumString,
  generateCompleteHAProxyConfig,
  generateCompleteHAProxyConfigString,
} from "../../../../../packages/shared/src/haproxy/template";
import type {
  DomainConfig,
  SiteConfig,
  SitesExecutorConfig,
  PomeriumConfig,
} from "../../../../../packages/shared/src/haproxy/types";

// Mock getStatsConfig to avoid reading env vars during tests
vi.mock("../../../../../packages/shared/src/config/env", () => ({
  getStatsConfig: () => ({
    user: "admin",
    password: "testpassword",
  }),
}));

describe("HAProxy Template Generation", () => {
  // ============================================================================
  // Default Configuration Tests
  // ============================================================================

  describe("getDefaultGlobalConfig", () => {
    it("should return default global configuration", () => {
      const config = getDefaultGlobalConfig();

      expect(config.maxConnections).toBe(4096);
      expect(config.logFormat).toBe("raw");
      expect(config.statsSocket).toContain("/var/run/haproxy/haproxy.sock");
      expect(config.statsSocket).toContain("mode 666");
      expect(config.statsSocket).toContain("level admin");
    });

    it("should return a new object each time", () => {
      const config1 = getDefaultGlobalConfig();
      const config2 = getDefaultGlobalConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
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

    it("should return a new object each time", () => {
      const config1 = getDefaultDefaultsConfig();
      const config2 = getDefaultDefaultsConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  // ============================================================================
  // sanitizeIdentifier Tests
  // ============================================================================

  describe("sanitizeIdentifier", () => {
    it("should convert hostname to valid identifier", () => {
      expect(sanitizeIdentifier("example.com")).toBe("example_com");
    });

    it("should handle subdomains", () => {
      expect(sanitizeIdentifier("www.example.com")).toBe("www_example_com");
      expect(sanitizeIdentifier("api.v2.example.com")).toBe("api_v2_example_com");
    });

    it("should handle hyphens (keep them)", () => {
      expect(sanitizeIdentifier("my-site.example.com")).toBe("my-site_example_com");
    });

    it("should handle special characters", () => {
      expect(sanitizeIdentifier("test@site!#.com")).toBe("test_site___com");
    });

    it("should convert to lowercase", () => {
      expect(sanitizeIdentifier("EXAMPLE.COM")).toBe("example_com");
      expect(sanitizeIdentifier("MyDomain.ORG")).toBe("mydomain_org");
    });

    it("should handle numbers", () => {
      expect(sanitizeIdentifier("site123.example.com")).toBe("site123_example_com");
    });

    it("should handle underscores (keep them)", () => {
      expect(sanitizeIdentifier("my_site.com")).toBe("my_site_com");
    });

    it("should handle edge cases", () => {
      expect(sanitizeIdentifier("")).toBe("");
      expect(sanitizeIdentifier("-")).toBe("-");
      expect(sanitizeIdentifier("_")).toBe("_");
      expect(sanitizeIdentifier("...")).toBe("___");
    });

    it("should handle wildcard domains", () => {
      expect(sanitizeIdentifier("*.example.com")).toBe("__example_com");
    });

    it("should handle port in hostname", () => {
      expect(sanitizeIdentifier("localhost:8080")).toBe("localhost_8080");
    });
  });

  // ============================================================================
  // generateHAProxyConfig Tests
  // ============================================================================

  describe("generateHAProxyConfig", () => {
    const createBasicDomain = (overrides: Partial<DomainConfig> = {}): DomainConfig => ({
      id: "dom-1",
      hostname: "example.com",
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
          name: "backend1",
          address: "127.0.0.1",
          port: 8080,
          protocol: "http",
          weight: 100,
          maxConnections: 1000,
          isBackup: false,
          enabled: true,
          backendType: "static",
          healthCheckEnabled: true,
          healthCheckPath: "/health",
          healthCheckInterval: 5,
          healthCheckTimeout: 2,
          healthCheckFall: 3,
          healthCheckRise: 2,
        },
      ],
      ...overrides,
    });

    it("should generate config for single domain", () => {
      const domain = createBasicDomain();
      const config = generateHAProxyConfig([domain]);

      expect(config.global).toBeDefined();
      expect(config.defaults).toBeDefined();
      expect(config.frontends).toHaveLength(1); // HTTP only, no SSL
      expect(config.backends).toHaveLength(2); // domain backend + fallback
    });

    it("should create HTTPS frontend when SSL is enabled", () => {
      const domain = createBasicDomain({
        sslEnabled: true,
        certificatePath: "/certs/example.com.pem",
      });
      const config = generateHAProxyConfig([domain]);

      expect(config.frontends).toHaveLength(2); // HTTP + HTTPS
      const httpsFrontend = config.frontends.find(f => f.name === "https_front");
      expect(httpsFrontend).toBeDefined();
      expect(httpsFrontend!.binds[0].ssl).toBe(true);
    });

    it("should add HTTPS redirect when forceHttps is enabled", () => {
      const domain = createBasicDomain({
        sslEnabled: true,
        forceHttps: true,
        certificatePath: "/certs/example.com.pem",
      });
      const config = generateHAProxyConfig([domain]);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      expect(httpFrontend!.httpRequestRules).toBeDefined();
      expect(httpFrontend!.httpRequestRules!.some(r => r.includes("redirect scheme https"))).toBe(true);
    });

    it("should generate maintenance backend when maintenance is enabled", () => {
      const domain = createBasicDomain({
        maintenanceEnabled: true,
        maintenancePagePath: "/maintenance/page.html",
      });
      const config = generateHAProxyConfig([domain]);

      const maintenanceBackend = config.backends.find(b => b.name.includes("maintenance"));
      expect(maintenanceBackend).toBeDefined();
    });

    it("should handle maintenance bypass IPs", () => {
      const domain = createBasicDomain({
        maintenanceEnabled: true,
        maintenancePagePath: "/maintenance/page.html",
        maintenanceBypassIps: ["192.168.1.1", "10.0.0.1"],
      });
      const config = generateHAProxyConfig([domain]);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const bypassAcl = httpFrontend!.acls.find(a => a.name.includes("bypass"));
      expect(bypassAcl).toBeDefined();
      expect(bypassAcl!.condition).toContain("192.168.1.1");
      expect(bypassAcl!.condition).toContain("10.0.0.1");
    });

    it("should skip domain without valid backends", () => {
      const domain = createBasicDomain({
        backends: [],
      });
      const config = generateHAProxyConfig([domain]);

      // Should only have fallback backend
      expect(config.backends).toHaveLength(1);
      expect(config.backends[0].name).toBe("fallback_backend");
    });

    it("should handle multiple domains", () => {
      const domains = [
        createBasicDomain({ id: "dom-1", hostname: "site1.com" }),
        createBasicDomain({ id: "dom-2", hostname: "site2.com" }),
        createBasicDomain({ id: "dom-3", hostname: "site3.com" }),
      ];
      const config = generateHAProxyConfig(domains);

      // 3 domain backends + 1 fallback
      expect(config.backends).toHaveLength(4);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      // 3 host ACLs
      expect(httpFrontend!.acls.filter(a => a.name.startsWith("host_"))).toHaveLength(3);
    });

    it("should set error page path on backend", () => {
      const domain = createBasicDomain({
        errorPagePath: "/errors/503.html",
      });
      const config = generateHAProxyConfig([domain]);

      const domainBackend = config.backends.find(b => b.name.includes("backend_"));
      expect(domainBackend!.errorFilePath).toBe("/errors/503.html");
    });

    it("should configure health checks on backend", () => {
      const domain = createBasicDomain();
      const config = generateHAProxyConfig([domain]);

      const domainBackend = config.backends.find(b => b.name.includes("backend_"));
      expect(domainBackend!.httpCheck).toBeDefined();
      expect(domainBackend!.httpCheck!.path).toBe("/health");
      expect(domainBackend!.httpCheck!.expectStatus).toBe(200);
    });

    it("should handle backup servers", () => {
      const domain = createBasicDomain({
        backends: [
          {
            id: "be-1",
            name: "primary",
            address: "127.0.0.1",
            port: 8080,
            protocol: "http",
            weight: 100,
            isBackup: false,
            enabled: true,
            backendType: "static",
            healthCheckEnabled: true,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
          },
          {
            id: "be-2",
            name: "backup",
            address: "127.0.0.2",
            port: 8080,
            protocol: "http",
            weight: 100,
            isBackup: true,
            enabled: true,
            backendType: "static",
            healthCheckEnabled: true,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
          },
        ],
      });
      const config = generateHAProxyConfig([domain]);

      const domainBackend = config.backends.find(b => b.name.includes("backend_"));
      const backupServer = domainBackend!.servers.find(s => s.backup);
      expect(backupServer).toBeDefined();
    });

    it("should use custom certsDir option", () => {
      const domain = createBasicDomain({
        sslEnabled: true,
        certificatePath: "/custom/cert.pem",
      });
      const config = generateHAProxyConfig([domain], {
        certsDir: "/custom/certs",
      });

      const httpsFrontend = config.frontends.find(f => f.name === "https_front");
      expect(httpsFrontend!.binds[0].certPath).toBe("/custom/certs/");
    });

    it("should always include fallback backend", () => {
      const config = generateHAProxyConfig([]);

      expect(config.backends).toHaveLength(1);
      expect(config.backends[0].name).toBe("fallback_backend");
    });
  });

  // ============================================================================
  // renderHAProxyConfig Tests
  // ============================================================================

  describe("renderHAProxyConfig", () => {
    it("should render valid HAProxy config string", () => {
      const domain: DomainConfig = {
        id: "dom-1",
        hostname: "example.com",
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
            name: "backend1",
            address: "127.0.0.1",
            port: 8080,
            protocol: "http",
            weight: 100,
            isBackup: false,
            enabled: true,
            backendType: "static",
            healthCheckEnabled: true,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
          },
        ],
      };

      const config = generateHAProxyConfig([domain]);
      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("global");
      expect(rendered).toContain("defaults");
      expect(rendered).toContain("frontend http_front");
      expect(rendered).toContain("backend backend_example_com");
      expect(rendered).toContain("backend fallback_backend");
    });

    it("should render global section correctly", () => {
      const config = generateHAProxyConfig([]);
      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("global");
      expect(rendered).toContain("log stdout format raw local0");
      expect(rendered).toContain("maxconn 4096");
      expect(rendered).toContain("stats socket");
    });

    it("should render defaults section correctly", () => {
      const config = generateHAProxyConfig([]);
      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("defaults");
      expect(rendered).toContain("mode http");
      expect(rendered).toContain("timeout connect 5s");
      expect(rendered).toContain("timeout client 50s");
      expect(rendered).toContain("timeout server 50s");
      expect(rendered).toContain("option http-keep-alive");
    });

    it("should render stats frontend with authentication", () => {
      const config = generateHAProxyConfig([]);
      const rendered = renderHAProxyConfig(config);

      expect(rendered).toContain("frontend stats");
      expect(rendered).toContain("bind *:8404");
      expect(rendered).toContain("stats enable");
      expect(rendered).toContain("stats uri /stats");
    });
  });

  // ============================================================================
  // generateHAProxyConfigString Tests
  // ============================================================================

  describe("generateHAProxyConfigString", () => {
    it("should generate complete config string", () => {
      const domain: DomainConfig = {
        id: "dom-1",
        hostname: "test.example.com",
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
            name: "server",
            address: "10.0.0.1",
            port: 3000,
            protocol: "http",
            weight: 100,
            isBackup: false,
            enabled: true,
            backendType: "static",
            healthCheckEnabled: false,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
          },
        ],
      };

      const configString = generateHAProxyConfigString([domain]);

      expect(typeof configString).toBe("string");
      expect(configString).toContain("frontend");
      expect(configString).toContain("backend");
      expect(configString).toContain("test_example_com");
    });
  });

  // ============================================================================
  // generatePomeriumBackend Tests
  // ============================================================================

  describe("generatePomeriumBackend", () => {
    it("should generate backend with default pomerium hostname", () => {
      const backend = generatePomeriumBackend();

      expect(backend.name).toBe("pomerium_backend");
      expect(backend.servers[0].address).toBe("pomerium");
      expect(backend.servers[0].port).toBe(80);
    });

    it("should parse HTTP URL correctly", () => {
      const backend = generatePomeriumBackend("http://pomerium.internal:8080");

      expect(backend.servers[0].address).toBe("pomerium.internal");
      expect(backend.servers[0].port).toBe(8080);
    });

    it("should parse HTTPS URL correctly", () => {
      const backend = generatePomeriumBackend("https://secure-pomerium.internal");

      expect(backend.servers[0].address).toBe("secure-pomerium.internal");
      expect(backend.servers[0].port).toBe(443);
    });

    it("should use hostname without protocol as-is", () => {
      const backend = generatePomeriumBackend("custom-pomerium");

      expect(backend.servers[0].address).toBe("custom-pomerium");
      expect(backend.servers[0].port).toBe(80);
    });

    it("should configure health check", () => {
      const backend = generatePomeriumBackend();

      expect(backend.httpCheck).toBeDefined();
      expect(backend.httpCheck!.path).toBe("/.pomerium/ping");
      expect(backend.httpCheck!.expectStatus).toBe("200-499");
      expect(backend.servers[0].healthCheck.enabled).toBe(true);
    });
  });

  // ============================================================================
  // generateSitesLookupBackend Tests
  // ============================================================================

  describe("generateSitesLookupBackend", () => {
    it("should generate sites-lookup backend", () => {
      const backend = generateSitesLookupBackend();

      expect(backend.name).toBe("sites_lookup_backend");
      expect(backend.servers[0].address).toBe("sites-lookup");
      expect(backend.servers[0].port).toBe(3002);
    });

    it("should configure health check on /health", () => {
      const backend = generateSitesLookupBackend();

      expect(backend.httpCheck).toBeDefined();
      expect(backend.httpCheck!.path).toBe("/health");
      expect(backend.servers[0].healthCheck.path).toBe("/health");
    });
  });

  // ============================================================================
  // generateHAProxyConfigWithSites Tests
  // ============================================================================

  describe("generateHAProxyConfigWithSites", () => {
    const createBasicSite = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
      id: "site-1",
      hostname: "mysite.example.com",
      sslEnabled: false,
      maintenanceEnabled: false,
      maintenancePagePath: null,
      maintenanceBypassIps: [],
      ...overrides,
    });

    const executorConfig: SitesExecutorConfig = {
      endpoint: "http://executor:9000",
      secret: "test-secret",
    };

    it("should add sites-lookup backend when sites exist", () => {
      const site = createBasicSite();
      const config = generateHAProxyConfigWithSites([], [site], executorConfig);

      const lookupBackend = config.backends.find(b => b.name === "sites_lookup_backend");
      expect(lookupBackend).toBeDefined();
    });

    it("should route site traffic to sites-lookup backend", () => {
      const site = createBasicSite();
      const config = generateHAProxyConfigWithSites([], [site], executorConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const siteRouting = httpFrontend!.useBackends.find(
        ub => ub.backendName === "sites_lookup_backend" && ub.condition?.includes("site_host_")
      );
      expect(siteRouting).toBeDefined();
    });

    it("should create HTTPS frontend for SSL-enabled sites", () => {
      const site = createBasicSite({ sslEnabled: true });
      const config = generateHAProxyConfigWithSites([], [site], executorConfig);

      const httpsFrontend = config.frontends.find(f => f.name === "https_front");
      expect(httpsFrontend).toBeDefined();
    });

    it("should add HTTPS redirect for SSL-enabled sites", () => {
      const site = createBasicSite({ sslEnabled: true });
      const config = generateHAProxyConfigWithSites([], [site], executorConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const redirectRule = httpFrontend!.httpRequestRules?.find(r => r.includes("redirect scheme https"));
      expect(redirectRule).toBeDefined();
    });

    it("should handle site maintenance mode", () => {
      const site = createBasicSite({
        maintenanceEnabled: true,
        maintenancePagePath: "/maintenance/site.html",
      });
      const config = generateHAProxyConfigWithSites([], [site], executorConfig);

      const maintenanceBackend = config.backends.find(b => b.name.includes("site_maintenance_"));
      expect(maintenanceBackend).toBeDefined();
    });

    it("should filter out domains that conflict with sites", () => {
      const domain: DomainConfig = {
        id: "dom-1",
        hostname: "mysite.example.com", // Same as site
        sslEnabled: false,
        forceHttps: false,
        certificatePath: null,
        errorPagePath: null,
        maintenanceEnabled: false,
        maintenancePagePath: null,
        maintenanceBypassIps: [],
        backends: [],
      };
      const site = createBasicSite();
      const config = generateHAProxyConfigWithSites([domain], [site], executorConfig);

      // Domain backend should NOT exist (filtered out)
      const domainBackend = config.backends.find(b => b.name === "backend_mysite_example_com");
      expect(domainBackend).toBeUndefined();
    });

    it("should handle multiple sites", () => {
      const sites = [
        createBasicSite({ id: "site-1", hostname: "site1.com" }),
        createBasicSite({ id: "site-2", hostname: "site2.com" }),
        createBasicSite({ id: "site-3", hostname: "site3.com" }),
      ];
      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const siteAcls = httpFrontend!.acls.filter(a => a.name.startsWith("site_host_"));
      expect(siteAcls).toHaveLength(3);
    });
  });

  // ============================================================================
  // generateHAProxyConfigWithPomerium Tests
  // ============================================================================

  describe("generateHAProxyConfigWithPomerium", () => {
    const createDomainWithPomerium = (): DomainConfig => ({
      id: "dom-1",
      hostname: "protected.example.com",
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
          healthCheckEnabled: true,
          healthCheckPath: "/health",
          healthCheckInterval: 5,
          healthCheckTimeout: 2,
          healthCheckFall: 3,
          healthCheckRise: 2,
        },
      ],
    });

    it("should not add Pomerium backend when disabled", () => {
      const domain = createDomainWithPomerium();
      const pomeriumConfig: PomeriumConfig = {
        enabled: false,
        internalUrl: "http://pomerium:80",
        routes: [],
      };

      const config = generateHAProxyConfigWithPomerium([domain], pomeriumConfig);
      const pomeriumBackend = config.backends.find(b => b.name === "pomerium_backend");
      expect(pomeriumBackend).toBeUndefined();
    });

    it("should add Pomerium backend when enabled with routes", () => {
      const domain = createDomainWithPomerium();
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            domainId: "dom-1",
            hostname: "protected.example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            priority: 100,
            enabled: true,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([domain], pomeriumConfig);
      const pomeriumBackend = config.backends.find(b => b.name === "pomerium_backend");
      expect(pomeriumBackend).toBeDefined();
    });

    it("should create Pomerium ACL for protected routes", () => {
      const domain = createDomainWithPomerium();
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            domainId: "dom-1",
            hostname: "protected.example.com",
            pathPattern: "/admin/*",
            protection: "protected",
            priority: 100,
            enabled: true,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([domain], pomeriumConfig);
      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const pomeriumAcl = httpFrontend!.acls.find(a => a.name.startsWith("pomerium_"));
      expect(pomeriumAcl).toBeDefined();
    });

    it("should route protected paths to Pomerium backend", () => {
      const domain = createDomainWithPomerium();
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            domainId: "dom-1",
            hostname: "protected.example.com",
            pathPattern: "/*",
            protection: "protected",
            priority: 100,
            enabled: true,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([domain], pomeriumConfig);
      const httpFrontend = config.frontends.find(f => f.name === "http_front");
      const pomeriumRouting = httpFrontend!.useBackends.find(ub => ub.backendName === "pomerium_backend");
      expect(pomeriumRouting).toBeDefined();
    });

    it("should not route public routes to Pomerium", () => {
      const domain = createDomainWithPomerium();
      const pomeriumConfig: PomeriumConfig = {
        enabled: true,
        internalUrl: "http://pomerium:80",
        routes: [
          {
            id: "route-1",
            domainId: "dom-1",
            hostname: "protected.example.com",
            pathPattern: "/public/*",
            protection: "public",
            priority: 100,
            enabled: true,
          },
        ],
      };

      const config = generateHAProxyConfigWithPomerium([domain], pomeriumConfig);
      const httpFrontend = config.frontends.find(f => f.name === "http_front");

      // Public routes should not have Pomerium ACL
      const pomeriumAcl = httpFrontend!.acls.find(a => a.name.startsWith("pomerium_"));
      expect(pomeriumAcl).toBeUndefined();
    });
  });

  // ============================================================================
  // generateCompleteHAProxyConfig Tests
  // ============================================================================

  describe("generateCompleteHAProxyConfig", () => {
    it("should generate config with all extensions", () => {
      const domain: DomainConfig = {
        id: "dom-1",
        hostname: "app.example.com",
        sslEnabled: true,
        forceHttps: true,
        certificatePath: "/certs/app.pem",
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
            healthCheckEnabled: true,
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
          },
        ],
      };

      const site: SiteConfig = {
        id: "site-1",
        hostname: "blog.example.com",
        sslEnabled: true,
        maintenanceEnabled: false,
        maintenancePagePath: null,
        maintenanceBypassIps: [],
      };

      const pomerium: PomeriumConfig = {
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
      };

      const config = generateCompleteHAProxyConfig([domain], {
        sites: [site],
        executorConfig: { endpoint: "http://executor:9000", secret: "test" },
        pomerium,
      });

      // Should have all backends
      expect(config.backends.find(b => b.name === "pomerium_backend")).toBeDefined();
      expect(config.backends.find(b => b.name === "sites_lookup_backend")).toBeDefined();
      expect(config.backends.find(b => b.name.includes("backend_app_example_com"))).toBeDefined();
    });

    it("should work with only domains (no extensions)", () => {
      const domain: DomainConfig = {
        id: "dom-1",
        hostname: "simple.example.com",
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
            healthCheckPath: "/health",
            healthCheckInterval: 5,
            healthCheckTimeout: 2,
            healthCheckFall: 3,
            healthCheckRise: 2,
          },
        ],
      };

      const config = generateCompleteHAProxyConfig([domain]);

      expect(config.backends.find(b => b.name === "pomerium_backend")).toBeUndefined();
      expect(config.backends.find(b => b.name === "sites_lookup_backend")).toBeUndefined();
      expect(config.backends.find(b => b.name.includes("backend_simple_example_com"))).toBeDefined();
    });
  });

  // ============================================================================
  // String Generation Helper Tests
  // ============================================================================

  describe("generateHAProxyConfigWithSitesString", () => {
    it("should return a string", () => {
      const site: SiteConfig = {
        id: "site-1",
        hostname: "test.com",
        sslEnabled: false,
        maintenanceEnabled: false,
        maintenancePagePath: null,
        maintenanceBypassIps: [],
      };

      const result = generateHAProxyConfigWithSitesString(
        [],
        [site],
        { endpoint: "http://executor:9000", secret: "test" }
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("sites_lookup_backend");
    });
  });

  describe("generateHAProxyConfigWithPomeriumString", () => {
    it("should return a string", () => {
      const domain: DomainConfig = {
        id: "dom-1",
        hostname: "test.com",
        sslEnabled: false,
        forceHttps: false,
        certificatePath: null,
        errorPagePath: null,
        maintenanceEnabled: false,
        maintenancePagePath: null,
        maintenanceBypassIps: [],
        backends: [],
      };

      const result = generateHAProxyConfigWithPomeriumString([domain], {
        enabled: false,
        internalUrl: "http://pomerium:80",
        routes: [],
      });

      expect(typeof result).toBe("string");
    });
  });

  describe("generateCompleteHAProxyConfigString", () => {
    it("should return a string", () => {
      const result = generateCompleteHAProxyConfigString([]);

      expect(typeof result).toBe("string");
      expect(result).toContain("global");
      expect(result).toContain("defaults");
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
      // Should not throw; backend is still added but no auth ACL
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
