/**
 * Sites Extension Job Types Unit Tests
 *
 * Tests for all Sites extension job data types and result types.
 */

import { describe, expect, it } from "vitest";
import type {
  SiteBuildJobData,
  SiteDeployJobData,
  SiteAnalyticsJobData,
  GitHubSyncJobData,
  PreviewGenerateJobData,
  HaproxySiteConfigJobData,
  SiteBuildResult,
  SiteDeployResult,
  PreviewGenerateResult,
  SiteKeepAliveJobData,
  SiteKeepAliveResult,
  MaintenanceCleanupJobData,
  MaintenanceCleanupResult,
} from "../src/types";

describe("Sites Extension Job Types", () => {
  describe("SiteBuildJobData", () => {
    it("has required fields", () => {
      const jobData: SiteBuildJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        branch: "main",
        envVariables: {
          NODE_ENV: "production",
          API_URL: "https://api.example.com",
        },
        buildCommand: "npm run build",
        installCommand: "npm install",
        nodeVersion: "20",
        framework: "nextjs",
        buildConfig: {
          cpus: 2,
          memoryMb: 4096,
          timeoutSeconds: 600,
        },
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.deploymentId).toBe("deploy-456");
      expect(jobData.branch).toBe("main");
      expect(jobData.framework).toBe("nextjs");
      expect(jobData.buildConfig.cpus).toBe(2);
      expect(jobData.buildConfig.memoryMb).toBe(4096);
      expect(jobData.buildConfig.timeoutSeconds).toBe(600);
    });

    it("supports optional fields", () => {
      const jobData: SiteBuildJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        branch: "main",
        commitSha: "abc123def456",
        envVariables: {},
        buildCommand: "npm run build",
        installCommand: "npm install",
        nodeVersion: "20",
        framework: "sveltekit",
        buildFlags: ["--no-lint", "--production"],
        outputDirectory: ".next",
        sourcePath: "/tmp/builds/site-123",
        buildConfig: {
          cpus: 1,
          memoryMb: 2048,
          timeoutSeconds: 300,
        },
      };

      expect(jobData.commitSha).toBe("abc123def456");
      expect(jobData.buildFlags).toEqual(["--no-lint", "--production"]);
      expect(jobData.outputDirectory).toBe(".next");
      expect(jobData.sourcePath).toBe("/tmp/builds/site-123");
    });

    it("accepts all framework types", () => {
      const frameworks: Array<SiteBuildJobData["framework"]> = [
        "nextjs",
        "sveltekit",
        "static",
        "custom",
      ];

      frameworks.forEach((framework) => {
        const jobData: SiteBuildJobData = {
          siteId: "site-123",
          deploymentId: "deploy-456",
          branch: "main",
          envVariables: {},
          buildCommand: "npm run build",
          installCommand: "npm install",
          nodeVersion: "20",
          framework,
          buildConfig: {
            cpus: 1,
            memoryMb: 1024,
            timeoutSeconds: 300,
          },
        };

        expect(jobData.framework).toBe(framework);
      });
    });

    it("validates buildConfig is required", () => {
      const requiredBuildConfigFields = ["cpus", "memoryMb", "timeoutSeconds"];

      const jobData: SiteBuildJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        branch: "main",
        envVariables: {},
        buildCommand: "npm run build",
        installCommand: "npm install",
        nodeVersion: "20",
        framework: "nextjs",
        buildConfig: {
          cpus: 4,
          memoryMb: 8192,
          timeoutSeconds: 1200,
        },
      };

      requiredBuildConfigFields.forEach((field) => {
        expect(jobData.buildConfig).toHaveProperty(field);
      });
    });

    it("supports different node versions", () => {
      const nodeVersions = ["18", "20", "22"];

      nodeVersions.forEach((nodeVersion) => {
        const jobData: SiteBuildJobData = {
          siteId: "site-123",
          deploymentId: "deploy-456",
          branch: "main",
          envVariables: {},
          buildCommand: "npm run build",
          installCommand: "npm install",
          nodeVersion,
          framework: "nextjs",
          buildConfig: { cpus: 1, memoryMb: 1024, timeoutSeconds: 300 },
        };

        expect(jobData.nodeVersion).toBe(nodeVersion);
      });
    });
  });

  describe("SiteDeployJobData", () => {
    it("has required fields", () => {
      const jobData: SiteDeployJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        targetSlot: "blue",
        artifactPath: "sites/my-app/deployments/1/artifact.tar.gz",
        runtimeConfig: {
          cpus: 1,
          memoryMb: 512,
          timeout: 30,
        },
      };

      expect(jobData.targetSlot).toBe("blue");
      expect(jobData.artifactPath).toContain("artifact.tar.gz");
      expect(jobData.runtimeConfig.cpus).toBe(1);
      expect(jobData.runtimeConfig.memoryMb).toBe(512);
    });

    it("supports optional runtime fields", () => {
      const jobData: SiteDeployJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        targetSlot: "green",
        artifactPath: "artifact.tar.gz",
        runtimeConfig: {
          cpus: 2,
          memoryMb: 1024,
          timeout: 60,
        },
        entryPoint: "server.js",
        runtimePath: ".next/standalone",
      };

      expect(jobData.entryPoint).toBe("server.js");
      expect(jobData.runtimePath).toBe(".next/standalone");
    });

    it("accepts blue and green slots", () => {
      const slots: Array<SiteDeployJobData["targetSlot"]> = ["blue", "green"];

      slots.forEach((slot) => {
        const jobData: SiteDeployJobData = {
          siteId: "site-123",
          deploymentId: "deploy-456",
          targetSlot: slot,
          artifactPath: "artifact.tar.gz",
          runtimeConfig: { cpus: 1, memoryMb: 256, timeout: 15 },
        };

        expect(jobData.targetSlot).toBe(slot);
      });
    });

    it("validates runtimeConfig has all required fields", () => {
      const requiredFields = ["cpus", "memoryMb", "timeout"];

      const jobData: SiteDeployJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        targetSlot: "blue",
        artifactPath: "artifact.tar.gz",
        runtimeConfig: { cpus: 2, memoryMb: 512, timeout: 30 },
      };

      requiredFields.forEach((field) => {
        expect(jobData.runtimeConfig).toHaveProperty(field);
      });
    });
  });

  describe("SiteAnalyticsJobData", () => {
    it("has required fields", () => {
      const timestamp = new Date().toISOString();
      const jobData: SiteAnalyticsJobData = {
        siteId: "site-123",
        timestamp,
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.timestamp).toBe(timestamp);
    });

    it("accepts ISO timestamp strings", () => {
      const jobData: SiteAnalyticsJobData = {
        siteId: "site-123",
        timestamp: "2025-01-15T10:30:00.000Z",
      };

      expect(jobData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("GitHubSyncJobData", () => {
    it("has required fields", () => {
      const jobData: GitHubSyncJobData = {
        siteId: "site-123",
        installationId: 12345678,
        action: "sync_all",
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.installationId).toBe(12345678);
      expect(jobData.action).toBe("sync_all");
    });

    it("accepts all action types", () => {
      const actions: Array<GitHubSyncJobData["action"]> = [
        "refresh_token",
        "fetch_branches",
        "check_commit",
        "sync_all",
      ];

      actions.forEach((action) => {
        const jobData: GitHubSyncJobData = {
          siteId: "site-123",
          installationId: 12345678,
          action,
        };

        expect(jobData.action).toBe(action);
      });
    });

    it("validates installationId is a number", () => {
      const jobData: GitHubSyncJobData = {
        siteId: "site-123",
        installationId: 98765432,
        action: "fetch_branches",
      };

      expect(typeof jobData.installationId).toBe("number");
      expect(jobData.installationId).toBeGreaterThan(0);
    });
  });

  describe("PreviewGenerateJobData", () => {
    it("has required fields", () => {
      const jobData: PreviewGenerateJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        slug: "my-app",
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.deploymentId).toBe("deploy-456");
      expect(jobData.slug).toBe("my-app");
    });

    it("supports optional URL", () => {
      const jobData: PreviewGenerateJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        slug: "my-app",
        url: "https://my-app.preview.example.com",
      };

      expect(jobData.url).toBe("https://my-app.preview.example.com");
    });

    it("validates slug format", () => {
      const validSlugs = ["my-app", "test-site-123", "app"];

      validSlugs.forEach((slug) => {
        const jobData: PreviewGenerateJobData = {
          siteId: "site-123",
          deploymentId: "deploy-456",
          slug,
        };

        expect(jobData.slug).toBe(slug);
      });
    });
  });

  describe("HaproxySiteConfigJobData", () => {
    it("has required fields", () => {
      const jobData: HaproxySiteConfigJobData = {
        siteId: "site-123",
        activeSlot: "blue",
        action: "add",
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.activeSlot).toBe("blue");
      expect(jobData.action).toBe("add");
    });

    it("accepts all action types", () => {
      const actions: Array<HaproxySiteConfigJobData["action"]> = [
        "add",
        "update",
        "remove",
      ];

      actions.forEach((action) => {
        const jobData: HaproxySiteConfigJobData = {
          siteId: "site-123",
          activeSlot: "green",
          action,
        };

        expect(jobData.action).toBe(action);
      });
    });

    it("accepts blue and green slots", () => {
      const slots: Array<HaproxySiteConfigJobData["activeSlot"]> = [
        "blue",
        "green",
      ];

      slots.forEach((activeSlot) => {
        const jobData: HaproxySiteConfigJobData = {
          siteId: "site-123",
          activeSlot,
          action: "update",
        };

        expect(jobData.activeSlot).toBe(activeSlot);
      });
    });
  });

  describe("SiteKeepAliveJobData", () => {
    it("has required siteId field", () => {
      const jobData: SiteKeepAliveJobData = {
        siteId: "site-123",
      };

      expect(jobData.siteId).toBe("site-123");
    });

    it("supports wildcard siteId for all sites", () => {
      const jobData: SiteKeepAliveJobData = {
        siteId: "*",
      };

      expect(jobData.siteId).toBe("*");
    });
  });

  describe("MaintenanceCleanupJobData", () => {
    it("has required type field", () => {
      const jobData: MaintenanceCleanupJobData = {
        type: "all",
      };

      expect(jobData.type).toBe("all");
    });

    it("accepts all cleanup types", () => {
      const types: Array<MaintenanceCleanupJobData["type"]> = [
        "all",
        "certificates",
        "sites",
        "deployments",
      ];

      types.forEach((type) => {
        const jobData: MaintenanceCleanupJobData = { type };
        expect(jobData.type).toBe(type);
      });
    });
  });
});

describe("Sites Extension Result Types", () => {
  describe("SiteBuildResult", () => {
    it("represents successful build", () => {
      const result: SiteBuildResult = {
        success: true,
        deploymentId: "deploy-456",
        artifactPath: "sites/my-app/artifact.tar.gz",
        artifactSize: 52428800,
        buildDurationMs: 120000,
      };

      expect(result.success).toBe(true);
      expect(result.artifactPath).toBeTruthy();
      expect(result.artifactSize).toBe(52428800);
      expect(result.buildDurationMs).toBe(120000);
    });

    it("represents failed build", () => {
      const result: SiteBuildResult = {
        success: false,
        deploymentId: "deploy-456",
        error: "Build failed: npm install returned exit code 1",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("Build failed");
      expect(result.artifactPath).toBeUndefined();
    });

    it("includes detected SSR information on success", () => {
      const result: SiteBuildResult = {
        success: true,
        deploymentId: "deploy-456",
        artifactPath: "artifact.tar.gz",
        detectedRenderMode: "ssr",
        detectedEntryPoint: "server.js",
        detectedRuntimePath: ".next/standalone",
      };

      expect(result.detectedRenderMode).toBe("ssr");
      expect(result.detectedEntryPoint).toBe("server.js");
      expect(result.detectedRuntimePath).toBe(".next/standalone");
    });

    it("includes detected SSG information on success", () => {
      const result: SiteBuildResult = {
        success: true,
        deploymentId: "deploy-456",
        artifactPath: "artifact.tar.gz",
        detectedRenderMode: "ssg",
      };

      expect(result.detectedRenderMode).toBe("ssg");
    });
  });

  describe("SiteDeployResult", () => {
    it("represents successful deployment", () => {
      const result: SiteDeployResult = {
        success: true,
        deploymentId: "deploy-456",
        runtimeId: "site-123-blue",
        slot: "blue",
      };

      expect(result.success).toBe(true);
      expect(result.runtimeId).toBe("site-123-blue");
      expect(result.slot).toBe("blue");
    });

    it("represents failed deployment", () => {
      const result: SiteDeployResult = {
        success: false,
        deploymentId: "deploy-456",
        slot: "green",
        error: "Runtime creation failed: timeout",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
      expect(result.runtimeId).toBeUndefined();
    });

    it("includes slot information on both success and failure", () => {
      const successResult: SiteDeployResult = {
        success: true,
        deploymentId: "deploy-456",
        slot: "blue",
        runtimeId: "runtime-123",
      };

      const failResult: SiteDeployResult = {
        success: false,
        deploymentId: "deploy-456",
        slot: "green",
        error: "Failed",
      };

      expect(successResult.slot).toBe("blue");
      expect(failResult.slot).toBe("green");
    });
  });

  describe("PreviewGenerateResult", () => {
    it("represents successful preview generation", () => {
      const result: PreviewGenerateResult = {
        success: true,
        deploymentId: "deploy-456",
        previewUrl: "https://deploy-456.preview.example.com",
      };

      expect(result.success).toBe(true);
      expect(result.previewUrl).toContain("deploy-456");
    });

    it("represents failed preview generation", () => {
      const result: PreviewGenerateResult = {
        success: false,
        deploymentId: "deploy-456",
        error: "Screenshot capture failed",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.previewUrl).toBeUndefined();
    });
  });

  describe("SiteKeepAliveResult", () => {
    it("represents successful keep-alive ping", () => {
      const result: SiteKeepAliveResult = {
        success: true,
        siteId: "site-123",
        responseTimeMs: 150,
        statusCode: 200,
      };

      expect(result.success).toBe(true);
      expect(result.responseTimeMs).toBe(150);
      expect(result.statusCode).toBe(200);
    });

    it("represents failed keep-alive ping", () => {
      const result: SiteKeepAliveResult = {
        success: false,
        siteId: "site-123",
        error: "Connection timeout",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection timeout");
    });

    it("includes response time on failure with partial success", () => {
      const result: SiteKeepAliveResult = {
        success: false,
        siteId: "site-123",
        responseTimeMs: 5000,
        statusCode: 502,
        error: "Bad gateway",
      };

      expect(result.success).toBe(false);
      expect(result.responseTimeMs).toBe(5000);
      expect(result.statusCode).toBe(502);
    });
  });

  describe("MaintenanceCleanupResult", () => {
    it("represents successful cleanup", () => {
      const result: MaintenanceCleanupResult = {
        success: true,
        cleanedCertificateDirs: 5,
        cleanedSiteSourceDirs: 3,
        cleanedDeploymentArtifacts: 10,
        errors: [],
      };

      expect(result.success).toBe(true);
      expect(result.cleanedCertificateDirs).toBe(5);
      expect(result.cleanedSiteSourceDirs).toBe(3);
      expect(result.cleanedDeploymentArtifacts).toBe(10);
      expect(result.errors).toHaveLength(0);
    });

    it("represents partial cleanup with errors", () => {
      const result: MaintenanceCleanupResult = {
        success: false,
        cleanedCertificateDirs: 3,
        cleanedSiteSourceDirs: 0,
        cleanedDeploymentArtifacts: 5,
        errors: [
          "Failed to remove /data/sites/orphaned-123",
          "Permission denied for /data/certs/old-cert",
        ],
      };

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain("orphaned");
    });
  });
});

describe("Job Data Validation Helpers", () => {
  it("validates SiteBuildJobData has all required fields", () => {
    const requiredFields = [
      "siteId",
      "deploymentId",
      "branch",
      "envVariables",
      "buildCommand",
      "installCommand",
      "nodeVersion",
      "framework",
      "buildConfig",
    ];

    const jobData: SiteBuildJobData = {
      siteId: "site-123",
      deploymentId: "deploy-456",
      branch: "main",
      envVariables: {},
      buildCommand: "npm run build",
      installCommand: "npm install",
      nodeVersion: "20",
      framework: "nextjs",
      buildConfig: {
        cpus: 2,
        memoryMb: 4096,
        timeoutSeconds: 600,
      },
    };

    requiredFields.forEach((field) => {
      expect(jobData).toHaveProperty(field);
      expect((jobData as Record<string, unknown>)[field]).not.toBeUndefined();
    });
  });

  it("validates SiteDeployJobData has all required fields", () => {
    const requiredFields = [
      "siteId",
      "deploymentId",
      "targetSlot",
      "artifactPath",
      "runtimeConfig",
    ];

    const jobData: SiteDeployJobData = {
      siteId: "site-123",
      deploymentId: "deploy-456",
      targetSlot: "blue",
      artifactPath: "artifact.tar.gz",
      runtimeConfig: { cpus: 1, memoryMb: 256, timeout: 30 },
    };

    requiredFields.forEach((field) => {
      expect(jobData).toHaveProperty(field);
      expect((jobData as Record<string, unknown>)[field]).not.toBeUndefined();
    });
  });

  it("validates buildConfig has all required fields", () => {
    const buildConfig = {
      cpus: 2,
      memoryMb: 4096,
      timeoutSeconds: 600,
    };

    expect(buildConfig.cpus).toBeGreaterThan(0);
    expect(buildConfig.memoryMb).toBeGreaterThan(0);
    expect(buildConfig.timeoutSeconds).toBeGreaterThan(0);
  });

  it("validates runtimeConfig has all required fields", () => {
    const runtimeConfig = {
      cpus: 1,
      memoryMb: 512,
      timeout: 30,
    };

    expect(runtimeConfig.cpus).toBeGreaterThan(0);
    expect(runtimeConfig.memoryMb).toBeGreaterThan(0);
    expect(runtimeConfig.timeout).toBeGreaterThan(0);
  });
});
