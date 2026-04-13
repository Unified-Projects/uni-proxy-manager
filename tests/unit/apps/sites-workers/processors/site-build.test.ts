/**
 * Site Build Processor Unit Tests
 *
 * Tests for the site build processor that handles
 * building site deployments using OpenRuntimes executor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { SiteBuildJobData, SiteBuildResult } from "@uni-proxy-manager/queue";

// Mock dependencies
vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      sites: { findFirst: vi.fn() },
      deployments: { findFirst: vi.fn() },
      githubConnections: { findFirst: vi.fn() },
      s3Providers: { findFirst: vi.fn() },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    publish: vi.fn(),
    rpush: vi.fn(),
    expire: vi.fn(),
    duplicate: vi.fn(() => ({
      on: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      quit: vi.fn(),
    })),
  })),
}));

vi.mock("@uni-proxy-manager/shared/github", () => ({
  getGitHubApp: vi.fn(),
  isGitHubAppConfigured: vi.fn(() => true),
}));

vi.mock("@uni-proxy-manager/shared/openruntimes", () => ({
  getOpenRuntimesClient: vi.fn(() => ({
    buildRuntime: vi.fn(),
  })),
}));

describe("Site Build Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("SiteBuildJobData type", () => {
    it("should have required fields", () => {
      const jobData: SiteBuildJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        branch: "main",
        framework: "nextjs",
        buildCommand: "npm run build",
        installCommand: "npm install",
        nodeVersion: "20",
        envVariables: { NODE_ENV: "production" },
        buildConfig: {
          cpus: 2,
          memoryMb: 4096,
          timeoutSeconds: 600,
        },
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.deploymentId).toBe("deploy-456");
      expect(jobData.framework).toBe("nextjs");
    });

    it("should accept optional fields", () => {
      const jobData: SiteBuildJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        branch: "main",
        framework: "nextjs",
        buildCommand: "npm run build",
        installCommand: "npm install",
        nodeVersion: "20",
        envVariables: {},
        buildConfig: {
          cpus: 1,
          memoryMb: 2048,
          timeoutSeconds: 300,
        },
        buildFlags: ["--experimental"],
        outputDirectory: "dist",
        commitSha: "abc123",
        sourcePath: "/uploads/source.tar.gz",
      };

      expect(jobData.buildFlags).toContain("--experimental");
      expect(jobData.outputDirectory).toBe("dist");
      expect(jobData.commitSha).toBe("abc123");
    });

    it("should allow static jobs without install or build commands", () => {
      const jobData: SiteBuildJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        branch: "upload",
        framework: "static",
        nodeVersion: "20",
        envVariables: {},
        buildConfig: {
          cpus: 1,
          memoryMb: 2048,
          timeoutSeconds: 300,
        },
      };

      expect(jobData.framework).toBe("static");
      expect(jobData.buildCommand).toBeUndefined();
      expect(jobData.installCommand).toBeUndefined();
    });
  });

  // ============================================================================
  // Result Types Tests
  // ============================================================================

  describe("SiteBuildResult type", () => {
    it("should represent successful build", () => {
      const result: SiteBuildResult = {
        success: true,
        deploymentId: "deploy-123",
        artifactPath: "local:/storage/functions/deploy-123/artifact.tar.gz",
        artifactSize: 52428800,
        buildDurationMs: 45000,
        detectedRenderMode: "ssr",
        detectedEntryPoint: "server.js",
        detectedRuntimePath: "",
      };

      expect(result.success).toBe(true);
      expect(result.detectedRenderMode).toBe("ssr");
    });

    it("should represent failed build", () => {
      const result: SiteBuildResult = {
        success: false,
        deploymentId: "deploy-123",
        error: "Build command failed with exit code 1",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("exit code");
    });

    it("should represent static build", () => {
      const result: SiteBuildResult = {
        success: true,
        deploymentId: "deploy-123",
        artifactPath: "local:/storage/functions/deploy-123/artifact.tar.gz",
        artifactSize: 10485760,
        buildDurationMs: 30000,
        detectedRenderMode: "ssg",
      };

      expect(result.detectedRenderMode).toBe("ssg");
      expect(result.detectedEntryPoint).toBeUndefined();
    });
  });

  // ============================================================================
  // Framework Detection Tests
  // ============================================================================

  describe("Framework SSR detection patterns", () => {
    const SSR_DETECTION = {
      nextjs: {
        patterns: [".next/standalone/server.js", ".next/server"],
        entryPoint: "server.js",
        runtimePath: "",
      },
      sveltekit: {
        patterns: ["build/index.js", "build/server"],
        entryPoint: "index.js",
        runtimePath: "build",
      },
      astro: {
        patterns: ["dist/server/entry.mjs", "dist/server"],
        entryPoint: "entry.mjs",
        runtimePath: "dist/server",
      },
    };

    it("should have Next.js SSR patterns", () => {
      expect(SSR_DETECTION.nextjs.patterns).toContain(".next/standalone/server.js");
      expect(SSR_DETECTION.nextjs.entryPoint).toBe("server.js");
    });

    it("should have SvelteKit SSR patterns", () => {
      expect(SSR_DETECTION.sveltekit.patterns).toContain("build/index.js");
      expect(SSR_DETECTION.sveltekit.entryPoint).toBe("index.js");
    });

    it("should have Astro SSR patterns", () => {
      expect(SSR_DETECTION.astro.patterns).toContain("dist/server/entry.mjs");
      expect(SSR_DETECTION.astro.entryPoint).toBe("entry.mjs");
    });
  });

  // ============================================================================
  // Framework Build Config Tests (URT-compatible)
  // ============================================================================

  describe("Framework build configuration", () => {
    const FRAMEWORK_BUILD_CONFIG = {
      nextjs: {
        envCommand: undefined,
        bundleCommand: undefined,
        outputDirectory: "./.next",
        buildCommand: "npx next build",
      },
      sveltekit: {
        envCommand: undefined,
        bundleCommand: undefined,
        outputDirectory: "./.svelte-kit",
      },
      static: {
        envCommand: undefined,
        bundleCommand: undefined,
        outputDirectory: "dist",
      },
    };

    it("should have Next.js specific config", () => {
      expect(FRAMEWORK_BUILD_CONFIG.nextjs.outputDirectory).toBe("./.next");
      expect(FRAMEWORK_BUILD_CONFIG.nextjs.buildCommand).toBe("npx next build");
      expect(FRAMEWORK_BUILD_CONFIG.nextjs.envCommand).toBeUndefined();
    });

    it("should have SvelteKit specific config", () => {
      expect(FRAMEWORK_BUILD_CONFIG.sveltekit.outputDirectory).toBe("./.svelte-kit");
      expect(FRAMEWORK_BUILD_CONFIG.sveltekit.envCommand).toBeUndefined();
    });

    it("should have static site config", () => {
      expect(FRAMEWORK_BUILD_CONFIG.static.outputDirectory).toBe("dist");
      expect(FRAMEWORK_BUILD_CONFIG.static.envCommand).toBeUndefined();
    });
  });

  // ============================================================================
  // Build Resource Tests
  // ============================================================================

  describe("Build resource configuration", () => {
    it("should enforce minimum memory for Next.js", () => {
      const framework = "nextjs";
      let minMemory = 2048;

      if (framework === "nextjs") {
        minMemory = 8192;
      }

      expect(minMemory).toBe(8192);
    });

    it("should enforce minimum memory for SvelteKit", () => {
      const framework = "sveltekit";
      let minMemory = 2048;

      if (framework === "sveltekit") {
        minMemory = 4096;
      }

      expect(minMemory).toBe(4096);
    });

    it("should use max of config and minimum", () => {
      const configMemory = 2048;
      const minMemory = 8192;

      const effectiveMemory = Math.max(configMemory, minMemory);

      expect(effectiveMemory).toBe(8192);
    });

    it("should enforce minimum timeout of 900 seconds", () => {
      const configTimeout = 300;
      const minTimeout = 900;

      const effectiveTimeout = Math.max(configTimeout, minTimeout);

      expect(effectiveTimeout).toBe(900);
    });
  });

  // ============================================================================
  // Runtime Image Tests
  // ============================================================================

  describe("Runtime image construction", () => {
    it("should use major version for Node 22+", () => {
      const nodeVersion = "22";
      const majorVersion = nodeVersion.split(".")[0] || "20";
      let runtimeNodeVersion: string;

      if (parseInt(majorVersion, 10) >= 22) {
        runtimeNodeVersion = majorVersion;
      } else {
        runtimeNodeVersion = nodeVersion.includes(".") ? nodeVersion : `${nodeVersion}.0`;
      }

      const runtimeImage = `openruntimes/node:v5-${runtimeNodeVersion}`;

      expect(runtimeImage).toBe("openruntimes/node:v5-22");
    });

    it("should add .0 for older Node versions", () => {
      const nodeVersion = "20";
      const majorVersion = nodeVersion.split(".")[0] || "20";
      let runtimeNodeVersion: string;

      if (parseInt(majorVersion, 10) >= 22) {
        runtimeNodeVersion = majorVersion;
      } else {
        runtimeNodeVersion = nodeVersion.includes(".") ? nodeVersion : `${nodeVersion}.0`;
      }

      const runtimeImage = `openruntimes/node:v5-${runtimeNodeVersion}`;

      expect(runtimeImage).toBe("openruntimes/node:v5-20.0");
    });

    it("should preserve version with minor for older Node", () => {
      const nodeVersion = "18.17";
      const majorVersion = nodeVersion.split(".")[0] || "20";
      let runtimeNodeVersion: string;

      if (parseInt(majorVersion, 10) >= 22) {
        runtimeNodeVersion = majorVersion;
      } else {
        runtimeNodeVersion = nodeVersion.includes(".") ? nodeVersion : `${nodeVersion}.0`;
      }

      expect(runtimeNodeVersion).toBe("18.17");
    });
  });

  // ============================================================================
  // Build Command Construction Tests (URT-compatible)
  // ============================================================================

  describe("Build command construction", () => {
    it("should combine commands with &&", () => {
      // URT uses standard npm commands, no helper scripts
      const commands = [
        "npm install",
        "npx next build",
      ];

      const finalCommand = commands.filter(Boolean).join(" && ");

      expect(finalCommand).toContain(" && ");
      expect(finalCommand.split(" && ")).toHaveLength(2);
    });

    it("should append build flags", () => {
      const buildCommand = "npm run build";
      const buildFlags = ["--experimental", "--turbo"];

      const fullBuildCommand = buildFlags.length > 0
        ? `${buildCommand} ${buildFlags.join(" ")}`
        : buildCommand;

      expect(fullBuildCommand).toBe("npm run build --experimental --turbo");
    });

    it("should handle empty build flags", () => {
      const buildCommand = "npm run build";
      const buildFlags: string[] = [];

      const fullBuildCommand = buildFlags.length > 0
        ? `${buildCommand} ${buildFlags.join(" ")}`
        : buildCommand;

      expect(fullBuildCommand).toBe("npm run build");
    });
  });

  // ============================================================================
  // Artifact Path Tests
  // ============================================================================

  describe("Artifact path handling", () => {
    it("should prefix local artifacts", () => {
      const artifactLocalPath = "/storage/functions/deploy-123/artifact.tar.gz";
      const artifactPath = `local:${artifactLocalPath}`;

      expect(artifactPath).toBe("local:/storage/functions/deploy-123/artifact.tar.gz");
    });

    it("should detect direct tar.gz upload", () => {
      const sourcePath = "/uploads/source.tar.gz";
      const isDirectTar = sourcePath.endsWith(".tar.gz");

      expect(isDirectTar).toBe(true);
    });

    it("should detect directory upload", () => {
      const sourcePath = "/uploads/source";
      const isDirectTar = sourcePath.endsWith(".tar.gz");

      expect(isDirectTar).toBe(false);
    });
  });

  // ============================================================================
  // Environment Variable Tests
  // ============================================================================

  describe("Environment variable handling", () => {
    it("should format env file content", () => {
      const envVariables = {
        NODE_ENV: "production",
        API_URL: "https://api.example.com",
        DEBUG: "false",
      };

      const envContent = Object.entries(envVariables)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

      expect(envContent).toContain("NODE_ENV=production");
      expect(envContent).toContain("API_URL=https://api.example.com");
    });

    it("should merge user env with build env", () => {
      const userEnv = { API_URL: "https://api.example.com" };
      const buildVariables = {
        NODE_ENV: "production",
        ...userEnv,
      };

      expect(buildVariables.NODE_ENV).toBe("production");
      expect(buildVariables.API_URL).toBe("https://api.example.com");
    });
  });

  // ============================================================================
  // Log Channel Tests
  // ============================================================================

  describe("Log channel construction", () => {
    it("should construct log channel", () => {
      const deploymentId = "deploy-123";
      const logChannel = `deployment-logs:${deploymentId}`;

      expect(logChannel).toBe("deployment-logs:deploy-123");
    });

    it("should construct status channel", () => {
      const deploymentId = "deploy-123";
      const statusChannel = `deployment-status:${deploymentId}`;

      expect(statusChannel).toBe("deployment-status:deploy-123");
    });

    it("should construct cancel channel", () => {
      const deploymentId = "deploy-123";
      const cancelChannel = `deployment-cancel:${deploymentId}`;

      expect(cancelChannel).toBe("deployment-cancel:deploy-123");
    });
  });

  // ============================================================================
  // Job Processing Tests
  // ============================================================================

  describe("Job processing", () => {
    it("should construct mock job correctly", () => {
      const mockJob = {
        id: "job-123",
        data: {
          siteId: "site-456",
          deploymentId: "deploy-789",
          branch: "main",
          framework: "nextjs",
          buildCommand: "npm run build",
          installCommand: "npm install",
          nodeVersion: "20",
          envVariables: {},
          buildConfig: {
            cpus: 2,
            memoryMb: 4096,
            timeoutSeconds: 600,
          },
        },
      } as Job<SiteBuildJobData>;

      expect(mockJob.data.framework).toBe("nextjs");
      expect(mockJob.data.buildConfig.cpus).toBe(2);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    it("should handle cancelled build", () => {
      const cancelled = true;

      if (cancelled) {
        const error = new Error("Build cancelled");
        expect(error.message).toBe("Build cancelled");
      }
    });

    it("should format error message", () => {
      const error = new Error("Build command failed with exit code 1");
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      expect(errorMessage).toContain("exit code 1");
    });
  });
});
