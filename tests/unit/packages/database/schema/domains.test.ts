/**
 * Domains Schema Unit Tests
 *
 * Tests for the domains database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  domains,
  domainStatusEnum,
  acmeVerificationMethodEnum,
  type Domain,
  type NewDomain,
} from "../../../../../packages/database/src/schema/domains";

describe("Domains Schema", () => {
  describe("domainStatusEnum", () => {
    it("should define all expected status values", () => {
      const enumValues = domainStatusEnum.enumValues;

      expect(enumValues).toContain("active");
      expect(enumValues).toContain("pending");
      expect(enumValues).toContain("disabled");
      expect(enumValues).toContain("error");
    });

    it("should have exactly 4 status values", () => {
      expect(domainStatusEnum.enumValues).toHaveLength(4);
    });

    it("should have correct enum name", () => {
      expect(domainStatusEnum.enumName).toBe("domain_status");
    });
  });

  describe("acmeVerificationMethodEnum", () => {
    it("should define all expected verification methods", () => {
      const enumValues = acmeVerificationMethodEnum.enumValues;

      expect(enumValues).toContain("dns-01");
      expect(enumValues).toContain("http-01");
      expect(enumValues).toContain("none");
    });

    it("should have exactly 3 verification methods", () => {
      expect(acmeVerificationMethodEnum.enumValues).toHaveLength(3);
    });

    it("should have correct enum name", () => {
      expect(acmeVerificationMethodEnum.enumName).toBe("acme_verification_method");
    });
  });

  describe("domains table", () => {
    it("should have id as primary key", () => {
      const idColumn = domains.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have hostname as required unique field", () => {
      const hostnameColumn = domains.hostname;
      expect(hostnameColumn.name).toBe("hostname");
      expect(hostnameColumn.notNull).toBe(true);
      expect(hostnameColumn.isUnique).toBe(true);
    });

    it("should have displayName as optional field", () => {
      const displayNameColumn = domains.displayName;
      expect(displayNameColumn.name).toBe("display_name");
      expect(displayNameColumn.notNull).toBe(false);
    });

    it("should have status with default pending", () => {
      const statusColumn = domains.status;
      expect(statusColumn.name).toBe("status");
      expect(statusColumn.notNull).toBe(true);
      expect(statusColumn.hasDefault).toBe(true);
    });

    it("should have sslEnabled with default true", () => {
      const sslColumn = domains.sslEnabled;
      expect(sslColumn.name).toBe("ssl_enabled");
      expect(sslColumn.notNull).toBe(true);
      expect(sslColumn.hasDefault).toBe(true);
    });

    it("should have forceHttps with default true", () => {
      const forceHttpsColumn = domains.forceHttps;
      expect(forceHttpsColumn.name).toBe("force_https");
      expect(forceHttpsColumn.notNull).toBe(true);
      expect(forceHttpsColumn.hasDefault).toBe(true);
    });

    it("should have maintenanceEnabled with default false", () => {
      const maintenanceColumn = domains.maintenanceEnabled;
      expect(maintenanceColumn.name).toBe("maintenance_enabled");
      expect(maintenanceColumn.notNull).toBe(true);
      expect(maintenanceColumn.hasDefault).toBe(true);
    });

    it("should have maintenanceBypassIps as JSONB field", () => {
      const bypassColumn = domains.maintenanceBypassIps;
      expect(bypassColumn.name).toBe("maintenance_bypass_ips");
      expect(bypassColumn.dataType).toBe("json");
    });

    it("should have configVersion with default 0", () => {
      const configVersionColumn = domains.configVersion;
      expect(configVersionColumn.name).toBe("config_version");
      expect(configVersionColumn.notNull).toBe(true);
      expect(configVersionColumn.hasDefault).toBe(true);
    });

    it("should have createdAt timestamp", () => {
      const createdAtColumn = domains.createdAt;
      expect(createdAtColumn.name).toBe("created_at");
      expect(createdAtColumn.notNull).toBe(true);
      expect(createdAtColumn.hasDefault).toBe(true);
    });

    it("should have updatedAt timestamp", () => {
      const updatedAtColumn = domains.updatedAt;
      expect(updatedAtColumn.name).toBe("updated_at");
      expect(updatedAtColumn.notNull).toBe(true);
      expect(updatedAtColumn.hasDefault).toBe(true);
    });

    it("should have foreign key columns", () => {
      expect(domains.acmeDnsProviderId.name).toBe("acme_dns_provider_id");
      expect(domains.errorPageId.name).toBe("error_page_id");
      expect(domains.maintenancePageId.name).toBe("maintenance_page_id");
      expect(domains.certificateId.name).toBe("certificate_id");
    });
  });

  describe("Domain types", () => {
    it("should export Domain select type", () => {
      const domain: Domain = {
        id: "test-id",
        hostname: "example.com",
        displayName: "Example",
        status: "active",
        sslEnabled: true,
        forceHttps: true,
        acmeVerificationMethod: "dns-01",
        acmeDnsProviderId: null,
        maintenanceEnabled: false,
        maintenanceBypassIps: [],
        errorPageId: null,
        maintenancePageId: null,
        certificateId: null,
        configVersion: 0,
        lastConfigUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(domain.id).toBe("test-id");
      expect(domain.hostname).toBe("example.com");
    });

    it("should export NewDomain insert type", () => {
      const newDomain: NewDomain = {
        id: "test-id",
        hostname: "example.com",
      };

      expect(newDomain.id).toBe("test-id");
      expect(newDomain.hostname).toBe("example.com");
    });
  });
});
