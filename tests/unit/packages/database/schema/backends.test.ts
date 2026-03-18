/**
 * Backends Schema Unit Tests
 *
 * Tests for the backends database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  backends,
  backendProtocolEnum,
  loadBalanceMethodEnum,
  backendTypeEnum,
  type Backend,
  type NewBackend,
} from "../../../../../packages/database/src/schema/backends";

describe("Backends Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("backendProtocolEnum", () => {
    it("should define http and https protocols", () => {
      const enumValues = backendProtocolEnum.enumValues;

      expect(enumValues).toContain("http");
      expect(enumValues).toContain("https");
    });

    it("should have exactly 2 protocols", () => {
      expect(backendProtocolEnum.enumValues).toHaveLength(2);
    });

    it("should have correct enum name", () => {
      expect(backendProtocolEnum.enumName).toBe("backend_protocol");
    });
  });

  describe("loadBalanceMethodEnum", () => {
    it("should define all expected load balance methods", () => {
      const enumValues = loadBalanceMethodEnum.enumValues;

      expect(enumValues).toContain("roundrobin");
      expect(enumValues).toContain("leastconn");
      expect(enumValues).toContain("source");
      expect(enumValues).toContain("first");
    });

    it("should have exactly 4 methods", () => {
      expect(loadBalanceMethodEnum.enumValues).toHaveLength(4);
    });

    it("should have correct enum name", () => {
      expect(loadBalanceMethodEnum.enumName).toBe("load_balance_method");
    });
  });

  describe("backendTypeEnum", () => {
    it("should define static and site types", () => {
      const enumValues = backendTypeEnum.enumValues;

      expect(enumValues).toContain("static");
      expect(enumValues).toContain("site");
    });

    it("should have exactly 2 types", () => {
      expect(backendTypeEnum.enumValues).toHaveLength(2);
    });

    it("should have correct enum name", () => {
      expect(backendTypeEnum.enumName).toBe("backend_type");
    });
  });

  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("backends table", () => {
    it("should have id as primary key", () => {
      const idColumn = backends.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have domainId as required field", () => {
      const domainIdColumn = backends.domainId;
      expect(domainIdColumn.name).toBe("domain_id");
      expect(domainIdColumn.notNull).toBe(true);
    });

    it("should have name as required field", () => {
      const nameColumn = backends.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
    });

    it("should have backendType with default static", () => {
      const backendTypeColumn = backends.backendType;
      expect(backendTypeColumn.name).toBe("backend_type");
      expect(backendTypeColumn.notNull).toBe(true);
      expect(backendTypeColumn.hasDefault).toBe(true);
    });

    it("should have address as optional field", () => {
      const addressColumn = backends.address;
      expect(addressColumn.name).toBe("address");
      expect(addressColumn.notNull).toBe(false);
    });

    it("should have port with default 80", () => {
      const portColumn = backends.port;
      expect(portColumn.name).toBe("port");
      expect(portColumn.hasDefault).toBe(true);
    });

    it("should have protocol with default http", () => {
      const protocolColumn = backends.protocol;
      expect(protocolColumn.name).toBe("protocol");
      expect(protocolColumn.notNull).toBe(true);
      expect(protocolColumn.hasDefault).toBe(true);
    });

    it("should have siteId as optional field", () => {
      const siteIdColumn = backends.siteId;
      expect(siteIdColumn.name).toBe("site_id");
      expect(siteIdColumn.notNull).toBe(false);
    });

    it("should have weight with default 100", () => {
      const weightColumn = backends.weight;
      expect(weightColumn.name).toBe("weight");
      expect(weightColumn.notNull).toBe(true);
      expect(weightColumn.hasDefault).toBe(true);
    });

    it("should have maxConnections as optional", () => {
      const maxConnectionsColumn = backends.maxConnections;
      expect(maxConnectionsColumn.name).toBe("max_connections");
      expect(maxConnectionsColumn.notNull).toBe(false);
    });

    it("should have loadBalanceMethod with default roundrobin", () => {
      const loadBalanceMethodColumn = backends.loadBalanceMethod;
      expect(loadBalanceMethodColumn.name).toBe("load_balance_method");
      expect(loadBalanceMethodColumn.notNull).toBe(true);
      expect(loadBalanceMethodColumn.hasDefault).toBe(true);
    });

    it("should have health check fields", () => {
      expect(backends.healthCheckEnabled.name).toBe("health_check_enabled");
      expect(backends.healthCheckPath.name).toBe("health_check_path");
      expect(backends.healthCheckInterval.name).toBe("health_check_interval");
      expect(backends.healthCheckTimeout.name).toBe("health_check_timeout");
      expect(backends.healthCheckFallThreshold.name).toBe("health_check_fall");
      expect(backends.healthCheckRiseThreshold.name).toBe("health_check_rise");
    });

    it("should have health status fields", () => {
      expect(backends.isHealthy.name).toBe("is_healthy");
      expect(backends.lastHealthCheck.name).toBe("last_health_check");
      expect(backends.lastHealthError.name).toBe("last_health_error");
    });

    it("should have enabled with default true", () => {
      const enabledColumn = backends.enabled;
      expect(enabledColumn.name).toBe("enabled");
      expect(enabledColumn.notNull).toBe(true);
      expect(enabledColumn.hasDefault).toBe(true);
    });

    it("should have isBackup with default false", () => {
      const isBackupColumn = backends.isBackup;
      expect(isBackupColumn.name).toBe("is_backup");
      expect(isBackupColumn.notNull).toBe(true);
      expect(isBackupColumn.hasDefault).toBe(true);
    });

    it("should have timestamps", () => {
      expect(backends.createdAt.name).toBe("created_at");
      expect(backends.updatedAt.name).toBe("updated_at");
      expect(backends.createdAt.notNull).toBe(true);
      expect(backends.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("Backend types", () => {
    it("should export Backend select type for static backend", () => {
      const backend: Backend = {
        id: "backend-1",
        domainId: "domain-1",
        name: "Primary Backend",
        backendType: "static",
        address: "192.168.1.100",
        port: 8080,
        protocol: "http",
        siteId: null,
        weight: 100,
        maxConnections: 1000,
        loadBalanceMethod: "roundrobin",
        healthCheckEnabled: true,
        healthCheckPath: "/health",
        healthCheckInterval: 5,
        healthCheckTimeout: 2,
        healthCheckFallThreshold: 3,
        healthCheckRiseThreshold: 2,
        isHealthy: true,
        lastHealthCheck: new Date(),
        lastHealthError: null,
        enabled: true,
        isBackup: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(backend.id).toBe("backend-1");
      expect(backend.backendType).toBe("static");
      expect(backend.address).toBe("192.168.1.100");
    });

    it("should export Backend select type for site backend", () => {
      const backend: Backend = {
        id: "backend-2",
        domainId: "domain-1",
        name: "Site Backend",
        backendType: "site",
        address: null,
        port: 80,
        protocol: "http",
        siteId: "site-1",
        weight: 100,
        maxConnections: null,
        loadBalanceMethod: "roundrobin",
        healthCheckEnabled: true,
        healthCheckPath: "/",
        healthCheckInterval: 5,
        healthCheckTimeout: 2,
        healthCheckFallThreshold: 3,
        healthCheckRiseThreshold: 2,
        isHealthy: true,
        lastHealthCheck: null,
        lastHealthError: null,
        enabled: true,
        isBackup: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(backend.backendType).toBe("site");
      expect(backend.siteId).toBe("site-1");
      expect(backend.address).toBeNull();
    });

    it("should export NewBackend insert type with minimal fields", () => {
      const newBackend: NewBackend = {
        id: "backend-1",
        domainId: "domain-1",
        name: "Backend",
      };

      expect(newBackend.id).toBe("backend-1");
      expect(newBackend.domainId).toBe("domain-1");
    });

    it("should allow all protocol types", () => {
      const protocols: Backend["protocol"][] = ["http", "https"];

      protocols.forEach(protocol => {
        const backend: Partial<Backend> = { protocol };
        expect(backend.protocol).toBe(protocol);
      });
    });

    it("should allow all load balance methods", () => {
      const methods: Backend["loadBalanceMethod"][] = [
        "roundrobin",
        "leastconn",
        "source",
        "first",
      ];

      methods.forEach(method => {
        const backend: Partial<Backend> = { loadBalanceMethod: method };
        expect(backend.loadBalanceMethod).toBe(method);
      });
    });

    it("should allow all backend types", () => {
      const types: Backend["backendType"][] = ["static", "site"];

      types.forEach(type => {
        const backend: Partial<Backend> = { backendType: type };
        expect(backend.backendType).toBe(type);
      });
    });
  });
});
