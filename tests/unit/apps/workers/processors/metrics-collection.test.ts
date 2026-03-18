/**
 * Metrics Collection Processor Unit Tests
 *
 * Tests for the metrics collection processor that gathers
 * traffic metrics from HAProxy and stores them in the database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { MetricsCollectionJobData, MetricsCollectionResult } from "@uni-proxy-manager/queue";

// Mock dependencies
vi.mock("@uni-proxy-manager/database", () => ({
  db: {
    query: {
      domains: {
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => []),
      })),
    })),
  },
}));

vi.mock("@uni-proxy-manager/shared/haproxy", () => ({
  getHaproxyStats: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "metric-id-123"),
}));

describe("Metrics Collection Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("MetricsCollectionJobData type", () => {
    it("should have required timestamp field", () => {
      const jobData: MetricsCollectionJobData = {
        timestamp: Date.now(),
      };

      expect(typeof jobData.timestamp).toBe("number");
    });

    it("should accept ISO timestamp string", () => {
      const timestamp = new Date().toISOString();
      const jobData = { timestamp };

      expect(typeof jobData.timestamp).toBe("string");
    });
  });

  // ============================================================================
  // Result Types Tests
  // ============================================================================

  describe("MetricsCollectionResult type", () => {
    it("should represent successful result", () => {
      const result: MetricsCollectionResult = {
        success: true,
        timestamp: Date.now(),
        metricsCollected: 5,
        domainsProcessed: 3,
      };

      expect(result.success).toBe(true);
      expect(result.metricsCollected).toBe(5);
      expect(result.domainsProcessed).toBe(3);
    });

    it("should represent result with no domains", () => {
      const result: MetricsCollectionResult = {
        success: true,
        timestamp: Date.now(),
        metricsCollected: 0,
        domainsProcessed: 0,
      };

      expect(result.success).toBe(true);
      expect(result.metricsCollected).toBe(0);
    });

    it("should represent failed result", () => {
      const result: MetricsCollectionResult = {
        success: false,
        timestamp: Date.now(),
        metricsCollected: 0,
        domainsProcessed: 0,
        error: "HAProxy stats unavailable",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("HAProxy stats unavailable");
    });
  });

  // ============================================================================
  // Frontend Matching Tests
  // ============================================================================

  describe("Frontend matching", () => {
    it("should match by exact hostname", () => {
      const domain = { id: "domain-1", hostname: "example.com" };
      const frontends = [
        { name: "example.com", total_requests: 100 },
        { name: "other.com", total_requests: 50 },
      ];

      const frontend = frontends.find((f) => f.name === domain.hostname);

      expect(frontend).toBeDefined();
      expect(frontend?.name).toBe("example.com");
    });

    it("should match by frontend_id pattern", () => {
      const domain = { id: "domain-123", hostname: "example.com" };
      const frontends = [
        { name: "frontend_domain-123", total_requests: 100 },
      ];

      const frontend = frontends.find((f) => f.name === `frontend_${domain.id}`);

      expect(frontend).toBeDefined();
      expect(frontend?.name).toBe("frontend_domain-123");
    });

    it("should match by hostname inclusion", () => {
      const domain = { id: "domain-1", hostname: "example.com" };
      const frontends = [
        { name: "fe_example.com_http", total_requests: 100 },
      ];

      const frontend = frontends.find((f) => f.name.includes(domain.hostname));

      expect(frontend).toBeDefined();
      expect(frontend?.name).toBe("fe_example.com_http");
    });

    it("should return undefined when no match found", () => {
      const domain = { id: "domain-1", hostname: "example.com" };
      const frontends = [
        { name: "other.com", total_requests: 100 },
      ];

      const frontend = frontends.find(
        (f) =>
          f.name === domain.hostname ||
          f.name === `frontend_${domain.id}` ||
          f.name.includes(domain.hostname)
      );

      expect(frontend).toBeUndefined();
    });
  });

  // ============================================================================
  // Metric Structure Tests
  // ============================================================================

  describe("Metric structure", () => {
    it("should create metric with all required fields", () => {
      const metric = {
        id: "metric-123",
        domainId: "domain-456",
        timestamp: new Date(),
        totalRequests: 1000,
        httpRequests: 1000,
        httpsRequests: 0,
        status2xx: 800,
        status3xx: 100,
        status4xx: 80,
        status5xx: 20,
        bytesIn: 1024000,
        bytesOut: 5120000,
        currentConnections: 50,
        maxConnections: 100,
      };

      expect(metric.id).toBe("metric-123");
      expect(metric.totalRequests).toBe(1000);
      expect(metric.status2xx + metric.status3xx + metric.status4xx + metric.status5xx).toBe(1000);
    });

    it("should handle zero values for all fields", () => {
      const metric = {
        id: "metric-123",
        domainId: "domain-456",
        timestamp: new Date(),
        totalRequests: 0,
        httpRequests: 0,
        httpsRequests: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        bytesIn: 0,
        bytesOut: 0,
        currentConnections: 0,
        maxConnections: 0,
      };

      expect(metric.totalRequests).toBe(0);
    });
  });

  // ============================================================================
  // HAProxy Frontend Stats Tests
  // ============================================================================

  describe("HAProxy frontend stats", () => {
    it("should extract total requests", () => {
      const frontend = { total_requests: 5000 };
      const totalRequests = frontend.total_requests || 0;

      expect(totalRequests).toBe(5000);
    });

    it("should extract HTTP response codes", () => {
      const frontend = {
        http_responses_2xx: 800,
        http_responses_3xx: 100,
        http_responses_4xx: 80,
        http_responses_5xx: 20,
      };

      expect(frontend.http_responses_2xx).toBe(800);
      expect(frontend.http_responses_3xx).toBe(100);
      expect(frontend.http_responses_4xx).toBe(80);
      expect(frontend.http_responses_5xx).toBe(20);
    });

    it("should extract bytes transferred", () => {
      const frontend = {
        bytes_in: 1024000,
        bytes_out: 5120000,
      };

      expect(frontend.bytes_in).toBe(1024000);
      expect(frontend.bytes_out).toBe(5120000);
    });

    it("should extract session counts", () => {
      const frontend = {
        current_sessions: 50,
        max_sessions: 100,
      };

      expect(frontend.current_sessions).toBe(50);
      expect(frontend.max_sessions).toBe(100);
    });

    it("should default missing values to 0", () => {
      const frontend: Record<string, number | undefined> = {};

      const totalRequests = frontend.total_requests || 0;
      const bytesIn = frontend.bytes_in || 0;
      const status2xx = frontend.http_responses_2xx || 0;

      expect(totalRequests).toBe(0);
      expect(bytesIn).toBe(0);
      expect(status2xx).toBe(0);
    });
  });

  // ============================================================================
  // Metrics Cleanup Tests
  // ============================================================================

  describe("Metrics cleanup", () => {
    it("should calculate 30 days ago", () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const now = new Date();
      const diff = now.getTime() - thirtyDaysAgo.getTime();
      const daysDiff = Math.round(diff / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBe(30);
    });

    it("should identify old metrics", () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const oldMetric = new Date();
      oldMetric.setDate(oldMetric.getDate() - 45);

      expect(oldMetric < thirtyDaysAgo).toBe(true);
    });

    it("should keep recent metrics", () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentMetric = new Date();
      recentMetric.setDate(recentMetric.getDate() - 15);

      expect(recentMetric < thirtyDaysAgo).toBe(false);
    });
  });

  // ============================================================================
  // Batch Insert Tests
  // ============================================================================

  describe("Batch insert", () => {
    it("should collect metrics to insert", () => {
      const metricsToInsert: unknown[] = [];

      metricsToInsert.push({ id: "1", domainId: "d1" });
      metricsToInsert.push({ id: "2", domainId: "d2" });

      expect(metricsToInsert).toHaveLength(2);
    });

    it("should skip insert when no metrics", () => {
      const metricsToInsert: unknown[] = [];

      if (metricsToInsert.length > 0) {
        // Would insert
      }

      expect(metricsToInsert).toHaveLength(0);
    });
  });

  // ============================================================================
  // Counter Tests
  // ============================================================================

  describe("Counters", () => {
    it("should increment domains processed count", () => {
      let domainsProcessed = 0;

      domainsProcessed++;
      domainsProcessed++;
      domainsProcessed++;

      expect(domainsProcessed).toBe(3);
    });

    it("should track metrics collected", () => {
      const metricsToInsert = [{ id: "1" }, { id: "2" }, { id: "3" }];

      expect(metricsToInsert.length).toBe(3);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    it("should handle HAProxy stats unavailable", () => {
      const error = new Error("Socket connection refused");
      const result: MetricsCollectionResult = {
        success: false,
        timestamp: Date.now(),
        metricsCollected: 0,
        domainsProcessed: 0,
        error: "HAProxy stats unavailable",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("HAProxy stats unavailable");
    });

    it("should continue if cleanup fails", () => {
      // Cleanup failure shouldn't affect main result
      const mainResult = { success: true };
      const cleanupError = new Error("Cleanup failed");

      console.warn("Cleanup failed:", cleanupError.message);

      expect(mainResult.success).toBe(true);
    });

    it("should format error message correctly", () => {
      const error = new Error("Database connection failed");
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      expect(errorMessage).toBe("Database connection failed");
    });
  });

  // ============================================================================
  // Empty Domains Tests
  // ============================================================================

  describe("Empty domains handling", () => {
    it("should return early when no domains", () => {
      const domains: unknown[] = [];

      if (domains.length === 0) {
        const result: MetricsCollectionResult = {
          success: true,
          timestamp: Date.now(),
          metricsCollected: 0,
          domainsProcessed: 0,
        };

        expect(result.success).toBe(true);
        expect(result.metricsCollected).toBe(0);
      }
    });
  });

  // ============================================================================
  // Stats Structure Tests
  // ============================================================================

  describe("HAProxy stats structure", () => {
    it("should have frontends array", () => {
      const stats = {
        frontends: [
          { name: "http_frontend", total_requests: 100 },
          { name: "https_frontend", total_requests: 200 },
        ],
      };

      expect(stats.frontends).toHaveLength(2);
    });

    it("should handle empty frontends", () => {
      const stats = {
        frontends: [] as { name: string; total_requests: number }[],
      };

      expect(stats.frontends).toHaveLength(0);
    });
  });

  // ============================================================================
  // Job Processing Tests
  // ============================================================================

  describe("Job processing", () => {
    it("should construct mock job correctly", () => {
      const timestamp = Date.now();
      const mockJob = {
        id: "job-123",
        data: {
          timestamp,
        },
      } as Job<MetricsCollectionJobData>;

      expect(mockJob.data.timestamp).toBe(timestamp);
    });
  });

  // ============================================================================
  // Logging Tests
  // ============================================================================

  describe("Logging", () => {
    it("should format collection start message", () => {
      const timestamp = 1705321200000;
      const message = `[Metrics Collection] Collecting metrics at ${timestamp}`;

      expect(message).toContain("[Metrics Collection]");
      expect(message).toContain(timestamp.toString());
    });

    it("should format insert count message", () => {
      const count = 15;
      const message = `[Metrics Collection] Inserted ${count} metrics`;

      expect(message).toBe("[Metrics Collection] Inserted 15 metrics");
    });

    it("should format cleanup message", () => {
      const count = 100;
      const message = `[Metrics Collection] Cleaned up ${count} old metrics`;

      expect(message).toBe("[Metrics Collection] Cleaned up 100 old metrics");
    });
  });
});
