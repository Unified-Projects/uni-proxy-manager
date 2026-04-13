import type {
  Domain,
  CreateDomainData,
  UpdateDomainData,
  Backend,
  CreateBackendData,
  UpdateBackendData,
  Certificate,
  RequestCertificateData,
  UpdateCertificateData,
  DnsProvider,
  CreateDnsProviderData,
  UpdateDnsProviderData,
  ErrorPage,
  CreateErrorPageData,
  MaintenanceWindow,
  EnableMaintenanceData,
  ScheduleMaintenanceData,
  HaproxyStatus,
  HaproxyReloadResult,
  DashboardStats,
  // Sites Extension
  ExtensionStatus,
  Site,
  CreateSiteData,
  UpdateSiteData,
  Deployment,
  GitHubConnection,
  ConnectGitHubData,
  UpdateGitHubConnectionData,
  GitHubRepository,
  GitHubBranch,
  SiteAnalyticsSummary,
  VisitorDataPoint,
  GeographyData,
  ReferrerData,
  PageData,
  DeviceBreakdown,
  S3Provider,
  CreateS3ProviderData,
  UpdateS3ProviderData,
  SiteDomain,
  // Pomerium & Advanced Domain Configuration
  PomeriumIdentityProvider,
  CreatePomeriumIdpData,
  UpdatePomeriumIdpData,
  PomeriumRoute,
  CreatePomeriumRouteData,
  UpdatePomeriumRouteData,
  PomeriumSettings,
  UpdatePomeriumSettingsData,
  PomeriumStatus,
  DomainRouteRule,
  CreateDomainRouteRuleData,
  UpdateDomainRouteRuleData,
  DomainIpRule,
  UpdateDomainIpRuleData,
  IpValidationResult,
  DomainSecurityHeaders,
  UpdateDomainSecurityHeadersData,
  DomainBlockedRoute,
  CreateDomainBlockedRouteData,
  UpdateDomainBlockedRouteData,
  // Analytics Extension
  AnalyticsConfig,
  EnableAnalyticsData,
  UpdateAnalyticsConfigData,
  AnalyticsSummary,
  AnalyticsTimeseries,
  AnalyticsPages,
  AnalyticsReferrers,
  AnalyticsGeography,
  AnalyticsDevices,
  AnalyticsEvents,
  AnalyticsEventDetail,
  AnalyticsUTM,
  AnalyticsLive,
  AnalyticsQueryParams,
  AnalyticsFunnel,
  CreateAnalyticsFunnelData,
  UpdateAnalyticsFunnelData,
  AnalyticsFunnelResult,
  AnalyticsFunnelWithResults,
  AnalyticsPublicDashboardVerify,
  AnalyticsPublicDashboardAuth,
} from "./types";

interface FetchOptions extends RequestInit {
  params?: Record<string, string | undefined>;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = endpoint;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.set(key, value);
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new ApiError(
      error.error || error.message || `HTTP ${response.status}`,
      response.status,
      error.code,
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
}

async function fetchFile(endpoint: string): Promise<string> {
  const response = await fetch(endpoint, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, response.status);
  }

  return response.text();
}

async function uploadFile<T>(endpoint: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Upload failed" }));
    throw new ApiError(
      error.error || error.message || `HTTP ${response.status}`,
      response.status,
      error.code,
    );
  }

  return response.json();
}

// Domain APIs
export const domainsApi = {
  list: () => fetchApi<{ domains: Domain[] }>("/api/domains"),
  get: (id: string) => fetchApi<{ domain: Domain }>(`/api/domains/${id}`),
  create: (data: CreateDomainData) =>
    fetchApi<{ domain: Domain }>("/api/domains", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateDomainData) =>
    fetchApi<{ domain: Domain }>(`/api/domains/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/domains/${id}`, {
      method: "DELETE",
    }),
};

// Backend APIs
export const backendsApi = {
  list: (domainId?: string) =>
    fetchApi<{ backends: Backend[] }>("/api/backends", {
      params: { domainId },
    }),
  get: (id: string) => fetchApi<{ backend: Backend }>(`/api/backends/${id}`),
  create: (data: CreateBackendData) =>
    fetchApi<{ backend: Backend }>("/api/backends", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateBackendData) =>
    fetchApi<{ backend: Backend }>(`/api/backends/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/backends/${id}`, {
      method: "DELETE",
    }),
};

// Certificate APIs
export const certificatesApi = {
  list: (domainId?: string) =>
    fetchApi<{ certificates: Certificate[] }>("/api/certificates", {
      params: { domainId },
    }),
  get: (id: string) =>
    fetchApi<{ certificate: Certificate }>(`/api/certificates/${id}`),
  request: (data: RequestCertificateData) =>
    fetchApi<{ certificate: Certificate }>("/api/certificates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateCertificateData) =>
    fetchApi<{
      certificate: Certificate;
      reissueQueued?: boolean;
      message?: string;
    }>(`/api/certificates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  renew: (id: string) =>
    fetchApi<{ success: boolean; certificate?: Certificate; message?: string }>(
      `/api/certificates/${id}/renew`,
      {
        method: "POST",
      },
    ),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/certificates/${id}`, {
      method: "DELETE",
    }),
};

// DNS Provider APIs
export const dnsProvidersApi = {
  list: () => fetchApi<{ providers: DnsProvider[] }>("/api/dns-providers"),
  get: (id: string) =>
    fetchApi<{ provider: DnsProvider }>(`/api/dns-providers/${id}`),
  create: (data: CreateDnsProviderData) =>
    fetchApi<{ provider: DnsProvider }>("/api/dns-providers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateDnsProviderData) =>
    fetchApi<{ provider: DnsProvider }>(`/api/dns-providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  test: (id: string) =>
    fetchApi<{ success: boolean; message?: string }>(
      `/api/dns-providers/${id}/test`,
      {
        method: "POST",
      },
    ),
  setDefault: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/dns-providers/${id}/default`, {
      method: "POST",
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/dns-providers/${id}`, {
      method: "DELETE",
    }),
};

// Error Page APIs
export const errorPagesApi = {
  list: () => fetchApi<{ errorPages: ErrorPage[] }>("/api/error-pages"),
  get: (id: string) =>
    fetchApi<{ errorPage: ErrorPage }>(`/api/error-pages/${id}`),
  create: (data: CreateErrorPageData) =>
    fetchApi<{ errorPage: ErrorPage }>("/api/error-pages", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  upload: (id: string, file: File) =>
    uploadFile<{ errorPage: ErrorPage }>(`/api/error-pages/${id}/upload`, file),
  preview: (id: string) => `/api/error-pages/${id}/preview`,
  download: (id: string) => `/api/error-pages/${id}/download`,
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/error-pages/${id}`, {
      method: "DELETE",
    }),
};

// Maintenance APIs
export const maintenanceApi = {
  getStatus: (domainId: string) =>
    fetchApi<{ maintenanceEnabled: boolean; bypassIps: string[] }>(
      `/api/maintenance/domains/${domainId}`,
    ),
  enable: (domainId: string, data?: EnableMaintenanceData) =>
    fetchApi<{ success: boolean; window: MaintenanceWindow }>(
      `/api/maintenance/domains/${domainId}/enable`,
      {
        method: "POST",
        body: JSON.stringify(data || {}),
      },
    ),
  disable: (domainId: string) =>
    fetchApi<{ success: boolean }>(
      `/api/maintenance/domains/${domainId}/disable`,
      {
        method: "POST",
      },
    ),
  updateBypassIps: (domainId: string, bypassIps: string[]) =>
    fetchApi<{ success: boolean }>(
      `/api/maintenance/domains/${domainId}/bypass-ips`,
      {
        method: "PUT",
        body: JSON.stringify({ bypassIps }),
      },
    ),
  // Maintenance windows
  listWindows: (options?: { domainId?: string; active?: boolean }) =>
    fetchApi<{ windows: MaintenanceWindow[] }>("/api/maintenance/windows", {
      params: {
        domainId: options?.domainId,
        active: options?.active?.toString(),
      },
    }),
  scheduleWindow: (data: ScheduleMaintenanceData) =>
    fetchApi<{ window: MaintenanceWindow }>("/api/maintenance/windows", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  cancelWindow: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/maintenance/windows/${id}`, {
      method: "DELETE",
    }),
};

// HAProxy APIs
export interface HaproxyConfigDiff {
  hasPendingChanges: boolean;
  currentConfigExists: boolean;
  currentLineCount: number;
  proposedLineCount: number;
  diff: string[];
  diffTruncated: boolean;
}

export const haproxyApi = {
  status: () => fetchApi<HaproxyStatus>("/api/haproxy/status"),
  reload: (force?: boolean) =>
    fetchApi<HaproxyReloadResult>("/api/haproxy/reload", {
      method: "POST",
      params: force ? { force: "true" } : undefined,
    }),
  getConfig: () => fetchFile("/api/haproxy/config"),
  previewConfig: () => fetchFile("/api/haproxy/config/preview"),
  getConfigDiff: () => fetchApi<HaproxyConfigDiff>("/api/haproxy/config/diff"),
};

// Stats API
export const statsApi = {
  dashboard: () => fetchApi<DashboardStats>("/api/stats/dashboard"),
};

// Config API
export const configApi = {
  getAcme: () =>
    fetchApi<{ email: string; staging: boolean; directoryUrl: string }>(
      "/api/config/acme",
    ),
  updateAcme: (data: { email: string }) =>
    fetchApi<{ success: boolean; message: string; email: string }>(
      "/api/config/acme",
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
};

// =============================================================================
// Sites Extension APIs (only available when extension is enabled)
// =============================================================================

// Extensions API
export const extensionsApi = {
  status: () => fetchApi<{ extensions: ExtensionStatus }>("/api/extensions"),
};

// Sites API
export const sitesApi = {
  list: () => fetchApi<{ sites: Site[] }>("/api/sites"),
  get: (id: string) => fetchApi<{ site: Site }>(`/api/sites/${id}`),
  create: (data: CreateSiteData) =>
    fetchApi<{ site: Site }>("/api/sites", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateSiteData) =>
    fetchApi<{ site: Site }>(`/api/sites/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/sites/${id}`, {
      method: "DELETE",
    }),
  deploy: (id: string) =>
    fetchApi<{ deployment: Deployment; message: string }>(
      `/api/sites/${id}/deploy`,
      {
        method: "POST",
      },
    ),
  uploadDeploy: async (id: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/sites/${id}/upload`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Upload failed" }));
      throw new Error(error.error || "Upload failed");
    }
    return response.json() as Promise<{
      deployment: Deployment;
      message: string;
    }>;
  },
  rollback: (siteId: string, deploymentId: string) =>
    fetchApi<{ deployment: Deployment; message: string }>(
      `/api/sites/${siteId}/rollback/${deploymentId}`,
      {
        method: "POST",
      },
    ),
  getEnv: (id: string) =>
    fetchApi<{ envVariables: Record<string, string>; count: number }>(
      `/api/sites/${id}/env`,
    ),
  updateEnv: (id: string, envVariables: Record<string, string>) =>
    fetchApi<{ success: boolean; count: number }>(`/api/sites/${id}/env`, {
      method: "PUT",
      body: JSON.stringify({ envVariables }),
    }),
};

// Deployments API
export const deploymentsApi = {
  list: (siteId?: string) =>
    fetchApi<{ deployments: Deployment[] }>("/api/deployments", {
      params: { siteId },
    }),
  get: (id: string) =>
    fetchApi<{ deployment: Deployment }>(`/api/deployments/${id}`),
  getLogs: (id: string) =>
    fetchApi<{ logs: string; status: string; complete: boolean }>(
      `/api/deployments/${id}/logs`,
    ),
  cancel: (id: string) =>
    fetchApi<{ deployment: Deployment; message: string }>(
      `/api/deployments/${id}/cancel`,
      {
        method: "POST",
      },
    ),
  promote: (id: string) =>
    fetchApi<{ deployment: Deployment; message: string }>(
      `/api/deployments/${id}/promote`,
      {
        method: "POST",
      },
    ),
  retry: (id: string) =>
    fetchApi<{ message: string; deploymentId: string }>(
      `/api/deployments/${id}/retry`,
      {
        method: "POST",
      },
    ),
  redeploy: (id: string) =>
    fetchApi<{ message: string; deploymentId: string }>(
      `/api/deployments/${id}/redeploy`,
      {
        method: "POST",
      },
    ),
  delete: (id: string) =>
    fetchApi<{ message: string; deploymentId: string }>(
      `/api/deployments/${id}`,
      {
        method: "DELETE",
      },
    ),
  getPreview: (id: string) =>
    fetchApi<{ previewUrl: string; deploymentId: string }>(
      `/api/deployments/${id}/preview`,
    ),
  generatePreview: (id: string) =>
    fetchApi<{ message: string; deploymentId: string }>(
      `/api/deployments/${id}/generate-preview`,
      {
        method: "POST",
      },
    ),
  // SSE endpoint for streaming logs
  streamLogsUrl: (id: string) => `/api/deployments/${id}/logs`,
};

// GitHub API
export const githubApi = {
  status: () =>
    fetchApi<{ configured: boolean; appSlug: string }>("/api/github/status"),
  getInstallUrl: (siteId?: string) =>
    fetchApi<{ installUrl: string }>("/api/github/install", {
      params: { siteId },
    }),
  listRepositories: (installationId: number) =>
    fetchApi<{ repositories: GitHubRepository[] }>(
      `/api/github/installations/${installationId}/repositories`,
    ),
  getSiteConnection: (siteId: string) =>
    fetchApi<{ connected: boolean; connection?: GitHubConnection }>(
      `/api/github/sites/${siteId}`,
    ),
  connect: (siteId: string, data: ConnectGitHubData) =>
    fetchApi<{ connection: GitHubConnection }>(`/api/github/sites/${siteId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateConnection: (siteId: string, data: UpdateGitHubConnectionData) =>
    fetchApi<{ connection: GitHubConnection }>(`/api/github/sites/${siteId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  disconnect: (siteId: string) =>
    fetchApi<{ success: boolean }>(`/api/github/sites/${siteId}`, {
      method: "DELETE",
    }),
  listBranches: (siteId: string) =>
    fetchApi<{ branches: GitHubBranch[] }>(
      `/api/github/sites/${siteId}/branches`,
    ),
  sync: (siteId: string) =>
    fetchApi<{
      synced: boolean;
      latestCommit: { sha: string; message: string };
    }>(`/api/github/sites/${siteId}/sync`, {
      method: "POST",
    }),
};

// Site Domains API
export const siteDomainsApi = {
  listBySite: (siteId: string) =>
    fetchApi<{ siteDomains: SiteDomain[] }>(`/api/sites/${siteId}/domains`),
};

// Site Analytics API
export const siteAnalyticsApi = {
  getSummary: (siteId: string, options?: { start?: string; end?: string }) =>
    fetchApi<SiteAnalyticsSummary>(`/api/site-analytics/${siteId}`, {
      params: options,
    }),
  getVisitors: (
    siteId: string,
    options?: { start?: string; end?: string; interval?: string },
  ) =>
    fetchApi<{ data: VisitorDataPoint[] }>(
      `/api/site-analytics/${siteId}/visitors`,
      {
        params: options,
      },
    ),
  getGeography: (siteId: string, options?: { start?: string; end?: string }) =>
    fetchApi<GeographyData>(`/api/site-analytics/${siteId}/geography`, {
      params: options,
    }),
  getReferrers: (
    siteId: string,
    options?: { start?: string; end?: string; limit?: string },
  ) =>
    fetchApi<ReferrerData>(`/api/site-analytics/${siteId}/referrers`, {
      params: options,
    }),
  getPages: (
    siteId: string,
    options?: { start?: string; end?: string; limit?: string },
  ) =>
    fetchApi<PageData>(`/api/site-analytics/${siteId}/pages`, {
      params: options,
    }),
  getDevices: (siteId: string, options?: { start?: string; end?: string }) =>
    fetchApi<DeviceBreakdown>(`/api/site-analytics/${siteId}/devices`, {
      params: options,
    }),
  // SSE endpoint for real-time visitors
  realtimeUrl: (siteId: string) => `/api/site-analytics/${siteId}/realtime`,

  // Domain Analytics API
  getDomainSummary: (
    domainId: string,
    options?: { start?: string; end?: string },
  ) =>
    fetchApi<DomainAnalyticsSummary>(
      `/api/site-analytics/domains/${domainId}`,
      {
        params: options,
      },
    ),
  getDomainVisitors: (
    domainId: string,
    options?: { start?: string; end?: string; interval?: string },
  ) =>
    fetchApi<{ data: VisitorDataPoint[] }>(
      `/api/site-analytics/domains/${domainId}/visitors`,
      {
        params: options,
      },
    ),
  getDomainGeography: (
    domainId: string,
    options?: { start?: string; end?: string },
  ) =>
    fetchApi<GeographyData>(
      `/api/site-analytics/domains/${domainId}/geography`,
      {
        params: options,
      },
    ),
  // SSE endpoint for real-time domain visitors
  domainRealtimeUrl: (domainId: string) =>
    `/api/site-analytics/domains/${domainId}/realtime`,
};

// Domain Analytics types
export interface DomainAnalyticsSummary {
  domainId: string;
  hostname: string;
  period: { start: string; end: string };
  summary: {
    totalPageViews: number;
    totalUniqueVisitors: number;
    totalBytesIn: number;
    totalBytesOut: number;
    total2xx: number;
    total3xx: number;
    total4xx: number;
    total5xx: number;
    avgResponseTime: number;
  };
  dataPoints: number;
}

// S3 Providers API
export const s3ProvidersApi = {
  list: () => fetchApi<{ providers: S3Provider[] }>("/api/s3-providers"),
  get: (id: string) =>
    fetchApi<{ provider: S3Provider }>(`/api/s3-providers/${id}`),
  create: (data: CreateS3ProviderData) =>
    fetchApi<{ provider: S3Provider }>("/api/s3-providers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateS3ProviderData) =>
    fetchApi<{ provider: S3Provider }>(`/api/s3-providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/s3-providers/${id}`, {
      method: "DELETE",
    }),
  test: (id: string) =>
    fetchApi<{ success: boolean; message?: string; error?: string }>(
      `/api/s3-providers/${id}/test`,
      {
        method: "POST",
      },
    ),
  setDefault: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/s3-providers/${id}/set-default`, {
      method: "POST",
    }),
  getUsage: (id: string) =>
    fetchApi<{
      usage: { totalObjects: number; totalSize: number; lastModified?: string };
    }>(`/api/s3-providers/${id}/usage`),
};

// System Config API
export interface RetentionConfig {
  maxDeploymentsPerSite: number;
  deploymentMaxAgeDays: number;
  artifactRetentionDays: number;
  logRetentionDays: number;
}

export interface BuildDefaultsConfig {
  defaultBuildCpus: number;
  defaultBuildMemoryMb: number;
  defaultBuildTimeoutSeconds: number;
}

export interface HaproxyWatchdogConfig {
  enabled: boolean;
}

export const systemConfigApi = {
  getAll: () =>
    fetchApi<{ config: Record<string, unknown> }>("/api/system-config"),
  getRetention: () =>
    fetchApi<{ retention: RetentionConfig }>("/api/system-config/retention"),
  updateRetention: (data: RetentionConfig) =>
    fetchApi<{ retention: RetentionConfig }>("/api/system-config/retention", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  resetRetention: () =>
    fetchApi<{ retention: RetentionConfig }>(
      "/api/system-config/retention/reset",
      {
        method: "POST",
      },
    ),
  getBuildDefaults: () =>
    fetchApi<{ buildDefaults: BuildDefaultsConfig }>(
      "/api/system-config/build-defaults",
    ),
  updateBuildDefaults: (data: BuildDefaultsConfig) =>
    fetchApi<{ buildDefaults: BuildDefaultsConfig }>(
      "/api/system-config/build-defaults",
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  resetBuildDefaults: () =>
    fetchApi<{ buildDefaults: BuildDefaultsConfig }>(
      "/api/system-config/build-defaults/reset",
      {
        method: "POST",
      },
    ),
  getHaproxyWatchdog: () =>
    fetchApi<{ watchdog: HaproxyWatchdogConfig }>(
      "/api/system-config/haproxy-watchdog",
    ),
  updateHaproxyWatchdog: (data: HaproxyWatchdogConfig) =>
    fetchApi<{ watchdog: HaproxyWatchdogConfig }>(
      "/api/system-config/haproxy-watchdog",
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
};

// =============================================================================
// Pomerium Extension APIs (only available when extension is enabled)
// =============================================================================

// Pomerium Identity Providers API
export const pomeriumIdpsApi = {
  list: () =>
    fetchApi<{ identityProviders: PomeriumIdentityProvider[] }>(
      "/api/pomerium/idps",
    ),
  get: (id: string) =>
    fetchApi<{ identityProvider: PomeriumIdentityProvider }>(
      `/api/pomerium/idps/${id}`,
    ),
  create: (data: CreatePomeriumIdpData) =>
    fetchApi<{ identityProvider: PomeriumIdentityProvider }>(
      "/api/pomerium/idps",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  update: (id: string, data: UpdatePomeriumIdpData) =>
    fetchApi<{ identityProvider: PomeriumIdentityProvider }>(
      `/api/pomerium/idps/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/pomerium/idps/${id}`, {
      method: "DELETE",
    }),
  test: (id: string) =>
    fetchApi<{ success: boolean; message?: string }>(
      `/api/pomerium/idps/${id}/test`,
      {
        method: "POST",
      },
    ),
};

// Pomerium Routes API
export const pomeriumRoutesApi = {
  list: (domainId?: string) =>
    fetchApi<{ routes: PomeriumRoute[] }>("/api/pomerium/routes", {
      params: { domainId },
    }),
  get: (id: string) =>
    fetchApi<{ route: PomeriumRoute }>(`/api/pomerium/routes/${id}`),
  create: (data: CreatePomeriumRouteData) =>
    fetchApi<{ route: PomeriumRoute }>("/api/pomerium/routes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdatePomeriumRouteData) =>
    fetchApi<{ route: PomeriumRoute }>(`/api/pomerium/routes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/pomerium/routes/${id}`, {
      method: "DELETE",
    }),
  toggle: (id: string) =>
    fetchApi<{ route: PomeriumRoute; enabled: boolean }>(
      `/api/pomerium/routes/${id}/toggle`,
      {
        method: "POST",
      },
    ),
  listByDomain: (domainId: string) =>
    fetchApi<{ routes: PomeriumRoute[] }>(
      `/api/pomerium/routes/domain/${domainId}`,
    ),
};

// Pomerium Settings API
export const pomeriumSettingsApi = {
  get: () => fetchApi<{ settings: PomeriumSettings }>("/api/pomerium/settings"),
  update: (data: UpdatePomeriumSettingsData) =>
    fetchApi<{ settings: PomeriumSettings }>("/api/pomerium/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  regenerateSecrets: () =>
    fetchApi<{ success: boolean; message: string; settings: PomeriumSettings }>(
      "/api/pomerium/settings/regenerate-secrets",
      { method: "POST" },
    ),
  getStatus: () => fetchApi<PomeriumStatus>("/api/pomerium/settings/status"),
  restart: () =>
    fetchApi<{ success: boolean; message: string }>(
      "/api/pomerium/settings/restart",
      { method: "POST" },
    ),
};

// =============================================================================
// Advanced Domain Configuration APIs
// =============================================================================

// Domain Route Rules API
export const domainRouteRulesApi = {
  list: (domainId?: string) =>
    fetchApi<{ routeRules: DomainRouteRule[] }>("/api/domain-route-rules", {
      params: { domainId },
    }),
  get: (id: string) =>
    fetchApi<{ routeRule: DomainRouteRule }>(`/api/domain-route-rules/${id}`),
  create: (data: CreateDomainRouteRuleData) =>
    fetchApi<{ routeRule: DomainRouteRule }>("/api/domain-route-rules", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateDomainRouteRuleData) =>
    fetchApi<{ routeRule: DomainRouteRule }>(`/api/domain-route-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/domain-route-rules/${id}`, {
      method: "DELETE",
    }),
  toggle: (id: string) =>
    fetchApi<{ routeRule: DomainRouteRule; enabled: boolean }>(
      `/api/domain-route-rules/${id}/toggle`,
      { method: "POST" },
    ),
  reorder: (rules: Array<{ id: string; priority: number }>) =>
    fetchApi<{ success: boolean }>("/api/domain-route-rules/reorder", {
      method: "PUT",
      body: JSON.stringify({ rules }),
    }),
};

// Domain IP Rules API
export const domainIpRulesApi = {
  get: (domainId: string) =>
    fetchApi<{ ipRule: DomainIpRule }>(`/api/domains/${domainId}/ip-rules`),
  update: (domainId: string, data: UpdateDomainIpRuleData) =>
    fetchApi<{ ipRule: DomainIpRule }>(`/api/domains/${domainId}/ip-rules`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  toggle: (domainId: string) =>
    fetchApi<{ ipRule: DomainIpRule; enabled: boolean }>(
      `/api/domains/${domainId}/ip-rules/toggle`,
      { method: "POST" },
    ),
  validate: (domainId: string, ipAddresses: string[]) =>
    fetchApi<{
      valid: boolean;
      results: IpValidationResult[];
      errors: string[];
    }>(`/api/domains/${domainId}/ip-rules/validate`, {
      method: "POST",
      body: JSON.stringify({ ipAddresses }),
    }),
};

// Domain Security Headers API
export const domainSecurityHeadersApi = {
  get: (domainId: string) =>
    fetchApi<{ securityHeaders: DomainSecurityHeaders }>(
      `/api/domains/${domainId}/security-headers`,
    ),
  update: (domainId: string, data: UpdateDomainSecurityHeadersData) =>
    fetchApi<{ securityHeaders: DomainSecurityHeaders }>(
      `/api/domains/${domainId}/security-headers`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  preview: (domainId: string) =>
    fetchApi<{ headers: Record<string, string> }>(
      `/api/domains/${domainId}/security-headers/preview`,
    ),
};

// Domain Blocked Routes API
export const domainBlockedRoutesApi = {
  list: (domainId?: string) =>
    fetchApi<{ blockedRoutes: DomainBlockedRoute[] }>(
      "/api/domain-blocked-routes",
      {
        params: { domainId },
      },
    ),
  get: (id: string) =>
    fetchApi<{ blockedRoute: DomainBlockedRoute }>(
      `/api/domain-blocked-routes/${id}`,
    ),
  create: (data: CreateDomainBlockedRouteData) =>
    fetchApi<{ blockedRoute: DomainBlockedRoute }>(
      "/api/domain-blocked-routes",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  update: (id: string, data: UpdateDomainBlockedRouteData) =>
    fetchApi<{ blockedRoute: DomainBlockedRoute }>(
      `/api/domain-blocked-routes/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/domain-blocked-routes/${id}`, {
      method: "DELETE",
    }),
  toggle: (id: string) =>
    fetchApi<{ blockedRoute: DomainBlockedRoute; enabled: boolean }>(
      `/api/domain-blocked-routes/${id}/toggle`,
      { method: "POST" },
    ),
};

// =============================================================================
// Analytics Extension APIs (only available when extension is enabled)
// =============================================================================

// Analytics Config API
export const analyticsConfigApi = {
  list: () => fetchApi<{ configs: AnalyticsConfig[] }>("/api/analytics-config"),
  get: (domainId: string) =>
    fetchApi<{ config: AnalyticsConfig }>(`/api/analytics-config/${domainId}`),
  enable: (domainId: string, data?: EnableAnalyticsData) =>
    fetchApi<{ config: AnalyticsConfig }>(
      `/api/analytics-config/${domainId}/enable`,
      {
        method: "POST",
        body: JSON.stringify(data || {}),
      },
    ),
  disable: (domainId: string) =>
    fetchApi<{ config: AnalyticsConfig }>(
      `/api/analytics-config/${domainId}/disable`,
      {
        method: "POST",
      },
    ),
  update: (domainId: string, data: UpdateAnalyticsConfigData) =>
    fetchApi<{ config: AnalyticsConfig }>(`/api/analytics-config/${domainId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (domainId: string) =>
    fetchApi<{ success: boolean }>(`/api/analytics-config/${domainId}`, {
      method: "DELETE",
    }),
  regenerateUuid: (domainId: string) =>
    fetchApi<{ config: AnalyticsConfig }>(
      `/api/analytics-config/${domainId}/regenerate-uuid`,
      {
        method: "POST",
      },
    ),
  regenerateApiToken: (domainId: string) =>
    fetchApi<{ apiToken: string; message: string }>(
      `/api/analytics-config/${domainId}/regenerate-api-token`,
      {
        method: "POST",
      },
    ),
  rotatePublicDashboardToken: (domainId: string) =>
    fetchApi<{ publicDashboardToken: string; publicDashboardUrl: string }>(
      `/api/analytics-config/${domainId}/public-dashboard/rotate`,
      {
        method: "POST",
      },
    ),
};

// Analytics Data API
export const analyticsDataApi = {
  getSummary: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsSummary>(`/api/analytics/${configId}/summary`, {
      params: params as Record<string, string | undefined>,
    }),
  getTimeseries: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsTimeseries>(`/api/analytics/${configId}/timeseries`, {
      params: params as Record<string, string | undefined>,
    }),
  getPages: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsPages>(`/api/analytics/${configId}/pages`, {
      params: params as Record<string, string | undefined>,
    }),
  getReferrers: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsReferrers>(`/api/analytics/${configId}/referrers`, {
      params: params as Record<string, string | undefined>,
    }),
  getGeography: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsGeography>(`/api/analytics/${configId}/geography`, {
      params: params as Record<string, string | undefined>,
    }),
  getDevices: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsDevices>(`/api/analytics/${configId}/devices`, {
      params: params as Record<string, string | undefined>,
    }),
  getEvents: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsEvents>(`/api/analytics/${configId}/events`, {
      params: params as Record<string, string | undefined>,
    }),
  getEventDetail: (
    configId: string,
    eventName: string,
    params?: AnalyticsQueryParams,
  ) =>
    fetchApi<AnalyticsEventDetail>(
      `/api/analytics/${configId}/events/${eventName}`,
      {
        params: params as Record<string, string | undefined>,
      },
    ),
  getUTM: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<AnalyticsUTM>(`/api/analytics/${configId}/utm`, {
      params: params as Record<string, string | undefined>,
    }),
  getLive: (configId: string) =>
    fetchApi<AnalyticsLive>(`/api/analytics/${configId}/live`),
  getLiveWsInfo: (configId: string) =>
    fetchApi<{ wsUrl: string; trackingUuid: string; enabled: boolean }>(
      `/api/analytics/${configId}/live/ws-info`,
    ),
  exportCsv: (configId: string, params?: AnalyticsQueryParams) =>
    `/api/analytics/${configId}/export/csv${
      params
        ? "?" +
          new URLSearchParams(
            Object.entries(params).filter(([, v]) => v !== undefined) as [
              string,
              string,
            ][],
          ).toString()
        : ""
    }`,
  exportJson: (configId: string, params?: AnalyticsQueryParams) =>
    fetchApi<{ data: Record<string, unknown>[] }>(
      `/api/analytics/${configId}/export/json`,
      {
        params: params as Record<string, string | undefined>,
      },
    ),
};

// Analytics Funnels API
export const analyticsFunnelsApi = {
  list: (configId: string) =>
    fetchApi<{ funnels: AnalyticsFunnel[] }>(
      `/api/analytics-funnels/${configId}`,
    ),
  create: (configId: string, data: CreateAnalyticsFunnelData) =>
    fetchApi<{ funnel: AnalyticsFunnel }>(
      `/api/analytics-funnels/${configId}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  update: (
    configId: string,
    funnelId: string,
    data: UpdateAnalyticsFunnelData,
  ) =>
    fetchApi<{ funnel: AnalyticsFunnel }>(
      `/api/analytics-funnels/${configId}/${funnelId}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  delete: (configId: string, funnelId: string) =>
    fetchApi<{ success: boolean }>(
      `/api/analytics-funnels/${configId}/${funnelId}`,
      {
        method: "DELETE",
      },
    ),
  getResults: (configId: string, funnelId: string) =>
    fetchApi<AnalyticsFunnelWithResults>(
      `/api/analytics-funnels/${configId}/${funnelId}/results`,
    ),
  recompute: (configId: string, funnelId: string) =>
    fetchApi<{ message: string }>(
      `/api/analytics-funnels/${configId}/${funnelId}/recompute`,
      {
        method: "POST",
      },
    ),
};

// Analytics Public Dashboard API
export const analyticsPublicApi = {
  verify: (token: string) =>
    fetchApi<AnalyticsPublicDashboardVerify>(
      `/api/analytics-public/${token}/verify`,
    ),
  authenticate: (token: string, password: string) =>
    fetchApi<AnalyticsPublicDashboardAuth>(
      `/api/analytics-public/${token}/auth`,
      {
        method: "POST",
        body: JSON.stringify({ password }),
      },
    ),
  getSummary: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsSummary>(`/api/analytics-public/${token}/summary`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  getTimeseries: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsTimeseries>(`/api/analytics-public/${token}/timeseries`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  getPages: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsPages>(`/api/analytics-public/${token}/pages`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  getReferrers: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsReferrers>(`/api/analytics-public/${token}/referrers`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  getGeography: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsGeography>(`/api/analytics-public/${token}/geography`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  getDevices: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsDevices>(`/api/analytics-public/${token}/devices`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  getUTM: (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ) =>
    fetchApi<AnalyticsUTM>(`/api/analytics-public/${token}/utm`, {
      params: params as Record<string, string | undefined>,
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    }),
  exportCsv: async (
    token: string,
    params?: AnalyticsQueryParams,
    sessionToken?: string,
  ): Promise<void> => {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined) as [
            string,
            string,
          ][],
        ).toString()
      : "";
    const resp = await fetch(`/api/analytics-public/${token}/export/csv${qs}`, {
      headers: sessionToken
        ? { Authorization: `Bearer ${sessionToken}` }
        : undefined,
    });
    if (!resp.ok) throw new Error("CSV export failed");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "analytics-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  },
};

// Shared Backends API
export const sharedBackendsApi = {
  list: () =>
    fetchApi<{ sharedBackends: import("./types").SharedBackend[] }>(
      "/api/shared-backends",
    ),
  get: (id: string) =>
    fetchApi<{ sharedBackend: import("./types").SharedBackend }>(
      `/api/shared-backends/${id}`,
    ),
  create: (data: import("./types").CreateSharedBackendData) =>
    fetchApi<{ sharedBackend: import("./types").SharedBackend }>(
      "/api/shared-backends",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  update: (id: string, data: import("./types").UpdateSharedBackendData) =>
    fetchApi<{ sharedBackend: import("./types").SharedBackend }>(
      `/api/shared-backends/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  delete: (id: string, force = false) =>
    fetchApi<{ success: boolean }>(
      `/api/shared-backends/${id}?force=${force}`,
      {
        method: "DELETE",
      },
    ),
  listDomains: (id: string) =>
    fetchApi<{ domains: import("./types").Domain[] }>(
      `/api/shared-backends/${id}/domains`,
    ),
  linkDomain: (id: string, domainId: string) =>
    fetchApi<{ link: unknown }>(`/api/shared-backends/${id}/domains`, {
      method: "POST",
      body: JSON.stringify({ domainId }),
    }),
  unlinkDomain: (id: string, domainId: string) =>
    fetchApi<{ success: boolean }>(
      `/api/shared-backends/${id}/domains/${domainId}`,
      {
        method: "DELETE",
      },
    ),
  toggle: (id: string) =>
    fetchApi<{ sharedBackend: import("./types").SharedBackend }>(
      `/api/shared-backends/${id}/toggle`,
      {
        method: "PATCH",
      },
    ),
  toggleBackup: (id: string) =>
    fetchApi<{ sharedBackend: import("./types").SharedBackend }>(
      `/api/shared-backends/${id}/backup`,
      {
        method: "PATCH",
      },
    ),
};

// Cluster APIs
export const clusterApi = {
  list: () =>
    fetchApi<{ nodes: import("./types").ClusterNode[] }>("/api/cluster"),
  get: (id: string) =>
    fetchApi<{ node: import("./types").ClusterNode }>(`/api/cluster/${id}`),
  create: (data: import("./types").CreateClusterNodeData) =>
    fetchApi<{ node: import("./types").ClusterNode }>("/api/cluster", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: import("./types").UpdateClusterNodeData) =>
    fetchApi<{ node: import("./types").ClusterNode }>(`/api/cluster/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/cluster/${id}`, { method: "DELETE" }),
  sync: (id: string) =>
    fetchApi<{ success: boolean; jobId: string | undefined }>(
      `/api/cluster/${id}/sync`,
      {
        method: "POST",
      },
    ),
  syncAll: () =>
    fetchApi<{
      success: boolean;
      nodesQueued: number;
      jobId: string | undefined;
    }>("/api/cluster/sync-all", { method: "POST" }),
  checkStatus: (id: string) =>
    fetchApi<{
      nodeId: string;
      status: string;
      health?: unknown;
      error?: string;
    }>(`/api/cluster/${id}/status`),
};

// Export ApiError for use in error handling
export { ApiError };
