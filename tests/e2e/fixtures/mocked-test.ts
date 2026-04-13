import { test as base, expect, type Route } from "@playwright/test";

type MockHandler = (url: URL, method: string, bodyText: string | null) => Promise<MockResponse | null>;

interface MockResponse {
  status?: number;
  contentType?: string;
  body?: string | Buffer;
}

const now = new Date();
const later = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

const mockState = {
  domains: [
    {
      id: "dom-1",
      hostname: "example.com",
      displayName: "Example",
      status: "active",
      sslEnabled: true,
      forceHttps: true,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      errorPageId: null,
      maintenancePageId: null,
      certificateId: "cert-1",
      configVersion: 1,
      lastConfigUpdate: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  // Sites extension mock data
  sites: [
    {
      id: "site-1",
      name: "My Next.js App",
      slug: "my-nextjs-app",
      framework: "nextjs",
      renderMode: "ssr",
      status: "active",
      buildCommand: "npm run build",
      installCommand: "npm install",
      outputDirectory: ".next",
      nodeVersion: "20",
      memoryMb: 256,
      cpuLimit: "0.5",
      timeoutSeconds: 30,
      maxConcurrency: 10,
      coldStartEnabled: true,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      envVariables: { NODE_ENV: "production" },
      buildFlags: [],
      activeDeploymentId: "deploy-1",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: "site-2",
      name: "SvelteKit Blog",
      slug: "sveltekit-blog",
      framework: "sveltekit",
      renderMode: "ssg",
      status: "building",
      buildCommand: "npm run build",
      installCommand: "npm install",
      outputDirectory: "build",
      nodeVersion: "20",
      memoryMb: 512,
      cpuLimit: "1.0",
      timeoutSeconds: 60,
      maxConcurrency: 5,
      coldStartEnabled: true,
      maintenanceEnabled: false,
      maintenanceBypassIps: [],
      envVariables: {},
      buildFlags: [],
      activeDeploymentId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  deployments: [
    {
      id: "deploy-1",
      siteId: "site-1",
      version: 3,
      slot: "blue",
      branch: "main",
      commitSha: "abc123def456",
      commitMessage: "feat: add new feature",
      status: "live",
      isActive: true,
      triggeredBy: "manual",
      buildLogs: "[12:00:00] Starting build...\n[12:01:00] Build complete",
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: "deploy-2",
      siteId: "site-1",
      version: 2,
      slot: "green",
      branch: "main",
      commitSha: "xyz789abc012",
      commitMessage: "fix: bug fix",
      status: "live",
      isActive: false,
      triggeredBy: "webhook",
      buildLogs: "[11:00:00] Starting build...\n[11:01:00] Build complete",
      startedAt: later(-1),
      completedAt: later(-1),
      createdAt: later(-1),
      updatedAt: later(-1),
    },
    {
      id: "deploy-3",
      siteId: "site-2",
      version: 1,
      slot: "blue",
      branch: "main",
      commitSha: "def456ghi789",
      commitMessage: "Initial deployment",
      status: "building",
      isActive: false,
      triggeredBy: "manual",
      buildLogs: "[12:00:00] Starting build...\n[12:00:30] Installing dependencies...",
      startedAt: now.toISOString(),
      completedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  githubConnections: [
    {
      id: "gh-1",
      siteId: "site-1",
      installationId: 12345678,
      repositoryId: 87654321,
      repositoryFullName: "my-org/my-nextjs-app",
      repositoryUrl: "https://github.com/my-org/my-nextjs-app",
      productionBranch: "main",
      previewBranches: ["*"],
      defaultBranch: "main",
      autoDeploy: true,
      lastSyncAt: now.toISOString(),
      lastCommitSha: "abc123def456",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  s3Providers: [
    {
      id: "s3-1",
      name: "MinIO Local",
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "sites-artifacts",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      isDefault: true,
      usedForBuildCache: true,
      usedForArtifacts: true,
      lastValidated: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  siteAnalytics: [
    {
      id: "analytics-1",
      siteId: "site-1",
      timestamp: now.toISOString(),
      pageViews: 1500,
      uniqueVisitors: 850,
      avgResponseTimeMs: 145,
      p95ResponseTimeMs: 320,
      bytesIn: 512000,
      bytesOut: 25600000,
      responses2xx: 1450,
      responses3xx: 25,
      responses4xx: 20,
      responses5xx: 5,
      geoData: { US: 500, GB: 200, DE: 100, FR: 50 },
      referrers: { "google.com": 400, "twitter.com": 200, direct: 250 },
      devices: { desktop: 600, mobile: 200, tablet: 50, other: 0 },
      paths: { "/": 500, "/dashboard": 300, "/settings": 200 },
      browsers: { Chrome: 500, Safari: 200, Firefox: 100, Edge: 50 },
    },
  ],
  backends: [
    {
      id: "be-1",
      domainId: "dom-1",
      name: "Primary",
      address: "test-backend",
      port: 80,
      protocol: "http",
      weight: 1,
      maxConnections: null,
      loadBalanceMethod: "roundrobin",
      healthCheckEnabled: true,
      healthCheckPath: "/health",
      healthCheckInterval: 10,
      healthCheckTimeout: 5,
      healthCheckFallThreshold: 3,
      healthCheckRiseThreshold: 2,
      isHealthy: true,
      lastHealthCheck: now.toISOString(),
      lastHealthError: null,
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  certificates: [
    {
      id: "cert-1",
      domainId: "dom-1",
      commonName: "example.com",
      altNames: ["www.example.com"],
      status: "active",
      lastError: null,
      certPath: "/etc/ssl/example.crt",
      keyPath: "/etc/ssl/example.key",
      chainPath: null,
      fullchainPath: null,
      issuedAt: now.toISOString(),
      expiresAt: later(15),
      autoRenew: true,
      renewBeforeDays: 30,
      lastRenewalAttempt: null,
      nextRenewalCheck: later(10),
      renewalAttempts: 0,
      dnsProviderId: "dns-1",
      fingerprint: "AB:CD",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  dnsProviders: [
    {
      id: "dns-1",
      name: "Cloudflare",
      type: "cloudflare",
      credentials: {
        apiToken: "token",
      },
      isDefault: true,
      lastValidated: now.toISOString(),
      validationError: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  errorPages: [
    {
      id: "err-1",
      name: "Default 502",
      type: "502",
      httpStatusCode: 502,
      description: "Default error page for bad gateway",
      directoryPath: "/data/error-pages/err-1",
      entryFile: "index.html",
      originalZipName: "502-page.zip",
      uploadedAt: now.toISOString(),
      fileSize: 15000,
      fileCount: 3,
      previewImagePath: "err-1/preview.png",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: "err-2",
      name: "Custom 404",
      type: "404",
      httpStatusCode: 404,
      description: "Not found page",
      directoryPath: "/data/error-pages/err-2",
      entryFile: "index.html",
      originalZipName: "404-page.zip",
      uploadedAt: now.toISOString(),
      fileSize: 12000,
      fileCount: 2,
      previewImagePath: "err-2/preview.png",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: "err-3",
      name: "No Upload Error Page",
      type: "503",
      httpStatusCode: 503,
      description: "Page without uploaded files",
      directoryPath: "/data/error-pages/err-3",
      entryFile: "index.html",
      originalZipName: null,
      uploadedAt: null,
      fileSize: null,
      fileCount: null,
      previewImagePath: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  maintenancePages: [
    {
      id: "maint-1",
      name: "Default Maintenance",
      type: "maintenance",
      httpStatusCode: 503,
      description: "Standard maintenance page",
      directoryPath: "/data/error-pages/maint-1",
      entryFile: "index.html",
      originalZipName: "maintenance.zip",
      uploadedAt: now.toISOString(),
      fileSize: 20000,
      fileCount: 4,
      previewImagePath: "maint-1/preview.png",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: "maint-2",
      name: "Scheduled Outage",
      type: "maintenance",
      httpStatusCode: 503,
      description: "For scheduled maintenance windows",
      directoryPath: "/data/error-pages/maint-2",
      entryFile: "index.html",
      originalZipName: null,
      uploadedAt: null,
      fileSize: null,
      fileCount: null,
      previewImagePath: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
  maintenanceWindows: [
    {
      id: "mw-1",
      domainId: "dom-1",
      title: "Routine maintenance",
      reason: "Updates",
      status: "scheduled",
      scheduledStartAt: later(1),
      scheduledEndAt: later(1.5),
      actualStartAt: null,
      actualEndAt: null,
      triggeredBy: "admin",
      bypassIps: ["1.1.1.1"],
      notifyOnStart: false,
      notifyOnEnd: false,
      notificationWebhook: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
};

const jsonResponse = (data: unknown, status = 200): MockResponse => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(data),
});

const textResponse = (text: string, status = 200): MockResponse => ({
  status,
  contentType: "text/plain",
  body: text,
});

const ONE_BY_ONE_TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const pngResponse = (): MockResponse => ({
  status: 200,
  contentType: "image/png",
  body: Buffer.from(ONE_BY_ONE_TRANSPARENT_PNG_BASE64, "base64"),
});

const allErrorLikePages = () => [...mockState.errorPages, ...mockState.maintenancePages];

const findErrorLikePage = (id: string) => allErrorLikePages().find((p) => p.id === id);

const handlers: MockHandler[] = [
  async (url, method, bodyText) => {
    if (url.pathname === "/api/stats/dashboard" && method === "GET") {
      const domainsActive = mockState.domains.filter((d) => d.status === "active").length;
      const domainsPending = mockState.domains.filter((d) => d.status === "pending").length;
      const domainsError = mockState.domains.filter((d) => d.status === "error").length;

      const certActive = mockState.certificates.filter((c) => c.status === "active").length;
      const certPending = mockState.certificates.filter((c) => c.status === "pending").length;
      const certExpired = mockState.certificates.filter((c) => c.status === "expired").length;
      const certFailed = mockState.certificates.filter((c) => c.status === "failed").length;

      const backendsHealthy = mockState.backends.filter((b) => b.isHealthy).length;
      const backendsUnhealthy = mockState.backends.length - backendsHealthy;

      const maintenanceActive = mockState.domains.filter((d) => d.maintenanceEnabled).length;

      return jsonResponse({
        domains: {
          total: mockState.domains.length,
          active: domainsActive,
          pending: domainsPending,
          disabled: mockState.domains.length - domainsActive - domainsPending - domainsError,
          error: domainsError,
        },
        certificates: {
          total: mockState.certificates.length,
          active: certActive,
          pending: certPending,
          expired: certExpired,
          failed: certFailed,
        },
        backends: {
          total: mockState.backends.length,
          healthy: backendsHealthy,
          unhealthy: backendsUnhealthy,
        },
        maintenance: {
          domainsInMaintenance: maintenanceActive,
          scheduledWindows: mockState.maintenanceWindows.length,
        },
      });
    }
    return null;
  },
  async (url, method, bodyText) => {
    if (url.pathname === "/api/domains") {
      if (method === "GET") {
        return jsonResponse({ domains: mockState.domains });
      }

      if (method === "POST" && bodyText) {
        const body = JSON.parse(bodyText) as { hostname: string; displayName?: string; sslEnabled?: boolean; forceHttps?: boolean };
        const domain = {
          id: `dom-${mockState.domains.length + 1}`,
          hostname: body.hostname,
          displayName: body.displayName ?? null,
          status: "active",
          sslEnabled: body.sslEnabled ?? true,
          forceHttps: body.forceHttps ?? true,
          maintenanceEnabled: false,
          maintenanceBypassIps: [],
          errorPageId: null,
          maintenancePageId: null,
          certificateId: null,
          configVersion: 1,
          lastConfigUpdate: now.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        mockState.domains.push(domain);
        return jsonResponse({ domain }, 201);
      }
    }

    const domainDetail = url.pathname.match(/^\/api\/domains\/(?<id>[^/]+)$/);
    if (domainDetail && method === "GET") {
      const domain = mockState.domains.find((d) => d.id === domainDetail.groups!.id);
      return jsonResponse({ domain });
    }

    return null;
  },
  async (url, method) => {
    if (url.pathname === "/api/backends" && method === "GET") {
      const domainId = url.searchParams.get("domainId");
      const backends = domainId
        ? mockState.backends.filter((b) => b.domainId === domainId)
        : mockState.backends;
      return jsonResponse({ backends });
    }
    return null;
  },
  async (url, method) => {
    if (url.pathname === "/api/certificates" && method === "GET") {
      return jsonResponse({ certificates: mockState.certificates });
    }
    return null;
  },
  async (url, method) => {
    if (url.pathname === "/api/dns-providers") {
      if (method === "GET") {
        return jsonResponse({ providers: mockState.dnsProviders });
      }
      if (method === "POST") {
        return jsonResponse({ provider: { ...mockState.dnsProviders[0] } }, 201);
      }
    }
    return null;
  },
  // Error pages handlers (including maintenance pages in unified API)
  async (url, method, bodyText) => {
    // GET /api/error-pages - List all pages (error + maintenance)
    if (url.pathname === "/api/error-pages" && method === "GET") {
      return jsonResponse({ errorPages: allErrorLikePages() });
    }

    // POST /api/error-pages - Create error page
    if (url.pathname === "/api/error-pages" && method === "POST" && bodyText) {
      const body = JSON.parse(bodyText) as { name: string; type: string; httpStatusCode?: number; description?: string };
      const isMaintenance = body.type === "maintenance";
      const nextIndex = isMaintenance ? mockState.maintenancePages.length + 1 : mockState.errorPages.length + 1;
      const createdPage = {
        id: isMaintenance ? `maint-${nextIndex}` : `err-${nextIndex}`,
        name: body.name,
        type: body.type,
        httpStatusCode:
          body.httpStatusCode || (body.type === "maintenance" ? 503 : body.type === "custom" ? 500 : parseInt(body.type)),
        description: body.description || null,
        directoryPath: `/data/error-pages/${isMaintenance ? `maint-${nextIndex}` : `err-${nextIndex}`}`,
        entryFile: "index.html",
        originalZipName: null,
        uploadedAt: null,
        fileSize: null,
        fileCount: null,
        previewImagePath: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (isMaintenance) {
        mockState.maintenancePages.push(createdPage);
      } else {
        mockState.errorPages.push(createdPage);
      }
      return jsonResponse({ errorPage: createdPage }, 201);
    }

    // GET /api/error-pages/:id - Get single error page
    const errorPageDetail = url.pathname.match(/^\/api\/error-pages\/(?<id>[^/]+)$/);
    if (errorPageDetail && method === "GET") {
      const errorPage = findErrorLikePage(errorPageDetail.groups!.id);
      if (!errorPage) {
        return jsonResponse({ error: "Error page not found" }, 404);
      }
      return jsonResponse({ errorPage });
    }

    // DELETE /api/error-pages/:id
    if (errorPageDetail && method === "DELETE") {
      const pageId = errorPageDetail.groups!.id;
      const errorIndex = mockState.errorPages.findIndex((p) => p.id === pageId);
      const maintenanceIndex = mockState.maintenancePages.findIndex((p) => p.id === pageId);
      if (errorIndex !== -1) {
        mockState.errorPages.splice(errorIndex, 1);
      } else if (maintenanceIndex !== -1) {
        mockState.maintenancePages.splice(maintenanceIndex, 1);
      } else {
        return jsonResponse({ error: "Error page not found" }, 404);
      }
      return jsonResponse({ success: true });
    }

    // POST /api/error-pages/:id/upload - Upload files
    const uploadMatch = url.pathname.match(/^\/api\/error-pages\/(?<id>[^/]+)\/upload$/);
    if (uploadMatch && method === "POST") {
      const errorPage = findErrorLikePage(uploadMatch.groups!.id);
      if (!errorPage) {
        return jsonResponse({ error: "Error page not found" }, 404);
      }
      // Simulate successful upload
      errorPage.uploadedAt = now.toISOString();
      errorPage.originalZipName = "uploaded.zip";
      errorPage.fileSize = 10000;
      errorPage.fileCount = 3;
      errorPage.previewImagePath = `${errorPage.id}/preview.png`;
      errorPage.updatedAt = now.toISOString();
      return jsonResponse({ success: true, errorPage });
    }

    // GET /api/error-pages/:id/preview.png - Serve preview
    const previewMatch = url.pathname.match(/^\/api\/error-pages\/(?<id>[^/]+)\/preview\.png$/);
    if (previewMatch && method === "GET") {
      const errorPage = findErrorLikePage(previewMatch.groups!.id);
      if (!errorPage || !errorPage.previewImagePath) {
        return jsonResponse({ error: "Preview not found" }, 404);
      }
      return pngResponse();
    }

    // POST /api/error-pages/:id/regenerate-preview
    const regenerateMatch = url.pathname.match(/^\/api\/error-pages\/(?<id>[^/]+)\/regenerate-preview$/);
    if (regenerateMatch && method === "POST") {
      const errorPage = findErrorLikePage(regenerateMatch.groups!.id);
      if (!errorPage) {
        return jsonResponse({ error: "Error page not found" }, 404);
      }
      if (!errorPage.uploadedAt) {
        return jsonResponse({ error: "No files uploaded" }, 400);
      }
      errorPage.previewImagePath = `${errorPage.id}/preview.png`;
      errorPage.updatedAt = now.toISOString();
      return jsonResponse({ success: true, errorPage });
    }

    return null;
  },
  // Maintenance pages handlers
  async (url, method, bodyText) => {
    // GET /api/maintenance-pages - List maintenance pages only
    if (url.pathname === "/api/maintenance-pages" && method === "GET") {
      return jsonResponse({ maintenancePages: mockState.maintenancePages });
    }

    // POST /api/maintenance-pages - Create maintenance page
    if (url.pathname === "/api/maintenance-pages" && method === "POST" && bodyText) {
      const body = JSON.parse(bodyText) as { name: string; description?: string };
      const maintenancePage = {
        id: `maint-${mockState.maintenancePages.length + 1}`,
        name: body.name,
        type: "maintenance",
        httpStatusCode: 503,
        description: body.description || null,
        directoryPath: `/data/error-pages/maint-${mockState.maintenancePages.length + 1}`,
        entryFile: "index.html",
        originalZipName: null,
        uploadedAt: null,
        fileSize: null,
        fileCount: null,
        previewImagePath: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      mockState.maintenancePages.push(maintenancePage);
      return jsonResponse({ maintenancePage }, 201);
    }

    // GET /api/maintenance-pages/:id
    const maintPageDetail = url.pathname.match(/^\/api\/maintenance-pages\/(?<id>[^/]+)$/);
    if (maintPageDetail && method === "GET") {
      const maintenancePage = mockState.maintenancePages.find((p) => p.id === maintPageDetail.groups!.id);
      if (!maintenancePage) {
        return jsonResponse({ error: "Maintenance page not found" }, 404);
      }
      return jsonResponse({ maintenancePage });
    }

    // DELETE /api/maintenance-pages/:id
    if (maintPageDetail && method === "DELETE") {
      const index = mockState.maintenancePages.findIndex((p) => p.id === maintPageDetail.groups!.id);
      if (index === -1) {
        return jsonResponse({ error: "Maintenance page not found" }, 404);
      }
      mockState.maintenancePages.splice(index, 1);
      return jsonResponse({ success: true });
    }

    // POST /api/maintenance-pages/:id/upload
    const maintUploadMatch = url.pathname.match(/^\/api\/maintenance-pages\/(?<id>[^/]+)\/upload$/);
    if (maintUploadMatch && method === "POST") {
      const maintenancePage = mockState.maintenancePages.find((p) => p.id === maintUploadMatch.groups!.id);
      if (!maintenancePage) {
        return jsonResponse({ error: "Maintenance page not found" }, 404);
      }
      maintenancePage.uploadedAt = now.toISOString();
      maintenancePage.originalZipName = "uploaded.zip";
      maintenancePage.fileSize = 15000;
      maintenancePage.fileCount = 4;
      maintenancePage.previewImagePath = `${maintenancePage.id}/preview.png`;
      maintenancePage.updatedAt = now.toISOString();
      return jsonResponse({ success: true, maintenancePage });
    }

    // GET /api/maintenance-pages/:id/preview.png
    const maintPreviewMatch = url.pathname.match(/^\/api\/maintenance-pages\/(?<id>[^/]+)\/preview\.png$/);
    if (maintPreviewMatch && method === "GET") {
      const maintenancePage = mockState.maintenancePages.find((p) => p.id === maintPreviewMatch.groups!.id);
      if (!maintenancePage || !maintenancePage.previewImagePath) {
        return jsonResponse({ error: "Preview not found" }, 404);
      }
      return pngResponse();
    }

    // POST /api/maintenance-pages/:id/regenerate-preview
    const maintRegenerateMatch = url.pathname.match(/^\/api\/maintenance-pages\/(?<id>[^/]+)\/regenerate-preview$/);
    if (maintRegenerateMatch && method === "POST") {
      const maintenancePage = mockState.maintenancePages.find((p) => p.id === maintRegenerateMatch.groups!.id);
      if (!maintenancePage) {
        return jsonResponse({ error: "Maintenance page not found" }, 404);
      }
      if (!maintenancePage.uploadedAt) {
        return jsonResponse({ error: "No files uploaded" }, 400);
      }
      maintenancePage.previewImagePath = `${maintenancePage.id}/preview.png`;
      maintenancePage.updatedAt = now.toISOString();
      return jsonResponse({ success: true, maintenancePage });
    }

    return null;
  },
  async (url, method, bodyText) => {
    if (url.pathname === "/api/maintenance/windows" && method === "GET") {
      const domainId = url.searchParams.get("domainId");
      const active = url.searchParams.get("active");
      let windows = [...mockState.maintenanceWindows];
      if (domainId) {
        windows = windows.filter((w) => w.domainId === domainId);
      }
      if (active === "true") {
        windows = windows.filter((w) => w.status === "scheduled" || w.status === "active");
      }
      return jsonResponse({ windows });
    }

    if (url.pathname === "/api/maintenance/windows" && method === "POST" && bodyText) {
      const data = JSON.parse(bodyText) as { domainId: string; title?: string; scheduledStartAt: string; scheduledEndAt?: string };
      const window = {
        id: `mw-${mockState.maintenanceWindows.length + 1}`,
        domainId: data.domainId,
        title: data.title ?? "Maintenance",
        reason: data.title ?? null,
        status: "scheduled",
        scheduledStartAt: data.scheduledStartAt,
        scheduledEndAt: data.scheduledEndAt ?? later(1),
        actualStartAt: null,
        actualEndAt: null,
        triggeredBy: "tests",
        bypassIps: [],
        notifyOnStart: false,
        notifyOnEnd: false,
        notificationWebhook: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      mockState.maintenanceWindows.push(window);
      return jsonResponse({ window }, 201);
    }

    const statusMatch = url.pathname.match(/^\/api\/maintenance\/domains\/(?<id>[^/]+)$/);
    if (statusMatch && method === "GET") {
      const domain = mockState.domains.find((d) => d.id === statusMatch.groups!.id);
      return jsonResponse({
        maintenanceEnabled: domain?.maintenanceEnabled ?? false,
        bypassIps: domain?.maintenanceBypassIps ?? [],
      });
    }

    const enableMatch = url.pathname.match(/^\/api\/maintenance\/domains\/(?<id>[^/]+)\/enable$/);
    if (enableMatch && method === "POST") {
      const domain = mockState.domains.find((d) => d.id === enableMatch.groups!.id);
      if (domain) {
        domain.maintenanceEnabled = true;
      }
      return jsonResponse({ success: true, window: mockState.maintenanceWindows[0] });
    }

    const disableMatch = url.pathname.match(/^\/api\/maintenance\/domains\/(?<id>[^/]+)\/disable$/);
    if (disableMatch && method === "POST") {
      const domain = mockState.domains.find((d) => d.id === disableMatch.groups!.id);
      if (domain) {
        domain.maintenanceEnabled = false;
      }
      return jsonResponse({ success: true });
    }

    const bypassMatch = url.pathname.match(/^\/api\/maintenance\/domains\/(?<id>[^/]+)\/bypass-ips$/);
    if (bypassMatch && method === "PUT" && bodyText) {
      const data = JSON.parse(bodyText) as { bypassIps: string[] };
      const domain = mockState.domains.find((d) => d.id === bypassMatch.groups!.id);
      if (domain) {
        domain.maintenanceBypassIps = data.bypassIps;
      }
      return jsonResponse({ success: true });
    }

    return null;
  },
  async (url, method) => {
    if (url.pathname === "/api/haproxy/status" && method === "GET") {
      return jsonResponse({
        status: "running",
        configExists: true,
        pid: 1234,
        uptime: "2h 15m",
      });
    }
    if (url.pathname === "/api/haproxy/reload" && method === "POST") {
      return jsonResponse({ success: true, changed: true, message: "Reloaded" });
    }
    if (url.pathname === "/api/haproxy/config" && method === "GET") {
      return textResponse("# mock haproxy config\nfrontend http_front\n  bind *:80\n");
    }
    if (url.pathname === "/api/haproxy/config/preview" && method === "GET") {
      return textResponse("# preview config\nfrontend https_front\n  bind *:443 ssl\n");
    }
    return null;
  },
  // Sites extension handlers
  async (url, method, bodyText) => {
    const withSiteComputedFields = (site: (typeof mockState.sites)[number]) => {
      const deployments = mockState.deployments
        .filter((d) => d.siteId === site.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const activeDeployment = deployments.find((d) => d.isActive);
      const latestDeployment = deployments[0];

      return {
        ...site,
        deployments,
        activeSlot: activeDeployment?.slot ?? null,
        activeVersion: activeDeployment?.version ?? null,
        latestDeployment: latestDeployment
          ? {
              ...latestDeployment,
              buildDurationMs: latestDeployment.buildDurationMs ?? null,
              deployedAt: latestDeployment.completedAt ?? null,
            }
          : null,
      };
    };

    // GET /api/sites - List all sites
    if (url.pathname === "/api/sites" && method === "GET") {
      const status = url.searchParams.get("status");
      const framework = url.searchParams.get("framework");
      let sites = [...mockState.sites];
      if (status) {
        sites = sites.filter((s) => s.status === status);
      }
      if (framework) {
        sites = sites.filter((s) => s.framework === framework);
      }
      return jsonResponse({ sites: sites.map(withSiteComputedFields) });
    }

    // POST /api/sites - Create new site
    if (url.pathname === "/api/sites" && method === "POST" && bodyText) {
      const body = JSON.parse(bodyText) as { name: string; slug: string; framework?: string; renderMode?: string };
      const site = {
        id: `site-${mockState.sites.length + 1}`,
        name: body.name,
        slug: body.slug,
        framework: body.framework || "nextjs",
        renderMode: body.renderMode || "ssr",
        status: "disabled",
        buildCommand: "npm run build",
        installCommand: "npm install",
        outputDirectory: ".next",
        nodeVersion: "20",
        memoryMb: 256,
        cpuLimit: "0.5",
        timeoutSeconds: 30,
        maxConcurrency: 10,
        coldStartEnabled: true,
        maintenanceEnabled: false,
        maintenanceBypassIps: [],
        envVariables: {},
        buildFlags: [],
        activeDeploymentId: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      mockState.sites.push(site);
      return jsonResponse({ site }, 201);
    }

    const siteEnvMatch = url.pathname.match(/^\/api\/sites\/(?<id>[^/]+)\/env$/);
    if (siteEnvMatch && method === "GET") {
      const site = mockState.sites.find((s) => s.id === siteEnvMatch.groups!.id);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }

      const maskedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(site.envVariables || {})) {
        if (
          key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("password") ||
          key.toLowerCase().includes("key") ||
          key.toLowerCase().includes("token")
        ) {
          maskedEnv[key] = "********";
        } else {
          maskedEnv[key] = value;
        }
      }

      return jsonResponse({
        envVariables: maskedEnv,
        count: Object.keys(site.envVariables || {}).length,
      });
    }

    if (siteEnvMatch && method === "PUT" && bodyText) {
      const site = mockState.sites.find((s) => s.id === siteEnvMatch.groups!.id);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }

      const body = JSON.parse(bodyText) as { envVariables?: Record<string, string> };
      site.envVariables = body.envVariables || {};
      site.updatedAt = now.toISOString();

      return jsonResponse({
        success: true,
        count: Object.keys(site.envVariables).length,
      });
    }

    // GET /api/sites/:id - Get site details
    const siteDetail = url.pathname.match(/^\/api\/sites\/(?<id>[^/]+)$/);
    if (siteDetail && method === "GET") {
      const site = mockState.sites.find((s) => s.id === siteDetail.groups!.id);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }
      return jsonResponse({ site: withSiteComputedFields(site) });
    }

    // PUT /api/sites/:id - Update site
    if (siteDetail && method === "PUT" && bodyText) {
      const site = mockState.sites.find((s) => s.id === siteDetail.groups!.id);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }
      const updates = JSON.parse(bodyText);
      Object.assign(site, updates, { updatedAt: now.toISOString() });
      return jsonResponse({ site });
    }

    // DELETE /api/sites/:id - Delete site
    if (siteDetail && method === "DELETE") {
      const index = mockState.sites.findIndex((s) => s.id === siteDetail.groups!.id);
      if (index === -1) {
        return jsonResponse({ error: "Site not found" }, 404);
      }
      mockState.sites.splice(index, 1);
      return jsonResponse({ success: true });
    }

    return null;
  },
  // Deployments handlers
  async (url, method, bodyText) => {
    const createDeployment = (siteId: string, overrides: Partial<typeof mockState.deployments[number]> = {}) => {
      const siteDeployments = mockState.deployments.filter((d) => d.siteId === siteId);
      const lastDeployment = siteDeployments.sort((a, b) => b.version - a.version)[0];
      const deployment = {
        id: `deploy-${mockState.deployments.length + 1}`,
        siteId,
        version: (lastDeployment?.version || 0) + 1,
        slot: lastDeployment?.slot === "blue" ? "green" : "blue",
        branch: "main",
        commitSha: `sha-${Date.now()}`,
        commitMessage: "Manual deployment",
        status: "live",
        isActive: true,
        triggeredBy: "manual",
        buildLogs: "[12:00:00] Starting build...\n[12:01:00] Build complete",
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ...overrides,
      };

      mockState.deployments
        .filter((d) => d.siteId === siteId)
        .forEach((d) => {
          d.isActive = false;
        });
      mockState.deployments.push(deployment);

      const site = mockState.sites.find((s) => s.id === siteId);
      if (site) {
        site.activeDeploymentId = deployment.id;
        site.status = deployment.status === "failed" ? "error" : "active";
        site.updatedAt = now.toISOString();
      }

      return deployment;
    };

    // Modern deployment endpoints used by current web app
    const modernDeployMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/deploy$/);
    if (modernDeployMatch && method === "POST") {
      const siteId = modernDeployMatch.groups!.siteId;
      const site = mockState.sites.find((s) => s.id === siteId);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }

      const deployment = createDeployment(siteId, { triggeredBy: "manual", commitMessage: "Manual deployment" });
      return jsonResponse({ deployment, message: "Deployment started" }, 201);
    }

    const modernUploadMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/upload$/);
    if (modernUploadMatch && method === "POST") {
      const siteId = modernUploadMatch.groups!.siteId;
      const site = mockState.sites.find((s) => s.id === siteId);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }

      const deployment = createDeployment(siteId, {
        triggeredBy: "manual",
        commitMessage: "Uploaded deployment archive",
      });
      return jsonResponse({ deployment, message: "Upload deployment started" }, 201);
    }

    if (url.pathname === "/api/deployments" && method === "GET") {
      const siteId = url.searchParams.get("siteId");
      const deployments = siteId
        ? mockState.deployments.filter((d) => d.siteId === siteId)
        : mockState.deployments;
      return jsonResponse({ deployments });
    }

    const deploymentByIdMatch = url.pathname.match(/^\/api\/deployments\/(?<deploymentId>[^/]+)$/);
    if (deploymentByIdMatch && method === "GET") {
      const deployment = mockState.deployments.find((d) => d.id === deploymentByIdMatch.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      return jsonResponse({ deployment });
    }

    if (deploymentByIdMatch && method === "DELETE") {
      const deploymentId = deploymentByIdMatch.groups!.deploymentId;
      const index = mockState.deployments.findIndex((d) => d.id === deploymentId);
      if (index === -1) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      mockState.deployments.splice(index, 1);
      return jsonResponse({ message: "Deployment deleted", deploymentId });
    }

    const deploymentLogsMatch = url.pathname.match(/^\/api\/deployments\/(?<deploymentId>[^/]+)\/logs$/);
    if (deploymentLogsMatch && method === "GET") {
      const deployment = mockState.deployments.find((d) => d.id === deploymentLogsMatch.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      return jsonResponse({
        logs: deployment.buildLogs || "",
        status: deployment.status,
        complete: deployment.status !== "pending" && deployment.status !== "building" && deployment.status !== "deploying",
      });
    }

    const modernCancelMatch = url.pathname.match(/^\/api\/deployments\/(?<deploymentId>[^/]+)\/cancel$/);
    if (modernCancelMatch && method === "POST") {
      const deployment = mockState.deployments.find((d) => d.id === modernCancelMatch.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      deployment.status = "cancelled";
      deployment.updatedAt = now.toISOString();
      return jsonResponse({ deployment, message: "Deployment cancelled" });
    }

    const modernPromoteMatch = url.pathname.match(/^\/api\/deployments\/(?<deploymentId>[^/]+)\/promote$/);
    if (modernPromoteMatch && method === "POST") {
      const deployment = mockState.deployments.find((d) => d.id === modernPromoteMatch.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      mockState.deployments
        .filter((d) => d.siteId === deployment.siteId)
        .forEach((d) => {
          d.isActive = d.id === deployment.id;
        });
      const site = mockState.sites.find((s) => s.id === deployment.siteId);
      if (site) {
        site.activeDeploymentId = deployment.id;
      }
      return jsonResponse({ deployment, message: "Deployment promoted" });
    }

    const modernRetryMatch = url.pathname.match(/^\/api\/deployments\/(?<deploymentId>[^/]+)\/retry$/);
    if (modernRetryMatch && method === "POST") {
      const source = mockState.deployments.find((d) => d.id === modernRetryMatch.groups!.deploymentId);
      if (!source) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      const deployment = createDeployment(source.siteId, {
        branch: source.branch,
        commitSha: source.commitSha,
        commitMessage: `Retry: ${source.commitMessage}`,
        triggeredBy: "manual",
      });
      return jsonResponse({ message: "Retry started", deploymentId: deployment.id });
    }

    const modernRedeployMatch = url.pathname.match(/^\/api\/deployments\/(?<deploymentId>[^/]+)\/redeploy$/);
    if (modernRedeployMatch && method === "POST") {
      const source = mockState.deployments.find((d) => d.id === modernRedeployMatch.groups!.deploymentId);
      if (!source) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      const deployment = createDeployment(source.siteId, {
        branch: source.branch,
        commitSha: source.commitSha,
        commitMessage: `Redeploy: ${source.commitMessage}`,
        triggeredBy: "manual",
      });
      return jsonResponse({ message: "Redeploy started", deploymentId: deployment.id });
    }

    const modernRollbackMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/rollback\/(?<deploymentId>[^/]+)$/);
    if (modernRollbackMatch && method === "POST") {
      const siteId = modernRollbackMatch.groups!.siteId;
      const deploymentId = modernRollbackMatch.groups!.deploymentId;
      const deployment = mockState.deployments.find((d) => d.id === deploymentId && d.siteId === siteId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }

      mockState.deployments
        .filter((d) => d.siteId === siteId)
        .forEach((d) => {
          d.isActive = d.id === deployment.id;
        });
      const site = mockState.sites.find((s) => s.id === siteId);
      if (site) {
        site.activeDeploymentId = deployment.id;
      }
      return jsonResponse({ deployment, message: "Site rolled back successfully" });
    }

    // GET /api/sites/:siteId/deployments - List deployments
    const deploymentsMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/deployments$/);
    if (deploymentsMatch && method === "GET") {
      const siteId = deploymentsMatch.groups!.siteId;
      const status = url.searchParams.get("status");
      let deployments = mockState.deployments.filter((d) => d.siteId === siteId);
      if (status) {
        deployments = deployments.filter((d) => d.status === status);
      }
      return jsonResponse({
        deployments,
        pagination: { total: deployments.length, page: 1, limit: 20 },
      });
    }

    // POST /api/sites/:siteId/deployments - Trigger deployment
    if (deploymentsMatch && method === "POST" && bodyText) {
      const siteId = deploymentsMatch.groups!.siteId;
      const site = mockState.sites.find((s) => s.id === siteId);
      if (!site) {
        return jsonResponse({ error: "Site not found" }, 404);
      }
      const body = JSON.parse(bodyText) as { branch?: string; commitSha?: string; commitMessage?: string };
      const lastDeployment = mockState.deployments.filter((d) => d.siteId === siteId).sort((a, b) => b.version - a.version)[0];
      const deployment = {
        id: `deploy-${mockState.deployments.length + 1}`,
        siteId,
        version: (lastDeployment?.version || 0) + 1,
        slot: lastDeployment?.slot === "blue" ? "green" : "blue",
        branch: body.branch || "main",
        commitSha: body.commitSha || `sha-${Date.now()}`,
        commitMessage: body.commitMessage || "Manual deployment",
        status: "pending",
        isActive: false,
        triggeredBy: "manual",
        buildLogs: "[00:00:00] Deployment queued...",
        startedAt: now.toISOString(),
        completedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      mockState.deployments.push(deployment);
      return jsonResponse({ deployment }, 201);
    }

    // GET /api/sites/:siteId/deployments/:deploymentId - Get deployment details
    const deploymentDetail = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/deployments\/(?<deploymentId>[^/]+)$/);
    if (deploymentDetail && method === "GET") {
      const deployment = mockState.deployments.find((d) => d.id === deploymentDetail.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      return jsonResponse({ deployment });
    }

    // POST /api/sites/:siteId/deployments/:deploymentId/cancel
    const cancelMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/deployments\/(?<deploymentId>[^/]+)\/cancel$/);
    if (cancelMatch && method === "POST") {
      const deployment = mockState.deployments.find((d) => d.id === cancelMatch.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      if (deployment.status === "live") {
        return jsonResponse({ error: "Cannot cancel live deployment" }, 400);
      }
      deployment.status = "cancelled";
      deployment.updatedAt = now.toISOString();
      return jsonResponse({ deployment });
    }

    // POST /api/sites/:siteId/deployments/:deploymentId/promote
    const promoteMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/deployments\/(?<deploymentId>[^/]+)\/promote$/);
    if (promoteMatch && method === "POST") {
      const siteId = promoteMatch.groups!.siteId;
      const deployment = mockState.deployments.find((d) => d.id === promoteMatch.groups!.deploymentId);
      const site = mockState.sites.find((s) => s.id === siteId);
      if (!deployment || !site) {
        return jsonResponse({ error: "Not found" }, 404);
      }
      // Deactivate previous active deployment
      mockState.deployments.filter((d) => d.siteId === siteId && d.isActive).forEach((d) => {
        d.isActive = false;
      });
      deployment.isActive = true;
      site.activeDeploymentId = deployment.id;
      return jsonResponse({ deployment, site });
    }

    // GET /api/sites/:siteId/deployments/:deploymentId/logs
    const logsMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/deployments\/(?<deploymentId>[^/]+)\/logs$/);
    if (logsMatch && method === "GET") {
      const deployment = mockState.deployments.find((d) => d.id === logsMatch.groups!.deploymentId);
      if (!deployment) {
        return jsonResponse({ error: "Deployment not found" }, 404);
      }
      return jsonResponse({ logs: deployment.buildLogs || "" });
    }

    // POST /api/sites/:siteId/rollback
    const rollbackMatch = url.pathname.match(/^\/api\/sites\/(?<siteId>[^/]+)\/rollback$/);
    if (rollbackMatch && method === "POST" && bodyText) {
      const siteId = rollbackMatch.groups!.siteId;
      const body = JSON.parse(bodyText) as { deploymentId: string };
      const deployment = mockState.deployments.find((d) => d.id === body.deploymentId);
      const site = mockState.sites.find((s) => s.id === siteId);
      if (!deployment || !site) {
        return jsonResponse({ error: "Not found" }, 404);
      }
      if (deployment.status !== "live") {
        return jsonResponse({ error: "Can only rollback to live deployments" }, 400);
      }
      // Deactivate previous active deployment
      mockState.deployments.filter((d) => d.siteId === siteId && d.isActive).forEach((d) => {
        d.isActive = false;
      });
      deployment.isActive = true;
      site.activeDeploymentId = deployment.id;
      return jsonResponse({ deployment, site });
    }

    return null;
  },
  // GitHub handlers
  async (url, method, bodyText) => {
    // GET /api/github/status
    if (url.pathname === "/api/github/status" && method === "GET") {
      return jsonResponse({ configured: true, appSlug: "uni-proxy-manager" });
    }

    // GET /api/github/install
    if (url.pathname === "/api/github/install" && method === "GET") {
      return jsonResponse({
        installUrl: "https://github.com/apps/uni-proxy-manager/installations/new",
      });
    }

    // GET /api/github/installations/:installationId/repositories
    const installationReposMatch = url.pathname.match(/^\/api\/github\/installations\/(?<installationId>[^/]+)\/repositories$/);
    if (installationReposMatch && method === "GET") {
      return jsonResponse({
        repositories: [
          {
            id: 87654321,
            name: "my-nextjs-app",
            fullName: "my-org/my-nextjs-app",
            defaultBranch: "main",
            private: false,
            url: "https://github.com/my-org/my-nextjs-app",
          },
          {
            id: 87654322,
            name: "my-other-app",
            fullName: "my-org/my-other-app",
            defaultBranch: "production",
            private: true,
            url: "https://github.com/my-org/my-other-app",
          },
        ],
      });
    }

    // GET /api/github/sites/:siteId
    const githubSiteMatch = url.pathname.match(/^\/api\/github\/sites\/(?<siteId>[^/]+)$/);
    if (githubSiteMatch && method === "GET") {
      const connection = mockState.githubConnections.find((c) => c.siteId === githubSiteMatch.groups!.siteId);
      if (!connection) {
        return jsonResponse({ connected: false });
      }
      return jsonResponse({
        connected: true,
        connection: {
          id: connection.id,
          repositoryFullName: connection.repositoryFullName,
          repositoryUrl: connection.repositoryUrl,
          productionBranch: connection.productionBranch,
          previewBranches: connection.previewBranches,
          autoDeploy: connection.autoDeploy,
          lastSyncAt: connection.lastSyncAt,
          lastCommitSha: connection.lastCommitSha,
        },
      });
    }

    // POST /api/github/sites/:siteId - Connect repository
    if (githubSiteMatch && method === "POST" && bodyText) {
      const siteId = githubSiteMatch.groups!.siteId;
      const existing = mockState.githubConnections.find((c) => c.siteId === siteId);
      if (existing) {
        return jsonResponse({ error: "Site is already connected to a repository" }, 409);
      }
      const body = JSON.parse(bodyText);
      const connection = {
        id: `gh-${mockState.githubConnections.length + 1}`,
        siteId,
        installationId: body.installationId,
        repositoryId: body.repositoryId,
        repositoryFullName: body.repositoryFullName,
        repositoryUrl: body.repositoryUrl || `https://github.com/${body.repositoryFullName}`,
        productionBranch: body.productionBranch || "main",
        previewBranches: body.previewBranches || ["*"],
        defaultBranch: body.productionBranch || "main",
        autoDeploy: body.autoDeploy ?? true,
        lastSyncAt: now.toISOString(),
        lastCommitSha: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      mockState.githubConnections.push(connection);
      return jsonResponse({ connection }, 201);
    }

    // PUT /api/github/sites/:siteId - Update connection
    if (githubSiteMatch && method === "PUT" && bodyText) {
      const connection = mockState.githubConnections.find((c) => c.siteId === githubSiteMatch.groups!.siteId);
      if (!connection) {
        return jsonResponse({ error: "No GitHub connection found" }, 404);
      }
      const updates = JSON.parse(bodyText);
      Object.assign(connection, updates, { updatedAt: now.toISOString() });
      return jsonResponse({ connection });
    }

    // GET /api/github/sites/:siteId/branches
    const branchesMatch = url.pathname.match(/^\/api\/github\/sites\/(?<siteId>[^/]+)\/branches$/);
    if (branchesMatch && method === "GET") {
      const connection = mockState.githubConnections.find((c) => c.siteId === branchesMatch.groups!.siteId);
      if (!connection) {
        return jsonResponse({ error: "No GitHub connection found" }, 404);
      }
      return jsonResponse({
        branches: [
          { name: "main", protected: true },
          { name: "production", protected: true },
          { name: "develop", protected: false },
        ],
      });
    }

    // POST /api/github/sites/:siteId/sync
    const syncMatch = url.pathname.match(/^\/api\/github\/sites\/(?<siteId>[^/]+)\/sync$/);
    if (syncMatch && method === "POST") {
      const connection = mockState.githubConnections.find((c) => c.siteId === syncMatch.groups!.siteId);
      if (!connection) {
        return jsonResponse({ error: "No GitHub connection found" }, 404);
      }
      connection.lastSyncAt = now.toISOString();
      connection.lastCommitSha = "abc123def456";
      connection.updatedAt = now.toISOString();
      return jsonResponse({
        synced: true,
        latestCommit: { sha: connection.lastCommitSha, message: "feat: sync" },
      });
    }

    // DELETE /api/github/sites/:siteId - Disconnect
    if (githubSiteMatch && method === "DELETE") {
      const index = mockState.githubConnections.findIndex((c) => c.siteId === githubSiteMatch.groups!.siteId);
      if (index === -1) {
        return jsonResponse({ error: "No GitHub connection found" }, 404);
      }
      mockState.githubConnections.splice(index, 1);
      return jsonResponse({ success: true });
    }

    return null;
  },
  // Analytics handlers
  async (url, method) => {
    const analyticsMatch = url.pathname.match(/^\/api\/site-analytics\/(?<siteId>[^/]+)(\/(?<endpoint>.+))?$/);
    if (!analyticsMatch) return null;

    const siteId = analyticsMatch.groups!.siteId;
    const endpoint = analyticsMatch.groups!.endpoint;
    const site = mockState.sites.find((s) => s.id === siteId);

    if (!site) {
      return jsonResponse({ error: "Site not found" }, 404);
    }

    const analytics = mockState.siteAnalytics.filter((a) => a.siteId === siteId);
    const summary = analytics.reduce(
      (acc, record) => ({
        totalPageViews: acc.totalPageViews + record.pageViews,
        totalUniqueVisitors: acc.totalUniqueVisitors + record.uniqueVisitors,
        total2xx: acc.total2xx + record.responses2xx,
        total5xx: acc.total5xx + record.responses5xx,
        avgResponseTime: acc.avgResponseTime + record.avgResponseTimeMs,
      }),
      { totalPageViews: 0, totalUniqueVisitors: 0, total2xx: 0, total5xx: 0, avgResponseTime: 0 }
    );
    if (analytics.length > 0) {
      summary.avgResponseTime = Math.round(summary.avgResponseTime / analytics.length);
    }

    // GET /api/site-analytics/:siteId
    if (!endpoint && method === "GET") {
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString() },
        summary,
        dataPoints: analytics.length,
      });
    }

    // GET /api/site-analytics/:siteId/visitors
    if (endpoint === "visitors" && method === "GET") {
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString(), interval: "1h" },
        data: analytics.map((a) => ({
          timestamp: a.timestamp,
          pageViews: a.pageViews,
          uniqueVisitors: a.uniqueVisitors,
        })),
      });
    }

    // GET /api/site-analytics/:siteId/geography
    if (endpoint === "geography" && method === "GET") {
      const geoData: Record<string, number> = {};
      analytics.forEach((a) => {
        Object.entries(a.geoData).forEach(([country, count]) => {
          geoData[country] = (geoData[country] || 0) + count;
        });
      });
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString() },
        countries: Object.entries(geoData).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
      });
    }

    // GET /api/site-analytics/:siteId/referrers
    if (endpoint === "referrers" && method === "GET") {
      const referrers: Record<string, number> = {};
      analytics.forEach((a) => {
        Object.entries(a.referrers).forEach(([domain, count]) => {
          referrers[domain] = (referrers[domain] || 0) + count;
        });
      });
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString() },
        referrers: Object.entries(referrers).map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count),
      });
    }

    // GET /api/site-analytics/:siteId/pages
    if (endpoint === "pages" && method === "GET") {
      const paths: Record<string, number> = {};
      analytics.forEach((a) => {
        Object.entries(a.paths).forEach(([path, count]) => {
          paths[path] = (paths[path] || 0) + count;
        });
      });
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString() },
        pages: Object.entries(paths).map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count),
      });
    }

    // GET /api/site-analytics/:siteId/devices
    if (endpoint === "devices" && method === "GET") {
      const devices = { desktop: 0, mobile: 0, tablet: 0, other: 0 };
      analytics.forEach((a) => {
        devices.desktop += a.devices.desktop;
        devices.mobile += a.devices.mobile;
        devices.tablet += a.devices.tablet;
        devices.other += a.devices.other;
      });
      const total = devices.desktop + devices.mobile + devices.tablet + devices.other;
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString() },
        devices: {
          desktop: { count: devices.desktop, percentage: total ? (devices.desktop / total) * 100 : 0 },
          mobile: { count: devices.mobile, percentage: total ? (devices.mobile / total) * 100 : 0 },
          tablet: { count: devices.tablet, percentage: total ? (devices.tablet / total) * 100 : 0 },
          other: { count: devices.other, percentage: total ? (devices.other / total) * 100 : 0 },
        },
        total,
      });
    }

    // GET /api/site-analytics/:siteId/browsers
    if (endpoint === "browsers" && method === "GET") {
      const browsers: Record<string, number> = {};
      analytics.forEach((a) => {
        Object.entries(a.browsers).forEach(([browser, count]) => {
          browsers[browser] = (browsers[browser] || 0) + count;
        });
      });
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString() },
        browsers: Object.entries(browsers).map(([browser, count]) => ({ browser, count })).sort((a, b) => b.count - a.count),
      });
    }

    // GET /api/site-analytics/:siteId/performance
    if (endpoint === "performance" && method === "GET") {
      return jsonResponse({
        siteId,
        period: { start: later(-1), end: now.toISOString(), interval: "1h" },
        data: analytics.map((a) => ({
          timestamp: a.timestamp,
          avgResponseTimeMs: a.avgResponseTimeMs,
          p95ResponseTimeMs: a.p95ResponseTimeMs,
          errorRate: a.pageViews > 0 ? (a.responses5xx / a.pageViews) * 100 : 0,
        })),
      });
    }

    return null;
  },
  // S3 Providers handlers
  async (url, method, bodyText) => {
    if (url.pathname === "/api/s3-providers" && method === "GET") {
      return jsonResponse({ providers: mockState.s3Providers });
    }

    if (url.pathname === "/api/s3-providers" && method === "POST" && bodyText) {
      const body = JSON.parse(bodyText);
      const provider = {
        id: `s3-${mockState.s3Providers.length + 1}`,
        name: body.name,
        endpoint: body.endpoint,
        region: body.region || "us-east-1",
        bucket: body.bucket,
        accessKeyId: body.accessKeyId,
        secretAccessKey: body.secretAccessKey,
        isDefault: mockState.s3Providers.length === 0,
        usedForBuildCache: body.usedForBuildCache ?? true,
        usedForArtifacts: body.usedForArtifacts ?? true,
        lastValidated: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      mockState.s3Providers.push(provider);
      return jsonResponse({ provider }, 201);
    }

    const providerMatch = url.pathname.match(/^\/api\/s3-providers\/(?<id>[^/]+)(\/(?<action>.+))?$/);
    if (providerMatch) {
      const providerId = providerMatch.groups!.id;
      const action = providerMatch.groups!.action;
      const provider = mockState.s3Providers.find((p) => p.id === providerId);

      if (!provider && !action) {
        return jsonResponse({ error: "Provider not found" }, 404);
      }

      if (action === "test" && method === "POST") {
        return jsonResponse({ success: true });
      }

      if (!action && method === "DELETE") {
        const index = mockState.s3Providers.findIndex((p) => p.id === providerId);
        if (index === -1) {
          return jsonResponse({ error: "Provider not found" }, 404);
        }
        mockState.s3Providers.splice(index, 1);
        return jsonResponse({ success: true });
      }
    }

    return null;
  },
  // Extensions handler - indicates Sites extension is enabled
  async (url, method) => {
    if (url.pathname === "/api/extensions" && method === "GET") {
      return jsonResponse({
        extensions: {
          sites: true,
        },
      });
    }
    return null;
  },
];

async function handleApi(route: Route) {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const bodyText = request.postData();

  for (const handler of handlers) {
    const result = await handler(url, method, bodyText);
    if (result) {
      await route.fulfill({
        status: result.status ?? 200,
        contentType: result.contentType ?? "application/json",
        body: result.body ?? "{}",
      });
      return;
    }
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}",
  });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/api/**", handleApi);
    await use(page);
  },
});

export { expect };
