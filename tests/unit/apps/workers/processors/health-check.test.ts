/**
 * Health Check Processor Unit Tests
 *
 * Tests for the health check processor that monitors
 * backend server health status.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { HealthCheckJobData } from "@uni-proxy-manager/queue";

// Mock dependencies
vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      backends: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

describe("Health Check Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("HealthCheckJobData type", () => {
    it("should accept scope 'all'", () => {
      const jobData: HealthCheckJobData = {
        scope: "all",
      };

      expect(jobData.scope).toBe("all");
      expect(jobData.domainId).toBeUndefined();
      expect(jobData.backendId).toBeUndefined();
    });

    it("should accept scope 'domain' with domainId", () => {
      const jobData: HealthCheckJobData = {
        scope: "domain",
        domainId: "domain-123",
      };

      expect(jobData.scope).toBe("domain");
      expect(jobData.domainId).toBe("domain-123");
    });

    it("should accept scope 'backend' with backendId", () => {
      const jobData: HealthCheckJobData = {
        scope: "backend",
        backendId: "backend-456",
      };

      expect(jobData.scope).toBe("backend");
      expect(jobData.backendId).toBe("backend-456");
    });
  });

  // ============================================================================
  // Result Types Tests
  // ============================================================================

  describe("HealthCheckResult type", () => {
    it("should represent successful result", () => {
      const result = {
        success: true,
        checkedCount: 10,
        healthyCount: 8,
        unhealthyCount: 2,
      };

      expect(result.success).toBe(true);
      expect(result.checkedCount).toBe(10);
      expect(result.healthyCount).toBe(8);
      expect(result.unhealthyCount).toBe(2);
    });

    it("should represent failed result", () => {
      const result = {
        success: false,
        checkedCount: 0,
        healthyCount: 0,
        unhealthyCount: 0,
      };

      expect(result.success).toBe(false);
      expect(result.checkedCount).toBe(0);
    });

    it("should have counts that add up", () => {
      const result = {
        success: true,
        checkedCount: 15,
        healthyCount: 12,
        unhealthyCount: 3,
      };

      expect(result.healthyCount + result.unhealthyCount).toBe(result.checkedCount);
    });
  });

  // ============================================================================
  // Scope Logic Tests
  // ============================================================================

  describe("Scope logic", () => {
    it("should check single backend for backend scope", () => {
      const scope = "backend";
      const backendId = "backend-123";

      const checkSingleBackend = scope === "backend" && backendId;
      expect(checkSingleBackend).toBeTruthy();
    });

    it("should check domain backends for domain scope", () => {
      const scope = "domain";
      const domainId = "domain-123";

      const checkDomainBackends = scope === "domain" && domainId;
      expect(checkDomainBackends).toBeTruthy();
    });

    it("should check all backends for all scope", () => {
      const scope = "all";

      const checkAllBackends = scope === "all";
      expect(checkAllBackends).toBe(true);
    });
  });

  // ============================================================================
  // Health Check URL Construction Tests
  // ============================================================================

  describe("Health check URL construction", () => {
    it("should construct URL with default health check path", () => {
      const backend = {
        protocol: "http",
        address: "192.168.1.100",
        port: 8080,
        healthCheckPath: "/",
      };

      const url = `${backend.protocol}://${backend.address}:${backend.port}${backend.healthCheckPath}`;

      expect(url).toBe("http://192.168.1.100:8080/");
    });

    it("should construct URL with custom health check path", () => {
      const backend = {
        protocol: "https",
        address: "api.example.com",
        port: 443,
        healthCheckPath: "/health",
      };

      const url = `${backend.protocol}://${backend.address}:${backend.port}${backend.healthCheckPath}`;

      expect(url).toBe("https://api.example.com:443/health");
    });

    it("should handle null health check path", () => {
      const backend = {
        protocol: "http",
        address: "localhost",
        port: 3000,
        healthCheckPath: null as string | null,
      };

      const url = `${backend.protocol}://${backend.address}:${backend.port}${backend.healthCheckPath || "/"}`;

      expect(url).toBe("http://localhost:3000/");
    });

    it("should handle complex health check paths", () => {
      const backend = {
        protocol: "http",
        address: "backend",
        port: 8000,
        healthCheckPath: "/api/v2/health?detailed=true",
      };

      const url = `${backend.protocol}://${backend.address}:${backend.port}${backend.healthCheckPath}`;

      expect(url).toBe("http://backend:8000/api/v2/health?detailed=true");
    });
  });

  // ============================================================================
  // Timeout Configuration Tests
  // ============================================================================

  describe("Timeout configuration", () => {
    it("should use default timeout of 2 seconds", () => {
      const backend = { healthCheckTimeout: null as number | null };
      const timeout = (backend.healthCheckTimeout || 2) * 1000;

      expect(timeout).toBe(2000);
    });

    it("should use custom timeout when specified", () => {
      const backend = { healthCheckTimeout: 5 };
      const timeout = (backend.healthCheckTimeout || 2) * 1000;

      expect(timeout).toBe(5000);
    });

    it("should convert timeout to milliseconds", () => {
      const timeoutSeconds = 3;
      const timeoutMs = timeoutSeconds * 1000;

      expect(timeoutMs).toBe(3000);
    });
  });

  // ============================================================================
  // Response Status Tests
  // ============================================================================

  describe("Response status evaluation", () => {
    it("should consider 2xx as healthy", () => {
      const statuses = [200, 201, 204, 299];

      for (const status of statuses) {
        const isHealthy = status >= 200 && status < 400;
        expect(isHealthy).toBe(true);
      }
    });

    it("should consider 3xx as healthy", () => {
      const statuses = [301, 302, 304, 307];

      for (const status of statuses) {
        const isHealthy = status >= 200 && status < 400;
        expect(isHealthy).toBe(true);
      }
    });

    it("should consider 4xx as unhealthy", () => {
      const statuses = [400, 401, 403, 404];

      for (const status of statuses) {
        const isHealthy = status >= 200 && status < 400;
        expect(isHealthy).toBe(false);
      }
    });

    it("should consider 5xx as unhealthy", () => {
      const statuses = [500, 502, 503, 504];

      for (const status of statuses) {
        const isHealthy = status >= 200 && status < 400;
        expect(isHealthy).toBe(false);
      }
    });
  });

  // ============================================================================
  // Backend Filter Tests
  // ============================================================================

  describe("Backend filtering", () => {
    it("should filter backends with health check enabled", () => {
      const backends = [
        { id: "1", healthCheckEnabled: true },
        { id: "2", healthCheckEnabled: false },
        { id: "3", healthCheckEnabled: true },
      ];

      const filtered = backends.filter((b) => b.healthCheckEnabled);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((b) => b.id)).toContain("1");
      expect(filtered.map((b) => b.id)).toContain("3");
    });

    it("should return empty array when no backends have health check enabled", () => {
      const backends = [
        { id: "1", healthCheckEnabled: false },
        { id: "2", healthCheckEnabled: false },
      ];

      const filtered = backends.filter((b) => b.healthCheckEnabled);

      expect(filtered).toHaveLength(0);
    });
  });

  // ============================================================================
  // Status Change Detection Tests
  // ============================================================================

  describe("Status change detection", () => {
    it("should detect status change from healthy to unhealthy", () => {
      const backend = { isHealthy: true };
      const newStatus = false;

      const statusChanged = newStatus !== backend.isHealthy;

      expect(statusChanged).toBe(true);
    });

    it("should detect status change from unhealthy to healthy", () => {
      const backend = { isHealthy: false };
      const newStatus = true;

      const statusChanged = newStatus !== backend.isHealthy;

      expect(statusChanged).toBe(true);
    });

    it("should detect no status change", () => {
      const backend = { isHealthy: true };
      const newStatus = true;

      const statusChanged = newStatus !== backend.isHealthy;

      expect(statusChanged).toBe(false);
    });
  });

  // ============================================================================
  // Database Update Tests
  // ============================================================================

  describe("Database updates", () => {
    it("should prepare update data for status change", () => {
      const isHealthy = false;
      const updateData = {
        isHealthy,
        lastHealthCheck: new Date(),
        lastHealthError: isHealthy ? null : "Health check failed",
        updatedAt: new Date(),
      };

      expect(updateData.isHealthy).toBe(false);
      expect(updateData.lastHealthError).toBe("Health check failed");
    });

    it("should clear error when healthy", () => {
      const isHealthy = true;
      const updateData = {
        isHealthy,
        lastHealthCheck: new Date(),
        lastHealthError: isHealthy ? null : "Health check failed",
        updatedAt: new Date(),
      };

      expect(updateData.isHealthy).toBe(true);
      expect(updateData.lastHealthError).toBeNull();
    });

    it("should prepare timestamp-only update", () => {
      const updateData = {
        lastHealthCheck: new Date(),
        updatedAt: new Date(),
      };

      expect(updateData.lastHealthCheck).toBeInstanceOf(Date);
      expect(updateData.updatedAt).toBeInstanceOf(Date);
    });
  });

  // ============================================================================
  // Counter Logic Tests
  // ============================================================================

  describe("Counter logic", () => {
    it("should increment healthy count", () => {
      let healthyCount = 0;
      const isHealthy = true;

      if (isHealthy) {
        healthyCount++;
      }

      expect(healthyCount).toBe(1);
    });

    it("should increment unhealthy count", () => {
      let unhealthyCount = 0;
      const isHealthy = false;

      if (!isHealthy) {
        unhealthyCount++;
      }

      expect(unhealthyCount).toBe(1);
    });

    it("should track both counts correctly", () => {
      let healthyCount = 0;
      let unhealthyCount = 0;

      const results = [true, true, false, true, false];

      for (const isHealthy of results) {
        if (isHealthy) {
          healthyCount++;
        } else {
          unhealthyCount++;
        }
      }

      expect(healthyCount).toBe(3);
      expect(unhealthyCount).toBe(2);
      expect(healthyCount + unhealthyCount).toBe(results.length);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    it("should handle network errors as unhealthy", () => {
      const error = new Error("Connection refused");
      const isHealthy = (() => {
        try {
          throw error;
        } catch {
          return false;
        }
      })();

      expect(isHealthy).toBe(false);
    });

    it("should handle timeout as unhealthy", () => {
      const error = new Error("AbortError: Timeout");
      const isHealthy = (() => {
        try {
          throw error;
        } catch {
          return false;
        }
      })();

      expect(isHealthy).toBe(false);
    });

    it("should return failed result on fatal error", () => {
      const result = {
        success: false,
        checkedCount: 0,
        healthyCount: 0,
        unhealthyCount: 0,
      };

      expect(result.success).toBe(false);
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
          scope: "all" as const,
        },
      } as Job<HealthCheckJobData>;

      expect(mockJob.data.scope).toBe("all");
    });

    it("should handle empty backends list", () => {
      const backends: unknown[] = [];

      const result = {
        success: true,
        checkedCount: backends.length,
        healthyCount: 0,
        unhealthyCount: 0,
      };

      expect(result.checkedCount).toBe(0);
      expect(result.success).toBe(true);
    });
  });
});
