/**
 * Seed script for visual testing environment
 * Creates test domains, backends, error pages, DNS providers, Sites, etc.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { nanoid } from "nanoid";
import * as schema from "../packages/database/src/schema";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { GeoData, ReferrerData, DeviceData, PathData } from "../packages/database/src/schema/site-analytics";

const connectionString =
  process.env.UNI_PROXY_MANAGER_DB_URL ||
  "postgresql://visual_user:visual_password@localhost:5434/uni_proxy_visual?sslmode=disable";

const client = postgres(connectionString, { max: 5, ssl: false });
const db = drizzle(client, { schema });

const PROJECT_ROOT = process.cwd();
const ERROR_PAGES_DIR = join(PROJECT_ROOT, "docker/visual-test-data/error-pages");
// Path as seen from inside the Docker container
const ERROR_PAGES_DIR_CONTAINER = "/data/error-pages";

async function createErrorPageFiles(pageId: string, type: "503" | "maintenance") {
  const pageDir = join(ERROR_PAGES_DIR, pageId);
  await mkdir(pageDir, { recursive: true });

  if (type === "503") {
    await writeFile(
      join(pageDir, "index.html"),
      `<!DOCTYPE html>
<html>
<head>
  <title>503 Service Unavailable</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 20px;
      backdrop-filter: blur(10px);
    }
    h1 { font-size: 72px; margin: 0; }
    p { font-size: 24px; opacity: 0.8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>503</h1>
    <p>Service Temporarily Unavailable</p>
    <p style="font-size: 16px; margin-top: 20px;">Please try again in a few minutes.</p>
  </div>
</body>
</html>`
    );
  } else {
    await writeFile(
      join(pageDir, "index.html"),
      `<!DOCTYPE html>
<html>
<head>
  <title>Scheduled Maintenance</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 20px;
      backdrop-filter: blur(10px);
      max-width: 600px;
    }
    h1 { font-size: 48px; margin: 0 0 20px 0; }
    .icon { font-size: 80px; margin-bottom: 20px; }
    p { font-size: 18px; opacity: 0.9; line-height: 1.6; }
    .eta {
      margin-top: 30px;
      padding: 15px;
      background: rgba(255,255,255,0.2);
      border-radius: 10px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128736;</div>
    <h1>Scheduled Maintenance</h1>
    <p>We're currently performing scheduled maintenance to improve our services.</p>
    <p>We apologize for any inconvenience.</p>
    <div class="eta">
      <strong>Expected completion:</strong> Within 2 hours
    </div>
  </div>
</body>
</html>`
    );
  }
}

async function seed() {
  console.log("Starting database seed...\n");

  // Clear existing data
  console.log("Clearing existing data...");
  // Sites extension tables first (due to foreign keys)
  await db.delete(schema.siteAnalytics);
  await db.delete(schema.siteDomains);
  await db.delete(schema.githubConnections);
  await db.delete(schema.deployments);
  await db.delete(schema.sites);
  await db.delete(schema.s3Providers);
  // Core tables
  await db.delete(schema.maintenanceWindows);
  await db.delete(schema.certificates);
  await db.delete(schema.backends);
  await db.delete(schema.domains);
  await db.delete(schema.dnsProviders);
  await db.delete(schema.errorPages);

  // Create DNS Providers
  console.log("Creating DNS providers...");
  const [cloudflareProvider] = await db
    .insert(schema.dnsProviders)
    .values({
      id: "dns-cloudflare-1",
      name: "Primary Cloudflare",
      type: "cloudflare",
      credentials: {
        apiToken: "cf_test_token_abc123xyz789",
      },
      isDefault: true,
      lastValidated: new Date(),
    })
    .returning();

  const [namecheapProvider] = await db
    .insert(schema.dnsProviders)
    .values({
      id: "dns-namecheap-1",
      name: "Backup Namecheap",
      type: "namecheap",
      credentials: {
        apiUser: "testuser",
        apiKey: "nc_test_key_def456",
        clientIp: "203.0.113.50",
      },
      isDefault: false,
    })
    .returning();

  console.log(`  Created: ${cloudflareProvider.name} (default)`);
  console.log(`  Created: ${namecheapProvider.name}`);

  // Create Error Pages
  console.log("\nCreating error pages...");

  const error503Id = "error-page-503-default";
  await createErrorPageFiles(error503Id, "503");
  const [error503Page] = await db
    .insert(schema.errorPages)
    .values({
      id: error503Id,
      name: "Default 503 Page",
      type: "503",
      description: "Service unavailable error page with gradient design",
      directoryPath: join(ERROR_PAGES_DIR_CONTAINER, error503Id),
      entryFile: "index.html",
      uploadedAt: new Date(),
      fileSize: 1024,
      fileCount: 1,
      previewImagePath: `${error503Id}/preview.png`,
    })
    .returning();
  console.log(`  Created: ${error503Page.name}`);

  const maintenancePageId = "error-page-maintenance-default";
  await createErrorPageFiles(maintenancePageId, "maintenance");
  const [maintenancePage] = await db
    .insert(schema.errorPages)
    .values({
      id: maintenancePageId,
      name: "Default Maintenance Page",
      type: "maintenance",
      description: "Scheduled maintenance page with ETA",
      directoryPath: join(ERROR_PAGES_DIR_CONTAINER, maintenancePageId),
      entryFile: "index.html",
      uploadedAt: new Date(),
      fileSize: 1280,
      fileCount: 1,
      previewImagePath: `${maintenancePageId}/preview.png`,
    })
    .returning();
  console.log(`  Created: ${maintenancePage.name}`);

  const customErrorId = "error-page-custom-1";
  const [customErrorPage] = await db
    .insert(schema.errorPages)
    .values({
      id: customErrorId,
      name: "Custom 500 Error",
      type: "custom",
      httpStatusCode: 500,
      description: "Internal server error page (not uploaded yet)",
      directoryPath: join(ERROR_PAGES_DIR_CONTAINER, customErrorId),
      entryFile: "index.html",
    })
    .returning();
  console.log(`  Created: ${customErrorPage.name} (not uploaded)`);

  // Create Domains
  console.log("\nCreating domains...");

  // Domain 1: Active with full configuration
  const [activeDomain] = await db
    .insert(schema.domains)
    .values({
      id: "domain-active-1",
      hostname: "app.example.com",
      displayName: "Production App",
      status: "active",
      sslEnabled: true,
      forceHttps: true,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      errorPageId: error503Id,
      configVersion: 1,
    })
    .returning();
  console.log(`  Created: ${activeDomain.hostname} (active)`);

  // Domain 2: In maintenance mode
  const [maintenanceDomain] = await db
    .insert(schema.domains)
    .values({
      id: "domain-maintenance-1",
      hostname: "staging.example.com",
      displayName: "Staging Environment",
      status: "active",
      sslEnabled: true,
      forceHttps: true,
      maintenanceEnabled: true,
      maintenanceBypassIps: ["192.168.1.100", "10.0.0.50", "203.0.113.10"],
      errorPageId: error503Id,
      maintenancePageId: maintenancePageId,
      configVersion: 3,
    })
    .returning();
  console.log(`  Created: ${maintenanceDomain.hostname} (maintenance mode)`);

  // Domain 3: Pending setup
  const [pendingDomain] = await db
    .insert(schema.domains)
    .values({
      id: "domain-pending-1",
      hostname: "new-site.example.com",
      displayName: "New Website",
      status: "pending",
      sslEnabled: true,
      forceHttps: false,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      configVersion: 0,
    })
    .returning();
  console.log(`  Created: ${pendingDomain.hostname} (pending)`);

  // Domain 4: Another active domain
  const [apiDomain] = await db
    .insert(schema.domains)
    .values({
      id: "domain-api-1",
      hostname: "api.example.com",
      displayName: "API Gateway",
      status: "active",
      sslEnabled: true,
      forceHttps: true,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      errorPageId: error503Id,
      configVersion: 5,
    })
    .returning();
  console.log(`  Created: ${apiDomain.hostname} (active)`);

  // Create Backends
  console.log("\nCreating backends...");

  // Backends for active domain (load balanced)
  await db.insert(schema.backends).values([
    {
      id: "backend-app-1",
      domainId: activeDomain.id,
      name: "App Server 1",
      address: "test-backend",
      port: 80,
      protocol: "http",
      weight: 100,
      enabled: true,
      isHealthy: true,
      healthCheckEnabled: true,
      healthCheckPath: "/health",
      healthCheckInterval: 10,
      healthCheckTimeout: 5,
      healthCheckFallThreshold: 3,
      healthCheckRiseThreshold: 2,
      loadBalanceMethod: "roundrobin",
    },
    {
      id: "backend-app-2",
      domainId: activeDomain.id,
      name: "App Server 2",
      address: "test-backend-2",
      port: 80,
      protocol: "http",
      weight: 100,
      enabled: true,
      isHealthy: true,
      healthCheckEnabled: true,
      healthCheckPath: "/health",
      healthCheckInterval: 10,
      healthCheckTimeout: 5,
      healthCheckFallThreshold: 3,
      healthCheckRiseThreshold: 2,
      loadBalanceMethod: "roundrobin",
    },
    {
      id: "backend-app-3",
      domainId: activeDomain.id,
      name: "App Server 3 (Disabled)",
      address: "test-backend-3",
      port: 80,
      protocol: "http",
      weight: 50,
      enabled: false,
      isHealthy: true,
      healthCheckEnabled: true,
      healthCheckPath: "/health",
      healthCheckInterval: 10,
      healthCheckTimeout: 5,
      healthCheckFallThreshold: 3,
      healthCheckRiseThreshold: 2,
      loadBalanceMethod: "roundrobin",
    },
  ]);
  console.log(`  Created: 3 backends for ${activeDomain.hostname}`);

  // Backends for maintenance domain
  await db.insert(schema.backends).values([
    {
      id: "backend-staging-1",
      domainId: maintenanceDomain.id,
      name: "Staging Server",
      address: "test-backend",
      port: 80,
      protocol: "http",
      weight: 100,
      enabled: true,
      isHealthy: true,
      healthCheckEnabled: true,
      healthCheckPath: "/",
      healthCheckInterval: 30,
      healthCheckTimeout: 10,
      healthCheckFallThreshold: 2,
      healthCheckRiseThreshold: 1,
      loadBalanceMethod: "roundrobin",
    },
  ]);
  console.log(`  Created: 1 backend for ${maintenanceDomain.hostname}`);

  // Backends for API domain (multiple weighted)
  await db.insert(schema.backends).values([
    {
      id: "backend-api-1",
      domainId: apiDomain.id,
      name: "API Primary",
      address: "test-backend",
      port: 80,
      protocol: "http",
      weight: 200,
      enabled: true,
      isHealthy: true,
      healthCheckEnabled: true,
      healthCheckPath: "/api/health",
      healthCheckInterval: 5,
      healthCheckTimeout: 2,
      healthCheckFallThreshold: 2,
      healthCheckRiseThreshold: 2,
      loadBalanceMethod: "leastconn",
    },
    {
      id: "backend-api-2",
      domainId: apiDomain.id,
      name: "API Secondary",
      address: "test-backend-2",
      port: 80,
      protocol: "http",
      weight: 100,
      enabled: true,
      isHealthy: true,
      healthCheckEnabled: true,
      healthCheckPath: "/api/health",
      healthCheckInterval: 5,
      healthCheckTimeout: 2,
      healthCheckFallThreshold: 2,
      healthCheckRiseThreshold: 2,
      loadBalanceMethod: "leastconn",
    },
  ]);
  console.log(`  Created: 2 backends for ${apiDomain.hostname}`);

  // Create Maintenance Windows
  console.log("\nCreating maintenance windows...");

  // Active maintenance window for staging
  const now = new Date();
  const [activeWindow] = await db
    .insert(schema.maintenanceWindows)
    .values({
      id: "maint-window-active-1",
      domainId: maintenanceDomain.id,
      title: "System Upgrade",
      reason: "Upgrading database servers and applying security patches",
      scheduledStartAt: new Date(now.getTime() - 3600000), // Started 1 hour ago
      scheduledEndAt: new Date(now.getTime() + 3600000), // Ends in 1 hour
      actualStartAt: new Date(now.getTime() - 3600000),
      isActive: true,
      bypassIps: ["192.168.1.100", "10.0.0.50"],
    })
    .returning();
  console.log(`  Created: ${activeWindow.title} (active)`);

  // Scheduled future maintenance
  const [futureWindow] = await db
    .insert(schema.maintenanceWindows)
    .values({
      id: "maint-window-scheduled-1",
      domainId: activeDomain.id,
      title: "Planned Downtime",
      reason: "Infrastructure migration to new data center",
      scheduledStartAt: new Date(now.getTime() + 86400000), // Tomorrow
      scheduledEndAt: new Date(now.getTime() + 86400000 + 7200000), // Tomorrow + 2 hours
      isActive: false,
      bypassIps: ["10.0.0.1"],
    })
    .returning();
  console.log(`  Created: ${futureWindow.title} (scheduled)`);

  // Past completed maintenance
  await db.insert(schema.maintenanceWindows).values({
    id: "maint-window-completed-1",
    domainId: apiDomain.id,
    title: "SSL Certificate Update",
    reason: "Renewing SSL certificates",
    scheduledStartAt: new Date(now.getTime() - 172800000), // 2 days ago
    scheduledEndAt: new Date(now.getTime() - 172800000 + 1800000), // 30 min window
    actualStartAt: new Date(now.getTime() - 172800000),
    actualEndAt: new Date(now.getTime() - 172800000 + 900000), // Completed in 15 min
    isActive: false,
    bypassIps: [],
  });
  console.log(`  Created: SSL Certificate Update (completed)`);

  // Create a certificate record (mock)
  console.log("\nCreating certificate records...");
  await db.insert(schema.certificates).values({
    id: "cert-app-1",
    domainId: activeDomain.id,
    dnsProviderId: cloudflareProvider.id,
    commonName: activeDomain.hostname,
    altNames: [`www.${activeDomain.hostname}`],
    status: "active",
    issuedAt: new Date(now.getTime() - 7776000000), // 90 days ago
    expiresAt: new Date(now.getTime() + 7776000000), // 90 days from now
    autoRenew: true,
    renewBeforeDays: 30,
    certPath: `${activeDomain.id}/cert.pem`,
    keyPath: `${activeDomain.id}/key.pem`,
    fullchainPath: `${activeDomain.id}/fullchain.pem`,
    fingerprint: "SHA256:abc123def456",
  });
  console.log(`  Created: Certificate for ${activeDomain.hostname}`);

  // ====================================
  // SITES EXTENSION DATA
  // ====================================

  // Create S3 Providers
  console.log("\nCreating S3 providers...");
  const [defaultS3Provider] = await db
    .insert(schema.s3Providers)
    .values({
      id: "s3-provider-minio-1",
      name: "Visual Test MinIO",
      endpoint: "http://visual-minio:9000",
      region: "us-east-1",
      bucket: "sites-artifacts",
      pathPrefix: "",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      isDefault: true,
      usedForBuildCache: true,
      usedForArtifacts: true,
      isConnected: true,
      lastConnectionCheck: new Date(),
    })
    .returning();
  console.log(`  Created: ${defaultS3Provider.name} (default)`);

  const [backupS3Provider] = await db
    .insert(schema.s3Providers)
    .values({
      id: "s3-provider-backup-1",
      name: "Backup S3 Storage",
      endpoint: "https://s3.amazonaws.com",
      region: "us-west-2",
      bucket: "backup-artifacts",
      pathPrefix: "sites/",
      accessKeyId: "AKIAEXAMPLE123",
      secretAccessKey: "secret-example-key",
      isDefault: false,
      usedForBuildCache: false,
      usedForArtifacts: true,
      isConnected: false,
      connectionError: "Not configured for visual testing",
    })
    .returning();
  console.log(`  Created: ${backupS3Provider.name} (not connected)`);

  // Create Sites
  console.log("\nCreating sites...");
  const [nextjsSite] = await db
    .insert(schema.sites)
    .values({
      id: "site-nextjs-1",
      name: "My Next.js App",
      slug: "my-nextjs-app",
      framework: "nextjs",
      renderMode: "ssr",
      buildCommand: "npm run build",
      outputDirectory: ".next",
      installCommand: "npm install",
      nodeVersion: "20",
      envVariables: {
        NEXT_PUBLIC_API_URL: "https://api.example.com",
        DATABASE_URL: "postgresql://localhost:5432/myapp",
      },
      buildFlags: ["--no-lint"],
      memoryMb: 512,
      cpuLimit: "1.0",
      timeoutSeconds: 60,
      maxConcurrency: 20,
      coldStartEnabled: true,
      errorPageId: error503Id,
      maintenancePageId: maintenancePageId,
      maintenanceEnabled: false,
      s3ProviderId: defaultS3Provider.id,
      status: "active",
      activeSlot: "blue",
    })
    .returning();
  console.log(`  Created: ${nextjsSite.name} (active, Next.js SSR)`);

  const [svelteKitSite] = await db
    .insert(schema.sites)
    .values({
      id: "site-sveltekit-1",
      name: "SvelteKit Dashboard",
      slug: "sveltekit-dashboard",
      framework: "sveltekit",
      renderMode: "hybrid",
      buildCommand: "npm run build",
      outputDirectory: "build",
      installCommand: "npm install",
      nodeVersion: "20",
      envVariables: {
        PUBLIC_API_ENDPOINT: "https://api.dashboard.com",
      },
      buildFlags: [],
      memoryMb: 256,
      cpuLimit: "0.5",
      timeoutSeconds: 30,
      maxConcurrency: 10,
      coldStartEnabled: true,
      s3ProviderId: defaultS3Provider.id,
      status: "building",
      activeSlot: "green",
    })
    .returning();
  console.log(`  Created: ${svelteKitSite.name} (building, SvelteKit hybrid)`);

  const [staticSite] = await db
    .insert(schema.sites)
    .values({
      id: "site-static-1",
      name: "Marketing Website",
      slug: "marketing-website",
      framework: "static",
      renderMode: "ssg",
      buildCommand: "npm run build",
      outputDirectory: "dist",
      installCommand: "npm install",
      nodeVersion: "18",
      envVariables: {},
      buildFlags: [],
      memoryMb: 128,
      cpuLimit: "0.25",
      timeoutSeconds: 10,
      maxConcurrency: 50,
      coldStartEnabled: false,
      s3ProviderId: defaultS3Provider.id,
      status: "disabled",
    })
    .returning();
  console.log(`  Created: ${staticSite.name} (disabled, static SSG)`);

  // Create Deployments
  console.log("\nCreating deployments...");

  // Next.js site deployments
  const [nextjsDeploymentLive] = await db
    .insert(schema.deployments)
    .values({
      id: "deployment-nextjs-1",
      siteId: nextjsSite.id,
      version: 3,
      commitSha: "abc123def456789012345678901234567890abcd",
      commitMessage: "feat: add user authentication flow",
      branch: "main",
      buildStartedAt: new Date(now.getTime() - 300000),
      buildCompletedAt: new Date(now.getTime() - 180000),
      buildLogs: `[12:00:00] Installing dependencies...
[12:00:15] npm install completed
[12:00:16] Running build command: npm run build
[12:01:30] Build completed successfully
[12:01:31] Uploading artifacts to S3...
[12:01:45] Deployment to blue slot successful`,
      buildDurationMs: 120000,
      slot: "blue",
      isActive: true,
      artifactPath: "sites/my-nextjs-app/deployments/3/artifact.tar.gz",
      artifactSize: 52428800,
      status: "live",
      triggeredBy: "webhook",
      deployedAt: new Date(now.getTime() - 180000),
      previewUrl: "https://my-nextjs-app-blue.preview.example.com",
    })
    .returning();
  console.log(`  Created: ${nextjsSite.name} deployment #3 (live)`);

  await db.insert(schema.deployments).values({
    id: "deployment-nextjs-2",
    siteId: nextjsSite.id,
    version: 2,
    commitSha: "111222333444555666777888999000aaabbbcccd",
    commitMessage: "fix: resolve memory leak in dashboard",
    branch: "main",
    buildStartedAt: new Date(now.getTime() - 86400000),
    buildCompletedAt: new Date(now.getTime() - 86280000),
    buildLogs: `[10:00:00] Installing dependencies...
[10:00:12] npm install completed
[10:00:13] Running build command: npm run build
[10:01:20] Build completed successfully
[10:01:21] Deploying to green slot...
[10:01:35] Deployment successful`,
    buildDurationMs: 95000,
    slot: "green",
    isActive: false,
    artifactPath: "sites/my-nextjs-app/deployments/2/artifact.tar.gz",
    artifactSize: 51380224,
    status: "live",
    triggeredBy: "manual",
    deployedAt: new Date(now.getTime() - 86280000),
  });
  console.log(`  Created: ${nextjsSite.name} deployment #2 (previous, live)`);

  await db.insert(schema.deployments).values({
    id: "deployment-nextjs-1-old",
    siteId: nextjsSite.id,
    version: 1,
    commitSha: "fffeeeddddccccbbbbaaaa999988887777666655",
    commitMessage: "initial commit",
    branch: "main",
    buildStartedAt: new Date(now.getTime() - 172800000),
    buildCompletedAt: new Date(now.getTime() - 172700000),
    buildLogs: "[Build logs truncated]",
    buildDurationMs: 100000,
    slot: "blue",
    isActive: false,
    status: "rolled_back",
    triggeredBy: "manual",
    deployedAt: new Date(now.getTime() - 172700000),
  });
  console.log(`  Created: ${nextjsSite.name} deployment #1 (rolled back)`);

  // SvelteKit site deployments
  const [sveltekitDeploymentBuilding] = await db
    .insert(schema.deployments)
    .values({
      id: "deployment-sveltekit-1",
      siteId: svelteKitSite.id,
      version: 1,
      commitSha: "bbb222ccc333ddd444eee555fff666777888999a",
      commitMessage: "feat: add real-time dashboard charts",
      branch: "develop",
      buildStartedAt: new Date(now.getTime() - 60000),
      buildLogs: `[12:05:00] Installing dependencies...
[12:05:18] npm install completed
[12:05:19] Running build command: npm run build
[12:05:45] Compiling SvelteKit application...`,
      slot: "green",
      isActive: false,
      status: "building",
      triggeredBy: "webhook",
    })
    .returning();
  console.log(`  Created: ${svelteKitSite.name} deployment #1 (building)`);

  // Failed deployment for static site
  await db.insert(schema.deployments).values({
    id: "deployment-static-1",
    siteId: staticSite.id,
    version: 1,
    commitSha: "ccc333ddd444eee555fff666777888999aaabbb0",
    commitMessage: "chore: update dependencies",
    branch: "main",
    buildStartedAt: new Date(now.getTime() - 3600000),
    buildCompletedAt: new Date(now.getTime() - 3540000),
    buildLogs: `[11:00:00] Installing dependencies...
[11:00:10] npm install completed
[11:00:11] Running build command: npm run build
[11:00:45] Error: Cannot find module 'vite'
[11:00:45] Build failed with exit code 1`,
    buildDurationMs: 60000,
    slot: "blue",
    isActive: false,
    status: "failed",
    errorMessage: "Build failed: Cannot find module 'vite'. Run npm install to fix.",
    triggeredBy: "manual",
  });
  console.log(`  Created: ${staticSite.name} deployment #1 (failed)`);

  // Update sites with active deployment IDs
  await db
    .update(schema.sites)
    .set({ activeDeploymentId: nextjsDeploymentLive.id })
    .where(eq(schema.sites.id, nextjsSite.id));

  // Create GitHub Connections
  console.log("\nCreating GitHub connections...");
  await db.insert(schema.githubConnections).values({
    id: "github-conn-nextjs-1",
    siteId: nextjsSite.id,
    installationId: 12345678,
    repositoryId: 87654321,
    repositoryFullName: "acme-corp/my-nextjs-app",
    repositoryUrl: "https://github.com/acme-corp/my-nextjs-app",
    defaultBranch: "main",
    productionBranch: "main",
    previewBranches: ["develop", "feature/*", "fix/*"],
    autoDeploy: true,
    webhookId: 11223344,
    webhookSecret: "visual-test-webhook-secret-123",
    lastSyncAt: new Date(now.getTime() - 300000),
    lastCommitSha: "abc123def456789012345678901234567890abcd",
  });
  console.log(`  Created: GitHub connection for ${nextjsSite.name}`);

  await db.insert(schema.githubConnections).values({
    id: "github-conn-sveltekit-1",
    siteId: svelteKitSite.id,
    installationId: 23456789,
    repositoryId: 98765432,
    repositoryFullName: "acme-corp/sveltekit-dashboard",
    repositoryUrl: "https://github.com/acme-corp/sveltekit-dashboard",
    defaultBranch: "main",
    productionBranch: "main",
    previewBranches: ["*"],
    autoDeploy: true,
    webhookId: 22334455,
    webhookSecret: "visual-test-webhook-secret-456",
    lastSyncAt: new Date(now.getTime() - 60000),
    lastCommitSha: "bbb222ccc333ddd444eee555fff666777888999a",
  });
  console.log(`  Created: GitHub connection for ${svelteKitSite.name}`);

  // Create Site Analytics
  console.log("\nCreating site analytics...");

  // Generate analytics for the past 7 days for the Next.js site
  const analyticsBatches = [];
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayStart = new Date(now.getTime() - dayOffset * 86400000);
    dayStart.setHours(0, 0, 0, 0);

    // Generate hourly analytics
    for (let hour = 0; hour < 24; hour++) {
      const timestamp = new Date(dayStart.getTime() + hour * 3600000);

      // Skip future hours for today
      if (timestamp > now) continue;

      // Simulate traffic patterns (more traffic during business hours)
      const isBusinessHour = hour >= 9 && hour <= 17;
      const baseMultiplier = isBusinessHour ? 3 : 1;
      const randomVariance = 0.5 + Math.random();

      const pageViews = Math.floor(100 * baseMultiplier * randomVariance);
      const uniqueVisitors = Math.floor(pageViews * 0.7);

      const geoData: GeoData = {
        US: Math.floor(pageViews * 0.45),
        GB: Math.floor(pageViews * 0.15),
        DE: Math.floor(pageViews * 0.12),
        FR: Math.floor(pageViews * 0.08),
        CA: Math.floor(pageViews * 0.07),
        AU: Math.floor(pageViews * 0.05),
        JP: Math.floor(pageViews * 0.05),
        BR: Math.floor(pageViews * 0.03),
      };

      const referrers: ReferrerData = {
        "google.com": Math.floor(pageViews * 0.35),
        "twitter.com": Math.floor(pageViews * 0.15),
        "github.com": Math.floor(pageViews * 0.12),
        "linkedin.com": Math.floor(pageViews * 0.08),
        direct: Math.floor(pageViews * 0.3),
      };

      const devices: DeviceData = {
        desktop: Math.floor(pageViews * 0.55),
        mobile: Math.floor(pageViews * 0.35),
        tablet: Math.floor(pageViews * 0.08),
        other: Math.floor(pageViews * 0.02),
      };

      const paths: PathData = {
        "/": Math.floor(pageViews * 0.3),
        "/dashboard": Math.floor(pageViews * 0.25),
        "/settings": Math.floor(pageViews * 0.15),
        "/profile": Math.floor(pageViews * 0.1),
        "/api/health": Math.floor(pageViews * 0.2),
      };

      analyticsBatches.push({
        id: `analytics-nextjs-${dayOffset}-${hour}`,
        siteId: nextjsSite.id,
        deploymentId: nextjsDeploymentLive.id,
        timestamp,
        pageViews,
        uniqueVisitors,
        avgResponseTimeMs: Math.floor(50 + Math.random() * 100),
        p95ResponseTimeMs: Math.floor(150 + Math.random() * 200),
        bytesIn: pageViews * 1024,
        bytesOut: pageViews * 51200,
        responses2xx: Math.floor(pageViews * 0.95),
        responses3xx: Math.floor(pageViews * 0.02),
        responses4xx: Math.floor(pageViews * 0.02),
        responses5xx: Math.floor(pageViews * 0.01),
        geoData,
        referrers,
        devices,
        paths,
        browsers: {
          Chrome: Math.floor(pageViews * 0.55),
          Safari: Math.floor(pageViews * 0.25),
          Firefox: Math.floor(pageViews * 0.12),
          Edge: Math.floor(pageViews * 0.05),
          Other: Math.floor(pageViews * 0.03),
        },
      });
    }
  }

  // Insert analytics in batches
  if (analyticsBatches.length > 0) {
    await db.insert(schema.siteAnalytics).values(analyticsBatches);
  }
  console.log(`  Created: ${analyticsBatches.length} analytics records for ${nextjsSite.name}`);

  await client.end();

  console.log("\n====================================");
  console.log("Database seeding complete!");
  console.log("====================================\n");
  console.log("Summary:");
  console.log("  - 2 DNS Providers (Cloudflare, Namecheap)");
  console.log("  - 3 Error Pages (503, Maintenance, Custom 500)");
  console.log("  - 4 Domains (2 active, 1 maintenance, 1 pending)");
  console.log("  - 6 Backends (distributed across domains)");
  console.log("  - 3 Maintenance Windows (1 active, 1 scheduled, 1 completed)");
  console.log("  - 1 Certificate (for app.example.com)");
  console.log("");
  console.log("Sites Extension:");
  console.log("  - 2 S3 Providers (MinIO default, AWS backup)");
  console.log("  - 3 Sites (Next.js active, SvelteKit building, Static disabled)");
  console.log("  - 5 Deployments (2 live, 1 building, 1 failed, 1 rolled back)");
  console.log("  - 2 GitHub Connections");
  console.log(`  - ${analyticsBatches.length} Analytics Records (7 days history)`);
  console.log("");
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
