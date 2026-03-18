/**
 * Queue package exports
 *
 * Provides BullMQ queue definitions and types for certificate management,
 * HAProxy config generation, and background tasks.
 */

// Queue definitions
export {
  QUEUES,
  JOB_PRIORITY,
  QUEUE_CONFIG,
  getQueueConfig,
  type QueueName,
  type JobPriority,
} from "./queues";

// Job data types
export type {
  CertificateIssueJobData,
  CertificateRenewalJobData,
  DnsChallengeJobData,
  HaproxyReloadJobData,
  HealthCheckJobData,
  CleanupJobData,
  MetricsCollectionJobData,
  HaproxyLogParseJobData,
  CertificateResult,
  DnsChallengeResult,
  HaproxyReloadResult,
  MetricsCollectionResult,
  HaproxyLogParseResult,
  // Sites extension types
  SiteBuildJobData,
  SiteDeployJobData,
  SiteAnalyticsJobData,
  GitHubSyncJobData,
  PreviewGenerateJobData,
  HaproxySiteConfigJobData,
  SiteKeepAliveJobData,
  SiteBuildResult,
  SiteDeployResult,
  PreviewGenerateResult,
  SiteKeepAliveResult,
  MaintenanceCleanupJobData,
  MaintenanceCleanupResult,
  // Pomerium extension types
  PomeriumConfigJobData,
  PomeriumConfigResult,
  // Analytics extension types
  AnalyticsFunnelComputeJobData,
  AnalyticsFunnelComputeResult,
  AnalyticsAnomalyDetectionJobData,
  AnalyticsAnomalyDetectionResult,
  AnalyticsAggregateCleanupJobData,
  AnalyticsDataCleanupJobData,
  PomeriumRestartJobData,
  PomeriumRestartResult,
  // Shared backend types
  SharedBackendSyncJobData,
  SharedBackendSyncResult,
  // Cluster sync types
  ClusterSyncJobData,
  ClusterSyncResult,
  // HAProxy watchdog types
  HaproxyWatchdogJobData,
  HaproxyWatchdogResult,
} from "./types";
