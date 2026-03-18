// Domain hooks
export {
  domainKeys,
  useDomains,
  useDomain,
  useCreateDomain,
  useUpdateDomain,
  useDeleteDomain,
} from "./use-domains";

// Backend hooks
export {
  backendKeys,
  useBackends,
  useBackend,
  useCreateBackend,
  useUpdateBackend,
  useDeleteBackend,
} from "./use-backends";

// Certificate hooks
export {
  certificateKeys,
  useCertificates,
  useCertificate,
  useRequestCertificate,
  useUpdateCertificate,
  useRenewCertificate,
  useDeleteCertificate,
} from "./use-certificates";

// DNS Provider hooks
export {
  dnsProviderKeys,
  useDnsProviders,
  useDnsProvider,
  useCreateDnsProvider,
  useUpdateDnsProvider,
  useTestDnsProvider,
  useSetDefaultDnsProvider,
  useDeleteDnsProvider,
} from "./use-dns-providers";

// Error Page hooks
export {
  errorPageKeys,
  useErrorPages,
  useErrorPage,
  useCreateErrorPage,
  useUploadErrorPage,
  useDeleteErrorPage,
  getErrorPagePreviewUrl,
  getErrorPageDownloadUrl,
} from "./use-error-pages";

// Maintenance hooks
export {
  maintenanceKeys,
  useMaintenanceStatus,
  useMaintenanceWindows,
  useEnableMaintenance,
  useDisableMaintenance,
  useUpdateBypassIps,
  useScheduleMaintenance,
  useCancelMaintenanceWindow,
} from "./use-maintenance";

// HAProxy hooks
export {
  haproxyKeys,
  useHaproxyStatus,
  useHaproxyConfig,
  useHaproxyConfigPreview,
  useHaproxyReload,
} from "./use-haproxy";

// Stats hooks
export { statsKeys, useDashboardStats } from "./use-stats";

// Extensions hooks
export {
  extensionKeys,
  useExtensions,
  useSitesExtensionEnabled,
  usePomeriumExtensionEnabled,
  useAnalyticsExtensionEnabled,
} from "./use-extensions";

// Sites extension hooks (only available when extension is enabled)
export {
  // Site hooks
  siteKeys,
  useSites,
  useSite,
  useCreateSite,
  useUpdateSite,
  useDeleteSite,
  useDeploySite,
  useUploadDeploySite,
  useRollbackSite,
  useSiteEnv,
  useUpdateSiteEnv,
  // Deployment hooks
  deploymentKeys,
  useDeployments,
  useDeployment,
  useDeploymentLogs,
  useCancelDeployment,
  usePromoteDeployment,
  useRetryDeployment,
  useRedeployDeployment,
  useDeleteDeployment,
  useDeploymentPreview,
  useGeneratePreview,
  // GitHub hooks
  githubKeys,
  useGitHubStatus,
  useGitHubInstallUrl,
  useGitHubRepositories,
  useGitHubConnection,
  useConnectGitHub,
  useUpdateGitHubConnection,
  useDisconnectGitHub,
  useGitHubBranches,
  useSyncGitHub,
  // Analytics hooks
  analyticsKeys,
  useSiteAnalyticsSummary,
  useSiteVisitors,
  useSiteGeography,
  useSiteReferrers,
  useSitePages,
  useSiteDevices,
  // S3 Provider hooks
  s3ProviderKeys,
  useS3Providers,
  useS3Provider,
  useCreateS3Provider,
  useUpdateS3Provider,
  useDeleteS3Provider,
  useTestS3Provider,
  useSetDefaultS3Provider,
  useS3ProviderUsage,
} from "./use-sites";

// SSE hooks
export { useDeploymentLogsSSE } from "./use-deployment-logs-sse";

// System Config hooks
export {
  systemConfigKeys,
  useRetentionConfig,
  useUpdateRetentionConfig,
  useResetRetentionConfig,
  useBuildDefaultsConfig,
  useUpdateBuildDefaultsConfig,
  useResetBuildDefaultsConfig,
  useHaproxyWatchdogConfig,
  useUpdateHaproxyWatchdogConfig,
} from "./use-system-config";

// Analytics configuration hooks (only available when extension is enabled)
export {
  analyticsConfigKeys,
  useAnalyticsConfigs,
  useAnalyticsConfig,
  useEnableAnalytics,
  useDisableAnalytics,
  useUpdateAnalyticsConfig,
  useDeleteAnalyticsConfig,
  useRegenerateTrackingUuid,
  useRegenerateApiToken,
} from "./use-analytics";

// Analytics data hooks
export {
  analyticsDataKeys,
  useAnalyticsSummary,
  useAnalyticsTimeseries,
  useAnalyticsPages,
  useAnalyticsReferrers,
  useAnalyticsGeography,
  useAnalyticsDevices,
  useAnalyticsEvents,
  useAnalyticsEventDetail,
  useAnalyticsUTM,
  useAnalyticsLive,
  useAnalyticsExport,
} from "./use-analytics-data";

// Analytics funnel hooks
export {
  analyticsFunnelKeys,
  useAnalyticsFunnels,
  useAnalyticsFunnelResults,
  useCreateAnalyticsFunnel,
  useUpdateAnalyticsFunnel,
  useDeleteAnalyticsFunnel,
  useRecomputeAnalyticsFunnel,
} from "./use-analytics-funnels";

// Shared Backends hooks
export {
  sharedBackendKeys,
  useSharedBackends,
  useSharedBackend,
  useCreateSharedBackend,
  useUpdateSharedBackend,
  useDeleteSharedBackend,
  useToggleSharedBackend,
  useLinkDomainToSharedBackend,
  useUnlinkDomainFromSharedBackend,
} from "./use-shared-backends";

// Cluster hooks
export {
  clusterKeys,
  useClusterNodes,
  useClusterNode,
  useCreateClusterNode,
  useUpdateClusterNode,
  useDeleteClusterNode,
  useSyncClusterNode,
  useSyncAllClusterNodes,
  useCheckClusterNodeStatus,
} from "./use-cluster";

// Settings Export/Import hooks
export {
  useExportSettings,
  useImportSettings,
} from "./use-settings-export-import";
export type { ExportOptions, ImportOptions, ImportResult } from "./use-settings-export-import";

// Pomerium extension hooks (only available when extension is enabled)
export {
  pomeriumKeys,
  // Identity Provider hooks
  usePomeriumIdps,
  usePomeriumIdp,
  useCreatePomeriumIdp,
  useUpdatePomeriumIdp,
  useDeletePomeriumIdp,
  useTestPomeriumIdp,
  // Route hooks
  usePomeriumRoutes,
  usePomeriumRoute,
  useCreatePomeriumRoute,
  useUpdatePomeriumRoute,
  useDeletePomeriumRoute,
  useTogglePomeriumRoute,
  usePomeriumRoutesByDomain,
  // Settings hooks
  usePomeriumSettings,
  useUpdatePomeriumSettings,
  useRegeneratePomeriumSecrets,
  usePomeriumStatus,
  useRestartPomerium,
} from "./use-pomerium";
