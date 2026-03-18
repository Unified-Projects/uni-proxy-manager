/**
 * Shared Backends Schema Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  sharedBackends,
  type SharedBackend,
  type NewSharedBackend,
} from "../../../../../packages/database/src/schema/shared-backends";
import {
  domainSharedBackends,
  type DomainSharedBackend,
} from "../../../../../packages/database/src/schema/domain-shared-backends";
import {
  backendProtocolEnum,
  loadBalanceMethodEnum,
} from "../../../../../packages/database/src/schema/backends";

describe("Shared Backends Schema", () => {
  describe("sharedBackends table", () => {
    it("should have id as primary key", () => {
      expect(sharedBackends.id.name).toBe("id");
      expect(sharedBackends.id.dataType).toBe("string");
    });

    it("should have name as unique not null", () => {
      expect(sharedBackends.name.name).toBe("name");
      expect(sharedBackends.name.notNull).toBe(true);
      expect(sharedBackends.name.isUnique).toBe(true);
    });

    it("should have address as not null", () => {
      expect(sharedBackends.address.name).toBe("address");
      expect(sharedBackends.address.notNull).toBe(true);
    });

    it("should have port with default 80", () => {
      expect(sharedBackends.port.name).toBe("port");
      expect(sharedBackends.port.notNull).toBe(true);
      expect(sharedBackends.port.hasDefault).toBe(true);
    });

    it("should have protocol with default http", () => {
      expect(sharedBackends.protocol.name).toBe("protocol");
      expect(sharedBackends.protocol.notNull).toBe(true);
      expect(sharedBackends.protocol.hasDefault).toBe(true);
    });

    it("should have weight with default 100", () => {
      expect(sharedBackends.weight.name).toBe("weight");
      expect(sharedBackends.weight.notNull).toBe(true);
      expect(sharedBackends.weight.hasDefault).toBe(true);
    });

    it("should have maxConnections as nullable", () => {
      expect(sharedBackends.maxConnections.name).toBe("max_connections");
      expect(sharedBackends.maxConnections.notNull).toBe(false);
    });

    it("should have loadBalanceMethod with default roundrobin", () => {
      expect(sharedBackends.loadBalanceMethod.name).toBe("load_balance_method");
      expect(sharedBackends.loadBalanceMethod.notNull).toBe(true);
      expect(sharedBackends.loadBalanceMethod.hasDefault).toBe(true);
    });

    it("should have healthCheckEnabled with default true", () => {
      expect(sharedBackends.healthCheckEnabled.name).toBe("health_check_enabled");
      expect(sharedBackends.healthCheckEnabled.notNull).toBe(true);
      expect(sharedBackends.healthCheckEnabled.hasDefault).toBe(true);
    });

    it("should have healthCheckPath as nullable", () => {
      expect(sharedBackends.healthCheckPath.name).toBe("health_check_path");
    });

    it("should have health check interval/timeout/fall/rise with defaults", () => {
      expect(sharedBackends.healthCheckInterval.hasDefault).toBe(true);
      expect(sharedBackends.healthCheckTimeout.hasDefault).toBe(true);
      expect(sharedBackends.healthCheckFall.hasDefault).toBe(true);
      expect(sharedBackends.healthCheckRise.hasDefault).toBe(true);
    });

    it("should have isHealthy with default true", () => {
      expect(sharedBackends.isHealthy.name).toBe("is_healthy");
      expect(sharedBackends.isHealthy.notNull).toBe(true);
      expect(sharedBackends.isHealthy.hasDefault).toBe(true);
    });

    it("should have enabled with default true", () => {
      expect(sharedBackends.enabled.name).toBe("enabled");
      expect(sharedBackends.enabled.notNull).toBe(true);
      expect(sharedBackends.enabled.hasDefault).toBe(true);
    });

    it("should have isBackup with default false", () => {
      expect(sharedBackends.isBackup.name).toBe("is_backup");
      expect(sharedBackends.isBackup.notNull).toBe(true);
      expect(sharedBackends.isBackup.hasDefault).toBe(true);
    });

    it("should have nullable rewrite fields", () => {
      expect(sharedBackends.hostRewrite.name).toBe("host_rewrite");
      expect(sharedBackends.pathPrefixAdd.name).toBe("path_prefix_add");
      expect(sharedBackends.pathPrefixStrip.name).toBe("path_prefix_strip");
    });

    it("should have createdAt and updatedAt with defaults", () => {
      expect(sharedBackends.createdAt.name).toBe("created_at");
      expect(sharedBackends.createdAt.notNull).toBe(true);
      expect(sharedBackends.createdAt.hasDefault).toBe(true);
      expect(sharedBackends.updatedAt.name).toBe("updated_at");
      expect(sharedBackends.updatedAt.notNull).toBe(true);
      expect(sharedBackends.updatedAt.hasDefault).toBe(true);
    });
  });

  describe("domainSharedBackends table", () => {
    it("should have id as primary key", () => {
      expect(domainSharedBackends.id.name).toBe("id");
      expect(domainSharedBackends.id.dataType).toBe("string");
    });

    it("should have domainId as not null", () => {
      expect(domainSharedBackends.domainId.name).toBe("domain_id");
      expect(domainSharedBackends.domainId.notNull).toBe(true);
    });

    it("should have sharedBackendId as not null", () => {
      expect(domainSharedBackends.sharedBackendId.name).toBe("shared_backend_id");
      expect(domainSharedBackends.sharedBackendId.notNull).toBe(true);
    });

    it("should have createdAt with default", () => {
      expect(domainSharedBackends.createdAt.name).toBe("created_at");
      expect(domainSharedBackends.createdAt.hasDefault).toBe(true);
    });
  });

  describe("reused enums", () => {
    it("backendProtocolEnum includes http and https", () => {
      expect(backendProtocolEnum.enumValues).toContain("http");
      expect(backendProtocolEnum.enumValues).toContain("https");
    });

    it("loadBalanceMethodEnum includes all methods", () => {
      expect(loadBalanceMethodEnum.enumValues).toContain("roundrobin");
      expect(loadBalanceMethodEnum.enumValues).toContain("leastconn");
      expect(loadBalanceMethodEnum.enumValues).toContain("source");
      expect(loadBalanceMethodEnum.enumValues).toContain("first");
    });
  });
});
