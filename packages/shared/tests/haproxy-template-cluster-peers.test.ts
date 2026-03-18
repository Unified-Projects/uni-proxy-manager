import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  generateHAProxyConfig,
  renderHAProxyConfig,
} from "../src/haproxy/template";
import type { DomainConfig, HAProxyClusterPeer } from "../src/haproxy/types";

function makeBackend(): DomainConfig["backends"][number] {
  return {
    id: "be-1",
    name: "primary",
    backendType: "static",
    address: "10.0.0.1",
    port: 8080,
    protocol: "http",
    weight: 100,
    maxConnections: undefined,
    healthCheckEnabled: false,
    healthCheckPath: "/",
    healthCheckInterval: 5,
    healthCheckTimeout: 2,
    healthCheckFall: 3,
    healthCheckRise: 2,
    enabled: true,
    isBackup: false,
  };
}

const baseDomain: DomainConfig = {
  id: "dom-1",
  hostname: "example.com",
  sslEnabled: false,
  forceHttps: false,
  maintenanceEnabled: false,
  maintenanceBypassIps: [],
  certificatePath: null,
  backends: [makeBackend()],
};

const peer1: HAProxyClusterPeer = {
  name: "node1",
  address: "10.0.1.1",
  port: 1024,
};

const peer2: HAProxyClusterPeer = {
  name: "node2",
  address: "10.0.1.2",
  port: 1024,
};

describe("HAProxy cluster peers section rendering", () => {
  it("should not emit a peers block when clusterPeers is undefined", () => {
    const config = generateHAProxyConfig([baseDomain]);
    const rendered = renderHAProxyConfig(config);
    expect(rendered).not.toContain("peers upm_cluster");
    expect(rendered).not.toContain("peer node");
  });

  it("should not emit a peers block when clusterPeers is empty array", () => {
    const config = generateHAProxyConfig([baseDomain]);
    config.clusterPeers = [];
    const rendered = renderHAProxyConfig(config);
    expect(rendered).not.toContain("peers upm_cluster");
  });

  it("should emit peers block when clusterPeers has entries", () => {
    const config = generateHAProxyConfig([baseDomain]);
    config.clusterPeers = [peer1, peer2];
    const rendered = renderHAProxyConfig(config);

    expect(rendered).toContain("peers upm_cluster");
    expect(rendered).toContain("peer node1");
    expect(rendered).toContain("peer node2");
    expect(rendered).toContain("10.0.1.1:1024");
    expect(rendered).toContain("10.0.1.2:1024");
  });

  it("should place the peers section before frontends", () => {
    const config = generateHAProxyConfig([baseDomain]);
    config.clusterPeers = [peer1, peer2];
    const rendered = renderHAProxyConfig(config);

    const peersIdx = rendered.indexOf("peers upm_cluster");
    const frontendIdx = rendered.indexOf("frontend http_front");
    expect(peersIdx).toBeGreaterThan(-1);
    expect(frontendIdx).toBeGreaterThan(-1);
    expect(peersIdx).toBeLessThan(frontendIdx);
  });

  it("should sanitize peer names with special characters", () => {
    const config = generateHAProxyConfig([baseDomain]);
    config.clusterPeers = [
      { name: "Node.One", address: "10.0.1.1", port: 1024 },
    ];
    const rendered = renderHAProxyConfig(config);

    // sanitizeIdentifier replaces . with _
    expect(rendered).toContain("peer node_one");
    expect(rendered).not.toContain("peer Node.One");
  });

  it("should use port from the peer entry", () => {
    const config = generateHAProxyConfig([baseDomain]);
    config.clusterPeers = [{ name: "nodeA", address: "192.168.1.5", port: 2048 }];
    const rendered = renderHAProxyConfig(config);

    expect(rendered).toContain("192.168.1.5:2048");
  });

  it("should include all required sections alongside peers block", () => {
    const config = generateHAProxyConfig([baseDomain]);
    config.clusterPeers = [peer1];
    const rendered = renderHAProxyConfig(config);

    // Core sections still present
    expect(rendered).toContain("global");
    expect(rendered).toContain("defaults");
    expect(rendered).toContain("frontend http_front");
    expect(rendered).toContain("backend backend_example_com");
    expect(rendered).toContain("peers upm_cluster");
  });
});
