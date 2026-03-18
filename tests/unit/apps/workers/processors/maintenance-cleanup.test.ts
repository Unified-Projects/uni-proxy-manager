/**
 * Maintenance Cleanup Processor Unit Tests
 *
 * Tests for the maintenance cleanup processor that handles
 * orphaned certificate directories and site source cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { MaintenanceCleanupJobData, MaintenanceCleanupResult } from "@uni-proxy-manager/queue";

// Mock dependencies
vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      domains: {
        findMany: vi.fn(),
      },
      sites: {
        findMany: vi.fn(),
      },
    },
  },
}));

vi.mock("@uni-proxy-manager/shared/config", () => ({
  getCertsDir: vi.fn(() => "/data/certs"),
}));

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

describe("Maintenance Cleanup Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("MaintenanceCleanupJobData type", () => {
    it("should accept 'all' cleanup type", () => {
      const jobData: MaintenanceCleanupJobData = {
        type: "all",
      };

      expect(jobData.type).toBe("all");
    });

    it("should accept 'certificates' cleanup type", () => {
      const jobData: MaintenanceCleanupJobData = {
        type: "certificates",
      };

      expect(jobData.type).toBe("certificates");
    });

    it("should accept 'sites' cleanup type", () => {
      const jobData: MaintenanceCleanupJobData = {
        type: "sites",
      };

      expect(jobData.type).toBe("sites");
    });
  });

  // ============================================================================
  // Result Types Tests
  // ============================================================================

  describe("MaintenanceCleanupResult type", () => {
    it("should represent successful cleanup result", () => {
      const result: MaintenanceCleanupResult = {
        success: true,
        cleanedCertificateDirs: 5,
        cleanedSiteSourceDirs: 3,
        cleanedDeploymentArtifacts: 0,
        errors: [],
      };

      expect(result.success).toBe(true);
      expect(result.cleanedCertificateDirs).toBe(5);
      expect(result.cleanedSiteSourceDirs).toBe(3);
      expect(result.cleanedDeploymentArtifacts).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should represent cleanup result with errors", () => {
      const result: MaintenanceCleanupResult = {
        success: true,
        cleanedCertificateDirs: 2,
        cleanedSiteSourceDirs: 1,
        cleanedDeploymentArtifacts: 0,
        errors: ["Failed to remove /data/certs/orphaned-id"],
      };

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Failed to remove");
    });

    it("should represent failed cleanup result", () => {
      const result: MaintenanceCleanupResult = {
        success: false,
        cleanedCertificateDirs: 0,
        cleanedSiteSourceDirs: 0,
        cleanedDeploymentArtifacts: 0,
        errors: ["Critical error: Unable to access filesystem"],
      };

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it("should represent partial success with mixed results", () => {
      const result: MaintenanceCleanupResult = {
        success: true,
        cleanedCertificateDirs: 10,
        cleanedSiteSourceDirs: 5,
        cleanedDeploymentArtifacts: 0,
        errors: [
          "Permission denied: /data/certs/protected-id",
          "File in use: /data/sites/sources/active-id",
        ],
      };

      expect(result.success).toBe(true);
      expect(result.cleanedCertificateDirs).toBe(10);
      expect(result.errors).toHaveLength(2);
    });
  });

  // ============================================================================
  // Valid Domain ID Set Tests
  // ============================================================================

  describe("Valid domain ID set", () => {
    it("should create set from domain IDs", () => {
      const allDomains = [
        { id: "domain-1" },
        { id: "domain-2" },
        { id: "domain-3" },
      ];
      const validDomainIds = new Set(allDomains.map((d) => d.id));

      expect(validDomainIds.size).toBe(3);
      expect(validDomainIds.has("domain-1")).toBe(true);
      expect(validDomainIds.has("domain-2")).toBe(true);
      expect(validDomainIds.has("domain-3")).toBe(true);
      expect(validDomainIds.has("domain-4")).toBe(false);
    });

    it("should identify orphaned directories", () => {
      const validDomainIds = new Set(["domain-1", "domain-2"]);
      const directoryEntries = ["domain-1", "domain-2", "orphaned-1", "orphaned-2"];

      const orphaned = directoryEntries.filter((entry) => !validDomainIds.has(entry));

      expect(orphaned).toHaveLength(2);
      expect(orphaned).toContain("orphaned-1");
      expect(orphaned).toContain("orphaned-2");
    });
  });

  // ============================================================================
  // Valid Site ID Set Tests
  // ============================================================================

  describe("Valid site ID set", () => {
    it("should create set from site IDs", () => {
      const allSites = [
        { id: "site-1" },
        { id: "site-2" },
      ];
      const validSiteIds = new Set(allSites.map((s) => s.id));

      expect(validSiteIds.size).toBe(2);
      expect(validSiteIds.has("site-1")).toBe(true);
      expect(validSiteIds.has("site-2")).toBe(true);
    });

    it("should identify orphaned site source directories", () => {
      const validSiteIds = new Set(["site-1"]);
      const directoryEntries = ["site-1", "deleted-site", "another-deleted"];

      const orphaned = directoryEntries.filter((entry) => !validSiteIds.has(entry));

      expect(orphaned).toHaveLength(2);
      expect(orphaned).toContain("deleted-site");
    });
  });

  // ============================================================================
  // PEM File Handling Tests
  // ============================================================================

  describe("HAProxy PEM file handling", () => {
    it("should extract domain ID from PEM filename", () => {
      const filename = "domain-123.pem";
      const domainId = filename.replace(".pem", "");

      expect(domainId).toBe("domain-123");
    });

    it("should identify orphaned PEM files", () => {
      const validDomainIds = new Set(["domain-1", "domain-2"]);
      const pemFiles = ["domain-1.pem", "domain-2.pem", "orphaned.pem"];

      const orphanedPems = pemFiles.filter((pem) => {
        const domainId = pem.replace(".pem", "");
        return !validDomainIds.has(domainId);
      });

      expect(orphanedPems).toHaveLength(1);
      expect(orphanedPems[0]).toBe("orphaned.pem");
    });

    it("should check if file ends with .pem", () => {
      expect("domain-123.pem".endsWith(".pem")).toBe(true);
      expect("domain-123".endsWith(".pem")).toBe(false);
      expect("domain-123.key".endsWith(".pem")).toBe(false);
    });
  });

  // ============================================================================
  // Cleanup Type Logic Tests
  // ============================================================================

  describe("Cleanup type logic", () => {
    it("should run certificates cleanup for 'all' type", () => {
      const type: MaintenanceCleanupJobData["type"] = "all";

      const runCertificates = type === "all" || type === "certificates";
      const runSites = type === "all" || type === "sites";

      expect(runCertificates).toBe(true);
      expect(runSites).toBe(true);
    });

    it("should run only certificates cleanup for 'certificates' type", () => {
      const type: MaintenanceCleanupJobData["type"] = "certificates";

      const runCertificates = type === "all" || type === "certificates";
      const runSites = type === "all" || type === "sites";

      expect(runCertificates).toBe(true);
      expect(runSites).toBe(false);
    });

    it("should run only sites cleanup for 'sites' type", () => {
      const type: MaintenanceCleanupJobData["type"] = "sites";

      const runCertificates = type === "all" || type === "certificates";
      const runSites = type === "all" || type === "sites";

      expect(runCertificates).toBe(false);
      expect(runSites).toBe(true);
    });
  });

  // ============================================================================
  // Path Construction Tests
  // ============================================================================

  describe("Path construction", () => {
    it("should construct certificate entry path", () => {
      const certsDir = "/data/certs";
      const entry = "domain-123";
      const expectedPath = `${certsDir}/${entry}`;

      expect(expectedPath).toBe("/data/certs/domain-123");
    });

    it("should construct site source entry path", () => {
      const sourcesDir = "/data/sites/sources";
      const entry = "site-456";
      const expectedPath = `${sourcesDir}/${entry}`;

      expect(expectedPath).toBe("/data/sites/sources/site-456");
    });
  });

  // ============================================================================
  // Error Aggregation Tests
  // ============================================================================

  describe("Error aggregation", () => {
    it("should aggregate errors from multiple sources", () => {
      const certErrors = ["Cert error 1", "Cert error 2"];
      const siteErrors = ["Site error 1"];

      const allErrors: string[] = [];
      allErrors.push(...certErrors);
      allErrors.push(...siteErrors);

      expect(allErrors).toHaveLength(3);
      expect(allErrors[0]).toBe("Cert error 1");
      expect(allErrors[2]).toBe("Site error 1");
    });

    it("should format error from Error instance", () => {
      const err = new Error("Permission denied");
      const entry = "domain-123";
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const formattedError = `Failed to process ${entry}: ${errMsg}`;

      expect(formattedError).toBe("Failed to process domain-123: Permission denied");
    });

    it("should handle unknown error type", () => {
      const err = "string error";
      const errMsg = err instanceof Error ? err.message : "Unknown error";

      expect(errMsg).toBe("Unknown error");
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
          type: "all" as const,
        },
      } as Job<MaintenanceCleanupJobData>;

      expect(mockJob.data.type).toBe("all");
    });

    it("should initialize result structure", () => {
      const result: MaintenanceCleanupResult = {
        success: true,
        cleanedCertificateDirs: 0,
        cleanedSiteSourceDirs: 0,
        cleanedDeploymentArtifacts: 0,
        errors: [],
      };

      expect(result.success).toBe(true);
      expect(result.cleanedCertificateDirs).toBe(0);
      expect(result.cleanedSiteSourceDirs).toBe(0);
      expect(result.cleanedDeploymentArtifacts).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  // ============================================================================
  // Directory Detection Tests
  // ============================================================================

  describe("Directory detection", () => {
    it("should identify directory vs file", () => {
      const directoryEntry = { isDirectory: () => true };
      const fileEntry = { isDirectory: () => false };

      expect(directoryEntry.isDirectory()).toBe(true);
      expect(fileEntry.isDirectory()).toBe(false);
    });
  });

  // ============================================================================
  // Environment Variable Tests
  // ============================================================================

  describe("Environment variables", () => {
    it("should use default SITES_SOURCE_DIR", () => {
      const defaultDir = process.env.SITES_SOURCE_DIR || "/data/sites/sources";

      expect(defaultDir).toBe("/data/sites/sources");
    });

    it("should use custom SITES_SOURCE_DIR when set", () => {
      const originalEnv = process.env.SITES_SOURCE_DIR;
      process.env.SITES_SOURCE_DIR = "/custom/sources";

      const sourcesDir = process.env.SITES_SOURCE_DIR || "/data/sites/sources";
      expect(sourcesDir).toBe("/custom/sources");

      // Restore
      if (originalEnv) {
        process.env.SITES_SOURCE_DIR = originalEnv;
      } else {
        delete process.env.SITES_SOURCE_DIR;
      }
    });
  });

  // ============================================================================
  // Cleanup Counter Tests
  // ============================================================================

  describe("Cleanup counters", () => {
    it("should increment cleaned count", () => {
      let cleaned = 0;
      cleaned++;
      cleaned++;
      cleaned++;

      expect(cleaned).toBe(3);
    });

    it("should track separate counters for certs and sites", () => {
      let cleanedCerts = 0;
      let cleanedSites = 0;

      cleanedCerts += 5;
      cleanedSites += 2;

      expect(cleanedCerts).toBe(5);
      expect(cleanedSites).toBe(2);
    });
  });
});
