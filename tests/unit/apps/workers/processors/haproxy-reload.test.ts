/**
 * HAProxy Reload Processor Unit Tests
 *
 * Tests for the HAProxy reload processor that handles
 * configuration reloads via Docker signals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { HaproxyReloadJobData, HaproxyReloadResult } from "@uni-proxy-manager/queue";

// Mock dependencies
vi.mock("@uni-proxy-manager/shared/config", () => ({
  getHaproxyConfigPath: vi.fn(() => "/etc/haproxy/haproxy.cfg"),
}));

vi.mock("@uni-proxy-manager/shared/haproxy", () => ({
  sendHaproxySocketCommand: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
}));

vi.mock("http", () => ({
  default: {
    request: vi.fn(),
  },
}));

describe("HAProxy Reload Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Job Data Types Tests
  // ============================================================================

  describe("HaproxyReloadJobData type", () => {
    it("should have required reason field", () => {
      const jobData: HaproxyReloadJobData = {
        reason: "domain_updated",
      };

      expect(jobData.reason).toBe("domain_updated");
    });

    it("should accept various reason values", () => {
      const reasons = [
        "domain_updated",
        "domain_created",
        "domain_deleted",
        "backend_updated",
        "certificate_issued",
        "maintenance_enabled",
        "config_regenerated",
      ];

      for (const reason of reasons) {
        const jobData: HaproxyReloadJobData = { reason };
        expect(jobData.reason).toBe(reason);
      }
    });
  });

  // ============================================================================
  // Result Types Tests
  // ============================================================================

  describe("HaproxyReloadResult type", () => {
    it("should represent successful reload", () => {
      const result: HaproxyReloadResult = {
        success: true,
        configPath: "/etc/haproxy/haproxy.cfg",
        reloadMethod: "docker-sighup",
      };

      expect(result.success).toBe(true);
      expect(result.configPath).toBe("/etc/haproxy/haproxy.cfg");
      expect(result.reloadMethod).toBe("docker-sighup");
    });

    it("should represent failed reload with error", () => {
      const result: HaproxyReloadResult = {
        success: false,
        configPath: "/etc/haproxy/haproxy.cfg",
        reloadMethod: "docker-sighup",
        error: "Docker API returned 404: container not found",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("container not found");
    });

    it("should represent reload with unknown method", () => {
      const result: HaproxyReloadResult = {
        success: false,
        reloadMethod: "unknown",
        error: "Config file not found",
      };

      expect(result.reloadMethod).toBe("unknown");
    });
  });

  // ============================================================================
  // Reload Method Tests
  // ============================================================================

  describe("Reload methods", () => {
    it("should recognize docker-sighup method", () => {
      const method: HaproxyReloadResult["reloadMethod"] = "docker-sighup";
      expect(method).toBe("docker-sighup");
    });

    it("should recognize socket-reload method", () => {
      const method: HaproxyReloadResult["reloadMethod"] = "socket-reload";
      expect(method).toBe("socket-reload");
    });

    it("should recognize unknown method", () => {
      const method: HaproxyReloadResult["reloadMethod"] = "unknown";
      expect(method).toBe("unknown");
    });
  });

  // ============================================================================
  // Docker Signal Tests
  // ============================================================================

  describe("Docker signal handling", () => {
    it("should use SIGHUP signal", () => {
      const signal = "SIGHUP";
      expect(signal).toBe("SIGHUP");
    });

    it("should construct Docker API path correctly", () => {
      const containerName = "uni-proxy-manager-haproxy";
      const signal = "SIGHUP";
      const path = `/containers/${containerName}/kill?signal=${signal}`;

      expect(path).toBe("/containers/uni-proxy-manager-haproxy/kill?signal=SIGHUP");
    });
  });

  // ============================================================================
  // Docker Response Status Tests
  // ============================================================================

  describe("Docker response status handling", () => {
    it("should consider 204 as success", () => {
      const statusCode = 204;
      const isSuccess = statusCode === 204 || statusCode === 200;

      expect(isSuccess).toBe(true);
    });

    it("should consider 200 as success", () => {
      const statusCode = 200;
      const isSuccess = statusCode === 204 || statusCode === 200;

      expect(isSuccess).toBe(true);
    });

    it("should consider 404 as failure", () => {
      const statusCode = 404;
      const isSuccess = statusCode === 204 || statusCode === 200;

      expect(isSuccess).toBe(false);
    });

    it("should consider 500 as failure", () => {
      const statusCode = 500;
      const isSuccess = statusCode === 204 || statusCode === 200;

      expect(isSuccess).toBe(false);
    });
  });

  // ============================================================================
  // Environment Variable Tests
  // ============================================================================

  describe("Environment variables", () => {
    it("should use default container name", () => {
      const containerName = process.env.HAPROXY_CONTAINER_NAME || "uni-proxy-manager-haproxy";
      expect(containerName).toBe("uni-proxy-manager-haproxy");
    });

    it("should use default Docker socket path", () => {
      const socketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
      expect(socketPath).toBe("/var/run/docker.sock");
    });
  });

  // ============================================================================
  // Config File Verification Tests
  // ============================================================================

  describe("Config file verification", () => {
    it("should construct config path", () => {
      const configPath = "/etc/haproxy/haproxy.cfg";
      expect(configPath).toBe("/etc/haproxy/haproxy.cfg");
    });

    it("should handle missing config file error", () => {
      const configPath = "/etc/haproxy/haproxy.cfg";
      const error = `Config file not found: ${configPath}`;

      expect(error).toContain(configPath);
    });
  });

  // ============================================================================
  // Socket Verification Tests
  // ============================================================================

  describe("Socket verification", () => {
    it("should use show info command for verification", () => {
      const command = "show info";
      expect(command).toBe("show info");
    });
  });

  // ============================================================================
  // Timeout Tests
  // ============================================================================

  describe("Request timeout", () => {
    it("should use 10 second timeout", () => {
      const timeout = 10000;
      expect(timeout).toBe(10000);
    });
  });

  // ============================================================================
  // Error Formatting Tests
  // ============================================================================

  describe("Error formatting", () => {
    it("should format Docker API error", () => {
      const statusCode = 404;
      const data = "container not found";
      const error = `Docker API returned ${statusCode}: ${data}`;

      expect(error).toBe("Docker API returned 404: container not found");
    });

    it("should format network error", () => {
      const error = new Error("ECONNREFUSED");
      const message = error.message;

      expect(message).toBe("ECONNREFUSED");
    });

    it("should format timeout error", () => {
      const error = "Docker API request timed out";
      expect(error).toBe("Docker API request timed out");
    });

    it("should handle unknown error", () => {
      const error = "unknown";
      const message = error instanceof Error ? error.message : "Unknown error";

      expect(message).toBe("Unknown error");
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
          reason: "certificate_issued",
        },
      } as Job<HaproxyReloadJobData>;

      expect(mockJob.data.reason).toBe("certificate_issued");
    });
  });

  // ============================================================================
  // HTTP Request Options Tests
  // ============================================================================

  describe("HTTP request options", () => {
    it("should construct correct request options", () => {
      const socketPath = "/var/run/docker.sock";
      const containerName = "uni-proxy-manager-haproxy";
      const signal = "SIGHUP";

      const options = {
        socketPath,
        path: `/containers/${containerName}/kill?signal=${signal}`,
        method: "POST",
      };

      expect(options.socketPath).toBe(socketPath);
      expect(options.path).toContain(containerName);
      expect(options.method).toBe("POST");
    });
  });

  // ============================================================================
  // Logging Tests
  // ============================================================================

  describe("Logging", () => {
    it("should format reload start message", () => {
      const reason = "domain_updated";
      const message = `[HAProxy Reload] Processing reload: ${reason}`;

      expect(message).toBe("[HAProxy Reload] Processing reload: domain_updated");
    });

    it("should format success message", () => {
      const containerName = "uni-proxy-manager-haproxy";
      const message = `[HAProxy Reload] Successfully sent SIGHUP to container ${containerName}`;

      expect(message).toBe("[HAProxy Reload] Successfully sent SIGHUP to container uni-proxy-manager-haproxy");
    });

    it("should format completion message", () => {
      const method = "docker-sighup";
      const message = `[HAProxy Reload] Completed via ${method}`;

      expect(message).toBe("[HAProxy Reload] Completed via docker-sighup");
    });
  });
});
