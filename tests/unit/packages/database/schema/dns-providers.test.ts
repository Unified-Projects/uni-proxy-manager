/**
 * DNS Providers Schema Unit Tests
 *
 * Tests for the dns providers database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  dnsProviders,
  dnsProviderTypeEnum,
  type DnsProvider,
  type NewDnsProvider,
  type CloudflareCredentials,
  type NamecheapCredentials,
  type DnsProviderCredentials,
} from "../../../../../packages/database/src/schema/dns-providers";

describe("DNS Providers Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("dnsProviderTypeEnum", () => {
    it("should define cloudflare and namecheap types", () => {
      const enumValues = dnsProviderTypeEnum.enumValues;

      expect(enumValues).toContain("cloudflare");
      expect(enumValues).toContain("namecheap");
    });

    it("should have exactly 2 types", () => {
      expect(dnsProviderTypeEnum.enumValues).toHaveLength(2);
    });

    it("should have correct enum name", () => {
      expect(dnsProviderTypeEnum.enumName).toBe("dns_provider_type");
    });
  });

  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("dnsProviders table", () => {
    it("should have id as primary key", () => {
      const idColumn = dnsProviders.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have name as required field", () => {
      const nameColumn = dnsProviders.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
    });

    it("should have type as required field", () => {
      const typeColumn = dnsProviders.type;
      expect(typeColumn.name).toBe("type");
      expect(typeColumn.notNull).toBe(true);
    });

    it("should have credentials as required JSONB field", () => {
      const credentialsColumn = dnsProviders.credentials;
      expect(credentialsColumn.name).toBe("credentials");
      expect(credentialsColumn.notNull).toBe(true);
      expect(credentialsColumn.dataType).toBe("json");
    });

    it("should have isDefault with default false", () => {
      const isDefaultColumn = dnsProviders.isDefault;
      expect(isDefaultColumn.name).toBe("is_default");
      expect(isDefaultColumn.notNull).toBe(true);
      expect(isDefaultColumn.hasDefault).toBe(true);
    });

    it("should have lastValidated as optional timestamp", () => {
      const lastValidatedColumn = dnsProviders.lastValidated;
      expect(lastValidatedColumn.name).toBe("last_validated");
      expect(lastValidatedColumn.notNull).toBe(false);
    });

    it("should have validationError as optional text", () => {
      const validationErrorColumn = dnsProviders.validationError;
      expect(validationErrorColumn.name).toBe("validation_error");
      expect(validationErrorColumn.notNull).toBe(false);
    });

    it("should have timestamps", () => {
      expect(dnsProviders.createdAt.name).toBe("created_at");
      expect(dnsProviders.updatedAt.name).toBe("updated_at");
      expect(dnsProviders.createdAt.notNull).toBe(true);
      expect(dnsProviders.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Credential Type Tests
  // ============================================================================

  describe("CloudflareCredentials type", () => {
    it("should support API token method", () => {
      const creds: CloudflareCredentials = {
        apiToken: "cf_token_abc123",
      };

      expect(creds.apiToken).toBe("cf_token_abc123");
    });

    it("should support global API key method", () => {
      const creds: CloudflareCredentials = {
        email: "admin@example.com",
        apiKey: "global_api_key_123",
      };

      expect(creds.email).toBe("admin@example.com");
      expect(creds.apiKey).toBe("global_api_key_123");
    });

    it("should allow both methods simultaneously", () => {
      const creds: CloudflareCredentials = {
        apiToken: "cf_token_abc123",
        email: "admin@example.com",
        apiKey: "global_api_key_123",
      };

      expect(creds.apiToken).toBeDefined();
      expect(creds.email).toBeDefined();
    });
  });

  describe("NamecheapCredentials type", () => {
    it("should require apiUser, apiKey, and clientIp", () => {
      const creds: NamecheapCredentials = {
        apiUser: "ncuser",
        apiKey: "nc_api_key_123",
        clientIp: "1.2.3.4",
      };

      expect(creds.apiUser).toBe("ncuser");
      expect(creds.apiKey).toBe("nc_api_key_123");
      expect(creds.clientIp).toBe("1.2.3.4");
    });

    it("should allow optional username", () => {
      const creds: NamecheapCredentials = {
        apiUser: "ncuser",
        apiKey: "nc_api_key_123",
        clientIp: "1.2.3.4",
        username: "different_user",
      };

      expect(creds.username).toBe("different_user");
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("DnsProvider types", () => {
    it("should export DnsProvider select type for Cloudflare", () => {
      const provider: DnsProvider = {
        id: "dns-1",
        name: "Cloudflare Production",
        type: "cloudflare",
        credentials: {
          apiToken: "cf_token_abc123",
        },
        isDefault: true,
        lastValidated: new Date(),
        validationError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(provider.id).toBe("dns-1");
      expect(provider.type).toBe("cloudflare");
    });

    it("should export DnsProvider select type for Namecheap", () => {
      const provider: DnsProvider = {
        id: "dns-2",
        name: "Namecheap Provider",
        type: "namecheap",
        credentials: {
          apiUser: "ncuser",
          apiKey: "nc_key_123",
          clientIp: "1.2.3.4",
        },
        isDefault: false,
        lastValidated: null,
        validationError: "API key invalid",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(provider.id).toBe("dns-2");
      expect(provider.type).toBe("namecheap");
      expect(provider.validationError).toBe("API key invalid");
    });

    it("should export NewDnsProvider insert type with minimal fields", () => {
      const newProvider: NewDnsProvider = {
        id: "dns-1",
        name: "New Provider",
        type: "cloudflare",
        credentials: {
          apiToken: "token",
        },
      };

      expect(newProvider.id).toBe("dns-1");
      expect(newProvider.name).toBe("New Provider");
    });

    it("should allow all provider types", () => {
      const types: DnsProvider["type"][] = ["cloudflare", "namecheap"];

      types.forEach(type => {
        const provider: Partial<DnsProvider> = { type };
        expect(provider.type).toBe(type);
      });
    });

    it("should handle provider with validation error", () => {
      const provider: Partial<DnsProvider> = {
        lastValidated: new Date(),
        validationError: "Authentication failed: Invalid API token",
      };

      expect(provider.validationError).toBeDefined();
      expect(provider.lastValidated).toBeDefined();
    });
  });

  // ============================================================================
  // Union Type Tests
  // ============================================================================

  describe("DnsProviderCredentials union type", () => {
    it("should accept Cloudflare credentials", () => {
      const creds: DnsProviderCredentials = {
        apiToken: "cf_token_123",
      };

      expect("apiToken" in creds).toBe(true);
    });

    it("should accept Namecheap credentials", () => {
      const creds: DnsProviderCredentials = {
        apiUser: "user",
        apiKey: "key",
        clientIp: "1.2.3.4",
      };

      expect("apiUser" in creds).toBe(true);
      expect("clientIp" in creds).toBe(true);
    });
  });
});
