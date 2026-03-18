/**
 * HAProxy configuration types for template generation
 */

export interface HAProxyGlobalConfig {
  maxConnections: number;
  logFormat: string;
  statsSocket: string;
}

export interface HAProxyDefaultsConfig {
  mode: "http" | "tcp";
  connectTimeout: string;
  clientTimeout: string;
  serverTimeout: string;
  httpKeepAlive: boolean;
  logFormat?: string;
}

export interface HAProxyBackendServer {
  name: string;
  address: string;
  port: number;
  weight: number;
  maxConnections?: number;
  backup?: boolean;
  /** Connect to backend using SSL (for HTTPS backends) */
  ssl?: boolean;
  /** Send SNI header matching the request Host header */
  sni?: boolean;
  /** Override SNI with a specific hostname (used when hostRewrite is set) */
  sniHost?: string;
  healthCheck: {
    enabled: boolean;
    path: string;
    interval: number;
    timeout: number;
    fall: number;
    rise: number;
  };
}

export interface HAProxyBackend {
  name: string;
  mode: "http" | "tcp";
  loadBalanceMethod: "roundrobin" | "leastconn" | "source" | "first";
  servers: HAProxyBackendServer[];
  errorFilePath?: string;
  httpCheck?: {
    path: string;
    expectStatus: number | string;
    /** If set, sends HTTP/1.1 with this Host header instead of HTTP/1.0 */
    host?: string;
  };
  httpRequestRules?: string[];
  /** Tunnel timeout for long-lived connections such as WebSockets */
  timeoutTunnel?: string;
  /** Maximum concurrent connections for this backend */
  maxconn?: number;
}

export interface HAProxyFrontendBind {
  address: string;
  port: number;
  ssl?: boolean;
  certPath?: string;
}

export interface HAProxyACL {
  name: string;
  condition: string;
}

export interface HAProxyUseBackend {
  backendName: string;
  condition?: string;
}

export interface HAProxyFrontend {
  name: string;
  mode: "http" | "tcp";
  binds: HAProxyFrontendBind[];
  acls: HAProxyACL[];
  useBackends: HAProxyUseBackend[];
  defaultBackend: string;
  httpRequestRules?: string[];
  httpResponseRules?: string[];
  captures?: string[];
}

export interface HAProxyClusterPeer {
  name: string;
  address: string;
  port: number;
}

export interface HAProxyConfig {
  global: HAProxyGlobalConfig;
  defaults: HAProxyDefaultsConfig;
  frontends: HAProxyFrontend[];
  backends: HAProxyBackend[];
  /** Cluster peers for HAProxy stick-table replication via the peers protocol */
  clusterPeers?: HAProxyClusterPeer[];
}

export interface DomainConfig {
  id: string;
  hostname: string;
  sslEnabled: boolean;
  forceHttps: boolean;
  maintenanceEnabled: boolean;
  maintenanceBypassIps: string[];
  errorPagePath?: string;
  maintenancePagePath?: string;
  certificatePath?: string;
  /** Alternative names (SANs) from the certificate, including wildcards like *.example.com */
  certificateAltNames?: string[];
  backends: BackendConfig[];
  // Bot filtering and blocking
  blockBots?: boolean;
  filterBotsFromStats?: boolean;
  // Subdomain aliases (www toggle and arbitrary aliases)
  subdomainAliases?: string[];
  // Advanced configuration
  routeRules?: DomainRouteRuleConfig[];
  ipAccessControl?: DomainIpAccessConfig;
  securityHeaders?: DomainSecurityHeadersConfig;
  blockedRoutes?: DomainBlockedRouteConfig[];
}

export interface BackendConfig {
  id: string;
  name: string;
  backendType: "static" | "site";
  // Static backend fields
  address: string | null;
  port: number | null;
  protocol: "http" | "https";
  // Site backend fields
  siteId: string | null;
  siteRuntimeId?: string; // {siteId}-{activeDeploymentId}
  // Common fields
  weight: number;
  maxConnections?: number;
  healthCheckEnabled: boolean;
  healthCheckPath: string;
  healthCheckInterval: number;
  healthCheckTimeout: number;
  healthCheckFall: number;
  healthCheckRise: number;
  enabled: boolean;
  isBackup: boolean;
  // Request modification options
  /** Override Host header sent to backend */
  hostRewrite?: string;
  /** Path prefix to add to requests */
  pathPrefixAdd?: string;
  /** Path prefix to strip from requests */
  pathPrefixStrip?: string;
}

/**
 * Sites extension types for HAProxy configuration
 */
export interface SiteConfig {
  id: string;
  slug: string;
  hostname: string;
  sslEnabled: boolean;
  activeSlot: "blue" | "green" | null;
  errorPagePath?: string;
  maintenanceEnabled: boolean;
  maintenanceBypassIps: string[];
  maintenancePagePath?: string;
}

export interface SitesExecutorConfig {
  endpoint: string;
  port: number;
  secret: string;
}

/**
 * Pomerium extension types for HAProxy configuration
 */
export type PomeriumRouteProtection = "protected" | "public" | "passthrough";

export interface PomeriumRouteConfig {
  id: string;
  name: string;
  domainId: string;
  hostname: string;
  pathPattern: string;
  protection: PomeriumRouteProtection;
  enabled: boolean;
  priority: number;
}

export interface PomeriumConfig {
  enabled: boolean;
  internalUrl: string;
  routes: PomeriumRouteConfig[];
  /** Public URL of the Pomerium authenticate service (e.g. https://auth.example.com) */
  authenticateServiceUrl?: string;
}

/**
 * Advanced domain configuration types
 */

// Route rules for URI-based routing to different backends or redirects
export type RouteActionType = "backend" | "redirect";

export interface DomainRouteRuleConfig {
  id: string;
  name: string;
  /**
   * Path pattern for matching. Supports:
   * - Glob patterns: /api/*, /dashboard/**
   * - Multiple paths (comma-separated): /login,/signup,/recover
   * - Direct regex: ^/api/(v1|v2)/.*
   * - Catch-all: /*, /**
   */
  pathPattern: string;
  /** Action type: route to backend or redirect to URL */
  actionType: RouteActionType;
  /** ID of the backend to route matching requests to (when actionType = "backend") */
  backendId?: string;
  /** Display name of the backend (for reference only) */
  backendName?: string;
  /** Target URL for redirect (when actionType = "redirect") */
  redirectUrl?: string;
  /** HTTP status code for redirect (301, 302, 303, 307, 308) */
  redirectStatusCode?: number;
  /** Append original path to redirect URL */
  redirectPreservePath?: boolean;
  /** Preserve query string in redirect */
  redirectPreserveQuery?: boolean;
  /** Lower number = higher priority (evaluated first) */
  priority: number;
  enabled: boolean;
}

// IP access control (whitelist/blacklist)
export type IpAccessMode = "whitelist" | "blacklist";

export interface DomainIpAccessConfig {
  enabled: boolean;
  mode: IpAccessMode;
  ipAddresses: string[]; // Supports CIDR notation
}

// Security headers configuration
export type XFrameOptionsValue = "deny" | "sameorigin" | "allow-from" | "disabled";

export interface DomainSecurityHeadersConfig {
  xFrameOptions?: {
    enabled: boolean;
    value: XFrameOptionsValue;
    allowFrom?: string; // URL for ALLOW-FROM
  };
  cspFrameAncestors?: {
    enabled: boolean;
    values: string[]; // ['self', 'https://example.com']
  };
  cors?: {
    enabled: boolean;
    allowOrigins: string[]; // ['*'] or specific origins
    allowMethods: string[];
    allowHeaders: string[];
    exposeHeaders: string[];
    allowCredentials: boolean;
    maxAge: number; // Seconds
  };
}

// Blocked routes for HAProxy-level path blocking
export interface DomainBlockedRouteConfig {
  id: string;
  pathPattern: string; // /admin/*, /console
  httpStatusCode: number;
  customResponseBody?: string;
  enabled: boolean;
}

/**
 * Analytics extension types for HAProxy configuration
 */
export interface AnalyticsRouteConfig {
  domainId: string;
  hostname: string;
  trackingUuid: string;
  enabled: boolean;
}

export interface AnalyticsBackendConfig {
  host: string;   // "analytics" (Docker service name)
  port: number;   // 3003
}

export interface AnalyticsConfig {
  routes: AnalyticsRouteConfig[];
  backend?: AnalyticsBackendConfig;
}
