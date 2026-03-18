/**
 * Domain Status Computation Unit Tests
 *
 * Tests for the domain status computation module.
 * Covers all status types and priority ordering.
 */

import { describe, it, expect } from "vitest";
import {
  computeDomainStatus,
  getStatusLabel,
  getStatusColorClass,
  type DomainForStatus,
  type ComputedDomainStatus,
} from "../../../../../packages/shared/src/domain-status/index";

describe("Domain Status", () => {
  // ============================================================================
  // computeDomainStatus Tests
  // ============================================================================

  describe("computeDomainStatus", () => {
    describe("maintenance status", () => {
      it("should return maintenance when enabled", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: true,
          sslEnabled: false,
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("maintenance");
      });

      it("should return maintenance even with unhealthy backends", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: true,
          sslEnabled: false,
          backends: [{ enabled: true, isHealthy: false }],
        };

        expect(computeDomainStatus(domain)).toBe("maintenance");
      });

      it("should return maintenance even with SSL errors", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: true,
          sslEnabled: true,
          certificate: null,
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("maintenance");
      });
    });

    describe("no-backends status", () => {
      it("should return no-backends when no backends configured", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [],
        };

        expect(computeDomainStatus(domain)).toBe("no-backends");
      });

      it("should return no-backends when backends is undefined", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
        };

        expect(computeDomainStatus(domain)).toBe("no-backends");
      });

      it("should return no-backends when all backends are disabled", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: false, isHealthy: true },
            { enabled: false, isHealthy: true },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("no-backends");
      });
    });

    describe("offline status", () => {
      it("should return offline when all backends are unhealthy", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: true, isHealthy: false },
            { enabled: true, isHealthy: false },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("offline");
      });

      it("should return offline with single unhealthy backend", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [{ enabled: true, isHealthy: false }],
        };

        expect(computeDomainStatus(domain)).toBe("offline");
      });
    });

    describe("ssl-error status", () => {
      it("should return ssl-error when SSL enabled but no certificate", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: null,
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-error");
      });

      it("should return ssl-error when certificate is undefined", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-error");
      });
    });

    describe("ssl-expired status", () => {
      it("should return ssl-expired when certificate status is expired", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "expired" },
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-expired");
      });
    });

    describe("ssl-pending status", () => {
      it("should return ssl-pending when certificate status is pending", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "pending" },
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-pending");
      });

      it("should return ssl-pending when certificate status is issuing", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "issuing" },
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-pending");
      });

      it("should return ssl-pending when certificate status is failed", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "failed" },
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-pending");
      });

      it("should return ssl-pending when certificate status is revoked", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "revoked" },
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-pending");
      });
    });

    describe("degraded status", () => {
      it("should return degraded when some backends are unhealthy", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: false },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("degraded");
      });

      it("should return degraded with majority unhealthy", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: false },
            { enabled: true, isHealthy: false },
            { enabled: true, isHealthy: false },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("degraded");
      });

      it("should return degraded with SSL active and partial backend health", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "active" },
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: false },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("degraded");
      });
    });

    describe("active status", () => {
      it("should return active when all systems operational", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return active with multiple healthy backends", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: true },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return active with SSL and active certificate", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "active" },
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return active when disabled backends exist but enabled ones are healthy", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: false, isHealthy: false },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return active when SSL is disabled (no certificate required)", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          certificate: null,
          backends: [{ enabled: true, isHealthy: true }],
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });
    });

    describe("status priority", () => {
      it("should prioritize maintenance over no-backends", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: true,
          sslEnabled: false,
          backends: [],
        };

        expect(computeDomainStatus(domain)).toBe("maintenance");
      });

      it("should prioritize no-backends over offline", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [{ enabled: false, isHealthy: false }],
        };

        expect(computeDomainStatus(domain)).toBe("no-backends");
      });

      it("should prioritize offline over ssl-error", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: null,
          backends: [{ enabled: true, isHealthy: false }],
        };

        expect(computeDomainStatus(domain)).toBe("offline");
      });

      it("should prioritize ssl-expired over degraded", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          certificate: { status: "expired" },
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: false },
          ],
        };

        expect(computeDomainStatus(domain)).toBe("ssl-expired");
      });
    });

    describe("redirect and pomerium routes", () => {
      it("should return active when no backends but hasRedirectRoutes is true", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [],
          hasRedirectRoutes: true,
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return active when no backends but hasPomeriumRoutes is true", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [],
          hasPomeriumRoutes: true,
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return active when no backends and both flags are true", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [],
          hasRedirectRoutes: true,
          hasPomeriumRoutes: true,
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return no-backends when no backends and both flags are false", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [],
          hasRedirectRoutes: false,
          hasPomeriumRoutes: false,
        };

        expect(computeDomainStatus(domain)).toBe("no-backends");
      });

      it("should return active when all backends disabled but hasRedirectRoutes is true", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [{ enabled: false, isHealthy: false }],
          hasRedirectRoutes: true,
        };

        expect(computeDomainStatus(domain)).toBe("active");
      });

      it("should return maintenance even when hasRedirectRoutes is true", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: true,
          sslEnabled: false,
          backends: [],
          hasRedirectRoutes: true,
        };

        expect(computeDomainStatus(domain)).toBe("maintenance");
      });
    });
  });

  // ============================================================================
  // getStatusLabel Tests
  // ============================================================================

  describe("getStatusLabel", () => {
    it("should return Active for active status", () => {
      expect(getStatusLabel("active")).toBe("Active");
    });

    it("should return Degraded for degraded status", () => {
      expect(getStatusLabel("degraded")).toBe("Degraded");
    });

    it("should return Offline for offline status", () => {
      expect(getStatusLabel("offline")).toBe("Offline");
    });

    it("should return Maintenance for maintenance status", () => {
      expect(getStatusLabel("maintenance")).toBe("Maintenance");
    });

    it("should return SSL Error for ssl-error status", () => {
      expect(getStatusLabel("ssl-error")).toBe("SSL Error");
    });

    it("should return SSL Expired for ssl-expired status", () => {
      expect(getStatusLabel("ssl-expired")).toBe("SSL Expired");
    });

    it("should return SSL Pending for ssl-pending status", () => {
      expect(getStatusLabel("ssl-pending")).toBe("SSL Pending");
    });

    it("should return No Backends for no-backends status", () => {
      expect(getStatusLabel("no-backends")).toBe("No Backends");
    });

    it("should return correct labels for all status types", () => {
      const statuses: ComputedDomainStatus[] = [
        "active",
        "degraded",
        "offline",
        "maintenance",
        "ssl-error",
        "ssl-expired",
        "ssl-pending",
        "no-backends",
      ];

      for (const status of statuses) {
        const label = getStatusLabel(status);
        expect(label).toBeDefined();
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================================
  // getStatusColorClass Tests
  // ============================================================================

  describe("getStatusColorClass", () => {
    it("should return green classes for active status", () => {
      const colorClass = getStatusColorClass("active");
      expect(colorClass).toContain("green");
    });

    it("should return yellow classes for degraded status", () => {
      const colorClass = getStatusColorClass("degraded");
      expect(colorClass).toContain("yellow");
    });

    it("should return red classes for offline status", () => {
      const colorClass = getStatusColorClass("offline");
      expect(colorClass).toContain("red");
    });

    it("should return yellow classes for maintenance status", () => {
      const colorClass = getStatusColorClass("maintenance");
      expect(colorClass).toContain("yellow");
    });

    it("should return red classes for ssl-error status", () => {
      const colorClass = getStatusColorClass("ssl-error");
      expect(colorClass).toContain("red");
    });

    it("should return red classes for ssl-expired status", () => {
      const colorClass = getStatusColorClass("ssl-expired");
      expect(colorClass).toContain("red");
    });

    it("should return yellow classes for ssl-pending status", () => {
      const colorClass = getStatusColorClass("ssl-pending");
      expect(colorClass).toContain("yellow");
    });

    it("should return gray classes for no-backends status", () => {
      const colorClass = getStatusColorClass("no-backends");
      expect(colorClass).toContain("gray");
    });

    it("should include hover styles for all statuses", () => {
      const statuses: ComputedDomainStatus[] = [
        "active",
        "degraded",
        "offline",
        "maintenance",
        "ssl-error",
        "ssl-expired",
        "ssl-pending",
        "no-backends",
      ];

      for (const status of statuses) {
        const colorClass = getStatusColorClass(status);
        expect(colorClass).toContain("hover:");
      }
    });

    it("should include background and text color for all statuses", () => {
      const statuses: ComputedDomainStatus[] = [
        "active",
        "degraded",
        "offline",
        "maintenance",
        "ssl-error",
        "ssl-expired",
        "ssl-pending",
        "no-backends",
      ];

      for (const status of statuses) {
        const colorClass = getStatusColorClass(status);
        expect(colorClass).toContain("bg-");
        expect(colorClass).toContain("text-");
      }
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("should handle empty backends array", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [],
      };

      expect(computeDomainStatus(domain)).toBe("no-backends");
    });

    it("should handle missing backends property", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
      };

      expect(computeDomainStatus(domain)).toBe("no-backends");
    });

    it("should handle mixed enabled/disabled backends", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: false, isHealthy: true },
          { enabled: false, isHealthy: true },
          { enabled: true, isHealthy: true },
        ],
      };

      expect(computeDomainStatus(domain)).toBe("active");
    });

    it("should correctly identify degraded with complex backend mix", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: true },
          { enabled: false, isHealthy: false }, // Disabled, doesn't count
          { enabled: true, isHealthy: false },
          { enabled: false, isHealthy: true }, // Disabled, doesn't count
        ],
      };

      // 2 enabled: 1 healthy, 1 unhealthy = degraded
      expect(computeDomainStatus(domain)).toBe("degraded");
    });
  });
});
