import { describe, expect, it } from "vitest";
import {
  generateHAProxyConfig,
  renderHAProxyConfig,
} from "../src/haproxy/template";
import type { DomainConfig } from "../src/haproxy/types";

function makeBackend(overrides: Partial<DomainConfig["backends"][number]> = {}): DomainConfig["backends"][number] {
  return {
    id: "be-1",
    name: "primary",
    backendType: "static",
    address: "10.0.0.1",
    port: 8080,
    protocol: "http",
    weight: 100,
    maxConnections: undefined,
    healthCheckEnabled: true,
    healthCheckPath: "/health",
    healthCheckInterval: 5,
    healthCheckTimeout: 2,
    healthCheckFall: 3,
    healthCheckRise: 2,
    enabled: true,
    isBackup: false,
    ...overrides,
  };
}

const baseNoSsl: DomainConfig = {
  id: "dom-1",
  hostname: "example.com",
  sslEnabled: false,
  forceHttps: false,
  maintenanceEnabled: false,
  maintenanceBypassIps: [],
  certificatePath: null,
  backends: [makeBackend()],
};

const baseSsl: DomainConfig = {
  ...baseNoSsl,
  sslEnabled: true,
  forceHttps: true,
  certificatePath: "/etc/haproxy/certs/example.com.pem",
};

describe("WWW Toggle — subdomainAliases in HAProxy config", () => {
  it("should not add any alias ACL when subdomainAliases is empty", () => {
    const domain: DomainConfig = { ...baseNoSsl, subdomainAliases: [] };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);
    expect(rendered).not.toContain("www.");
    expect(rendered).toContain("hdr(host) -i example.com");
  });

  it("should not add any alias ACL when subdomainAliases is undefined", () => {
    const domain: DomainConfig = { ...baseNoSsl };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);
    expect(rendered).not.toContain("host_www");
    expect(rendered).toContain("backend_example_com");
  });

  it("should add ACL and use_backend for www alias in HTTP frontend", () => {
    const domain: DomainConfig = {
      ...baseNoSsl,
      subdomainAliases: ["www.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    expect(rendered).toContain("www.example.com");
    expect(rendered).toContain("backend_example_com");
  });

  it("should add ACL for multiple aliases", () => {
    const domain: DomainConfig = {
      ...baseNoSsl,
      subdomainAliases: ["www.example.com", "app.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    expect(rendered).toContain("www.example.com");
    expect(rendered).toContain("app.example.com");
  });

  it("should include alias ACL in HTTPS frontend when SSL enabled and cert covers alias", () => {
    const domain: DomainConfig = {
      ...baseSsl,
      // certificateAltNames must include the alias for the HTTPS frontend to add it
      certificateAltNames: ["www.example.com"],
      subdomainAliases: ["www.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    const httpFrontendSection = rendered.split("frontend https_front")[0];
    const httpsFrontendSection = rendered.split("frontend https_front")[1];

    expect(httpFrontendSection).toContain("www.example.com");
    expect(httpsFrontendSection).toContain("www.example.com");
  });

  it("should not include alias in HTTPS frontend when cert does not cover alias", () => {
    const domain: DomainConfig = {
      ...baseSsl,
      // no certificateAltNames — cert only covers example.com
      subdomainAliases: ["www.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    const httpFrontendSection = rendered.split("frontend https_front")[0];
    const httpsFrontendSection = rendered.split("frontend https_front")[1];

    // HTTP frontend still gets the alias
    expect(httpFrontendSection).toContain("www.example.com");
    // HTTPS frontend does not — cert doesn't cover it
    expect(httpsFrontendSection).not.toContain("www.example.com");
  });

  it("should add forceHttps redirect for aliases when forceHttps is enabled", () => {
    const domain: DomainConfig = {
      ...baseSsl,
      subdomainAliases: ["www.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    // The rendered config should have redirect logic referencing the alias
    expect(rendered).toContain("www.example.com");
    // The http frontend should redirect to https, alias included
    const httpSection = rendered.split("frontend https_front")[0];
    expect(httpSection).toContain("www.example.com");
  });

  it("should generate consistent backend name for alias traffic", () => {
    const domain: DomainConfig = {
      ...baseNoSsl,
      subdomainAliases: ["www.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    // Alias traffic should route to the same backend as primary hostname
    const backendName = "backend_example_com";
    expect(rendered).toContain(backendName);

    // The backend block itself should exist
    expect(config.backends.some((b) => b.name === backendName)).toBe(true);
  });

  it("should handle alias with uppercase and special characters in sanitization", () => {
    const domain: DomainConfig = {
      ...baseNoSsl,
      hostname: "My-App.example.com",
      subdomainAliases: ["www.My-App.example.com"],
    };
    const config = generateHAProxyConfig([domain]);
    const rendered = renderHAProxyConfig(config);

    expect(rendered).toContain("www.My-App.example.com");
    // Sanitized backend name uses lowercase
    expect(rendered).toContain("backend_my-app_example_com");
  });
});
