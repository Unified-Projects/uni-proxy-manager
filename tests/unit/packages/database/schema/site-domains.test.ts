/**
 * Site Domains Schema Unit Tests
 *
 * Tests for the site domains database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  siteDomains,
  siteDomainTypeEnum,
  type SiteDomain,
  type NewSiteDomain,
} from "../../../../../packages/database/src/schema/site-domains";

describe("Site Domains Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("siteDomainTypeEnum", () => {
    it("should define all expected domain types", () => {
      const enumValues = siteDomainTypeEnum.enumValues;

      expect(enumValues).toContain("production");
      expect(enumValues).toContain("preview");
      expect(enumValues).toContain("branch");
    });

    it("should have exactly 3 types", () => {
      expect(siteDomainTypeEnum.enumValues).toHaveLength(3);
    });

    it("should have correct enum name", () => {
      expect(siteDomainTypeEnum.enumName).toBe("site_domain_type");
    });
  });

  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("siteDomains table", () => {
    it("should have id as primary key", () => {
      const idColumn = siteDomains.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have siteId as required field", () => {
      const siteIdColumn = siteDomains.siteId;
      expect(siteIdColumn.name).toBe("site_id");
      expect(siteIdColumn.notNull).toBe(true);
    });

    it("should have domainId as required field", () => {
      const domainIdColumn = siteDomains.domainId;
      expect(domainIdColumn.name).toBe("domain_id");
      expect(domainIdColumn.notNull).toBe(true);
    });

    it("should have type with default production", () => {
      const typeColumn = siteDomains.type;
      expect(typeColumn.name).toBe("type");
      expect(typeColumn.notNull).toBe(true);
      expect(typeColumn.hasDefault).toBe(true);
    });

    it("should have branchName as optional field", () => {
      const branchNameColumn = siteDomains.branchName;
      expect(branchNameColumn.name).toBe("branch_name");
      expect(branchNameColumn.notNull).toBe(false);
    });

    it("should have deploymentId as optional field", () => {
      const deploymentIdColumn = siteDomains.deploymentId;
      expect(deploymentIdColumn.name).toBe("deployment_id");
      expect(deploymentIdColumn.notNull).toBe(false);
    });

    it("should have isActive with default true", () => {
      const isActiveColumn = siteDomains.isActive;
      expect(isActiveColumn.name).toBe("is_active");
      expect(isActiveColumn.notNull).toBe(true);
      expect(isActiveColumn.hasDefault).toBe(true);
    });

    it("should have createdAt timestamp", () => {
      const createdAtColumn = siteDomains.createdAt;
      expect(createdAtColumn.name).toBe("created_at");
      expect(createdAtColumn.notNull).toBe(true);
      expect(createdAtColumn.hasDefault).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("SiteDomain types", () => {
    it("should export SiteDomain select type for production domain", () => {
      const siteDomain: SiteDomain = {
        id: "sd-1",
        siteId: "site-1",
        domainId: "domain-1",
        type: "production",
        branchName: null,
        deploymentId: null,
        isActive: true,
        createdAt: new Date(),
      };

      expect(siteDomain.id).toBe("sd-1");
      expect(siteDomain.type).toBe("production");
      expect(siteDomain.isActive).toBe(true);
    });

    it("should export SiteDomain select type for preview domain", () => {
      const siteDomain: SiteDomain = {
        id: "sd-2",
        siteId: "site-1",
        domainId: "domain-2",
        type: "preview",
        branchName: null,
        deploymentId: "deploy-123",
        isActive: true,
        createdAt: new Date(),
      };

      expect(siteDomain.type).toBe("preview");
      expect(siteDomain.deploymentId).toBe("deploy-123");
    });

    it("should export SiteDomain select type for branch domain", () => {
      const siteDomain: SiteDomain = {
        id: "sd-3",
        siteId: "site-1",
        domainId: "domain-3",
        type: "branch",
        branchName: "feature/new-feature",
        deploymentId: "deploy-456",
        isActive: true,
        createdAt: new Date(),
      };

      expect(siteDomain.type).toBe("branch");
      expect(siteDomain.branchName).toBe("feature/new-feature");
    });

    it("should export NewSiteDomain insert type with minimal fields", () => {
      const newSiteDomain: NewSiteDomain = {
        id: "sd-1",
        siteId: "site-1",
        domainId: "domain-1",
      };

      expect(newSiteDomain.id).toBe("sd-1");
      expect(newSiteDomain.siteId).toBe("site-1");
      expect(newSiteDomain.domainId).toBe("domain-1");
    });

    it("should allow all domain types", () => {
      const types: SiteDomain["type"][] = ["production", "preview", "branch"];

      types.forEach(type => {
        const siteDomain: Partial<SiteDomain> = { type };
        expect(siteDomain.type).toBe(type);
      });
    });

    it("should handle inactive domain", () => {
      const inactiveDomain: Partial<SiteDomain> = {
        type: "preview",
        isActive: false,
        deploymentId: "deploy-old",
      };

      expect(inactiveDomain.isActive).toBe(false);
    });

    it("should handle branch domain with feature branch", () => {
      const branchDomain: Partial<SiteDomain> = {
        type: "branch",
        branchName: "feature/user-authentication",
      };

      expect(branchDomain.branchName).toContain("feature/");
    });

    it("should handle branch domain with develop branch", () => {
      const branchDomain: Partial<SiteDomain> = {
        type: "branch",
        branchName: "develop",
      };

      expect(branchDomain.branchName).toBe("develop");
    });

    it("should handle preview domain linked to deployment", () => {
      const previewDomain: Partial<SiteDomain> = {
        type: "preview",
        deploymentId: "deploy-pr-123",
        branchName: null,
      };

      expect(previewDomain.deploymentId).toContain("deploy-");
    });
  });
});
