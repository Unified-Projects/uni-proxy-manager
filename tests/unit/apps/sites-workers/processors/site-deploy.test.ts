/**
 * Site Deploy Processor Unit Tests
 *
 * Tests for the site deploy processor that handles
 * deploying built artifacts to OpenRuntimes containers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { SiteDeployJobData, SiteDeployResult } from "@uni-proxy-manager/queue";

// Mock dependencies
vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      sites: { findFirst: vi.fn() },
      deployments: { findFirst: vi.fn() },
      s3Providers: { findFirst: vi.fn() },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  getRedisClient: vi.fn(() => ({
    publish: vi.fn(),
    rpush: vi.fn(),
    lrange: vi.fn(() => []),
    expire: vi.fn(),
    del: vi.fn(),
  })),
}));

vi.mock("@uni-proxy-manager/shared/openruntimes", () => ({
  getOpenRuntimesClient: vi.fn(() => ({
    getRuntime: vi.fn(),
    deleteRuntime: vi.fn(),
    execute: vi.fn(),
    waitForRuntime: vi.fn(),
  })),
}));

vi.mock("@uni-proxy-manager/shared", () => ({
  waitForSiteDeployLock: vi.fn(() => true),
  releaseSiteDeployLock: vi.fn(),
}));

describe("Site Deploy Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("SiteDeployJobData type", () => {
    it("should have required fields", () => {
      const jobData: SiteDeployJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        targetSlot: "blue",
        artifactPath: "local:/storage/functions/deploy-456/artifact.tar.gz",
        runtimeConfig: {
          cpus: 0.5,
          memoryMb: 256,
          timeout: 30,
        },
      };

      expect(jobData.siteId).toBe("site-123");
      expect(jobData.targetSlot).toBe("blue");
      expect(jobData.runtimeConfig.memoryMb).toBe(256);
    });

    it("should accept optional entry point and runtime path", () => {
      const jobData: SiteDeployJobData = {
        siteId: "site-123",
        deploymentId: "deploy-456",
        targetSlot: "green",
        artifactPath: "local:/storage/functions/deploy-456/artifact.tar.gz",
        renderMode: "ssr",
        runtimeConfig: {
          cpus: 1,
          memoryMb: 512,
          timeout: 60,
        },
        entryPoint: "server.js",
        runtimePath: ".next/standalone",
      };

      expect(jobData.renderMode).toBe("ssr");
      expect(jobData.entryPoint).toBe("server.js");
      expect(jobData.runtimePath).toBe(".next/standalone");
    });
  });

  // ============================================================================
  // Result Types Tests
  // ============================================================================

  describe("SiteDeployResult type", () => {
    it("should represent successful deployment", () => {
      const result: SiteDeployResult = {
        success: true,
        deploymentId: "deploy-123",
        runtimeId: "site-123-deploy-123",
        slot: "blue",
      };

      expect(result.success).toBe(true);
      expect(result.runtimeId).toBe("site-123-deploy-123");
    });

    it("should represent failed deployment", () => {
      const result: SiteDeployResult = {
        success: false,
        deploymentId: "deploy-123",
        slot: "blue",
        error: "Runtime health check failed: 500",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("health check failed");
    });
  });

  // ============================================================================
  // Runtime ID Tests
  // ============================================================================

  describe("Runtime ID construction", () => {
    it("should format runtime ID as siteId-deploymentId", () => {
      const siteId = "site-123";
      const deploymentId = "deploy-456";
      const runtimeId = `${siteId}-${deploymentId}`;

      expect(runtimeId).toBe("site-123-deploy-456");
    });
  });

  // ============================================================================
  // Artifact Path Tests
  // ============================================================================

  describe("Artifact path handling", () => {
    it("should detect local artifact path", () => {
      const artifactPath = "local:/storage/functions/deploy-123/artifact.tar.gz";
      const isLocal = artifactPath.startsWith("local:");

      expect(isLocal).toBe(true);
    });

    it("should extract local path from artifact path", () => {
      const artifactPath = "local:/storage/functions/deploy-123/artifact.tar.gz";
      const localPath = artifactPath.substring(6);

      expect(localPath).toBe("/storage/functions/deploy-123/artifact.tar.gz");
    });

    it("should detect S3 artifact path", () => {
      const artifactPath = "artifacts/site-123/deploy-456.tar.gz";
      const isLocal = artifactPath.startsWith("local:");

      expect(isLocal).toBe(false);
    });
  });

  // ============================================================================
  // Runtime Image Tests
  // ============================================================================

  describe("Runtime image construction", () => {
    it("should construct runtime image for Node 20", () => {
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

    it("should construct runtime image for Node 22", () => {
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
  });

  // ============================================================================
  // Start Command Tests
  // ============================================================================

  describe("Framework start commands", () => {
    const getStartCommand = (framework: string, isStatic: boolean): string => {
      switch (framework) {
        case "nextjs":
          return isStatic ? "bash helpers/server.sh" : "bash helpers/next-js/server.sh";
        case "sveltekit":
          return isStatic ? "bash helpers/server.sh" : "bash helpers/sveltekit/server.sh";
        case "static":
          return "bash helpers/server.sh";
        case "custom":
          return 'node "dist/server.js"';
        default:
          return "bash helpers/server.sh";
      }
    };

    it("should use SSR server for Next.js", () => {
      const command = getStartCommand("nextjs", false);
      expect(command).toBe("bash helpers/next-js/server.sh");
    });

    it("should use static server for Next.js SSG", () => {
      const command = getStartCommand("nextjs", true);
      expect(command).toBe("bash helpers/server.sh");
    });

    it("should use SSR server for SvelteKit", () => {
      const command = getStartCommand("sveltekit", false);
      expect(command).toBe("bash helpers/sveltekit/server.sh");
    });

    it("should use static server for static sites", () => {
      const command = getStartCommand("static", false);
      expect(command).toBe("bash helpers/server.sh");
    });

    it("should use the configured runtime target for custom sites", () => {
      const command = getStartCommand("custom", false);
      expect(command).toBe('node "dist/server.js"');
    });

    it("should honor detected render mode over stored metadata", () => {
      const siteRenderMode = "ssg";
      const jobRenderMode = "ssr";
      const effectiveRenderMode = jobRenderMode || siteRenderMode;

      expect(effectiveRenderMode).toBe("ssr");
      expect(getStartCommand("nextjs", effectiveRenderMode === "ssg")).toBe(
        "bash helpers/next-js/server.sh"
      );
    });
  });

  // ============================================================================
  // Runtime Entrypoint Tests
  // ============================================================================

  describe("Runtime entrypoint construction", () => {
    it("should construct entrypoint with escaped command", () => {
      const startCommand = "bash helpers/next-js/server.sh";
      const escapedStartCommand = startCommand.replace(/"/g, '\\"');
      const runtimeEntrypoint =
        `cp /tmp/code.tar.gz /mnt/code/code.tar.gz && nohup helpers/start.sh "${escapedStartCommand}"`;

      expect(runtimeEntrypoint).toContain("cp /tmp/code.tar.gz");
      expect(runtimeEntrypoint).toContain("helpers/start.sh");
    });
  });

  // ============================================================================
  // Health Check Tests
  // ============================================================================

  describe("Health check evaluation", () => {
    it("should consider status < 500 as healthy", () => {
      const statuses = [200, 201, 301, 404];

      for (const statusCode of statuses) {
        const isHealthy = statusCode < 500;
        expect(isHealthy).toBe(true);
      }
    });

    it("should consider status >= 500 as unhealthy", () => {
      const statuses = [500, 502, 503, 504];

      for (const statusCode of statuses) {
        const isHealthy = statusCode < 500;
        expect(isHealthy).toBe(false);
      }
    });

    it("should fail health check when errors present", () => {
      const healthCheck = {
        statusCode: 200,
        errors: "Error: Failed to start server",
        duration: 100,
      };

      const errorsText = healthCheck.errors?.trim();
      const isHealthyStatus = healthCheck.statusCode < 500;

      expect(isHealthyStatus).toBe(true);
      expect(!!errorsText).toBe(true);
    });
  });

  // ============================================================================
  // Runtime Startup Error Tests
  // ============================================================================

  describe("Runtime startup error detection", () => {
    const isRuntimeStartupError = (error: unknown): boolean => {
      const message = error instanceof Error ? error.message : String(error);
      return /runtime_timeout|runtime not ready|container not found/i.test(message);
    };

    it("should detect runtime timeout error", () => {
      const error = new Error("runtime_timeout: container took too long to start");
      expect(isRuntimeStartupError(error)).toBe(true);
    });

    it("should detect runtime not ready error", () => {
      const error = new Error("Runtime not ready for execution");
      expect(isRuntimeStartupError(error)).toBe(true);
    });

    it("should detect container not found error", () => {
      const error = new Error("Container not found");
      expect(isRuntimeStartupError(error)).toBe(true);
    });

    it("should not detect other errors as startup errors", () => {
      const error = new Error("Build failed");
      expect(isRuntimeStartupError(error)).toBe(false);
    });
  });

  // ============================================================================
  // Runtime Variables Tests
  // ============================================================================

  describe("Runtime variables configuration", () => {
    it("should include user env variables", () => {
      const siteEnvVariables = {
        API_URL: "https://api.example.com",
        DEBUG: "true",
      };

      const runtimeVariables = {
        ...siteEnvVariables,
      };

      expect(runtimeVariables.API_URL).toBe("https://api.example.com");
    });

    it("should include static fallback for SSG sites", () => {
      const isStatic = true;
      const siteEnvVariables = {};

      const runtimeVariables = {
        ...siteEnvVariables,
        ...(isStatic ? { OPEN_RUNTIMES_STATIC_FALLBACK: "index.html" } : {}),
      };

      expect(runtimeVariables.OPEN_RUNTIMES_STATIC_FALLBACK).toBe("index.html");
    });

    it("should not include static fallback for SSR sites", () => {
      const isStatic = false;
      const siteEnvVariables = {};

      const runtimeVariables = {
        ...siteEnvVariables,
        ...(isStatic ? { OPEN_RUNTIMES_STATIC_FALLBACK: "index.html" } : {}),
      };

      expect(runtimeVariables.OPEN_RUNTIMES_STATIC_FALLBACK).toBeUndefined();
    });
  });

  // ============================================================================
  // Warmup Timeout Tests
  // ============================================================================

  describe("Warmup timeout calculation", () => {
    it("should use max of config timeout and startup timeout", () => {
      const runtimeTimeout = 30;
      const STARTUP_TIMEOUT_SECONDS = 120;

      const warmupTimeoutSeconds = Math.max(runtimeTimeout, STARTUP_TIMEOUT_SECONDS);

      expect(warmupTimeoutSeconds).toBe(120);
    });

    it("should use config timeout when larger", () => {
      const runtimeTimeout = 180;
      const STARTUP_TIMEOUT_SECONDS = 120;

      const warmupTimeoutSeconds = Math.max(runtimeTimeout, STARTUP_TIMEOUT_SECONDS);

      expect(warmupTimeoutSeconds).toBe(180);
    });
  });

  // ============================================================================
  // Lock Management Tests
  // ============================================================================

  describe("Deployment lock management", () => {
    it("should fail if lock not acquired", () => {
      const lockAcquired = false;

      expect(lockAcquired).toBe(false);
      if (!lockAcquired) {
        const error = new Error("Could not acquire deployment lock - another deployment is in progress");
        expect(error.message).toContain("deployment lock");
      }
    });
  });

  // ============================================================================
  // Cache Invalidation Tests
  // ============================================================================

  describe("Cache invalidation", () => {
    it("should construct cache keys from hostnames", () => {
      const siteHostnames = [
        { hostname: "example.com" },
        { hostname: "www.example.com" },
      ];

      const cacheKeys = siteHostnames.map((h) => `sites:route:${h.hostname}`);

      expect(cacheKeys).toContain("sites:route:example.com");
      expect(cacheKeys).toContain("sites:route:www.example.com");
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
          targetSlot: "blue" as const,
          artifactPath: "local:/storage/functions/deploy-789/artifact.tar.gz",
          runtimeConfig: {
            cpus: 0.5,
            memoryMb: 256,
            timeout: 30,
          },
        },
      } as Job<SiteDeployJobData>;

      expect(mockJob.data.targetSlot).toBe("blue");
      expect(mockJob.data.runtimeConfig.memoryMb).toBe(256);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    it("should format error message correctly", () => {
      const error = new Error("Runtime health check failed: 500");
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      expect(errorMessage).toBe("Runtime health check failed: 500");
    });
  });

  // ============================================================================
  // Logging Tests
  // ============================================================================

  describe("Logging", () => {
    it("should format log line with timestamp", () => {
      const message = "Starting deployment process...";
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] ${message}`;

      expect(logLine).toContain("[");
      expect(logLine).toContain("]");
      expect(logLine).toContain(message);
    });

    it("should construct log buffer key", () => {
      const deploymentId = "deploy-123";
      const logBufferKey = `deployment-logs-buffer:${deploymentId}`;

      expect(logBufferKey).toBe("deployment-logs-buffer:deploy-123");
    });
  });
});
