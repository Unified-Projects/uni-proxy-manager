/**
 * Core Job Types Unit Tests
 *
 * Tests for core job data types including certificates, DNS, HAProxy,
 * health checks, cleanup, metrics, and Pomerium.
 */

import { describe, expect, it } from "vitest";
import type {
  CertificateIssueJobData,
  CertificateRenewalJobData,
  CertificateResult,
  DnsChallengeJobData,
  DnsChallengeResult,
  HaproxyReloadJobData,
  HaproxyReloadResult,
  HealthCheckJobData,
  CleanupJobData,
  MetricsCollectionJobData,
  MetricsCollectionResult,
  PomeriumConfigJobData,
  PomeriumConfigResult,
  PomeriumRestartJobData,
  PomeriumRestartResult,
} from "../src/types";

describe("Certificate Job Types", () => {
  describe("CertificateIssueJobData", () => {
    it("has required fields", () => {
      const jobData: CertificateIssueJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        dnsProviderId: "dns-789",
        acmeEmail: "admin@example.com",
      };

      expect(jobData.certificateId).toBe("cert-123");
      expect(jobData.domainId).toBe("domain-456");
      expect(jobData.hostname).toBe("example.com");
      expect(jobData.dnsProviderId).toBe("dns-789");
      expect(jobData.acmeEmail).toBe("admin@example.com");
    });

    it("supports optional fields", () => {
      const jobData: CertificateIssueJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        altNames: ["www.example.com", "api.example.com"],
        dnsProviderId: "dns-789",
        acmeEmail: "admin@example.com",
        staging: true,
      };

      expect(jobData.altNames).toEqual(["www.example.com", "api.example.com"]);
      expect(jobData.staging).toBe(true);
    });

    it("supports empty altNames array", () => {
      const jobData: CertificateIssueJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        altNames: [],
        dnsProviderId: "dns-789",
        acmeEmail: "admin@example.com",
      };

      expect(jobData.altNames).toEqual([]);
    });

    it("defaults staging to undefined for production", () => {
      const jobData: CertificateIssueJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        dnsProviderId: "dns-789",
        acmeEmail: "admin@example.com",
      };

      expect(jobData.staging).toBeUndefined();
    });
  });

  describe("CertificateRenewalJobData", () => {
    it("has required fields", () => {
      const jobData: CertificateRenewalJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        dnsProviderId: "dns-789",
      };

      expect(jobData.certificateId).toBe("cert-123");
      expect(jobData.domainId).toBe("domain-456");
      expect(jobData.hostname).toBe("example.com");
      expect(jobData.dnsProviderId).toBe("dns-789");
    });

    it("supports forceRenewal option", () => {
      const jobData: CertificateRenewalJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        dnsProviderId: "dns-789",
        forceRenewal: true,
      };

      expect(jobData.forceRenewal).toBe(true);
    });

    it("defaults forceRenewal to undefined", () => {
      const jobData: CertificateRenewalJobData = {
        certificateId: "cert-123",
        domainId: "domain-456",
        hostname: "example.com",
        dnsProviderId: "dns-789",
      };

      expect(jobData.forceRenewal).toBeUndefined();
    });
  });

  describe("CertificateResult", () => {
    it("represents successful certificate issuance", () => {
      const result: CertificateResult = {
        success: true,
        certificateId: "cert-123",
        certPath: "/data/certs/example.com/cert.pem",
        keyPath: "/data/certs/example.com/key.pem",
        fullchainPath: "/data/certs/example.com/fullchain.pem",
        expiresAt: new Date("2025-12-31T23:59:59Z"),
      };

      expect(result.success).toBe(true);
      expect(result.certPath).toContain("cert.pem");
      expect(result.keyPath).toContain("key.pem");
      expect(result.fullchainPath).toContain("fullchain.pem");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("represents failed certificate issuance", () => {
      const result: CertificateResult = {
        success: false,
        certificateId: "cert-123",
        error: "DNS challenge failed: record not found",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("DNS challenge failed");
      expect(result.certPath).toBeUndefined();
    });
  });
});

describe("DNS Challenge Job Types", () => {
  describe("DnsChallengeJobData", () => {
    it("has required fields for set action", () => {
      const jobData: DnsChallengeJobData = {
        certificateId: "cert-123",
        hostname: "example.com",
        dnsProviderId: "dns-789",
        challengeToken: "acme-challenge-token-xyz",
        action: "set",
      };

      expect(jobData.certificateId).toBe("cert-123");
      expect(jobData.hostname).toBe("example.com");
      expect(jobData.dnsProviderId).toBe("dns-789");
      expect(jobData.challengeToken).toBe("acme-challenge-token-xyz");
      expect(jobData.action).toBe("set");
    });

    it("has required fields for clear action", () => {
      const jobData: DnsChallengeJobData = {
        certificateId: "cert-123",
        hostname: "example.com",
        dnsProviderId: "dns-789",
        challengeToken: "acme-challenge-token-xyz",
        action: "clear",
      };

      expect(jobData.action).toBe("clear");
    });

    it("supports verificationAttempts tracking", () => {
      const jobData: DnsChallengeJobData = {
        certificateId: "cert-123",
        hostname: "example.com",
        dnsProviderId: "dns-789",
        challengeToken: "acme-challenge-token-xyz",
        action: "set",
        verificationAttempts: 3,
      };

      expect(jobData.verificationAttempts).toBe(3);
    });

    it("accepts set and clear actions only", () => {
      const actions: Array<DnsChallengeJobData["action"]> = ["set", "clear"];

      actions.forEach((action) => {
        const jobData: DnsChallengeJobData = {
          certificateId: "cert-123",
          hostname: "example.com",
          dnsProviderId: "dns-789",
          challengeToken: "token",
          action,
        };

        expect(jobData.action).toBe(action);
      });
    });
  });

  describe("DnsChallengeResult", () => {
    it("represents successful set operation", () => {
      const result: DnsChallengeResult = {
        success: true,
        hostname: "example.com",
        action: "set",
        verified: true,
      };

      expect(result.success).toBe(true);
      expect(result.action).toBe("set");
      expect(result.verified).toBe(true);
    });

    it("represents successful clear operation", () => {
      const result: DnsChallengeResult = {
        success: true,
        hostname: "example.com",
        action: "clear",
      };

      expect(result.success).toBe(true);
      expect(result.action).toBe("clear");
    });

    it("represents failed DNS challenge", () => {
      const result: DnsChallengeResult = {
        success: false,
        hostname: "example.com",
        action: "set",
        verified: false,
        error: "DNS propagation timeout",
      };

      expect(result.success).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error).toContain("timeout");
    });
  });
});

describe("HAProxy Job Types", () => {
  describe("HaproxyReloadJobData", () => {
    it("has required fields", () => {
      const jobData: HaproxyReloadJobData = {
        reason: "Certificate updated for example.com",
        triggeredBy: "certificate",
      };

      expect(jobData.reason).toBe("Certificate updated for example.com");
      expect(jobData.triggeredBy).toBe("certificate");
    });

    it("supports all trigger types", () => {
      const triggers: Array<HaproxyReloadJobData["triggeredBy"]> = [
        "api",
        "certificate",
        "domain",
        "backend",
        "maintenance",
        "scheduled",
      ];

      triggers.forEach((triggeredBy) => {
        const jobData: HaproxyReloadJobData = {
          reason: "Test reload",
          triggeredBy,
        };

        expect(jobData.triggeredBy).toBe(triggeredBy);
      });
    });

    it("supports affectedDomainIds", () => {
      const jobData: HaproxyReloadJobData = {
        reason: "Multiple domains updated",
        triggeredBy: "api",
        affectedDomainIds: ["domain-1", "domain-2", "domain-3"],
      };

      expect(jobData.affectedDomainIds).toHaveLength(3);
      expect(jobData.affectedDomainIds).toContain("domain-1");
    });

    it("supports force option", () => {
      const jobData: HaproxyReloadJobData = {
        reason: "Force reload requested",
        triggeredBy: "api",
        force: true,
      };

      expect(jobData.force).toBe(true);
    });
  });

  describe("HaproxyReloadResult", () => {
    it("represents successful socket reload", () => {
      const result: HaproxyReloadResult = {
        success: true,
        configPath: "/etc/haproxy/haproxy.cfg",
        configVersion: 42,
        reloadMethod: "socket",
      };

      expect(result.success).toBe(true);
      expect(result.reloadMethod).toBe("socket");
      expect(result.configVersion).toBe(42);
    });

    it("represents successful signal reload", () => {
      const result: HaproxyReloadResult = {
        success: true,
        configPath: "/etc/haproxy/haproxy.cfg",
        reloadMethod: "signal",
      };

      expect(result.reloadMethod).toBe("signal");
    });

    it("represents successful docker-sighup reload", () => {
      const result: HaproxyReloadResult = {
        success: true,
        configPath: "/etc/haproxy/haproxy.cfg",
        reloadMethod: "docker-sighup",
      };

      expect(result.reloadMethod).toBe("docker-sighup");
    });

    it("represents config-updated only result", () => {
      const result: HaproxyReloadResult = {
        success: true,
        configPath: "/etc/haproxy/haproxy.cfg",
        reloadMethod: "config-updated",
      };

      expect(result.reloadMethod).toBe("config-updated");
    });

    it("represents no reload needed", () => {
      const result: HaproxyReloadResult = {
        success: true,
        reloadMethod: "none",
      };

      expect(result.reloadMethod).toBe("none");
    });

    it("represents failed reload", () => {
      const result: HaproxyReloadResult = {
        success: false,
        reloadMethod: "unknown",
        error: "HAProxy configuration validation failed",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("validation failed");
    });

    it("supports all reload methods", () => {
      const methods: Array<HaproxyReloadResult["reloadMethod"]> = [
        "socket",
        "signal",
        "restart",
        "docker-sighup",
        "config-updated",
        "none",
        "unknown",
      ];

      methods.forEach((method) => {
        const result: HaproxyReloadResult = {
          success: true,
          reloadMethod: method,
        };

        expect(result.reloadMethod).toBe(method);
      });
    });
  });
});

describe("Health Check Job Types", () => {
  describe("HealthCheckJobData", () => {
    it("supports all scope for checking all backends", () => {
      const jobData: HealthCheckJobData = {
        scope: "all",
      };

      expect(jobData.scope).toBe("all");
      expect(jobData.domainId).toBeUndefined();
      expect(jobData.backendId).toBeUndefined();
    });

    it("supports domain scope with domainId", () => {
      const jobData: HealthCheckJobData = {
        scope: "domain",
        domainId: "domain-123",
      };

      expect(jobData.scope).toBe("domain");
      expect(jobData.domainId).toBe("domain-123");
    });

    it("supports backend scope with backendId", () => {
      const jobData: HealthCheckJobData = {
        scope: "backend",
        backendId: "backend-456",
      };

      expect(jobData.scope).toBe("backend");
      expect(jobData.backendId).toBe("backend-456");
    });

    it("accepts all scope types", () => {
      const scopes: Array<HealthCheckJobData["scope"]> = [
        "all",
        "domain",
        "backend",
      ];

      scopes.forEach((scope) => {
        const jobData: HealthCheckJobData = { scope };
        expect(jobData.scope).toBe(scope);
      });
    });
  });
});

describe("Cleanup Job Types", () => {
  describe("CleanupJobData", () => {
    it("supports single cleanup task", () => {
      const jobData: CleanupJobData = {
        tasks: ["expired_certs"],
      };

      expect(jobData.tasks).toHaveLength(1);
      expect(jobData.tasks).toContain("expired_certs");
    });

    it("supports multiple cleanup tasks", () => {
      const jobData: CleanupJobData = {
        tasks: [
          "expired_certs",
          "old_error_pages",
          "orphaned_files",
          "old_maintenance_windows",
          "old_metrics",
        ],
      };

      expect(jobData.tasks).toHaveLength(5);
    });

    it("accepts all task types", () => {
      const tasks: CleanupJobData["tasks"] = [
        "expired_certs",
        "old_error_pages",
        "orphaned_files",
        "old_maintenance_windows",
        "old_metrics",
      ];

      tasks.forEach((task) => {
        const jobData: CleanupJobData = { tasks: [task] };
        expect(jobData.tasks).toContain(task);
      });
    });
  });
});

describe("Metrics Collection Job Types", () => {
  describe("MetricsCollectionJobData", () => {
    it("has required timestamp field", () => {
      const jobData: MetricsCollectionJobData = {
        timestamp: "2025-01-15T10:30:00.000Z",
      };

      expect(jobData.timestamp).toBe("2025-01-15T10:30:00.000Z");
    });

    it("accepts ISO timestamp strings", () => {
      const jobData: MetricsCollectionJobData = {
        timestamp: new Date().toISOString(),
      };

      expect(jobData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("MetricsCollectionResult", () => {
    it("represents successful metrics collection", () => {
      const result: MetricsCollectionResult = {
        success: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        metricsCollected: 150,
        domainsProcessed: 25,
      };

      expect(result.success).toBe(true);
      expect(result.metricsCollected).toBe(150);
      expect(result.domainsProcessed).toBe(25);
    });

    it("represents failed metrics collection", () => {
      const result: MetricsCollectionResult = {
        success: false,
        timestamp: "2025-01-15T10:30:00.000Z",
        metricsCollected: 0,
        domainsProcessed: 0,
        error: "HAProxy stats socket unreachable",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("socket unreachable");
    });

    it("represents partial success", () => {
      const result: MetricsCollectionResult = {
        success: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        metricsCollected: 50,
        domainsProcessed: 10,
      };

      expect(result.success).toBe(true);
      expect(result.metricsCollected).toBeGreaterThan(0);
    });
  });
});

describe("Pomerium Job Types", () => {
  describe("PomeriumConfigJobData", () => {
    it("has required reason field", () => {
      const jobData: PomeriumConfigJobData = {
        reason: "Route added",
      };

      expect(jobData.reason).toBe("Route added");
    });

    it("supports triggeredBy field", () => {
      const jobData: PomeriumConfigJobData = {
        reason: "IdP configuration changed",
        triggeredBy: "idp",
      };

      expect(jobData.triggeredBy).toBe("idp");
    });

    it("accepts all trigger types", () => {
      const triggers: Array<NonNullable<PomeriumConfigJobData["triggeredBy"]>> =
        ["idp", "route", "settings", "startup"];

      triggers.forEach((triggeredBy) => {
        const jobData: PomeriumConfigJobData = {
          reason: "Test config update",
          triggeredBy,
        };

        expect(jobData.triggeredBy).toBe(triggeredBy);
      });
    });

    it("supports undefined triggeredBy", () => {
      const jobData: PomeriumConfigJobData = {
        reason: "Manual regeneration",
      };

      expect(jobData.triggeredBy).toBeUndefined();
    });
  });

  describe("PomeriumConfigResult", () => {
    it("represents successful config generation", () => {
      const result: PomeriumConfigResult = {
        success: true,
        configPath: "/etc/pomerium/config.yaml",
        routesConfigured: 15,
        idpsConfigured: 2,
      };

      expect(result.success).toBe(true);
      expect(result.configPath).toContain("pomerium");
      expect(result.routesConfigured).toBe(15);
      expect(result.idpsConfigured).toBe(2);
    });

    it("represents failed config generation", () => {
      const result: PomeriumConfigResult = {
        success: false,
        error: "Invalid IdP configuration: missing client_id",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing client_id");
      expect(result.configPath).toBeUndefined();
    });

    it("represents config with zero routes", () => {
      const result: PomeriumConfigResult = {
        success: true,
        configPath: "/etc/pomerium/config.yaml",
        routesConfigured: 0,
        idpsConfigured: 1,
      };

      expect(result.success).toBe(true);
      expect(result.routesConfigured).toBe(0);
    });
  });
});

describe("Job Data Validation", () => {
  it("validates CertificateIssueJobData has required fields", () => {
    const requiredFields = [
      "certificateId",
      "domainId",
      "hostname",
      "dnsProviderId",
      "acmeEmail",
    ];

    const jobData: CertificateIssueJobData = {
      certificateId: "cert-123",
      domainId: "domain-456",
      hostname: "example.com",
      dnsProviderId: "dns-789",
      acmeEmail: "admin@example.com",
    };

    requiredFields.forEach((field) => {
      expect(jobData).toHaveProperty(field);
    });
  });

  it("validates DnsChallengeJobData has required fields", () => {
    const requiredFields = [
      "certificateId",
      "hostname",
      "dnsProviderId",
      "challengeToken",
      "action",
    ];

    const jobData: DnsChallengeJobData = {
      certificateId: "cert-123",
      hostname: "example.com",
      dnsProviderId: "dns-789",
      challengeToken: "token",
      action: "set",
    };

    requiredFields.forEach((field) => {
      expect(jobData).toHaveProperty(field);
    });
  });

  it("validates HaproxyReloadJobData has required fields", () => {
    const requiredFields = ["reason", "triggeredBy"];

    const jobData: HaproxyReloadJobData = {
      reason: "Test",
      triggeredBy: "api",
    };

    requiredFields.forEach((field) => {
      expect(jobData).toHaveProperty(field);
    });
  });

  it("validates HealthCheckJobData has required scope", () => {
    const jobData: HealthCheckJobData = {
      scope: "all",
    };

    expect(jobData).toHaveProperty("scope");
    expect(["all", "domain", "backend"]).toContain(jobData.scope);
  });

  it("validates MetricsCollectionJobData has required timestamp", () => {
    const jobData: MetricsCollectionJobData = {
      timestamp: new Date().toISOString(),
    };

    expect(jobData).toHaveProperty("timestamp");
    expect(typeof jobData.timestamp).toBe("string");
  });

  it("validates PomeriumConfigJobData has required reason", () => {
    const jobData: PomeriumConfigJobData = {
      reason: "Config update",
    };

    expect(jobData).toHaveProperty("reason");
    expect(typeof jobData.reason).toBe("string");
  });

  it("validates PomeriumRestartJobData has required reason", () => {
    const jobData: PomeriumRestartJobData = {
      reason: "Manual restart from UI",
    };

    expect(jobData).toHaveProperty("reason");
    expect(typeof jobData.reason).toBe("string");
  });
});

describe("Pomerium Restart Job Types", () => {
  describe("PomeriumRestartJobData", () => {
    it("has required reason field", () => {
      const jobData: PomeriumRestartJobData = {
        reason: "Manual restart from UI",
      };

      expect(jobData.reason).toBe("Manual restart from UI");
    });

    it("accepts any string reason", () => {
      const reasons = [
        "Manual restart from UI",
        "Secrets regenerated",
        "Post-config reload",
      ];

      reasons.forEach((reason) => {
        const jobData: PomeriumRestartJobData = { reason };
        expect(jobData.reason).toBe(reason);
      });
    });
  });

  describe("PomeriumRestartResult", () => {
    it("represents a successful restart", () => {
      const result: PomeriumRestartResult = {
        success: true,
        method: "docker-restart",
      };

      expect(result.success).toBe(true);
      expect(result.method).toBe("docker-restart");
      expect(result.error).toBeUndefined();
    });

    it("represents a failed restart with error detail", () => {
      const result: PomeriumRestartResult = {
        success: false,
        method: "docker-restart",
        error: "Docker API returned 404: No such container",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("No such container");
    });

    it("always carries a method string regardless of outcome", () => {
      const successResult: PomeriumRestartResult = {
        success: true,
        method: "docker-restart",
      };
      const failResult: PomeriumRestartResult = {
        success: false,
        method: "docker-restart",
        error: "timeout",
      };

      expect(successResult.method).toBe("docker-restart");
      expect(failResult.method).toBe("docker-restart");
    });
  });
});
