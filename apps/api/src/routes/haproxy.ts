import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import {
  domains,
  backends,
  sites,
  siteDomains,
  pomeriumSettings,
  pomeriumRoutes,
  domainRouteRules,
  domainIpRules,
  domainSecurityHeaders,
  domainBlockedRoutes,
  analyticsConfig,
  domainSharedBackends,
  sharedBackends,
  clusterNodes,
} from "@uni-proxy-manager/database/schema";
import { inArray, eq, and, ne } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, type HaproxyReloadJobData, type ClusterSyncJobData } from "@uni-proxy-manager/queue";
import {
  renderHAProxyConfig,
  generateCompleteHAProxyConfig,
  generateHAProxyConfig,
  type DomainConfig,
  type SiteConfig,
  type SitesExecutorConfig,
  type PomeriumConfig,
  type PomeriumRouteConfig,
  type DomainRouteRuleConfig,
  type DomainIpAccessConfig,
  type DomainSecurityHeadersConfig,
  type DomainBlockedRouteConfig,
  type AnalyticsRouteConfig,
  type HAProxyClusterPeer,
  isHaproxyRunning,
  getHaproxyInfo,
  getHaproxyStats,
} from "@uni-proxy-manager/shared/haproxy";
import {
  getHaproxyConfigPath,
  getCertsDir,
  getErrorPagesDir,
} from "@uni-proxy-manager/shared/config";
import { isExtensionEnabled } from "../extensions";
import { writeFile, readFile, stat } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function redactConfig(text: string): string {
  return text.replace(/(stats auth \S+:)\S+/g, "$1[REDACTED]");
}

/**
 * Format uptime in seconds to human-readable string
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

const app = new Hono();

// Get HAProxy status
app.get("/status", async (c) => {
  try {
    const configPath = getHaproxyConfigPath();

    let configExists = false;
    let configModified: Date | null = null;

    try {
      const stats = await stat(configPath);
      configExists = true;
      configModified = stats.mtime;
    } catch {
      // Config doesn't exist yet
    }

    // Check if HAProxy is running via stats socket
    let status: "running" | "stopped" | "unknown" = "unknown";
    let uptime: string | undefined;
    let version: string | undefined;
    let currentConnections = 0;

    try {
      const running = await isHaproxyRunning();
      if (running) {
        status = "running";

        try {
          const info = await getHaproxyInfo();
          version = info.version;

          // Info keys retrieved successfully

          // Try to get uptime from uptime_sec (preferred)
          if (info.uptime_sec && typeof info.uptime_sec === "number") {
            uptime = formatUptime(info.uptime_sec);
          }
          // Fallback: try to calculate from start_time if available
          else if (info.start_time && typeof info.start_time === "number") {
            // uptime_sec not available, using start_time fallback
            // start_time is Unix timestamp of process start
            const now = Math.floor(Date.now() / 1000);
            const uptimeSeconds = now - info.start_time;
            if (uptimeSeconds > 0) {
              uptime = formatUptime(uptimeSeconds);
            }
          }
          // Final fallback: try_pid_start_time (for multi-process HAProxy)
          else if (info.try_pid_start_time && typeof info.try_pid_start_time === "number") {
            // uptime_sec not available, using try_pid_start_time fallback
            const now = Math.floor(Date.now() / 1000);
            const uptimeSeconds = now - info.try_pid_start_time;
            if (uptimeSeconds > 0) {
              uptime = formatUptime(uptimeSeconds);
            }
          } else {
            console.warn("[HAProxy] No uptime information available from HAProxy process");
          }
        } catch (infoError) {
          console.warn("[HAProxy] Could not get detailed info:", infoError);
        }

        try {
          const stats = await getHaproxyStats();
          currentConnections = stats.frontends.reduce(
            (sum, frontend) => sum + (frontend.current_sessions || 0),
            0
          );
        } catch (statsError) {
          console.warn("[HAProxy] Could not get stats:", statsError);
        }
      } else {
        status = "stopped";
      }
    } catch (error) {
      console.error("[HAProxy] Error checking HAProxy status:", error);
      status = "unknown";
    }

    // Get domain count
    const allDomains = await db.query.domains.findMany();
    const domainCount = allDomains.length;

    return c.json({
      status,
      uptime,
      version,
      currentConnections,
      configExists,
      configPath,
      configModified: configModified?.toISOString(),
      domainCount,
    });
  } catch (error) {
    console.error("[HAProxy] Error getting status:", error);
    return c.json({ error: "Failed to get HAProxy status" }, 500);
  }
});

// Get current config
app.get("/config", async (c) => {
  try {
    const configPath = getHaproxyConfigPath();

    let config: string;
    try {
      config = await readFile(configPath, "utf-8");
    } catch {
      return c.json({ error: "Config file not found" }, 404);
    }

    return c.text(redactConfig(config), 200, {
      "Content-Type": "text/plain",
    });
  } catch (error) {
    console.error("[HAProxy] Error getting config:", error);
    return c.json({ error: "Failed to get config" }, 500);
  }
});

// Preview config (generate without applying)
app.get("/config/preview", async (c) => {
  try {
    const config = await generateConfig();

    return c.text(redactConfig(config), 200, {
      "Content-Type": "text/plain",
    });
  } catch (error) {
    console.error("[HAProxy] Error generating preview:", error);
    return c.json({ error: "Failed to generate config preview" }, 500);
  }
});

// Get config diff - compare current vs proposed
app.get("/config/diff", async (c) => {
  try {
    const configPath = getHaproxyConfigPath();
    const proposedConfig = redactConfig(await generateConfig());

    let currentConfig: string | null = null;
    try {
      currentConfig = redactConfig(await readFile(configPath, "utf-8"));
    } catch {
      // Config doesn't exist yet
    }

    const hasPendingChanges = currentConfig !== proposedConfig;

    // Generate simple line-by-line diff
    const diff: string[] = [];
    if (hasPendingChanges && currentConfig) {
      const currentLines = currentConfig.split("\n");
      const proposedLines = proposedConfig.split("\n");
      const maxLines = Math.max(currentLines.length, proposedLines.length);

      for (let i = 0; i < maxLines; i++) {
        const currentLine = currentLines[i] ?? "";
        const proposedLine = proposedLines[i] ?? "";

        if (currentLine !== proposedLine) {
          if (currentLine && !proposedLine) {
            diff.push(`- ${i + 1}: ${currentLine}`);
          } else if (!currentLine && proposedLine) {
            diff.push(`+ ${i + 1}: ${proposedLine}`);
          } else {
            diff.push(`- ${i + 1}: ${currentLine}`);
            diff.push(`+ ${i + 1}: ${proposedLine}`);
          }
        }
      }
    } else if (hasPendingChanges && !currentConfig) {
      diff.push("+ [New config - no existing config file]");
    }

    return c.json({
      hasPendingChanges,
      currentConfigExists: currentConfig !== null,
      currentLineCount: currentConfig?.split("\n").length ?? 0,
      proposedLineCount: proposedConfig.split("\n").length,
      diff: diff.slice(0, 100), // Limit to first 100 diff lines
      diffTruncated: diff.length > 100,
    });
  } catch (error) {
    console.error("[HAProxy] Error generating config diff:", error);
    return c.json({ error: "Failed to generate config diff" }, 500);
  }
});

// Trigger config reload
app.post("/reload", async (c) => {
  const force = c.req.query("force") === "true";

  try {
    // Generate new config
    const newConfig = await generateConfig();

    // Check if config has changed
    const configPath = getHaproxyConfigPath();
    let currentConfig: string | null = null;

    try {
      currentConfig = await readFile(configPath, "utf-8");
    } catch {
      // Config doesn't exist yet
    }

    if (!force && currentConfig === newConfig) {
      return c.json({
        success: true,
        message: "Config unchanged, no reload needed",
        changed: false,
      });
    }

    // Write new config
    await writeFile(configPath, newConfig, "utf-8");

    // Queue reload job, with fallback to direct reload
    let reloadMethod: "queue" | "direct" = "queue";
    let reloadError: string | undefined;

    try {
      const redis = getRedisClient();
      const queue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, {
        connection: redis,
      });

      const ts = Date.now();
      await queue.add(
        `reload-${ts}`,
        {
          reason: "Manual reload triggered",
          triggeredBy: "api",
          force,
        },
        { jobId: `haproxy-reload-${ts}` }
      );

      // Also fan out to cluster nodes if any exist
      try {
        const hasRemoteNodes = await db.query.clusterNodes.findFirst({
          where: ne(clusterNodes.isLocal, true),
        });
        if (hasRemoteNodes) {
          const clusterQueue = new Queue<ClusterSyncJobData>(QUEUES.CLUSTER_SYNC, {
            connection: redis,
          });
          await clusterQueue.add(
            `cluster-sync-${ts}`,
            { reason: "HAProxy reload", triggeredBy: "domain-change" },
            { jobId: `cluster-sync-reload-${ts}` }
          );
        }
      } catch (clusterErr) {
        console.warn("[HAProxy] Could not enqueue cluster sync:", clusterErr);
      }
    } catch (queueError) {
      console.error("[HAProxy] Failed to queue reload job, attempting direct reload:", queueError);
      reloadMethod = "direct";

      // Fallback: attempt direct HAProxy reload
      try {
        // Check if HAProxy is running first
        const running = await isHaproxyRunning();
        if (running) {
          // Send SIGUSR2 to reload config gracefully
          await execAsync("kill -USR2 $(cat /var/run/haproxy.pid 2>/dev/null) 2>/dev/null || haproxy -f /etc/haproxy/haproxy.cfg -p /var/run/haproxy.pid -sf $(cat /var/run/haproxy.pid 2>/dev/null) 2>/dev/null || true");
        }
      } catch (directError) {
        console.error("[HAProxy] Direct reload also failed:", directError);
        reloadError = directError instanceof Error ? directError.message : "Direct reload failed";
      }
    }

    return c.json({
      success: true,
      message: reloadMethod === "queue"
        ? "Config updated and reload queued"
        : reloadError
          ? `Config updated but reload failed: ${reloadError}`
          : "Config updated and direct reload attempted",
      changed: true,
      reloadMethod,
      reloadError,
    });
  } catch (error) {
    console.error("[HAProxy] Error reloading config:", error);
    return c.json({ error: "Failed to reload config" }, 500);
  }
});

// Apply config directly (without queue)
app.post("/apply", async (c) => {
  try {
    // Generate new config
    const newConfig = await generateConfig();

    // Write config
    const configPath = getHaproxyConfigPath();
    await writeFile(configPath, newConfig, "utf-8");

    return c.json({
      success: true,
      message: "Config written. HAProxy reload pending.",
      configPath,
    });
  } catch (error) {
    console.error("[HAProxy] Error applying config:", error);
    return c.json({ error: "Failed to apply config" }, 500);
  }
});

async function generateConfig(): Promise<string> {
  const allDomains = await db.query.domains.findMany({
    with: {
      backends: true,
      certificate: true,
    },
  });

  const certsDir = getCertsDir();
  const errorPagesDir = getErrorPagesDir();
  await ensureHaproxyPemFiles(allDomains, certsDir);

  // Collect all site IDs from site-type backends to fetch their active deployment info
  const siteIds = allDomains
    .flatMap((d) => d.backends)
    .filter((b) => b.backendType === "site" && b.siteId)
    .map((b) => b.siteId as string);

  // Fetch sites with their active deployment IDs
  const siteMap = new Map<string, { activeDeploymentId: string | null }>();
  if (siteIds.length > 0) {
    const siteRecords = await db.query.sites.findMany({
      where: inArray(sites.id, siteIds),
      columns: {
        id: true,
        activeDeploymentId: true,
      },
    });
    for (const site of siteRecords) {
      siteMap.set(site.id, { activeDeploymentId: site.activeDeploymentId });
    }
  }

  // Fetch advanced domain configuration
  const allRouteRules = await db.query.domainRouteRules.findMany({
    with: { backend: true },
  });
  const allIpRules = await db.query.domainIpRules.findMany();
  const allSecurityHeaders = await db.query.domainSecurityHeaders.findMany();
  const allBlockedRoutes = await db.query.domainBlockedRoutes.findMany();

  // Group by domain ID for efficient lookup
  const routeRulesByDomain = new Map<string, typeof allRouteRules>();
  for (const rule of allRouteRules) {
    const existing = routeRulesByDomain.get(rule.domainId) || [];
    existing.push(rule);
    routeRulesByDomain.set(rule.domainId, existing);
  }

  const ipRulesByDomain = new Map<string, (typeof allIpRules)[0]>();
  for (const rule of allIpRules) {
    ipRulesByDomain.set(rule.domainId, rule);
  }

  const securityHeadersByDomain = new Map<string, (typeof allSecurityHeaders)[0]>();
  for (const headers of allSecurityHeaders) {
    securityHeadersByDomain.set(headers.domainId, headers);
  }

  const blockedRoutesByDomain = new Map<string, typeof allBlockedRoutes>();
  for (const route of allBlockedRoutes) {
    const existing = blockedRoutesByDomain.get(route.domainId) || [];
    existing.push(route);
    blockedRoutesByDomain.set(route.domainId, existing);
  }

  // Fetch shared backends linked to each domain
  const allSharedBackendLinks = await db.query.domainSharedBackends.findMany({
    with: { sharedBackend: true },
  });

  // Group shared backends by domain ID, only include enabled ones
  const sharedBackendsByDomain = new Map<string, typeof allSharedBackendLinks[0]["sharedBackend"][]>();
  for (const link of allSharedBackendLinks) {
    if (!link.sharedBackend || !link.sharedBackend.enabled) continue;
    const existing = sharedBackendsByDomain.get(link.domainId) || [];
    existing.push(link.sharedBackend);
    sharedBackendsByDomain.set(link.domainId, existing);
  }

  // Build certificate coverage map for wildcard matching
  // Maps hostnames to their covering domain (for certificate path lookup)
  const certificateCoverage = new Map<string, { domainId: string; altNames: string[] }>();
  for (const domain of allDomains) {
    if (domain.certificate?.status === "active" && domain.certificate.altNames) {
      certificateCoverage.set(domain.hostname, {
        domainId: domain.id,
        altNames: domain.certificate.altNames as string[],
      });
    }
  }

  // Helper to check if a hostname matches a wildcard pattern
  function hostnameMatchesWildcard(hostname: string, pattern: string): boolean {
    if (!pattern.startsWith("*.")) return false;
    const wildcardBase = pattern.substring(2);
    const hostParts = hostname.split(".");
    const baseParts = wildcardBase.split(".");
    if (hostParts.length !== baseParts.length + 1) return false;
    const hostBase = hostParts.slice(1).join(".");
    return hostBase.toLowerCase() === wildcardBase.toLowerCase();
  }

  // Find certificate coverage for a hostname (own or wildcard)
  function findCertificateCoverage(hostname: string): { domainId: string; altNames: string[] } | null {
    // Check if domain has its own certificate
    const own = certificateCoverage.get(hostname);
    if (own) return own;

    // Check for wildcard coverage from other domains
    for (const [, certInfo] of certificateCoverage) {
      for (const altName of certInfo.altNames) {
        if (altName.toLowerCase() === hostname.toLowerCase()) {
          return certInfo;
        }
        if (altName.startsWith("*.") && hostnameMatchesWildcard(hostname, altName)) {
          return certInfo;
        }
      }
    }
    return null;
  }

  const domainConfigs: DomainConfig[] = allDomains.map((domain) => {
    const certActive = domain.certificate?.status === "active";
    // Check for wildcard coverage if domain doesn't have its own cert
    const coveringCert = !certActive ? findCertificateCoverage(domain.hostname) : null;
    const hasCertCoverage = certActive || coveringCert !== null;
    const sslEnabled = domain.sslEnabled && hasCertCoverage;

    // Get advanced config for this domain
    const routeRules = routeRulesByDomain.get(domain.id);
    const ipRule = ipRulesByDomain.get(domain.id);
    const securityHeaders = securityHeadersByDomain.get(domain.id);
    const blockedRoutes = blockedRoutesByDomain.get(domain.id);

    // Build route rules config
    const routeRulesConfig: DomainRouteRuleConfig[] | undefined = routeRules?.map((r) => ({
      id: r.id,
      name: r.name,
      pathPattern: r.pathPattern,
      actionType: r.actionType,
      backendId: r.backendId || undefined,
      backendName: r.backend?.name || undefined,
      redirectUrl: r.redirectUrl || undefined,
      redirectStatusCode: r.redirectStatusCode || undefined,
      redirectPreservePath: r.redirectPreservePath ?? undefined,
      redirectPreserveQuery: r.redirectPreserveQuery ?? undefined,
      priority: r.priority,
      enabled: r.enabled,
    }));

    // Build IP access control config
    const ipAccessControl: DomainIpAccessConfig | undefined = ipRule
      ? {
          enabled: ipRule.enabled,
          mode: ipRule.mode as "whitelist" | "blacklist",
          ipAddresses: (ipRule.ipAddresses as string[]) || [],
        }
      : undefined;

    // Build security headers config
    const securityHeadersConfig: DomainSecurityHeadersConfig | undefined = securityHeaders
      ? {
          xFrameOptions: securityHeaders.xFrameOptionsEnabled
            ? {
                enabled: securityHeaders.xFrameOptionsEnabled,
                value: (securityHeaders.xFrameOptionsValue || "deny") as "deny" | "sameorigin" | "allow-from" | "disabled",
                allowFrom: securityHeaders.xFrameOptionsAllowFrom || undefined,
              }
            : undefined,
          cspFrameAncestors: securityHeaders.cspFrameAncestorsEnabled
            ? {
                enabled: securityHeaders.cspFrameAncestorsEnabled,
                values: (securityHeaders.cspFrameAncestors as string[]) || [],
              }
            : undefined,
          cors: securityHeaders.corsEnabled
            ? {
                enabled: securityHeaders.corsEnabled,
                allowOrigins: (securityHeaders.corsAllowOrigins as string[]) || [],
                allowMethods: (securityHeaders.corsAllowMethods as string[]) || [],
                allowHeaders: (securityHeaders.corsAllowHeaders as string[]) || [],
                exposeHeaders: (securityHeaders.corsExposeHeaders as string[]) || [],
                allowCredentials: securityHeaders.corsAllowCredentials,
                maxAge: securityHeaders.corsMaxAge || 86400,
              }
            : undefined,
        }
      : undefined;

    // Build blocked routes config
    const blockedRoutesConfig: DomainBlockedRouteConfig[] | undefined = blockedRoutes?.map((r) => ({
      id: r.id,
      pathPattern: r.pathPattern,
      httpStatusCode: r.httpStatusCode,
      customResponseBody: r.customResponseBody || undefined,
      enabled: r.enabled,
    }));

    return {
      id: domain.id,
      hostname: domain.hostname,
      sslEnabled,
      forceHttps: domain.forceHttps && sslEnabled,
      maintenanceEnabled: domain.maintenanceEnabled,
      maintenanceBypassIps: (domain.maintenanceBypassIps as string[]) || [],
      errorPagePath: domain.errorPageId
        ? join(errorPagesDir, domain.errorPageId, "503.http")
        : undefined,
      maintenancePagePath: domain.maintenancePageId
        ? join(errorPagesDir, domain.maintenancePageId, "index.html")
        : undefined,
      certificatePath: certActive
        ? join(certsDir, domain.id, "fullchain.pem")
        : coveringCert
          ? join(certsDir, coveringCert.domainId, "fullchain.pem")
          : undefined,
      certificateAltNames: certActive && domain.certificate?.altNames
        ? (domain.certificate.altNames as string[])
        : coveringCert?.altNames,
      backends: [
        ...domain.backends
          .filter((b) => b.enabled)
          .map((b) => {
            // For site backends, construct the runtime ID
            let siteRuntimeId: string | undefined;
            if (b.backendType === "site" && b.siteId) {
              const siteInfo = siteMap.get(b.siteId);
              if (siteInfo?.activeDeploymentId) {
                siteRuntimeId = `${b.siteId}-${siteInfo.activeDeploymentId}`;
              }
            }

            return {
              id: b.id,
              name: b.name,
              backendType: (b.backendType || "static") as "static" | "site",
              address: b.address,
              port: b.port,
              protocol: b.protocol as "http" | "https",
              siteId: b.siteId,
              siteRuntimeId,
              weight: b.weight,
              maxConnections: b.maxConnections || undefined,
              healthCheckEnabled: b.healthCheckEnabled,
              healthCheckPath: b.healthCheckPath || "/",
              healthCheckInterval: b.healthCheckInterval,
              healthCheckTimeout: b.healthCheckTimeout,
              healthCheckFall: b.healthCheckFallThreshold,
              healthCheckRise: b.healthCheckRiseThreshold,
              enabled: b.enabled,
              isBackup: b.isBackup,
              // Request modification options
              hostRewrite: b.hostRewrite || undefined,
              pathPrefixAdd: b.pathPrefixAdd || undefined,
              pathPrefixStrip: b.pathPrefixStrip || undefined,
            };
          }),
        // Materialize shared backends for this domain
        ...(sharedBackendsByDomain.get(domain.id) || []).map((sb) => ({
          id: sb.id,
          name: `shared_${sb.name}`,
          backendType: "static" as const,
          address: sb.address,
          port: sb.port,
          protocol: sb.protocol as "http" | "https",
          siteId: null,
          weight: sb.weight,
          maxConnections: sb.maxConnections || undefined,
          healthCheckEnabled: sb.healthCheckEnabled,
          healthCheckPath: sb.healthCheckPath || "/",
          healthCheckInterval: sb.healthCheckInterval,
          healthCheckTimeout: sb.healthCheckTimeout,
          healthCheckFall: sb.healthCheckFall,
          healthCheckRise: sb.healthCheckRise,
          enabled: sb.enabled,
          isBackup: sb.isBackup,
          hostRewrite: sb.hostRewrite || undefined,
          pathPrefixAdd: sb.pathPrefixAdd || undefined,
          pathPrefixStrip: sb.pathPrefixStrip || undefined,
        })),
      ],
      // Subdomain aliases
      subdomainAliases: (domain.subdomainAliases as string[] | null) || [],
      // Advanced configuration
      routeRules: routeRulesConfig,
      ipAccessControl,
      securityHeaders: securityHeadersConfig,
      blockedRoutes: blockedRoutesConfig,
    };
  });

  // Fetch Pomerium config if extension is enabled
  let pomeriumConfig: PomeriumConfig | undefined;
  const pomeriumInternalUrl = process.env.POMERIUM_INTERNAL_URL;

  if (pomeriumInternalUrl && isExtensionEnabled("pomerium")) {
    try {
      const settings = await db.query.pomeriumSettings.findFirst();
      if (settings?.enabled) {
        const routes = await db.query.pomeriumRoutes.findMany({
          where: eq(pomeriumRoutes.enabled, true),
          with: {
            domain: true,
          },
        });

        const routeConfigs: PomeriumRouteConfig[] = routes.map((route) => ({
          id: route.id,
          name: route.name,
          domainId: route.domainId,
          hostname: route.domain?.hostname || "",
          pathPattern: route.pathPattern,
          protection: route.protection as "protected" | "public" | "passthrough",
          enabled: route.enabled,
          priority: route.priority,
        }));

        pomeriumConfig = {
          enabled: true,
          internalUrl: pomeriumInternalUrl,
          routes: routeConfigs,
          authenticateServiceUrl: settings.authenticateServiceUrl || undefined,
        };
      }
    } catch (pomeriumError) {
      console.warn("[HAProxy] Could not fetch Pomerium config:", pomeriumError);
    }
  }

  // Fetch analytics config if extension is enabled
  let analyticsOption: { routes: AnalyticsRouteConfig[]; backend?: { host: string; port: number } } | undefined;

  if (isExtensionEnabled("analytics")) {
    try {
      const analyticsRecords = await db.query.analyticsConfig.findMany({
        where: eq(analyticsConfig.enabled, true),
        with: {
          domain: true,
        },
      });

      if (analyticsRecords.length > 0) {
        const analyticsRoutes: AnalyticsRouteConfig[] = analyticsRecords
          .filter((record) => record.domain)
          .map((record) => ({
            domainId: record.domainId,
            hostname: record.domain!.hostname,
            trackingUuid: record.trackingUuid,
            enabled: record.enabled,
          }));

        if (analyticsRoutes.length > 0) {
          const analyticsEndpoint = process.env.UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT;
          let backend: { host: string; port: number } | undefined;

          if (analyticsEndpoint) {
            try {
              const url = new URL(
                analyticsEndpoint.startsWith("http")
                  ? analyticsEndpoint
                  : `http://${analyticsEndpoint}`
              );
              backend = {
                host: url.hostname,
                port: url.port ? parseInt(url.port, 10) : 3003,
              };
            } catch {
              // Fall back to defaults if URL parsing fails
              backend = { host: analyticsEndpoint, port: 3003 };
            }
          }

          analyticsOption = {
            routes: analyticsRoutes,
            backend,
          };
        }
      }
    } catch (analyticsError) {
      console.warn("[HAProxy] Could not fetch analytics config:", analyticsError);
    }
  }

  // If sites extension is enabled, include site configs for routing to sites-lookup
  if (isExtensionEnabled("sites")) {
    // Fetch all sites with their domains
    const allSites = await db.query.sites.findMany({
      columns: {
        id: true,
        slug: true,
        activeSlot: true,
        maintenanceEnabled: true,
        maintenanceBypassIps: true,
      },
    });

    // Build site configs with hostnames from siteDomains
    // Only include sites that have at least one domain with a site-type backend configured
    const siteConfigs: SiteConfig[] = [];

    // Collect all domain IDs linked to sites for checking
    const siteDomainLinks = await db.query.siteDomains.findMany({
      columns: {
        siteId: true,
        domainId: true,
      },
    });

    // Build a map of siteId -> domainIds
    const siteToDomainIds = new Map<string, string[]>();
    for (const link of siteDomainLinks) {
      const existing = siteToDomainIds.get(link.siteId) || [];
      existing.push(link.domainId);
      siteToDomainIds.set(link.siteId, existing);
    }

    // Check if any domain for this site has a site-type backend
    const siteHasBackend = new Set<string>();
    for (const [siteId, domainIds] of siteToDomainIds) {
      const hasSiteBackend = domainIds.some(domainId => {
        const domain = allDomains.find(d => d.id === domainId);
        return domain?.backends.some(b => b.backendType === "site" && b.siteId === siteId && b.enabled);
      });
      if (hasSiteBackend) {
        siteHasBackend.add(siteId);
      }
    }

    for (const site of allSites) {
      // Skip sites that don't have any site-type backends configured
      if (!siteHasBackend.has(site.id)) {
        continue;
      }

      // Get domains for this site via siteDomains join
      const siteDomainRecords = await db
        .select({ hostname: domains.hostname, sslEnabled: domains.sslEnabled })
        .from(siteDomains)
        .innerJoin(domains, eq(domains.id, siteDomains.domainId))
        .where(eq(siteDomains.siteId, site.id));

      // Create a site config for each hostname
      for (const domainRecord of siteDomainRecords) {
        siteConfigs.push({
          id: site.id,
          slug: site.slug,
          hostname: domainRecord.hostname,
          sslEnabled: domainRecord.sslEnabled,
          activeSlot: site.activeSlot as "blue" | "green" | null,
          maintenanceEnabled: site.maintenanceEnabled,
          maintenanceBypassIps: (site.maintenanceBypassIps as string[]) || [],
        });
      }
    }

    // Executor config (not used for routing anymore, but needed for type)
    const executorConfig: SitesExecutorConfig = {
      endpoint: process.env.SITES_EXECUTOR_ENDPOINT || "openruntimes-executor",
      port: 80,
      secret: process.env.SITES_EXECUTOR_SECRET || "",
    };

    // Fetch cluster peers for HAProxy peers section (stick-table replication)
    const clusterPeers = await fetchClusterPeers();

    // Use complete config generator
    const sitesHAConfig = generateCompleteHAProxyConfig(domainConfigs, {
      certsDir,
      errorPagesDir,
      sites: siteConfigs,
      executorConfig,
      pomerium: pomeriumConfig,
      analytics: analyticsOption,
    });
    sitesHAConfig.clusterPeers = clusterPeers.length > 0 ? clusterPeers : undefined;
    return renderHAProxyConfig(sitesHAConfig);
  }

  // Fetch cluster peers for HAProxy peers section (stick-table replication)
  const clusterPeers = await fetchClusterPeers();

  // Use complete config generator if Pomerium or analytics are available
  const hasPomerium = pomeriumConfig && pomeriumConfig.routes.length > 0;
  const hasAnalytics = analyticsOption && analyticsOption.routes.length > 0;

  if (hasPomerium || hasAnalytics) {
    const completeHAConfig = generateCompleteHAProxyConfig(domainConfigs, {
      certsDir,
      errorPagesDir,
      pomerium: pomeriumConfig,
      analytics: analyticsOption,
    });
    completeHAConfig.clusterPeers = clusterPeers.length > 0 ? clusterPeers : undefined;
    return renderHAProxyConfig(completeHAConfig);
  }

  const baseHAConfig = generateHAProxyConfig(domainConfigs, {
    certsDir,
    errorPagesDir,
  });
  baseHAConfig.clusterPeers = clusterPeers.length > 0 ? clusterPeers : undefined;
  return renderHAProxyConfig(baseHAConfig);
}

async function fetchClusterPeers(): Promise<HAProxyClusterPeer[]> {
  try {
    const allNodes = await db.query.clusterNodes.findMany();
    if (allNodes.length < 2) return [];
    const peersPort = parseInt(process.env.UNI_PROXY_MANAGER_HAPROXY_PEERS_PORT || "1024", 10);
    return allNodes.map((node) => {
      let address = node.apiUrl;
      try {
        address = new URL(node.apiUrl).hostname;
      } catch {
        // keep raw value
      }
      return { name: node.name, address, port: peersPort };
    });
  } catch {
    return [];
  }
}

function resolveCertPath(path: string, certsDir: string): string {
  if (path.startsWith("/")) {
    return path;
  }
  return join(certsDir, path);
}

async function ensureHaproxyPemFiles(
  domainsList: Array<{
    id: string;
    hostname: string;
    certificate?: {
      status?: string;
      keyPath?: string | null;
      fullchainPath?: string | null;
    } | null;
  }>,
  certsDir: string
): Promise<void> {
  for (const domain of domainsList) {
    const cert = domain.certificate;
    if (!cert || cert.status !== "active") {
      continue;
    }
    if (!cert.keyPath || !cert.fullchainPath) {
      continue;
    }

    const targetPath = join(certsDir, `${domain.id}.pem`);
    try {
      await stat(targetPath);
      continue;
    } catch {
      // Missing combined PEM, regenerate below.
    }

    try {
      const keyContent = await readFile(resolveCertPath(cert.keyPath, certsDir), "utf-8");
      const fullchainContent = await readFile(
        resolveCertPath(cert.fullchainPath, certsDir),
        "utf-8"
      );
      await writeFile(targetPath, `${keyContent}\n${fullchainContent}`, "utf-8");
    } catch (error) {
      console.warn(
        `[HAProxy] Failed to generate combined PEM for ${domain.hostname}:`,
        error
      );
    }
  }
}

export default app;
