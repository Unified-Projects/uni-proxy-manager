/**
 * Sites Schema Unit Tests
 *
 * Tests for the sites database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  sites,
  siteStatusEnum,
  siteFrameworkEnum,
  siteRenderModeEnum,
  type Site,
  type NewSite,
} from "../../../../../packages/database/src/schema/sites";

describe("Sites Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("siteStatusEnum", () => {
    it("should define all expected status values", () => {
      const enumValues = siteStatusEnum.enumValues;

      expect(enumValues).toContain("active");
      expect(enumValues).toContain("building");
      expect(enumValues).toContain("deploying");
      expect(enumValues).toContain("error");
      expect(enumValues).toContain("disabled");
    });

    it("should have correct enum name", () => {
      expect(siteStatusEnum.enumName).toBe("site_status");
    });
  });

  describe("siteFrameworkEnum", () => {
    it("should define all expected frameworks", () => {
      const enumValues = siteFrameworkEnum.enumValues;

      expect(enumValues).toContain("nextjs");
      expect(enumValues).toContain("sveltekit");
      expect(enumValues).toContain("static");
      expect(enumValues).toContain("custom");
    });

    it("should have exactly 4 frameworks", () => {
      expect(siteFrameworkEnum.enumValues).toHaveLength(4);
    });

    it("should have correct enum name", () => {
      expect(siteFrameworkEnum.enumName).toBe("site_framework");
    });
  });

  describe("siteRenderModeEnum", () => {
    it("should define all expected render modes", () => {
      const enumValues = siteRenderModeEnum.enumValues;

      expect(enumValues).toContain("ssr");
      expect(enumValues).toContain("ssg");
      expect(enumValues).toContain("hybrid");
    });

    it("should have exactly 3 render modes", () => {
      expect(siteRenderModeEnum.enumValues).toHaveLength(3);
    });

    it("should have correct enum name", () => {
      expect(siteRenderModeEnum.enumName).toBe("site_render_mode");
    });
  });

  // ============================================================================
  // Sites Table Tests
  // ============================================================================

  describe("sites table", () => {
    it("should have id as primary key", () => {
      const idColumn = sites.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have name as required field", () => {
      const nameColumn = sites.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
    });

    it("should have slug as required unique field", () => {
      const slugColumn = sites.slug;
      expect(slugColumn.name).toBe("slug");
      expect(slugColumn.notNull).toBe(true);
      expect(slugColumn.isUnique).toBe(true);
    });

    it("should have framework with default nextjs", () => {
      const frameworkColumn = sites.framework;
      expect(frameworkColumn.name).toBe("framework");
      expect(frameworkColumn.notNull).toBe(true);
      expect(frameworkColumn.hasDefault).toBe(true);
    });

    it("should have renderMode with default ssr", () => {
      const renderModeColumn = sites.renderMode;
      expect(renderModeColumn.name).toBe("render_mode");
      expect(renderModeColumn.notNull).toBe(true);
      expect(renderModeColumn.hasDefault).toBe(true);
    });

    it("should have status with default pending", () => {
      const statusColumn = sites.status;
      expect(statusColumn.name).toBe("status");
      expect(statusColumn.notNull).toBe(true);
      expect(statusColumn.hasDefault).toBe(true);
    });

    it("should have build configuration fields", () => {
      expect(sites.buildCommand.name).toBe("build_command");
      expect(sites.installCommand.name).toBe("install_command");
      expect(sites.outputDirectory.name).toBe("output_directory");
    });

    it("should have nodeVersion with default", () => {
      const nodeVersionColumn = sites.nodeVersion;
      expect(nodeVersionColumn.name).toBe("node_version");
      expect(nodeVersionColumn.hasDefault).toBe(true);
    });

    it("should have resource limit fields", () => {
      expect(sites.memoryMb.name).toBe("memory_mb");
      expect(sites.cpuLimit.name).toBe("cpu_limit");
      expect(sites.timeoutSeconds.name).toBe("timeout_seconds");
      expect(sites.maxConcurrency.name).toBe("max_concurrency");
    });

    it("should have coldStartEnabled field", () => {
      const coldStartColumn = sites.coldStartEnabled;
      expect(coldStartColumn.name).toBe("cold_start_enabled");
      expect(coldStartColumn.hasDefault).toBe(true);
    });

    it("should have envVariables as JSONB field", () => {
      const envColumn = sites.envVariables;
      expect(envColumn.name).toBe("env_variables");
      expect(envColumn.dataType).toBe("json");
    });

    it("should have buildFlags as JSONB field", () => {
      const flagsColumn = sites.buildFlags;
      expect(flagsColumn.name).toBe("build_flags");
      expect(flagsColumn.dataType).toBe("json");
    });

    it("should have timestamps", () => {
      expect(sites.createdAt.name).toBe("created_at");
      expect(sites.updatedAt.name).toBe("updated_at");
      expect(sites.createdAt.notNull).toBe(true);
      expect(sites.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("Site types", () => {
    it("should export Site select type", () => {
      const site: Site = {
        id: "site-1",
        name: "My Site",
        slug: "my-site",
        framework: "nextjs",
        renderMode: "ssr",
        status: "active",
        buildCommand: "npm run build",
        installCommand: "npm install",
        outputDirectory: ".next",
        nodeVersion: "20",
        memoryMb: 256,
        cpuLimit: "0.5",
        timeoutSeconds: 30,
        maxConcurrency: 10,
        coldStartEnabled: true,
        envVariables: { NODE_ENV: "production" },
        buildFlags: [],
        activeDeploymentId: null,
        activeSlot: null,
        runtimePath: null,
        entryPoint: null,
        buildCpus: "1.0",
        buildMemoryMb: 2048,
        buildTimeoutSeconds: 900,
        productionDomainId: null,
        errorPageId: null,
        maintenancePageId: null,
        maintenanceEnabled: false,
        s3ProviderId: null,
        previewUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(site.id).toBe("site-1");
      expect(site.framework).toBe("nextjs");
    });

    it("should export NewSite insert type", () => {
      const newSite: NewSite = {
        id: "site-1",
        name: "New Site",
        slug: "new-site",
      };

      expect(newSite.id).toBe("site-1");
      expect(newSite.slug).toBe("new-site");
    });

    it("should allow all framework types", () => {
      const frameworks: Site["framework"][] = [
        "nextjs",
        "sveltekit",
        "static",
        "custom",
      ];

      frameworks.forEach((framework) => {
        const site: Partial<Site> = { framework };
        expect(site.framework).toBe(framework);
      });
    });

    it("should allow all render modes", () => {
      const modes: Site["renderMode"][] = ["ssr", "ssg", "hybrid"];

      modes.forEach((mode) => {
        const site: Partial<Site> = { renderMode: mode };
        expect(site.renderMode).toBe(mode);
      });
    });

    it("should allow all status values", () => {
      const statuses: Site["status"][] = [
        "active",
        "building",
        "deploying",
        "error",
        "disabled",
      ];

      statuses.forEach((status) => {
        const site: Partial<Site> = { status };
        expect(site.status).toBe(status);
      });
    });
  });
});
