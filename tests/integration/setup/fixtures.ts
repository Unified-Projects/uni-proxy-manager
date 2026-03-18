/**
 * Test data fixtures and factories
 */

import { nanoid, customAlphabet } from "nanoid";
import archiver from "archiver";

// Use only alphanumeric characters for hostname-safe IDs
const nanoidAlphanumeric = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  8
);

/**
 * Create a domain fixture with random hostname
 */
export function createDomainFixture(
  overrides: Partial<{
    hostname: string;
    displayName: string;
    sslEnabled: boolean;
    forceHttps: boolean;
  }> = {}
) {
  return {
    hostname: overrides.hostname || `test-${nanoidAlphanumeric()}.example.com`,
    displayName: overrides.displayName || "Test Domain",
    sslEnabled: overrides.sslEnabled ?? true,
    forceHttps: overrides.forceHttps ?? true,
  };
}

/**
 * Create a backend fixture for a domain
 */
export function createBackendFixture(
  domainId: string,
  overrides: Partial<{
    name: string;
    address: string;
    port: number;
    protocol: "http" | "https";
    weight: number;
    healthCheckEnabled: boolean;
    healthCheckPath: string;
    isBackup: boolean;
  }> = {}
) {
  return {
    domainId,
    name: overrides.name || `backend-${nanoid(6)}`,
    address: overrides.address || "127.0.0.1",
    port: overrides.port ?? 8080,
    protocol: overrides.protocol || "http",
    weight: overrides.weight ?? 100,
    healthCheckEnabled: overrides.healthCheckEnabled ?? true,
    healthCheckPath: overrides.healthCheckPath || "/health",
    healthCheckInterval: 5,
    healthCheckTimeout: 2,
    healthCheckFallThreshold: 3,
    healthCheckRiseThreshold: 2,
    loadBalanceMethod: "roundrobin" as const,
    isBackup: overrides.isBackup ?? false,
  };
}

/**
 * Create a DNS provider fixture
 */
export function createDnsProviderFixture(
  type: "cloudflare" | "namecheap" = "cloudflare"
) {
  if (type === "cloudflare") {
    return {
      name: `Cloudflare Provider ${nanoid(6)}`,
      type: "cloudflare" as const,
      credentials: {
        apiToken: `cf-test-token-${nanoid(12)}`,
      },
      isDefault: false,
    };
  }

  return {
    name: `Namecheap Provider ${nanoid(6)}`,
    type: "namecheap" as const,
    credentials: {
      apiUser: "testuser",
      apiKey: `nc-test-key-${nanoid(12)}`,
      clientIp: "127.0.0.1",
    },
    isDefault: false,
  };
}

/**
 * Create an error page fixture
 */
export function createErrorPageFixture(
  type: "503" | "404" | "500" | "502" | "504" | "maintenance" | "custom" = "503"
) {
  const httpStatusCodes: Record<string, number | undefined> = {
    "503": 503,
    "404": 404,
    "500": 500,
    "502": 502,
    "504": 504,
    "maintenance": 503,
    "custom": 500,
  };

  return {
    name: `Error Page ${type} ${nanoid(6)}`,
    type,
    description: `Test ${type} error page`,
    entryFile: "index.html",
    httpStatusCode: httpStatusCodes[type],
  };
}

/**
 * Create a maintenance page fixture
 */
export function createMaintenancePageFixture(
  overrides: Partial<{
    name: string;
    description: string;
  }> = {}
) {
  return {
    name: overrides.name || `Maintenance Page ${nanoid(6)}`,
    type: "maintenance" as const,
    description: overrides.description || "Scheduled maintenance page",
    entryFile: "index.html",
  };
}

/**
 * Create a test ZIP file with HTML content
 */
export async function createTestZipFile(
  content: string = "<html><body>Error Page</body></html>"
): Promise<File> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const blob = new Blob([buffer], { type: "application/zip" });
      const file = new File([blob], "error-page.zip", {
        type: "application/zip",
      });
      resolve(file);
    });
    archive.on("error", reject);

    archive.append(content, { name: "index.html" });
    archive.append("body { color: red; }", { name: "style.css" });
    archive.finalize();
  });
}

/**
 * Create a maintenance window fixture
 */
export function createMaintenanceWindowFixture(domainId: string) {
  const startAt = new Date(Date.now() + 3600000); // 1 hour from now
  const endAt = new Date(Date.now() + 7200000); // 2 hours from now

  return {
    domainId,
    title: `Scheduled Maintenance ${nanoid(6)}`,
    reason: "System upgrade",
    scheduledStartAt: startAt.toISOString(),
    scheduledEndAt: endAt.toISOString(),
    bypassIps: ["192.168.1.1", "10.0.0.1"],
  };
}

/**
 * Create a certificate request fixture
 */
export function createCertificateRequestFixture(
  domainId: string,
  dnsProviderId: string
) {
  return {
    domainId,
    dnsProviderId,
    altNames: [],
  };
}

// =============================================================================
// Shared Backends Fixtures
// =============================================================================

/**
 * Create a shared backend fixture
 */
export function createSharedBackendFixture(
  overrides: Partial<{
    name: string;
    description: string;
    address: string;
    port: number;
    protocol: "http" | "https";
    weight: number;
    healthCheckEnabled: boolean;
    healthCheckPath: string;
    enabled: boolean;
    isBackup: boolean;
    loadBalanceMethod: "roundrobin" | "leastconn" | "source" | "first";
  }> = {}
) {
  return {
    name: overrides.name || `shared-backend-${nanoidAlphanumeric()}`,
    description: overrides.description,
    address: overrides.address || "10.0.0.1",
    port: overrides.port ?? 8080,
    protocol: overrides.protocol || ("http" as const),
    weight: overrides.weight ?? 100,
    healthCheckEnabled: overrides.healthCheckEnabled ?? true,
    healthCheckPath: overrides.healthCheckPath || "/health",
    healthCheckInterval: 5,
    healthCheckTimeout: 2,
    healthCheckFall: 3,
    healthCheckRise: 2,
    loadBalanceMethod: overrides.loadBalanceMethod || ("roundrobin" as const),
    enabled: overrides.enabled ?? true,
    isBackup: overrides.isBackup ?? false,
  };
}

// =============================================================================
// Cluster Nodes Fixtures
// =============================================================================

/**
 * Create a cluster node fixture
 */
export function createClusterNodeFixture(
  overrides: Partial<{
    name: string;
    apiUrl: string;
    apiKey: string;
    isLocal: boolean;
  }> = {}
) {
  const id = nanoidAlphanumeric();
  return {
    name: overrides.name || `node-${id}`,
    apiUrl: overrides.apiUrl || `http://node-${id}.example.com`,
    apiKey: overrides.apiKey || `test-api-key-${nanoid(16)}`,
    isLocal: overrides.isLocal ?? false,
  };
}

// =============================================================================
// Sites Extension Fixtures
// =============================================================================

/**
 * Create a site fixture
 */
export function createSiteFixture(
  overrides: Partial<{
    name: string;
    slug: string;
    framework: "nextjs" | "sveltekit" | "static" | "custom";
    renderMode: "ssr" | "ssg" | "hybrid";
    buildCommand: string;
    outputDirectory: string;
    nodeVersion: string;
    memoryMb: number;
    cpuLimit: string;
    timeoutSeconds: number;
  }> = {}
) {
  const id = nanoidAlphanumeric();
  return {
    name: overrides.name || `Test Site ${id}`,
    slug: overrides.slug || `test-site-${id}`,
    framework: overrides.framework || "nextjs",
    renderMode: overrides.renderMode || "ssr",
    buildCommand: overrides.buildCommand || "npm run build",
    outputDirectory: overrides.outputDirectory || ".next",
    installCommand: "npm install",
    nodeVersion: overrides.nodeVersion || "20",
    memoryMb: overrides.memoryMb ?? 256,
    cpuLimit: overrides.cpuLimit || "0.5",
    timeoutSeconds: overrides.timeoutSeconds ?? 30,
    maxConcurrency: 10,
    coldStartEnabled: true,
    envVariables: {},
    buildFlags: [],
  };
}

/**
 * Create a deployment fixture
 */
export function createDeploymentFixture(
  siteId: string,
  overrides: Partial<{
    version: number;
    commitSha: string;
    commitMessage: string;
    branch: string;
    status: "pending" | "building" | "deploying" | "live" | "failed" | "rolled_back" | "cancelled";
    slot: "blue" | "green";
    triggeredBy: "manual" | "webhook" | "schedule" | "rollback";
  }> = {}
) {
  return {
    siteId,
    version: overrides.version ?? 1,
    commitSha: overrides.commitSha || `${nanoid(40)}`,
    commitMessage: overrides.commitMessage || "feat: test deployment",
    branch: overrides.branch || "main",
    status: overrides.status || "pending",
    slot: overrides.slot || "blue",
    triggeredBy: overrides.triggeredBy || "manual",
  };
}

/**
 * Create an S3 provider fixture
 */
export function createS3ProviderFixture(
  overrides: Partial<{
    name: string;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    isDefault: boolean;
  }> = {}
) {
  return {
    name: overrides.name || `S3 Provider ${nanoid(6)}`,
    endpoint: overrides.endpoint || process.env.SITES_S3_ENDPOINT || "http://test-minio:9000",
    region: overrides.region || "us-east-1",
    bucket: overrides.bucket || `test-bucket-${nanoidAlphanumeric()}`,
    pathPrefix: "",
    accessKeyId: overrides.accessKeyId || "minioadmin",
    secretAccessKey: overrides.secretAccessKey || "minioadmin",
    isDefault: overrides.isDefault ?? false,
    usedForBuildCache: true,
    usedForArtifacts: true,
  };
}

/**
 * Create a GitHub connection fixture
 */
export function createGitHubConnectionFixture(
  siteId: string,
  overrides: Partial<{
    installationId: number;
    repositoryId: number;
    repositoryFullName: string;
    productionBranch: string;
    autoDeploy: boolean;
  }> = {}
) {
  return {
    siteId,
    installationId: overrides.installationId ?? 12345678,
    repositoryId: overrides.repositoryId ?? 87654321,
    repositoryFullName: overrides.repositoryFullName || "test-org/test-repo",
    repositoryUrl: `https://github.com/${overrides.repositoryFullName || "test-org/test-repo"}`,
    defaultBranch: "main",
    productionBranch: overrides.productionBranch || "main",
    previewBranches: ["*"],
    autoDeploy: overrides.autoDeploy ?? true,
  };
}

/**
 * Create site analytics fixture
 */
export function createSiteAnalyticsFixture(
  siteId: string,
  deploymentId?: string,
  overrides: Partial<{
    timestamp: Date;
    pageViews: number;
    uniqueVisitors: number;
  }> = {}
) {
  return {
    siteId,
    deploymentId,
    timestamp: overrides.timestamp || new Date(),
    pageViews: overrides.pageViews ?? 100,
    uniqueVisitors: overrides.uniqueVisitors ?? 70,
    avgResponseTimeMs: 150,
    p95ResponseTimeMs: 350,
    bytesIn: 102400,
    bytesOut: 5120000,
    responses2xx: 95,
    responses3xx: 2,
    responses4xx: 2,
    responses5xx: 1,
    geoData: { US: 50, GB: 20, DE: 15, FR: 10, CA: 5 },
    referrers: { "google.com": 40, "twitter.com": 20, direct: 40 },
    devices: { desktop: 60, mobile: 35, tablet: 4, other: 1 },
    paths: { "/": 40, "/dashboard": 30, "/settings": 20, "/api/health": 10 },
    browsers: { Chrome: 60, Safari: 25, Firefox: 10, Edge: 5 },
  };
}

// =============================================================================
// Pomerium Extension Fixtures - Re-export from dedicated file
// =============================================================================

export {
  createPomeriumIdpFixture,
  createPomeriumOidcIdpFixture,
  createPomeriumGoogleIdpFixture,
  createPomeriumAzureIdpFixture,
  createPomeriumGitHubIdpFixture,
  createPomeriumRouteFixture,
  createAdminRouteFixture,
  createDomainRestrictedRouteFixture,
  createPublicRouteFixture,
  createPassthroughRouteFixture,
  createPomeriumSettingsFixture,
  createPomeriumTestScenario,
  POLICY_PRESETS,
} from "./pomerium-fixtures";
