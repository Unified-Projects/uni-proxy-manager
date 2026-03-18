import { describe, it, expect } from "vitest";
import {
  computeDomainStatus,
  getStatusLabel,
  getStatusColorClass,
  type DomainForStatus,
  type ComputedDomainStatus,
} from "../src/domain-status";

describe("Domain Status Computation", () => {
  describe("computeDomainStatus", () => {
    it("should return 'maintenance' when maintenance is enabled (highest priority)", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: true,
        sslEnabled: false,
        backends: [{ enabled: true, isHealthy: true }],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("maintenance");
    });

    it("should return 'maintenance' even with other issues", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: true,
        sslEnabled: true,
        backends: [], // No backends
        certificate: null, // No certificate
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("maintenance");
    });

    it("should return 'no-backends' when no backends are configured", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("no-backends");
    });

    it("should return 'no-backends' when no backends are enabled", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: false, isHealthy: true },
          { enabled: false, isHealthy: false },
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("no-backends");
    });

    it("should return 'offline' when all backends are unhealthy", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: false },
          { enabled: true, isHealthy: false },
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("offline");
    });

    it("should return 'offline' when mix of enabled/disabled but all enabled are unhealthy", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: false },
          { enabled: false, isHealthy: true }, // Disabled backends don't count
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("offline");
    });

    it("should return 'ssl-error' when SSL enabled but no certificate", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: null,
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-error");
    });

    it("should return 'ssl-error' when SSL enabled and certificate is undefined", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: undefined,
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-error");
    });

    it("should return 'ssl-expired' when certificate is expired", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: { status: "expired" },
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-expired");
    });

    it("should return 'ssl-pending' when certificate is pending", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: { status: "pending" },
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-pending");
    });

    it("should return 'ssl-pending' when certificate is issuing", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: { status: "issuing" },
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-pending");
    });

    it("should return 'ssl-pending' when certificate is failed", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: { status: "failed" },
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-pending");
    });

    it("should return 'ssl-pending' when certificate is revoked", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: { status: "revoked" },
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("ssl-pending");
    });

    it("should return 'degraded' when some backends are unhealthy", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: true },
          { enabled: true, isHealthy: false },
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("degraded");
    });

    it("should return 'degraded' ignoring disabled backends", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: true },
          { enabled: true, isHealthy: false },
          { enabled: false, isHealthy: false }, // Disabled - should be ignored
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("degraded");
    });

    it("should return 'active' when all systems operational", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: true },
          { enabled: true, isHealthy: true },
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("active");
    });

    it("should return 'active' with SSL and active certificate", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: true,
        backends: [{ enabled: true, isHealthy: true }],
        certificate: { status: "active" },
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("active");
    });

    it("should return 'active' with single healthy backend", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [{ enabled: true, isHealthy: true }],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("active");
    });

    it("should return 'active' when SSL not enabled and backends are healthy", () => {
      const domain: DomainForStatus = {
        maintenanceEnabled: false,
        sslEnabled: false,
        backends: [
          { enabled: true, isHealthy: true },
          { enabled: false, isHealthy: false }, // Disabled backend ignored
        ],
      };

      const status = computeDomainStatus(domain);
      expect(status).toBe("active");
    });

    describe("priority order", () => {
      it("maintenance > no-backends", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: true,
          sslEnabled: false,
          backends: [],
        };

        expect(computeDomainStatus(domain)).toBe("maintenance");
      });

      it("no-backends > offline", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [], // No backends takes priority
        };

        expect(computeDomainStatus(domain)).toBe("no-backends");
      });

      it("offline > ssl-error", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          backends: [{ enabled: true, isHealthy: false }], // All unhealthy
          certificate: null, // SSL error
        };

        expect(computeDomainStatus(domain)).toBe("offline");
      });

      it("ssl-error > ssl-expired", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          backends: [{ enabled: true, isHealthy: true }],
          certificate: null, // No cert takes priority over expired
        };

        expect(computeDomainStatus(domain)).toBe("ssl-error");
      });

      it("ssl-expired > ssl-pending", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          backends: [{ enabled: true, isHealthy: true }],
          certificate: { status: "expired" },
        };

        expect(computeDomainStatus(domain)).toBe("ssl-expired");
      });

      it("ssl-pending > degraded", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: true,
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: false }, // Degraded backends
          ],
          certificate: { status: "pending" },
        };

        expect(computeDomainStatus(domain)).toBe("ssl-pending");
      });

      it("degraded > active", () => {
        const domain: DomainForStatus = {
          maintenanceEnabled: false,
          sslEnabled: false,
          backends: [
            { enabled: true, isHealthy: true },
            { enabled: true, isHealthy: false }, // Some unhealthy
          ],
        };

        expect(computeDomainStatus(domain)).toBe("degraded");
      });
    });
  });

  describe("getStatusLabel", () => {
    const testCases: Array<[ComputedDomainStatus, string]> = [
      ["active", "Active"],
      ["degraded", "Degraded"],
      ["offline", "Offline"],
      ["maintenance", "Maintenance"],
      ["ssl-error", "SSL Error"],
      ["ssl-expired", "SSL Expired"],
      ["ssl-pending", "SSL Pending"],
      ["no-backends", "No Backends"],
    ];

    it.each(testCases)("should return '%s' label for %s status", (status, expectedLabel) => {
      expect(getStatusLabel(status)).toBe(expectedLabel);
    });
  });

  describe("getStatusColorClass", () => {
    it("should return green class for active status", () => {
      const colorClass = getStatusColorClass("active");
      expect(colorClass).toContain("green");
    });

    it("should return yellow class for degraded status", () => {
      const colorClass = getStatusColorClass("degraded");
      expect(colorClass).toContain("yellow");
    });

    it("should return red class for offline status", () => {
      const colorClass = getStatusColorClass("offline");
      expect(colorClass).toContain("red");
    });

    it("should return yellow class for maintenance status", () => {
      const colorClass = getStatusColorClass("maintenance");
      expect(colorClass).toContain("yellow");
    });

    it("should return red class for ssl-error status", () => {
      const colorClass = getStatusColorClass("ssl-error");
      expect(colorClass).toContain("red");
    });

    it("should return red class for ssl-expired status", () => {
      const colorClass = getStatusColorClass("ssl-expired");
      expect(colorClass).toContain("red");
    });

    it("should return yellow class for ssl-pending status", () => {
      const colorClass = getStatusColorClass("ssl-pending");
      expect(colorClass).toContain("yellow");
    });

    it("should return gray class for no-backends status", () => {
      const colorClass = getStatusColorClass("no-backends");
      expect(colorClass).toContain("gray");
    });

    it("should return valid Tailwind classes", () => {
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
        // Should contain bg-, text-, and hover: classes
        expect(colorClass).toMatch(/bg-/);
        expect(colorClass).toMatch(/text-/);
        expect(colorClass).toMatch(/hover:/);
      }
    });
  });
});
