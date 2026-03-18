import { describe, expect, it } from "vitest";
import {
  generateHAProxyConfigWithSites,
  renderHAProxyConfig,
  sanitizeIdentifier,
} from "../src/haproxy/template";
import type { DomainConfig, SiteConfig, SitesExecutorConfig } from "../src/haproxy/types";

const executorConfig: SitesExecutorConfig = {
  endpoint: "openruntimes-executor",
  port: 80,
  secret: "test-secret",
};

const baseDomain: DomainConfig = {
  id: "dom-1",
  hostname: "api.example.com",
  sslEnabled: true,
  forceHttps: true,
  maintenanceEnabled: false,
  maintenanceBypassIps: [],
  certificatePath: "/etc/haproxy/certs/api.example.com.pem",
  backends: [
    {
      id: "be-1",
      name: "primary",
      backendType: "static",
      address: "api-backend",
      port: 8080,
      protocol: "http",
      weight: 100,
      healthCheckEnabled: true,
      healthCheckPath: "/health",
      healthCheckInterval: 10,
      healthCheckTimeout: 5,
      healthCheckFall: 3,
      healthCheckRise: 2,
      enabled: true,
      isBackup: false,
    },
  ],
};

const baseSite: SiteConfig = {
  id: "site-1",
  slug: "my-app",
  hostname: "myapp.example.com",
  sslEnabled: true,
  activeSlot: "blue",
  maintenanceEnabled: false,
  maintenanceBypassIps: [],
};

describe("HAProxy Sites Backend Generation", () => {
  describe("generateHAProxyConfigWithSites", () => {
    it("includes both domain backend and sites_lookup_backend", () => {
      const config = generateHAProxyConfigWithSites(
        [baseDomain],
        [baseSite],
        executorConfig
      );

      // Should have domain backend
      const domainBackend = config.backends.find(
        (b) => b.name === "backend_api_example_com"
      );
      expect(domainBackend).toBeTruthy();

      // Should have sites_lookup_backend (single backend for all sites)
      const sitesLookupBackend = config.backends.find(
        (b) => b.name === "sites_lookup_backend"
      );
      expect(sitesLookupBackend).toBeTruthy();
      expect(sitesLookupBackend?.servers[0].address).toBe("sites-lookup");
      expect(sitesLookupBackend?.servers[0].port).toBe(3002);
    });

    it("adds site ACLs and routing to HTTP frontend", () => {
      const config = generateHAProxyConfigWithSites(
        [],
        [baseSite],
        executorConfig
      );

      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      expect(httpFrontend).toBeTruthy();

      // Should have site host ACL
      const siteAcl = httpFrontend?.acls.find((a) => a.name === "site_host_site-1");
      expect(siteAcl).toBeTruthy();
      expect(siteAcl?.condition).toBe("hdr(host) -i myapp.example.com");

      // Should route to sites_lookup_backend
      const useBackend = httpFrontend?.useBackends.find(
        (b) => b.backendName === "sites_lookup_backend"
      );
      expect(useBackend).toBeTruthy();
      expect(useBackend?.condition).toBe("site_host_site-1");
    });

    it("adds site ACLs and routing to HTTPS frontend for SSL sites", () => {
      const sslSite: SiteConfig = {
        ...baseSite,
        sslEnabled: true,
      };

      const config = generateHAProxyConfigWithSites(
        [baseDomain], // Need a domain with SSL to create HTTPS frontend
        [sslSite],
        executorConfig
      );

      const httpsFrontend = config.frontends.find((f) => f.name === "https_front");
      expect(httpsFrontend).toBeTruthy();

      // Should have site host ACL on HTTPS
      const siteAcl = httpsFrontend?.acls.find((a) => a.name === "site_host_site-1");
      expect(siteAcl).toBeTruthy();
    });

    it("handles maintenance mode for sites", () => {
      const maintenanceSite: SiteConfig = {
        ...baseSite,
        maintenanceEnabled: true,
        maintenancePagePath: "/etc/haproxy/errors/maintenance.html",
      };

      const config = generateHAProxyConfigWithSites(
        [],
        [maintenanceSite],
        executorConfig
      );

      const httpFrontend = config.frontends.find((f) => f.name === "http_front");

      // Should have maintenance ACL
      const maintenanceAcl = httpFrontend?.acls.find(
        (a) => a.name === "site_maintenance_site-1"
      );
      expect(maintenanceAcl).toBeTruthy();

      // Should have maintenance backend
      const maintenanceBackend = config.backends.find(
        (b) => b.name === "site_maintenance_site-1"
      );
      expect(maintenanceBackend).toBeTruthy();
      expect(maintenanceBackend?.errorFilePath).toBe(
        "/etc/haproxy/errors/maintenance.html"
      );

      // Should route to maintenance backend before active slot
      const maintenanceUseBackend = httpFrontend?.useBackends.find(
        (b) => b.backendName === "site_maintenance_site-1"
      );
      expect(maintenanceUseBackend).toBeTruthy();
    });

    it("handles maintenance bypass IPs", () => {
      const maintenanceWithBypass: SiteConfig = {
        ...baseSite,
        maintenanceEnabled: true,
        maintenancePagePath: "/etc/haproxy/errors/maintenance.html",
        maintenanceBypassIps: ["192.168.1.100", "10.0.0.50"],
      };

      const config = generateHAProxyConfigWithSites(
        [],
        [maintenanceWithBypass],
        executorConfig
      );

      const httpFrontend = config.frontends.find((f) => f.name === "http_front");

      // Should have bypass ACL
      const bypassAcl = httpFrontend?.acls.find(
        (a) => a.name === "site_bypass_site-1"
      );
      expect(bypassAcl).toBeTruthy();
      expect(bypassAcl?.condition).toBe("src 192.168.1.100 10.0.0.50");

      // Maintenance routing should exclude bypass IPs
      const maintenanceUseBackend = httpFrontend?.useBackends.find(
        (b) => b.backendName === "site_maintenance_site-1"
      );
      expect(maintenanceUseBackend?.condition).toContain("!site_bypass_site-1");
    });

    it("skips sites without active slot", () => {
      const inactiveSite: SiteConfig = {
        ...baseSite,
        activeSlot: null,
      };

      const config = generateHAProxyConfigWithSites(
        [],
        [inactiveSite],
        executorConfig
      );

      // Should not have any site backends
      const siteBackends = config.backends.filter((b) =>
        b.name.startsWith("site_site-1")
      );
      expect(siteBackends).toHaveLength(0);
    });

    it("handles multiple sites", () => {
      const sites: SiteConfig[] = [
        { ...baseSite, id: "site-1", hostname: "app1.example.com", activeSlot: "blue" },
        { ...baseSite, id: "site-2", hostname: "app2.example.com", activeSlot: "green" },
      ];

      const config = generateHAProxyConfigWithSites([], sites, executorConfig);

      // Should have a single sites_lookup_backend for all sites
      expect(config.backends.find((b) => b.name === "sites_lookup_backend")).toBeTruthy();

      // Should have ACLs for both sites
      const httpFrontend = config.frontends.find((f) => f.name === "http_front");
      expect(httpFrontend?.acls.find((a) => a.name === "site_host_site-1")).toBeTruthy();
      expect(httpFrontend?.acls.find((a) => a.name === "site_host_site-2")).toBeTruthy();

      // Both should route to sites_lookup_backend
      const site1UseBackend = httpFrontend?.useBackends.find(
        (b) => b.condition === "site_host_site-1" && b.backendName === "sites_lookup_backend"
      );
      const site2UseBackend = httpFrontend?.useBackends.find(
        (b) => b.condition === "site_host_site-2" && b.backendName === "sites_lookup_backend"
      );
      expect(site1UseBackend).toBeTruthy();
      expect(site2UseBackend).toBeTruthy();
    });

    it("generates valid HAProxy configuration string", () => {
      const config = generateHAProxyConfigWithSites(
        [baseDomain],
        [baseSite],
        executorConfig
      );

      const rendered = renderHAProxyConfig(config);

      // Should contain sites_lookup_backend for site routing
      expect(rendered).toContain("backend sites_lookup_backend");
      expect(rendered).toContain("server lookup sites-lookup:3002");

      // Should contain domain backend too
      expect(rendered).toContain("backend backend_api_example_com");

      // Should have frontend routing for site
      expect(rendered).toContain("hdr(host) -i myapp.example.com");
      expect(rendered).toContain("use_backend sites_lookup_backend if site_host_site-1");
    });
  });

  describe("Site ID sanitization", () => {
    it("sanitizes various special characters", () => {
      expect(sanitizeIdentifier("my-site")).toBe("my-site");
      expect(sanitizeIdentifier("my.site")).toBe("my_site");
      expect(sanitizeIdentifier("My Site")).toBe("my_site");
      expect(sanitizeIdentifier("UPPERCASE")).toBe("uppercase");
      expect(sanitizeIdentifier("site@123")).toBe("site_123");
    });
  });
});
