/**
 * Queue definitions and configuration for BullMQ
 */

import type { JobsOptions } from "bullmq";

/**
 * Queue names used throughout the application
 */
export const QUEUES = {
  /** Queue for certificate issuance jobs */
  CERTIFICATE_ISSUE: "certificate-issue",
  /** Queue for certificate renewal jobs */
  CERTIFICATE_RENEWAL: "certificate-renewal",
  /** Queue for DNS challenge operations */
  DNS_CHALLENGE: "dns-challenge",
  /** Queue for HAProxy config generation and reload */
  HAPROXY_RELOAD: "haproxy-reload",
  /** Queue for backend health checks */
  HEALTH_CHECK: "health-check",
  /** Queue for cleanup operations (expired certs, old files) */
  CLEANUP: "cleanup",
  /** Queue for metrics collection from HAProxy */
  METRICS_COLLECTION: "metrics-collection",
  /** Queue for parsing HAProxy access logs for per-domain traffic */
  HAPROXY_LOG_PARSE: "haproxy-log-parse",

  // Sites extension queues (only used when extension enabled)
  /** Queue for site build jobs */
  SITE_BUILD: "site-build",
  /** Queue for site deployment jobs */
  SITE_DEPLOY: "site-deploy",
  /** Queue for site analytics collection */
  SITE_ANALYTICS: "site-analytics",
  /** Queue for GitHub sync operations */
  GITHUB_SYNC: "github-sync",
  /** Queue for site preview generation */
  PREVIEW_GENERATE: "preview-generate",
  /** Queue for HAProxy site backend config updates */
  HAPROXY_SITE_CONFIG: "haproxy-site-config",
  /** Queue for site keep-alive pings (cold start prevention) */
  SITE_KEEPALIVE: "site-keepalive",
  /** Queue for daily maintenance cleanup of orphaned files */
  MAINTENANCE_CLEANUP: "maintenance-cleanup",

  // Pomerium extension queues (only used when extension enabled)
  /** Queue for Pomerium config regeneration */
  POMERIUM_CONFIG: "pomerium-config",
  /** Queue for Pomerium service restarts */
  POMERIUM_RESTART: "pomerium-restart",

  /** Queue for syncing shared backend changes to linked domains */
  SHARED_BACKEND_SYNC: "shared-backend-sync",

  /** Queue for syncing config to cluster nodes */
  CLUSTER_SYNC: "cluster-sync",

  // Analytics extension queues (only used when extension enabled)
  /** Queue for funnel computation jobs */
  ANALYTICS_FUNNEL_COMPUTE: "analytics-funnel-compute",
  /** Queue for anomaly detection jobs */
  ANALYTICS_ANOMALY_DETECTION: "analytics-anomaly-detection",
  /** Queue for aggregate table cleanup jobs */
  ANALYTICS_AGGREGATE_CLEANUP: "analytics-aggregate-cleanup",
  /** Queue for deleting all ClickHouse data for a removed analytics config */
  ANALYTICS_DATA_CLEANUP: "analytics-data-cleanup",

  /** Queue for HAProxy crash detection and auto-restart watchdog */
  HAPROXY_WATCHDOG: "haproxy-watchdog",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Job priority levels (lower number = higher priority)
 */
export const JOB_PRIORITY = {
  /** HAProxy reload - highest priority */
  CRITICAL: 1,
  /** Certificate operations */
  HIGH: 5,
  /** Health checks */
  NORMAL: 10,
  /** Cleanup operations */
  LOW: 20,
} as const;

export type JobPriority = (typeof JOB_PRIORITY)[keyof typeof JOB_PRIORITY];

/**
 * Default job options for each queue type
 */
export const QUEUE_CONFIG: Record<string, { defaultJobOptions: JobsOptions }> = {
  [QUEUES.CERTIFICATE_ISSUE]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 60000, // 1 minute initial delay
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60, // Keep for 7 days
        count: 500,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60, // Keep for 30 days
        count: 1000,
      },
    },
  },
  [QUEUES.CERTIFICATE_RENEWAL]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 3600000, // 1 hour initial delay for renewals
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60,
        count: 500,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 1000,
      },
    },
  },
  [QUEUES.DNS_CHALLENGE]: {
    defaultJobOptions: {
      attempts: 10,
      backoff: {
        type: "fixed",
        delay: 30000, // 30 seconds - DNS propagation needs time
      },
      removeOnComplete: {
        age: 24 * 60 * 60, // Keep for 1 day
        count: 200,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 500,
      },
    },
  },
  [QUEUES.HAPROXY_RELOAD]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "fixed",
        delay: 5000, // 5 seconds
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 200,
      },
    },
  },
  [QUEUES.HEALTH_CHECK]: {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: {
        age: 60 * 60, // Keep failed checks for 1 hour
        count: 100,
      },
    },
  },
  [QUEUES.CLEANUP]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 60000,
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 100,
      },
    },
  },
  [QUEUES.METRICS_COLLECTION]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 30000, // 30 seconds
      },
      removeOnComplete: true,
      removeOnFail: {
        age: 60 * 60, // Keep failed metrics jobs for 1 hour
        count: 50,
      },
    },
  },
  [QUEUES.HAPROXY_LOG_PARSE]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 30000, // 30 seconds
      },
      removeOnComplete: true,
      removeOnFail: {
        age: 60 * 60, // Keep failed log parse jobs for 1 hour
        count: 50,
      },
    },
  },

  // Sites extension queue configs
  [QUEUES.SITE_BUILD]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 30000, // 30 seconds initial delay
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60, // Keep for 7 days
        count: 100,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60, // Keep for 30 days
        count: 200,
      },
    },
  },
  [QUEUES.SITE_DEPLOY]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 10000, // 10 seconds initial delay
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 200,
      },
    },
  },
  [QUEUES.SITE_ANALYTICS]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 30000,
      },
      removeOnComplete: true,
      removeOnFail: {
        age: 60 * 60, // 1 hour
        count: 50,
      },
    },
  },
  [QUEUES.GITHUB_SYNC]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 60000, // 1 minute
      },
      removeOnComplete: {
        age: 24 * 60 * 60, // 1 day
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60, // 7 days
        count: 200,
      },
    },
  },
  [QUEUES.PREVIEW_GENERATE]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 10000,
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 100,
      },
    },
  },
  [QUEUES.HAPROXY_SITE_CONFIG]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "fixed",
        delay: 5000, // 5 seconds
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 200,
      },
    },
  },
  [QUEUES.SITE_KEEPALIVE]: {
    defaultJobOptions: {
      attempts: 1, // Single attempt - just a ping
      removeOnComplete: true, // Don't need to keep ping results
      removeOnFail: {
        age: 60 * 60, // Keep failed pings for 1 hour for debugging
        count: 100,
      },
    },
  },
  [QUEUES.MAINTENANCE_CLEANUP]: {
    defaultJobOptions: {
      attempts: 1, // Single daily attempt
      removeOnComplete: {
        age: 7 * 24 * 60 * 60, // Keep for 7 days
        count: 30, // Keep last 30 cleanups
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60, // Keep failures for 30 days
        count: 100,
      },
    },
  },

  [QUEUES.SHARED_BACKEND_SYNC]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "fixed",
        delay: 2000, // 2 seconds
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 200,
      },
    },
  },
  [QUEUES.CLUSTER_SYNC]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5000, // 5 seconds
      },
      removeOnComplete: {
        age: 60 * 60, // Keep for 1 hour (runs every 30s)
        count: 100,
      },
      removeOnFail: {
        age: 24 * 60 * 60,
        count: 100,
      },
    },
  },

  // Pomerium extension queue configs
  [QUEUES.POMERIUM_CONFIG]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "fixed",
        delay: 5000, // 5 seconds
      },
      removeOnComplete: {
        age: 24 * 60 * 60, // 1 day
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60, // 7 days
        count: 200,
      },
    },
  },
  [QUEUES.POMERIUM_RESTART]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 5000, // 5 seconds
      },
      removeOnComplete: {
        age: 24 * 60 * 60, // 1 day
        count: 50,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60, // 7 days
        count: 100,
      },
    },
  },

  // Analytics extension queue configs
  [QUEUES.ANALYTICS_FUNNEL_COMPUTE]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 30000,
      },
      removeOnComplete: {
        age: 24 * 60 * 60, // Keep for 1 day
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 50,
      },
    },
  },
  [QUEUES.ANALYTICS_ANOMALY_DETECTION]: {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: {
        age: 24 * 60 * 60,
        count: 100,
      },
    },
  },
  [QUEUES.ANALYTICS_AGGREGATE_CLEANUP]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 300000 },
      removeOnComplete: true,
      removeOnFail: {
        age: 24 * 60 * 60,
        count: 10,
      },
    },
  },
  [QUEUES.ANALYTICS_DATA_CLEANUP]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60000 },
      removeOnComplete: true,
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 50,
      },
    },
  },
  [QUEUES.HAPROXY_WATCHDOG]: {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: {
        age: 60 * 60,
        count: 50,
      },
    },
  },
};

/**
 * Get default job options for a queue
 */
export function getQueueConfig(queueName: QueueName): JobsOptions {
  const defaults = QUEUE_CONFIG[queueName]?.defaultJobOptions ?? {};
  // Return a clone so callers can safely mutate without affecting shared defaults
  return structuredClone(defaults);
}
