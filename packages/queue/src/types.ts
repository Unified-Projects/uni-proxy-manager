/**
 * Job data types for BullMQ queues
 */

/**
 * Certificate issuance job data
 */
export interface CertificateIssueJobData {
  certificateId: string;
  domainId: string;
  hostname: string;
  altNames?: string[];
  dnsProviderId: string;
  acmeEmail: string;
  staging?: boolean;
}

/**
 * Certificate renewal job data
 */
export interface CertificateRenewalJobData {
  certificateId: string;
  domainId: string;
  hostname: string;
  dnsProviderId: string;
  forceRenewal?: boolean;
}

/**
 * DNS challenge job data
 */
export interface DnsChallengeJobData {
  certificateId: string;
  hostname: string;
  dnsProviderId: string;
  challengeToken: string;
  action: "set" | "clear";
  /** Number of verification attempts made */
  verificationAttempts?: number;
}

/**
 * HAProxy reload job data
 */
export interface HaproxyReloadJobData {
  reason: string;
  triggeredBy: "api" | "certificate" | "domain" | "backend" | "maintenance" | "scheduled" | "pomerium-config";
  /** Domain IDs that triggered this reload */
  affectedDomainIds?: string[];
  /** Force regeneration even if config hasn't changed */
  force?: boolean;
}

/**
 * Health check job data
 */
export interface HealthCheckJobData {
  /** Check all backends or specific ones */
  scope: "all" | "domain" | "backend";
  domainId?: string;
  backendId?: string;
}

/**
 * Cleanup job data
 */
export interface CleanupJobData {
  tasks: Array<"expired_certs" | "old_error_pages" | "orphaned_files" | "old_maintenance_windows" | "old_metrics">;
}

export interface MetricsCollectionJobData {
  timestamp: string;
}

export interface HaproxyLogParseJobData {
  timestamp: string;
}

export interface HaproxyLogParseResult {
  success: boolean;
  timestamp: string;
  linesProcessed: number;
  domainsUpdated: number;
  error?: string;
}

/**
 * Certificate operation result
 */
export interface CertificateResult {
  success: boolean;
  certificateId: string;
  certPath?: string;
  keyPath?: string;
  fullchainPath?: string;
  expiresAt?: Date;
  error?: string;
}

/**
 * DNS challenge result
 */
export interface DnsChallengeResult {
  success: boolean;
  hostname: string;
  action: "set" | "clear";
  verified?: boolean;
  error?: string;
}

/**
 * HAProxy reload result
 */
export interface HaproxyReloadResult {
  success: boolean;
  configPath?: string;
  configVersion?: number;
  reloadMethod: "socket" | "signal" | "restart" | "docker-sighup" | "config-updated" | "none" | "unknown";
  error?: string;
}

export interface MetricsCollectionResult {
  success: boolean;
  timestamp: string;
  metricsCollected: number;
  domainsProcessed: number;
  error?: string;
}

// =============================================================================
// Sites Extension Job Types (only used when extension enabled)
// =============================================================================

/**
 * Site build job data
 */
export interface SiteBuildJobData {
  siteId: string;
  deploymentId: string;
  commitSha?: string;
  branch: string;
  envVariables: Record<string, string>;
  buildCommand?: string;
  installCommand?: string;
  nodeVersion: string;
  framework: "nextjs" | "sveltekit" | "static" | "custom";
  buildFlags?: string[];
  outputDirectory?: string;
  sourcePath?: string;
  /** Build-specific resource configuration for executor-based builds */
  buildConfig: {
    cpus: number;
    memoryMb: number;
    timeoutSeconds: number;
  };
}

/**
 * Site deploy job data
 */
export interface SiteDeployJobData {
  siteId: string;
  deploymentId: string;
  targetSlot: "blue" | "green";
  artifactPath: string;
  renderMode?: "ssr" | "ssg";
  runtimeConfig: {
    cpus: number;
    memoryMb: number;
    timeout: number;
  };
  entryPoint?: string;
  runtimePath?: string;
}

export interface SiteAnalyticsJobData {
  siteId: string;
  timestamp: string;
}

/**
 * GitHub sync job data
 */
export interface GitHubSyncJobData {
  siteId: string;
  installationId: number;
  action: "refresh_token" | "fetch_branches" | "check_commit" | "sync_all";
}

/**
 * Preview generation job data
 */
export interface PreviewGenerateJobData {
  siteId: string;
  deploymentId: string;
  slug: string;
  url?: string;
}

/**
 * HAProxy site config job data
 */
export interface HaproxySiteConfigJobData {
  siteId: string;
  activeSlot: "blue" | "green";
  action: "add" | "update" | "remove";
}

/**
 * Site build result
 */
export interface SiteBuildResult {
  success: boolean;
  deploymentId: string;
  artifactPath?: string;
  artifactSize?: number;
  buildDurationMs?: number;
  error?: string;
  /** SSR detection results */
  detectedRenderMode?: "ssr" | "ssg";
  detectedEntryPoint?: string;
  detectedRuntimePath?: string;
}

/**
 * Site deploy result
 */
export interface SiteDeployResult {
  success: boolean;
  deploymentId: string;
  runtimeId?: string;
  slot: "blue" | "green";
  error?: string;
}

/**
 * Preview generation result
 */
export interface PreviewGenerateResult {
  success: boolean;
  deploymentId: string;
  previewUrl?: string;
  error?: string;
}

/**
 * Site keep-alive job data
 * When siteId is "*", the scheduler queries all sites with coldStartEnabled=false
 */
export interface SiteKeepAliveJobData {
  siteId: string;
}

/**
 * Site keep-alive result
 */
export interface SiteKeepAliveResult {
  success: boolean;
  siteId: string;
  responseTimeMs?: number;
  statusCode?: number;
  error?: string;
}

/**
 * Maintenance cleanup job data
 */
export interface MaintenanceCleanupJobData {
  type: "all" | "certificates" | "sites" | "deployments";
}

/**
 * Maintenance cleanup result
 */
export interface MaintenanceCleanupResult {
  success: boolean;
  cleanedCertificateDirs: number;
  cleanedSiteSourceDirs: number;
  cleanedDeploymentArtifacts: number;
  errors: string[];
}

// =============================================================================
// Shared Backend Job Types
// =============================================================================

export interface SharedBackendSyncJobData {
  sharedBackendId: string;
  reason?: string;
}

export interface SharedBackendSyncResult {
  success: boolean;
  sharedBackendId: string;
  domainsAffected: number;
  error?: string;
}

// =============================================================================
// Cluster Sync Job Types
// =============================================================================

export interface ClusterSyncJobData {
  reason?: string;
  triggeredBy?: "domain-change" | "manual" | "backend-change";
  targetNodeIds?: string[];
}

export interface ClusterSyncResult {
  success: boolean;
  nodesAttempted: number;
  nodesSucceeded: number;
  errors: Array<{ nodeId: string; error: string }>;
}

// =============================================================================
// Pomerium Extension Job Types (only used when extension enabled)
// =============================================================================

/**
 * Pomerium config regeneration job data
 */
export interface PomeriumConfigJobData {
  reason: string;
  triggeredBy?: "idp" | "route" | "settings" | "startup";
}

/**
 * Pomerium config regeneration result
 */
export interface PomeriumConfigResult {
  success: boolean;
  configPath?: string;
  routesConfigured?: number;
  idpsConfigured?: number;
  error?: string;
}

/**
 * Pomerium service restart job data
 */
export interface PomeriumRestartJobData {
  reason: string;
}

/**
 * Pomerium service restart result
 */
export interface PomeriumRestartResult {
  success: boolean;
  method: string;
  error?: string;
}

// =============================================================================
// Analytics Extension Job Types (only used when extension enabled)
// =============================================================================

/**
 * Funnel computation job data
 */
export interface AnalyticsFunnelComputeJobData {
  funnelId: string;
  analyticsConfigId?: string;
  /** If provided, compute for this specific period. Otherwise compute for default window. */
  periodStart?: string;
  periodEnd?: string;
}

/**
 * Funnel computation result
 */
export interface AnalyticsFunnelComputeResult {
  success: boolean;
  funnelId: string;
  totalEntrants: number;
  stepCounts: number[];
  overallConversionRate: number;
  error?: string;
}

/**
 * Anomaly detection job data
 */
export interface AnalyticsAnomalyDetectionJobData {
  analyticsConfigId?: string;
  /** Which metric to check */
  metric?: "page_views" | "unique_visitors" | "sessions";
}

/**
 * Aggregate cleanup job data
 */
export interface AnalyticsAggregateCleanupJobData {
  /** Empty - runs for all configs */
}

/**
 * Data cleanup job data (delete all ClickHouse data for a removed config)
 */
export interface AnalyticsDataCleanupJobData {
  /** The analytics config ID whose data should be deleted */
  analyticsConfigId: string;
}

export interface HaproxyWatchdogJobData {
  timestamp: string;
}

export interface HaproxyWatchdogResult {
  success: boolean;
  skipped?: boolean;
  haproxyWasHealthy: boolean;
  restartAttempted: boolean;
  restartSucceeded?: boolean;
  error?: string;
}

/**
 * Anomaly detection result
 */
export interface AnalyticsAnomalyDetectionResult {
  success: boolean;
  analyticsConfigId: string;
  metric: string;
  anomalyDetected: boolean;
  currentValue?: number;
  baselineMean?: number;
  baselineStddev?: number;
  error?: string;
}
