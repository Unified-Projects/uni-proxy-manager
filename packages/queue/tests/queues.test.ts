/**
 * Queue Definitions Unit Tests
 *
 * Tests for queue names, configurations, priorities, and helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  QUEUES,
  QUEUE_CONFIG,
  JOB_PRIORITY,
  getQueueConfig,
  type QueueName,
  type JobPriority,
} from "../src/queues";

describe("QUEUES", () => {
  describe("Core Queue Names", () => {
    it("should define CERTIFICATE_ISSUE queue", () => {
      expect(QUEUES.CERTIFICATE_ISSUE).toBe("certificate-issue");
    });

    it("should define CERTIFICATE_RENEWAL queue", () => {
      expect(QUEUES.CERTIFICATE_RENEWAL).toBe("certificate-renewal");
    });

    it("should define DNS_CHALLENGE queue", () => {
      expect(QUEUES.DNS_CHALLENGE).toBe("dns-challenge");
    });

    it("should define HAPROXY_RELOAD queue", () => {
      expect(QUEUES.HAPROXY_RELOAD).toBe("haproxy-reload");
    });

    it("should define HEALTH_CHECK queue", () => {
      expect(QUEUES.HEALTH_CHECK).toBe("health-check");
    });

    it("should define CLEANUP queue", () => {
      expect(QUEUES.CLEANUP).toBe("cleanup");
    });

    it("should define METRICS_COLLECTION queue", () => {
      expect(QUEUES.METRICS_COLLECTION).toBe("metrics-collection");
    });
  });

  describe("Sites Extension Queue Names", () => {
    it("should define SITE_BUILD queue", () => {
      expect(QUEUES.SITE_BUILD).toBe("site-build");
    });

    it("should define SITE_DEPLOY queue", () => {
      expect(QUEUES.SITE_DEPLOY).toBe("site-deploy");
    });

    it("should define SITE_ANALYTICS queue", () => {
      expect(QUEUES.SITE_ANALYTICS).toBe("site-analytics");
    });

    it("should define GITHUB_SYNC queue", () => {
      expect(QUEUES.GITHUB_SYNC).toBe("github-sync");
    });

    it("should define PREVIEW_GENERATE queue", () => {
      expect(QUEUES.PREVIEW_GENERATE).toBe("preview-generate");
    });

    it("should define HAPROXY_SITE_CONFIG queue", () => {
      expect(QUEUES.HAPROXY_SITE_CONFIG).toBe("haproxy-site-config");
    });

    it("should define SITE_KEEPALIVE queue", () => {
      expect(QUEUES.SITE_KEEPALIVE).toBe("site-keepalive");
    });

    it("should define MAINTENANCE_CLEANUP queue", () => {
      expect(QUEUES.MAINTENANCE_CLEANUP).toBe("maintenance-cleanup");
    });
  });

  describe("Pomerium Extension Queue Names", () => {
    it("should define POMERIUM_CONFIG queue", () => {
      expect(QUEUES.POMERIUM_CONFIG).toBe("pomerium-config");
    });

    it("should define POMERIUM_RESTART queue", () => {
      expect(QUEUES.POMERIUM_RESTART).toBe("pomerium-restart");
    });
  });

  describe("Queue Name Uniqueness", () => {
    it("should have all unique queue names", () => {
      const queueValues = Object.values(QUEUES);
      const uniqueValues = new Set(queueValues);
      expect(uniqueValues.size).toBe(queueValues.length);
    });

    it("should have kebab-case queue names", () => {
      Object.values(QUEUES).forEach((queueName) => {
        expect(queueName).toMatch(/^[a-z]+(-[a-z]+)*$/);
      });
    });
  });

  describe("QueueName Type", () => {
    it("should be assignable from QUEUES values", () => {
      const queueName: QueueName = QUEUES.CERTIFICATE_ISSUE;
      expect(queueName).toBe("certificate-issue");
    });

    it("should cover all defined queues", () => {
      const allQueues: QueueName[] = [
        QUEUES.CERTIFICATE_ISSUE,
        QUEUES.CERTIFICATE_RENEWAL,
        QUEUES.DNS_CHALLENGE,
        QUEUES.HAPROXY_RELOAD,
        QUEUES.HEALTH_CHECK,
        QUEUES.CLEANUP,
        QUEUES.METRICS_COLLECTION,
        QUEUES.SITE_BUILD,
        QUEUES.SITE_DEPLOY,
        QUEUES.SITE_ANALYTICS,
        QUEUES.GITHUB_SYNC,
        QUEUES.PREVIEW_GENERATE,
        QUEUES.HAPROXY_SITE_CONFIG,
        QUEUES.SITE_KEEPALIVE,
        QUEUES.MAINTENANCE_CLEANUP,
        QUEUES.POMERIUM_CONFIG,
        QUEUES.POMERIUM_RESTART,
      ];
      expect(allQueues).toHaveLength(17);
    });
  });
});

describe("JOB_PRIORITY", () => {
  it("should define CRITICAL as highest priority (1)", () => {
    expect(JOB_PRIORITY.CRITICAL).toBe(1);
  });

  it("should define HIGH priority (5)", () => {
    expect(JOB_PRIORITY.HIGH).toBe(5);
  });

  it("should define NORMAL priority (10)", () => {
    expect(JOB_PRIORITY.NORMAL).toBe(10);
  });

  it("should define LOW priority (20)", () => {
    expect(JOB_PRIORITY.LOW).toBe(20);
  });

  it("should have CRITICAL < HIGH < NORMAL < LOW", () => {
    expect(JOB_PRIORITY.CRITICAL).toBeLessThan(JOB_PRIORITY.HIGH);
    expect(JOB_PRIORITY.HIGH).toBeLessThan(JOB_PRIORITY.NORMAL);
    expect(JOB_PRIORITY.NORMAL).toBeLessThan(JOB_PRIORITY.LOW);
  });

  describe("JobPriority Type", () => {
    it("should be assignable from JOB_PRIORITY values", () => {
      const priority: JobPriority = JOB_PRIORITY.HIGH;
      expect(priority).toBe(5);
    });
  });
});

describe("QUEUE_CONFIG", () => {
  describe("Certificate Issue Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.CERTIFICATE_ISSUE];

    it("should have 3 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(3);
    });

    it("should use exponential backoff with 1 minute initial delay", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "exponential",
        delay: 60000,
      });
    });

    it("should keep completed jobs for 7 days", () => {
      expect(config.defaultJobOptions.removeOnComplete).toEqual({
        age: 7 * 24 * 60 * 60,
        count: 500,
      });
    });

    it("should keep failed jobs for 30 days", () => {
      expect(config.defaultJobOptions.removeOnFail).toEqual({
        age: 30 * 24 * 60 * 60,
        count: 1000,
      });
    });
  });

  describe("Certificate Renewal Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.CERTIFICATE_RENEWAL];

    it("should have 5 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(5);
    });

    it("should use exponential backoff with 1 hour initial delay", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "exponential",
        delay: 3600000,
      });
    });
  });

  describe("DNS Challenge Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.DNS_CHALLENGE];

    it("should have 10 retry attempts for DNS propagation", () => {
      expect(config.defaultJobOptions.attempts).toBe(10);
    });

    it("should use fixed 30 second backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 30000,
      });
    });

    it("should keep completed jobs for 1 day", () => {
      expect(config.defaultJobOptions.removeOnComplete).toEqual({
        age: 24 * 60 * 60,
        count: 200,
      });
    });
  });

  describe("HAProxy Reload Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.HAPROXY_RELOAD];

    it("should have 3 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(3);
    });

    it("should use fixed 5 second backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 5000,
      });
    });
  });

  describe("Health Check Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.HEALTH_CHECK];

    it("should have only 1 attempt", () => {
      expect(config.defaultJobOptions.attempts).toBe(1);
    });

    it("should immediately remove completed jobs", () => {
      expect(config.defaultJobOptions.removeOnComplete).toBe(true);
    });

    it("should keep failed checks for 1 hour", () => {
      expect(config.defaultJobOptions.removeOnFail).toEqual({
        age: 60 * 60,
        count: 100,
      });
    });
  });

  describe("Cleanup Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.CLEANUP];

    it("should have 2 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(2);
    });

    it("should use fixed 1 minute backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 60000,
      });
    });
  });

  describe("Metrics Collection Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.METRICS_COLLECTION];

    it("should have 2 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(2);
    });

    it("should immediately remove completed jobs", () => {
      expect(config.defaultJobOptions.removeOnComplete).toBe(true);
    });
  });

  describe("Site Build Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.SITE_BUILD];

    it("should have 2 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(2);
    });

    it("should use exponential backoff with 30 second initial delay", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "exponential",
        delay: 30000,
      });
    });
  });

  describe("Site Deploy Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.SITE_DEPLOY];

    it("should have 3 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(3);
    });

    it("should use exponential backoff with 10 second initial delay", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "exponential",
        delay: 10000,
      });
    });
  });

  describe("Site Analytics Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.SITE_ANALYTICS];

    it("should have 2 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(2);
    });

    it("should immediately remove completed jobs", () => {
      expect(config.defaultJobOptions.removeOnComplete).toBe(true);
    });
  });

  describe("GitHub Sync Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.GITHUB_SYNC];

    it("should have 3 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(3);
    });

    it("should use exponential backoff with 1 minute initial delay", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "exponential",
        delay: 60000,
      });
    });
  });

  describe("Preview Generate Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.PREVIEW_GENERATE];

    it("should have 2 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(2);
    });

    it("should use fixed 10 second backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 10000,
      });
    });
  });

  describe("HAProxy Site Config Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.HAPROXY_SITE_CONFIG];

    it("should have 3 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(3);
    });

    it("should use fixed 5 second backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 5000,
      });
    });
  });

  describe("Site Keepalive Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.SITE_KEEPALIVE];

    it("should have only 1 attempt", () => {
      expect(config.defaultJobOptions.attempts).toBe(1);
    });

    it("should immediately remove completed jobs", () => {
      expect(config.defaultJobOptions.removeOnComplete).toBe(true);
    });
  });

  describe("Maintenance Cleanup Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.MAINTENANCE_CLEANUP];

    it("should have only 1 attempt", () => {
      expect(config.defaultJobOptions.attempts).toBe(1);
    });

    it("should keep last 30 cleanup results", () => {
      expect(config.defaultJobOptions.removeOnComplete).toEqual({
        age: 7 * 24 * 60 * 60,
        count: 30,
      });
    });
  });

  describe("Pomerium Config Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.POMERIUM_CONFIG];

    it("should have 3 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(3);
    });

    it("should use fixed 5 second backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 5000,
      });
    });

    it("should keep completed jobs for 1 day", () => {
      expect(config.defaultJobOptions.removeOnComplete).toEqual({
        age: 24 * 60 * 60,
        count: 100,
      });
    });
  });

  describe("Pomerium Restart Queue", () => {
    const config = QUEUE_CONFIG[QUEUES.POMERIUM_RESTART];

    it("should have 2 retry attempts", () => {
      expect(config.defaultJobOptions.attempts).toBe(2);
    });

    it("should use fixed 5 second backoff", () => {
      expect(config.defaultJobOptions.backoff).toEqual({
        type: "fixed",
        delay: 5000,
      });
    });

    it("should keep completed jobs for 1 day", () => {
      expect(config.defaultJobOptions.removeOnComplete).toEqual({
        age: 24 * 60 * 60,
        count: 50,
      });
    });

    it("should keep failed jobs for 7 days", () => {
      expect(config.defaultJobOptions.removeOnFail).toEqual({
        age: 7 * 24 * 60 * 60,
        count: 100,
      });
    });
  });

  describe("Config Completeness", () => {
    it("should have config for all defined queues", () => {
      Object.values(QUEUES).forEach((queueName) => {
        expect(QUEUE_CONFIG[queueName]).toBeDefined();
        expect(QUEUE_CONFIG[queueName].defaultJobOptions).toBeDefined();
      });
    });
  });
});

describe("getQueueConfig", () => {
  it("should return config for DNS_CHALLENGE queue", () => {
    const config = getQueueConfig(QUEUES.DNS_CHALLENGE);
    expect(config.attempts).toBe(10);
    expect(config.backoff).toEqual({ type: "fixed", delay: 30000 });
  });

  it("should return config for HAPROXY_RELOAD queue", () => {
    const config = getQueueConfig(QUEUES.HAPROXY_RELOAD);
    expect(config.attempts).toBe(3);
    expect(config.backoff).toEqual({ type: "fixed", delay: 5000 });
  });

  it("should return config for CERTIFICATE_ISSUE queue", () => {
    const config = getQueueConfig(QUEUES.CERTIFICATE_ISSUE);
    expect(config.attempts).toBe(3);
    expect(config.backoff).toEqual({ type: "exponential", delay: 60000 });
  });

  it("should return config for SITE_BUILD queue", () => {
    const config = getQueueConfig(QUEUES.SITE_BUILD);
    expect(config.attempts).toBe(2);
    expect(config.backoff).toEqual({ type: "exponential", delay: 30000 });
  });

  it("should return config for POMERIUM_CONFIG queue", () => {
    const config = getQueueConfig(QUEUES.POMERIUM_CONFIG);
    expect(config.attempts).toBe(3);
    expect(config.backoff).toEqual({ type: "fixed", delay: 5000 });
  });

  it("should return config for POMERIUM_RESTART queue", () => {
    const config = getQueueConfig(QUEUES.POMERIUM_RESTART);
    expect(config.attempts).toBe(2);
    expect(config.backoff).toEqual({ type: "fixed", delay: 5000 });
  });

  it("should return an isolated copy so callers can mutate safely", () => {
    const original = getQueueConfig(QUEUES.HAPROXY_RELOAD);
    original.attempts = 99;

    const fresh = getQueueConfig(QUEUES.HAPROXY_RELOAD);
    expect(fresh.attempts).toBe(3);
  });

  it("should return independent copies on multiple calls", () => {
    const config1 = getQueueConfig(QUEUES.DNS_CHALLENGE);
    const config2 = getQueueConfig(QUEUES.DNS_CHALLENGE);

    config1.attempts = 999;

    expect(config2.attempts).toBe(10);
    expect(config1).not.toBe(config2);
  });

  it("should return empty object for unknown queue", () => {
    const config = getQueueConfig("unknown-queue" as QueueName);
    expect(config).toEqual({});
  });

  it("should return cloneable configs for all queues", () => {
    Object.values(QUEUES).forEach((queueName) => {
      const config = getQueueConfig(queueName);
      expect(() => JSON.stringify(config)).not.toThrow();
    });
  });
});
