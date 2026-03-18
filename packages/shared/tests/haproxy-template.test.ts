import { describe, expect, it } from "vitest";
import {
  generateHAProxyConfig,
  renderHAProxyConfig,
  sanitizeIdentifier,
} from "../src/haproxy/template";
import type { DomainConfig } from "../src/haproxy/types";

const baseDomain: DomainConfig = {
  id: "dom-1",
  hostname: "Api.Example.com",
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
      address: "test-backend",
      port: 80,
      protocol: "http",
      weight: 1,
      maxConnections: 100,
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

describe("sanitizeIdentifier", () => {
  it("replaces unsupported characters and lowercases", () => {
    expect(sanitizeIdentifier("Api.Example.com")).toBe("api_example_com");
    expect(sanitizeIdentifier("UPPER-Case*Value")).toBe("upper-case_value");
  });
});

describe("HAProxy template generation", () => {
  it("builds frontends/backends for domains with SSL and forces https redirect", () => {
    const config = generateHAProxyConfig([baseDomain], {
      certsDir: "/etc/haproxy/certs",
      errorPagesDir: "/etc/haproxy/errors",
    });

    const httpsFrontend = config.frontends.find((f) => f.name === "https_front");
    expect(httpsFrontend).toBeTruthy();
    expect(httpsFrontend?.binds[0].ssl).toBe(true);
    expect(httpsFrontend?.binds[0].certPath).toContain("/etc/haproxy/certs/");
    expect(httpsFrontend?.useBackends.some((b) => b.backendName.includes("backend_api_example_com"))).toBe(true);

    const backend = config.backends.find((b) => b.name === "backend_api_example_com");
    expect(backend).toBeTruthy();
    expect(backend?.servers[0].address).toBe("test-backend");
    expect(backend?.servers[0].healthCheck.enabled).toBe(true);

    // Fallback backend always present
    expect(config.backends.some((b) => b.name === "fallback_backend")).toBe(true);
  });

  it("renders a complete HAProxy configuration string", () => {
    const config = generateHAProxyConfig([baseDomain]);
    const rendered = renderHAProxyConfig(config);

    expect(rendered).toContain("frontend http_front");
    expect(rendered).toContain("frontend https_front");
    expect(rendered).toContain("backend backend_api_example_com");
    expect(rendered).toContain("balance roundrobin");
  });
});
