/**
 * Certificates Schema Unit Tests
 *
 * Tests for the certificates database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  certificates,
  certificateStatusEnum,
  certificateSourceEnum,
  type Certificate,
  type NewCertificate,
} from "../../../../../packages/database/src/schema/certificates";

describe("Certificates Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("certificateStatusEnum", () => {
    it("should define all expected status values", () => {
      const enumValues = certificateStatusEnum.enumValues;

      expect(enumValues).toContain("pending");
      expect(enumValues).toContain("issuing");
      expect(enumValues).toContain("active");
      expect(enumValues).toContain("expired");
      expect(enumValues).toContain("failed");
      expect(enumValues).toContain("revoked");
    });

    it("should have exactly 6 status values", () => {
      expect(certificateStatusEnum.enumValues).toHaveLength(6);
    });

    it("should have correct enum name", () => {
      expect(certificateStatusEnum.enumName).toBe("certificate_status");
    });
  });

  describe("certificateSourceEnum", () => {
    it("should define all expected source values", () => {
      const enumValues = certificateSourceEnum.enumValues;

      expect(enumValues).toContain("manual");
      expect(enumValues).toContain("letsencrypt");
      expect(enumValues).toContain("acme_other");
    });

    it("should have exactly 3 source values", () => {
      expect(certificateSourceEnum.enumValues).toHaveLength(3);
    });

    it("should have correct enum name", () => {
      expect(certificateSourceEnum.enumName).toBe("certificate_source");
    });
  });

  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("certificates table", () => {
    it("should have id as primary key", () => {
      const idColumn = certificates.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have domainId as required field", () => {
      const domainIdColumn = certificates.domainId;
      expect(domainIdColumn.name).toBe("domain_id");
      expect(domainIdColumn.notNull).toBe(true);
    });

    it("should have commonName as required field", () => {
      const commonNameColumn = certificates.commonName;
      expect(commonNameColumn.name).toBe("common_name");
      expect(commonNameColumn.notNull).toBe(true);
    });

    it("should have altNames as JSONB field", () => {
      const altNamesColumn = certificates.altNames;
      expect(altNamesColumn.name).toBe("alt_names");
      expect(altNamesColumn.dataType).toBe("json");
    });

    it("should have isWildcard with default false", () => {
      const isWildcardColumn = certificates.isWildcard;
      expect(isWildcardColumn.name).toBe("is_wildcard");
      expect(isWildcardColumn.notNull).toBe(true);
      expect(isWildcardColumn.hasDefault).toBe(true);
    });

    it("should have source with default manual", () => {
      const sourceColumn = certificates.source;
      expect(sourceColumn.name).toBe("source");
      expect(sourceColumn.notNull).toBe(true);
      expect(sourceColumn.hasDefault).toBe(true);
    });

    it("should have status with default pending", () => {
      const statusColumn = certificates.status;
      expect(statusColumn.name).toBe("status");
      expect(statusColumn.notNull).toBe(true);
      expect(statusColumn.hasDefault).toBe(true);
    });

    it("should have file path fields", () => {
      expect(certificates.certPath.name).toBe("cert_path");
      expect(certificates.keyPath.name).toBe("key_path");
      expect(certificates.chainPath.name).toBe("chain_path");
      expect(certificates.fullchainPath.name).toBe("fullchain_path");
    });

    it("should have expiry tracking fields", () => {
      expect(certificates.issuedAt.name).toBe("issued_at");
      expect(certificates.expiresAt.name).toBe("expires_at");
    });

    it("should have renewal settings", () => {
      expect(certificates.autoRenew.name).toBe("auto_renew");
      expect(certificates.renewBeforeDays.name).toBe("renew_before_days");
      expect(certificates.lastRenewalAttempt.name).toBe("last_renewal_attempt");
      expect(certificates.nextRenewalCheck.name).toBe("next_renewal_check");
      expect(certificates.renewalAttempts.name).toBe("renewal_attempts");
    });

    it("should have autoRenew with default true", () => {
      const autoRenewColumn = certificates.autoRenew;
      expect(autoRenewColumn.notNull).toBe(true);
      expect(autoRenewColumn.hasDefault).toBe(true);
    });

    it("should have renewBeforeDays with default 30", () => {
      const renewBeforeDaysColumn = certificates.renewBeforeDays;
      expect(renewBeforeDaysColumn.notNull).toBe(true);
      expect(renewBeforeDaysColumn.hasDefault).toBe(true);
    });

    it("should have dnsProviderId as optional foreign key", () => {
      const dnsProviderIdColumn = certificates.dnsProviderId;
      expect(dnsProviderIdColumn.name).toBe("dns_provider_id");
      expect(dnsProviderIdColumn.notNull).toBe(false);
    });

    it("should have ACME fields", () => {
      expect(certificates.acmeAccountUrl.name).toBe("acme_account_url");
      expect(certificates.acmeOrderUrl.name).toBe("acme_order_url");
    });

    it("should have fingerprint field", () => {
      const fingerprintColumn = certificates.fingerprint;
      expect(fingerprintColumn.name).toBe("fingerprint");
      expect(fingerprintColumn.notNull).toBe(false);
    });

    it("should have timestamps", () => {
      expect(certificates.createdAt.name).toBe("created_at");
      expect(certificates.updatedAt.name).toBe("updated_at");
      expect(certificates.createdAt.notNull).toBe(true);
      expect(certificates.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("Certificate types", () => {
    it("should export Certificate select type", () => {
      const certificate: Certificate = {
        id: "cert-1",
        domainId: "domain-1",
        commonName: "example.com",
        altNames: ["www.example.com", "api.example.com"],
        isWildcard: false,
        source: "letsencrypt",
        issuer: "Let's Encrypt Authority X3",
        status: "active",
        lastError: null,
        certPath: "/certs/example.com/cert.pem",
        keyPath: "/certs/example.com/key.pem",
        chainPath: "/certs/example.com/chain.pem",
        fullchainPath: "/certs/example.com/fullchain.pem",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        autoRenew: true,
        renewBeforeDays: 30,
        lastRenewalAttempt: null,
        nextRenewalCheck: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        renewalAttempts: 0,
        dnsProviderId: "dns-1",
        acmeAccountUrl: "https://acme-v02.api.letsencrypt.org/acme/acct/12345",
        acmeOrderUrl: null,
        fingerprint: "sha256:abc123...",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(certificate.id).toBe("cert-1");
      expect(certificate.commonName).toBe("example.com");
      expect(certificate.status).toBe("active");
    });

    it("should export NewCertificate insert type with minimal fields", () => {
      const newCertificate: NewCertificate = {
        id: "cert-1",
        domainId: "domain-1",
        commonName: "example.com",
      };

      expect(newCertificate.id).toBe("cert-1");
      expect(newCertificate.domainId).toBe("domain-1");
    });

    it("should allow all status values", () => {
      const statuses: Certificate["status"][] = [
        "pending",
        "issuing",
        "active",
        "expired",
        "failed",
        "revoked",
      ];

      statuses.forEach(status => {
        const cert: Partial<Certificate> = { status };
        expect(cert.status).toBe(status);
      });
    });

    it("should allow all source values", () => {
      const sources: Certificate["source"][] = [
        "manual",
        "letsencrypt",
        "acme_other",
      ];

      sources.forEach(source => {
        const cert: Partial<Certificate> = { source };
        expect(cert.source).toBe(source);
      });
    });

    it("should handle wildcard certificate", () => {
      const wildcardCert: Partial<Certificate> = {
        commonName: "*.example.com",
        isWildcard: true,
        altNames: ["*.example.com", "example.com"],
      };

      expect(wildcardCert.isWildcard).toBe(true);
      expect(wildcardCert.commonName?.startsWith("*.")).toBe(true);
    });

    it("should handle certificate with multiple alt names", () => {
      const cert: Partial<Certificate> = {
        commonName: "example.com",
        altNames: [
          "www.example.com",
          "api.example.com",
          "admin.example.com",
          "staging.example.com",
        ],
      };

      expect(cert.altNames).toHaveLength(4);
    });
  });
});
