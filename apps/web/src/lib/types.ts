// Domain types
export type DomainStatus = "active" | "pending" | "disabled" | "error";

export type ComputedDomainStatus =
  | "active"
  | "degraded"
  | "offline"
  | "maintenance"
  | "ssl-error"
  | "ssl-expired"
  | "ssl-pending"
  | "no-backends";

export interface Domain {
  id: string;
  hostname: string;
  displayName: string | null;
  status: DomainStatus; // Legacy field, deprecated
  statusComputed?: ComputedDomainStatus; // New computed status
  sslEnabled: boolean;
  forceHttps: boolean;
  acmeVerificationMethod?: "dns-01" | "http-01" | "none";
  acmeDnsProviderId?: string | null;
  maintenanceEnabled: boolean;
  maintenanceBypassIps: string[];
  errorPageId: string | null;
  maintenancePageId: string | null;
  certificateId: string | null;
  // WWW redirect and subdomain aliases
  wwwRedirectEnabled: boolean;
  subdomainAliases: string[];
  // Bot filtering and blocking
  blockBots: boolean;
  filterBotsFromStats: boolean;
  configVersion: number;
  lastConfigUpdate: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  backends?: Backend[];
  certificate?: Certificate;
  errorPage?: ErrorPage;
  maintenancePage?: ErrorPage;
}

export interface CreateDomainData {
  hostname: string;
  displayName?: string;
  sslEnabled?: boolean;
  forceHttps?: boolean;
  acmeVerificationMethod?: "dns-01" | "http-01" | "none";
  acmeDnsProviderId?: string;
}

export interface UpdateDomainData {
  displayName?: string;
  status?: DomainStatus;
  sslEnabled?: boolean;
  forceHttps?: boolean;
  acmeVerificationMethod?: "dns-01" | "http-01" | "none";
  acmeDnsProviderId?: string | null;
  errorPageId?: string | null;
  maintenancePageId?: string | null;
  // Bot filtering and blocking
  blockBots?: boolean;
  filterBotsFromStats?: boolean;
  // WWW redirect and subdomain aliases
  wwwRedirectEnabled?: boolean;
  subdomainAliases?: string[];
}

// Site Domain types
export interface SiteDomain {
  id: string;
  siteId: string;
  domainId: string;
  type: "production" | "preview" | "branch";
  branchName: string | null;
  deploymentId: string | null;
  isActive: boolean;
  createdAt: string;
  // Relations
  domain?: Domain;
}

// Backend types
export type BackendProtocol = "http" | "https";
export type LoadBalanceMethod = "roundrobin" | "leastconn" | "source" | "first";
export type BackendType = "static" | "site";

export interface Backend {
  id: string;
  domainId: string;
  name: string;
  backendType: BackendType;
  // Static backend fields
  address: string | null;
  port: number | null;
  protocol: BackendProtocol;
  // Site backend fields
  siteId: string | null;
  // Common fields
  weight: number;
  maxConnections: number | null;
  loadBalanceMethod: LoadBalanceMethod;
  healthCheckEnabled: boolean;
  healthCheckPath: string;
  healthCheckInterval: number;
  healthCheckTimeout: number;
  healthCheckFallThreshold: number;
  healthCheckRiseThreshold: number;
  isHealthy: boolean;
  lastHealthCheck: string | null;
  lastHealthError: string | null;
  enabled: boolean;
  isBackup: boolean;
  // Request modification options
  hostRewrite: string | null;
  pathPrefixAdd: string | null;
  pathPrefixStrip: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  domain?: Domain;
  site?: Site;
}

export interface CreateBackendData {
  domainId: string;
  name: string;
  backendType?: BackendType;
  // Static backend fields
  address?: string;
  port?: number;
  protocol?: BackendProtocol;
  // Site backend fields
  siteId?: string;
  // Common fields
  weight?: number;
  maxConnections?: number;
  loadBalanceMethod?: LoadBalanceMethod;
  healthCheckEnabled?: boolean;
  healthCheckPath?: string;
  healthCheckInterval?: number;
  healthCheckTimeout?: number;
  healthCheckFallThreshold?: number;
  healthCheckRiseThreshold?: number;
  enabled?: boolean;
  isBackup?: boolean;
  // Request modification options
  hostRewrite?: string;
  pathPrefixAdd?: string;
  pathPrefixStrip?: string;
}

export interface UpdateBackendData {
  name?: string;
  backendType?: BackendType;
  address?: string | null;
  port?: number | null;
  protocol?: BackendProtocol;
  siteId?: string | null;
  weight?: number;
  maxConnections?: number | null;
  loadBalanceMethod?: LoadBalanceMethod;
  healthCheckEnabled?: boolean;
  healthCheckPath?: string;
  healthCheckInterval?: number;
  healthCheckTimeout?: number;
  healthCheckFallThreshold?: number;
  healthCheckRiseThreshold?: number;
  enabled?: boolean;
  isBackup?: boolean;
  // Request modification options
  hostRewrite?: string | null;
  pathPrefixAdd?: string | null;
  pathPrefixStrip?: string | null;
}

// Certificate types
export type CertificateStatus = "pending" | "issuing" | "active" | "expired" | "failed" | "revoked";

export interface Certificate {
  id: string;
  domainId: string;
  commonName: string;
  altNames: string[];
  status: CertificateStatus;
  lastError: string | null;
  certPath: string | null;
  keyPath: string | null;
  chainPath: string | null;
  fullchainPath: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  renewBeforeDays: number;
  lastRenewalAttempt: string | null;
  nextRenewalCheck: string | null;
  renewalAttempts: number;
  dnsProviderId: string | null;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  domain?: Domain;
  dnsProvider?: DnsProvider;
}

export interface RequestCertificateData {
  domainId: string;
  dnsProviderId?: string;
  altNames?: string[];
}

export interface UpdateCertificateData {
  autoRenew?: boolean;
  renewBeforeDays?: number;
  dnsProviderId?: string | null;
}

// DNS Provider types
export type DnsProviderType = "cloudflare" | "namecheap";

export interface CloudflareCredentials {
  apiToken?: string;
  email?: string;
  apiKey?: string;
}

export interface NamecheapCredentials {
  apiUser: string;
  apiKey: string;
  clientIp: string;
  username?: string;
}

export type DnsProviderCredentials = CloudflareCredentials | NamecheapCredentials;

export interface DnsProvider {
  id: string;
  name: string;
  type: DnsProviderType;
  hasCredentials: boolean; // API won't return actual credentials
  isDefault: boolean;
  lastValidated: string | null;
  validationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDnsProviderData {
  name: string;
  type: DnsProviderType;
  credentials: DnsProviderCredentials;
  isDefault?: boolean;
}

export interface UpdateDnsProviderData {
  name?: string;
  credentials?: DnsProviderCredentials;
  isDefault?: boolean;
}

// Error Page types
export type ErrorPageType = "503" | "404" | "500" | "502" | "504" | "maintenance" | "custom";

export interface ErrorPage {
  id: string;
  name: string;
  type: ErrorPageType;
  httpStatusCode: number | null;
  directoryPath: string;
  entryFile: string;
  originalZipName: string | null;
  uploadedAt: string | null;
  fileSize: number | null;
  fileCount: number | null;
  previewImagePath: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateErrorPageData {
  name: string;
  type: ErrorPageType;
  httpStatusCode?: number;
  description?: string;
}

// Maintenance types
export interface MaintenanceWindow {
  id: string;
  domainId: string;
  title: string | null;
  reason: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  isActive: boolean;
  triggeredBy: string | null;
  bypassIps: string[] | null;
  notifyOnStart: boolean;
  notifyOnEnd: boolean;
  notificationWebhook: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  domain?: Domain;
}

export interface EnableMaintenanceData {
  reason?: string;
  bypassIps?: string[];
}

export interface ScheduleMaintenanceData {
  domainId: string;
  title?: string;
  reason?: string;
  scheduledStartAt: string;
  scheduledEndAt?: string;
  bypassIps?: string[];
  notifyOnStart?: boolean;
  notifyOnEnd?: boolean;
  notificationWebhook?: string;
}

// HAProxy types
export interface HaproxyStatus {
  status: "running" | "stopped" | "unknown";
  configExists: boolean;
  pid?: number;
  uptime?: string;
  currentConnections?: number;
}

export interface HaproxyReloadResult {
  success: boolean;
  changed: boolean;
  message?: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

// Stats types for dashboard
export interface DashboardStats {
  domains: {
    total: number;
    active: number;
    pending: number;
    disabled: number;
    error: number;
  };
  certificates: {
    total: number;
    active: number;
    pending: number;
    expired: number;
    failed: number;
  };
  backends: {
    total: number;
    healthy: number;
    unhealthy: number;
  };
  maintenance: {
    domainsInMaintenance: number;
    scheduledWindows: number;
  };
}

// =============================================================================
// Sites Extension Types
// =============================================================================

// Extension status
export interface ExtensionStatus {
  sites: boolean;
  pomerium: boolean;
  analytics: boolean;
}

// Site types
export type SiteStatus = "active" | "building" | "deploying" | "error" | "disabled";
export type SiteFramework = "nextjs" | "sveltekit" | "static" | "custom";
export type SiteRenderMode = "ssr" | "ssg" | "hybrid";
export type DeploymentSlot = "blue" | "green";

export interface Site {
  id: string;
  name: string;
  slug: string;
  framework: SiteFramework;
  renderMode: SiteRenderMode;
  status: SiteStatus;
  activeSlot: DeploymentSlot | null;
  activeVersion: number | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  installCommand: string | null;
  nodeVersion: string | null;
  envVariables: Record<string, string>;
  buildFlags: string[];
  runtimePath: string | null;
  entryPoint: string | null;
  memoryMb: number;
  cpuLimit: string;
  timeoutSeconds: number;
  maxConcurrency: number;
  coldStartEnabled: boolean;
  productionDomainId: string | null;
  errorPageId: string | null;
  maintenancePageId: string | null;
  s3ProviderId: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  latestDeployment?: Deployment;
  domains?: SiteDomain[];
  githubConnected?: boolean;
  githubConnection?: GitHubConnection;
}

export interface CreateSiteData {
  name: string;
  slug: string;
  framework?: SiteFramework;
  renderMode?: SiteRenderMode;
  buildCommand?: string;
  outputDirectory?: string;
  installCommand?: string;
  nodeVersion?: string;
  envVariables?: Record<string, string>;
  buildFlags?: string[];
  runtimePath?: string;
  entryPoint?: string;
  memoryMb?: number;
  cpuLimit?: string;
  timeoutSeconds?: number;
  maxConcurrency?: number;
  coldStartEnabled?: boolean;
  productionDomainId?: string;
  errorPageId?: string;
  maintenancePageId?: string;
  s3ProviderId?: string;
}

export interface UpdateSiteData extends Partial<CreateSiteData> {}

// Deployment types
export type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "live"
  | "failed"
  | "rolled_back"
  | "cancelled";
export type DeploymentTrigger = "manual" | "webhook" | "schedule" | "rollback";

export interface Deployment {
  id: string;
  siteId: string;
  version: number;
  commitSha: string | null;
  commitMessage: string | null;
  branch: string | null;
  buildStartedAt: string | null;
  buildCompletedAt: string | null;
  buildLogs: string | null;
  buildDurationMs: number | null;
  slot: DeploymentSlot | null;
  isActive: boolean;
  artifactPath: string | null;
  artifactSize: number | null;
  status: DeploymentStatus;
  errorMessage: string | null;
  triggeredBy: DeploymentTrigger;
  deployedAt: string | null;
  previewUrl: string | null;
  createdAt: string;
  // Relations
  site?: Site;
}

// GitHub connection types
export interface GitHubConnection {
  id: string;
  repositoryFullName: string;
  repositoryUrl: string | null;
  productionBranch: string | null;
  previewBranches: string[];
  autoDeploy: boolean;
  lastSyncAt: string | null;
  lastCommitSha: string | null;
}

export interface ConnectGitHubData {
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  repositoryUrl?: string;
  productionBranch?: string;
  previewBranches?: string[];
  autoDeploy?: boolean;
}

export interface UpdateGitHubConnectionData {
  productionBranch?: string;
  previewBranches?: string[];
  autoDeploy?: boolean;
}

// Site domain types
export interface SiteDomain {
  id: string;
  siteId: string;
  hostname: string;
  isPrimary: boolean;
  sslEnabled: boolean;
  createdAt: string;
}

// S3 Provider types
export interface S3Provider {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  pathPrefix: string;
  accessKeyId: string; // Masked in API response
  secretAccessKey: string; // Always masked
  isDefault: boolean;
  usedForBuildCache: boolean;
  usedForArtifacts: boolean;
  isConnected: boolean;
  lastConnectionCheck: string | null;
  connectionError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateS3ProviderData {
  name: string;
  endpoint: string;
  region?: string;
  bucket: string;
  pathPrefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
  isDefault?: boolean;
  usedForBuildCache?: boolean;
  usedForArtifacts?: boolean;
}

export interface UpdateS3ProviderData extends Partial<CreateS3ProviderData> {}

// Site analytics types
export interface SiteAnalyticsSummary {
  siteId: string;
  period: {
    start: string;
    end: string;
  };
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

export interface VisitorDataPoint {
  timestamp: string;
  pageViews: number;
  uniqueVisitors: number;
}

export interface GeographyData {
  countries: Array<{
    country: string;
    count: number;
  }>;
}

export interface ReferrerData {
  referrers: Array<{
    domain: string;
    count: number;
  }>;
}

export interface PageData {
  pages: Array<{
    path: string;
    count: number;
  }>;
}

export interface DeviceBreakdown {
  devices: {
    desktop: { count: number; percentage: number };
    mobile: { count: number; percentage: number };
    tablet: { count: number; percentage: number };
    other: { count: number; percentage: number };
  };
  total: number;
}

// GitHub types
export interface GitHubRepository {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

// =============================================================================
// Pomerium Extension Types
// =============================================================================

export type PomeriumIdpType = "google" | "azure" | "github" | "oidc";
export type PomeriumRouteProtection = "protected" | "public" | "passthrough";

export interface PomeriumPolicyConfig {
  allowedUsers?: string[];
  allowedGroups?: string[];
  allowedDomains?: string[];
  allowedEmailPatterns?: string[];
  corsAllowPreflight?: boolean;
  passIdentityHeaders?: boolean;
  setRequestHeaders?: Record<string, string>;
  removeRequestHeaders?: string[];
  timeout?: number;
  idleTimeout?: number;
  websocketsEnabled?: boolean;
  preserveHostHeader?: boolean;
  tlsSkipVerify?: boolean;
}

export interface PomeriumIdentityProvider {
  id: string;
  name: string;
  displayName: string | null;
  type: PomeriumIdpType;
  credentials: Record<string, unknown>; // Masked in responses
  enabled: boolean;
  isDefault: boolean;
  lastValidated: string | null;
  validationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePomeriumIdpData {
  name: string;
  displayName?: string;
  type: PomeriumIdpType;
  credentials: {
    clientId: string;
    clientSecret: string;
    tenantId?: string; // Azure
    hostedDomain?: string; // Google
    issuerUrl?: string; // OIDC
    allowedOrganizations?: string[]; // GitHub
    scopes?: string[]; // OIDC
  };
  enabled?: boolean;
  isDefault?: boolean;
}

export interface UpdatePomeriumIdpData {
  name?: string;
  displayName?: string;
  credentials?: Partial<CreatePomeriumIdpData["credentials"]>;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface PomeriumRoute {
  id: string;
  name: string;
  domainId: string;
  pathPattern: string;
  protection: PomeriumRouteProtection;
  identityProviderId: string | null;
  policyConfig: PomeriumPolicyConfig;
  priority: number;
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  identityProvider?: {
    id: string;
    name: string;
    type: PomeriumIdpType;
    hasCredentials: boolean;
  } | null;
  domain?: Domain | null;
}

export interface CreatePomeriumRouteData {
  name: string;
  domainId: string;
  pathPattern?: string;
  protection?: PomeriumRouteProtection;
  identityProviderId?: string;
  policyConfig?: PomeriumPolicyConfig;
  priority?: number;
  enabled?: boolean;
  description?: string;
}

export interface UpdatePomeriumRouteData {
  name?: string;
  pathPattern?: string;
  protection?: PomeriumRouteProtection;
  identityProviderId?: string | null;
  policyConfig?: PomeriumPolicyConfig;
  priority?: number;
  enabled?: boolean;
  description?: string | null;
}

export interface PomeriumSettings {
  id: string;
  authenticateServiceUrl: string | null;
  cookieName: string | null;
  cookieExpire: string | null;
  cookieDomain: string | null;
  cookieSecure: boolean | null;
  cookieHttpOnly: boolean | null;
  logLevel: string | null;
  forwardAuthUrl: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  // Secrets are masked
  sharedSecret: string | null;
  cookieSecret: string | null;
  signingKey: string | null;
}

export interface UpdatePomeriumSettingsData {
  authenticateServiceUrl?: string;
  cookieName?: string;
  cookieExpire?: string;
  cookieDomain?: string;
  cookieSecure?: boolean;
  cookieHttpOnly?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
  forwardAuthUrl?: string;
  enabled?: boolean;
}

export interface PomeriumStatus {
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  error: string | null;
  authenticateUrl: string | null;
}

// =============================================================================
// Shared Backend Types
// =============================================================================

export interface SharedBackend {
  id: string;
  name: string;
  description: string | null;
  address: string;
  port: number;
  protocol: BackendProtocol;
  weight: number;
  maxConnections: number | null;
  loadBalanceMethod: LoadBalanceMethod;
  healthCheckEnabled: boolean;
  healthCheckPath: string;
  healthCheckInterval: number;
  healthCheckTimeout: number;
  healthCheckFall: number;
  healthCheckRise: number;
  isHealthy: boolean;
  lastHealthCheck: string | null;
  lastHealthError: string | null;
  enabled: boolean;
  isBackup: boolean;
  hostRewrite: string | null;
  pathPrefixAdd: string | null;
  pathPrefixStrip: string | null;
  createdAt: string;
  updatedAt: string;
  // Populated by list endpoint
  domainCount?: number;
  // Populated by get endpoint
  linkedDomains?: Domain[];
}

export interface CreateSharedBackendData {
  name: string;
  description?: string;
  address: string;
  port?: number;
  protocol?: BackendProtocol;
  weight?: number;
  maxConnections?: number;
  loadBalanceMethod?: LoadBalanceMethod;
  healthCheckEnabled?: boolean;
  healthCheckPath?: string;
  healthCheckInterval?: number;
  healthCheckTimeout?: number;
  healthCheckFall?: number;
  healthCheckRise?: number;
  enabled?: boolean;
  isBackup?: boolean;
  hostRewrite?: string;
  pathPrefixAdd?: string;
  pathPrefixStrip?: string;
}

export interface UpdateSharedBackendData extends Partial<CreateSharedBackendData> {}

// =============================================================================
// Clustering Types
// =============================================================================

export type ClusterNodeStatus = "online" | "offline" | "syncing" | "error" | "unknown";

export interface ClusterNode {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  status: ClusterNodeStatus;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  configVersion: string | null;
  isLocal: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClusterNodeData {
  name: string;
  apiUrl: string;
  apiKey: string;
  isLocal?: boolean;
}

export interface UpdateClusterNodeData {
  name?: string;
  apiUrl?: string;
  apiKey?: string;
}

// =============================================================================
// Advanced Domain Configuration Types
// =============================================================================

// Domain Route Rules - URI-based routing to different backends or URL redirects
export type RouteActionType = "backend" | "redirect";

export interface DomainRouteRule {
  id: string;
  domainId: string;
  name: string;
  pathPattern: string;
  actionType: RouteActionType;
  // Backend routing
  backendId: string | null;
  // Redirect options
  redirectUrl: string | null;
  redirectStatusCode: number | null;
  redirectPreservePath: boolean;
  redirectPreserveQuery: boolean;
  priority: number;
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  backend?: Backend;
  domain?: Domain;
}

export interface CreateDomainRouteRuleData {
  domainId: string;
  name: string;
  pathPattern: string;
  actionType?: RouteActionType;
  // Backend routing (required when actionType is "backend")
  backendId?: string;
  // Redirect options (required when actionType is "redirect")
  redirectUrl?: string;
  redirectStatusCode?: number;
  redirectPreservePath?: boolean;
  redirectPreserveQuery?: boolean;
  priority?: number;
  enabled?: boolean;
  description?: string;
}

export interface UpdateDomainRouteRuleData {
  name?: string;
  pathPattern?: string;
  actionType?: RouteActionType;
  backendId?: string | null;
  redirectUrl?: string | null;
  redirectStatusCode?: number;
  redirectPreservePath?: boolean;
  redirectPreserveQuery?: boolean;
  priority?: number;
  enabled?: boolean;
  description?: string | null;
}

// Domain IP Rules - Whitelist/Blacklist IP access control
export type IpAccessMode = "whitelist" | "blacklist";

export interface DomainIpRule {
  id: string;
  domainId: string;
  mode: IpAccessMode;
  ipAddresses: string[];
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDomainIpRuleData {
  mode?: IpAccessMode;
  ipAddresses?: string[];
  enabled?: boolean;
  description?: string | null;
}

export interface IpValidationResult {
  ip: string;
  valid: boolean;
  type: "ipv4" | "ipv6" | "invalid";
  isCidr: boolean;
}

// Domain Security Headers - X-Frame-Options, CSP, CORS configuration
export type XFrameOptionsValue = "deny" | "sameorigin" | "allow-from" | "disabled";

export interface DomainSecurityHeaders {
  id: string;
  domainId: string;
  // X-Frame-Options
  xFrameOptionsEnabled: boolean;
  xFrameOptionsValue: XFrameOptionsValue | null;
  xFrameOptionsAllowFrom: string | null;
  // CSP frame-ancestors
  cspFrameAncestorsEnabled: boolean;
  cspFrameAncestors: string[];
  // CORS
  corsEnabled: boolean;
  corsAllowOrigins: string[];
  corsAllowMethods: string[];
  corsAllowHeaders: string[];
  corsExposeHeaders: string[];
  corsAllowCredentials: boolean;
  corsMaxAge: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDomainSecurityHeadersData {
  // X-Frame-Options
  xFrameOptionsEnabled?: boolean;
  xFrameOptionsValue?: XFrameOptionsValue;
  xFrameOptionsAllowFrom?: string | null;
  // CSP frame-ancestors
  cspFrameAncestorsEnabled?: boolean;
  cspFrameAncestors?: string[];
  // CORS
  corsEnabled?: boolean;
  corsAllowOrigins?: string[];
  corsAllowMethods?: string[];
  corsAllowHeaders?: string[];
  corsExposeHeaders?: string[];
  corsAllowCredentials?: boolean;
  corsMaxAge?: number;
}

// Domain Blocked Routes - HAProxy-level path blocking
export interface DomainBlockedRoute {
  id: string;
  domainId: string;
  pathPattern: string;
  enabled: boolean;
  httpStatusCode: number;
  customResponseBody: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  domain?: Domain;
}

export interface CreateDomainBlockedRouteData {
  domainId: string;
  pathPattern: string;
  enabled?: boolean;
  httpStatusCode?: number;
  customResponseBody?: string;
  description?: string;
}

export interface UpdateDomainBlockedRouteData {
  pathPattern?: string;
  enabled?: boolean;
  httpStatusCode?: number;
  customResponseBody?: string | null;
  description?: string | null;
}

// =============================================================================
// Analytics Extension Types
// =============================================================================

// Analytics config (per-domain)
export interface AnalyticsConfig {
  id: string;
  domainId: string;
  domainHostname: string;
  trackingUuid: string;
  enabled: boolean;
  rawRetentionDays: number;
  aggregateRetentionDays: number;
  maxBreakdownEntries: number;
  publicDashboardEnabled: boolean;
  publicDashboardToken: string | null;
  hasPublicDashboardPassword: boolean;
  trackScrollDepth: boolean;
  trackSessionDuration: boolean;
  trackOutboundLinks: boolean;
  ignoredPaths: string[];
  allowedOrigins: string[];
  embedSnippet: string;
  createdAt: string;
}

export interface EnableAnalyticsData {
  rawRetentionDays?: number;
  aggregateRetentionDays?: number;
  trackScrollDepth?: boolean;
  trackSessionDuration?: boolean;
  trackOutboundLinks?: boolean;
  ignoredPaths?: string[];
}

export interface UpdateAnalyticsConfigData {
  rawRetentionDays?: number;
  aggregateRetentionDays?: number;
  maxBreakdownEntries?: number;
  trackScrollDepth?: boolean;
  trackSessionDuration?: boolean;
  trackOutboundLinks?: boolean;
  ignoredPaths?: string[];
  allowedOrigins?: string[];
  publicDashboardEnabled?: boolean;
  publicDashboardPassword?: string | null;
}

// Analytics query filter params
export interface AnalyticsQueryParams {
  start?: string;
  end?: string;
  limit?: string;
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
  referrer_domain?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  pathname?: string;
}

// Analytics summary response
export interface AnalyticsSummary {
  summary: {
    pageViews: number;
    uniqueVisitors: number;
    sessions: number;
    bounceRate: number;
    avgSessionDurationMs: number;
    avgScrollDepthPct: number;
    customEvents: number;
    topPage?: string;
    topReferrer?: string;
  };
  comparison: {
    pageViewsChange: number;
    uniqueVisitorsChange: number;
    bounceRateChange: number;
  } | null;
}

// Analytics timeseries response
export interface AnalyticsTimeseriesBucket {
  bucketStart: string;
  pageViews: number;
  uniqueVisitors: number;
  sessions: number;
  bounces: number;
  customEvents: number;
}

export interface AnalyticsTimeseries {
  timeseries: AnalyticsTimeseriesBucket[];
}

// Analytics pages response
export interface AnalyticsPageEntry {
  pathname: string;
  pageViews: number;
  uniqueVisitors: number;
  avgDurationMs: number;
  avgScrollDepthPct: number;
}

export interface AnalyticsEntryExitPage {
  pathname: string;
  visitors: number;
  sessions: number;
}

export interface AnalyticsOutboundLink {
  destination: string;
  sourcePage: string;
  clicks: number;
}

export interface AnalyticsPages {
  pages: AnalyticsPageEntry[];
  entryPages: AnalyticsEntryExitPage[];
  exitPages: AnalyticsEntryExitPage[];
  outboundLinks: AnalyticsOutboundLink[];
}

// Analytics referrers response
export interface AnalyticsReferrerEntry {
  domain: string;
  visitors: number;
  pageViews: number;
}

export interface AnalyticsReferrers {
  referrers: AnalyticsReferrerEntry[];
}

// Analytics geography response
export interface AnalyticsCountryEntry {
  countryCode: string;
  visitors: number;
  pageViews: number;
}

export interface AnalyticsGeography {
  countries: AnalyticsCountryEntry[];
}

// Analytics devices response
export interface AnalyticsDevices {
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
    other: number;
  };
  browsers: Array<{ name: string; count: number }>;
  os: Array<{ name: string; count: number }>;
}

// Analytics events response
export interface AnalyticsEventEntry {
  name: string;
  count: number;
  uniqueVisitors: number;
}

export interface AnalyticsEvents {
  events: AnalyticsEventEntry[];
}

// Analytics event detail response
export interface AnalyticsEventDetail {
  eventName: string;
  totalCount: number;
  uniqueVisitors: number;
  metadata: Array<{ key: string; value: string; count: number }>;
  topPages: Array<{ pathname: string; count: number }>;
}

// Analytics UTM response
export interface AnalyticsUTM {
  sources: Array<{ source: string; visitors: number; pageViews: number }>;
  mediums: Array<{ medium: string; visitors: number; percentage: number }>;
  campaigns: Array<{ campaign: string; visitors: number; pageViews: number }>;
}

// Analytics live response
export interface AnalyticsLive {
  activeVisitors: number;
  activePages: Array<{ pathname: string; visitors: number }>;
  recentEvents: Array<Record<string, unknown>>;
}

// Analytics funnel types
export interface AnalyticsFunnelStep {
  name: string;
  type: "pageview" | "event";
  pathPattern?: string;
  eventName?: string;
  eventMetaMatch?: Record<string, string | number | boolean>;
}

export interface AnalyticsFunnel {
  id: string;
  analyticsConfigId: string;
  name: string;
  description: string | null;
  steps: AnalyticsFunnelStep[];
  windowMs: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnalyticsFunnelData {
  name: string;
  description?: string;
  steps: AnalyticsFunnelStep[];
  analysisWindowDays?: number;
}

export interface UpdateAnalyticsFunnelData {
  name?: string;
  description?: string | null;
  steps?: AnalyticsFunnelStep[];
  analysisWindowDays?: number;
  enabled?: boolean;
}

export interface AnalyticsFunnelResult {
  id: string;
  funnelId: string;
  periodStart: string;
  periodEnd: string;
  stepCounts: number[];
  stepConversionRates: number[];
  overallConversionRate: number;
  totalEntrants: number;
  computedAt: string;
}

export interface AnalyticsFunnelWithResults {
  funnel: AnalyticsFunnel;
  results: AnalyticsFunnelResult | null;
}

// Analytics public dashboard types
export interface AnalyticsPublicDashboardVerify {
  valid: boolean;
  domainHostname?: string;
  requiresPassword?: boolean;
  dashboardName?: string;
}

export interface AnalyticsPublicDashboardAuth {
  authenticated: boolean;
  sessionToken: string;
  expiresIn: number;
}
