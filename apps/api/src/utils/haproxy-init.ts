import { stat, writeFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { db } from "@uni-proxy-manager/database";
import { domains, sites, pomeriumSettings, pomeriumRoutes } from "@uni-proxy-manager/database/schema";
import { inArray, eq } from "drizzle-orm";
import {
  generateHAProxyConfigString,
  generateHAProxyConfigWithPomeriumString,
  type DomainConfig,
  type PomeriumConfig,
  type PomeriumRouteConfig,
} from "@uni-proxy-manager/shared/haproxy";
import {
  getHaproxyConfigPath,
  getCertsDir,
  getErrorPagesDir,
} from "@uni-proxy-manager/shared/config";

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await stat(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
    console.log(`[HAProxy Init] Created directory: ${dirPath}`);
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate HAProxy config from database
 */
async function generateConfig(): Promise<string> {
  const certsDir = getCertsDir();
  const errorPagesDir = getErrorPagesDir();

  try {
    const allDomains = await db.query.domains.findMany({
      with: {
        backends: true,
        certificate: true,
      },
    });
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

    const domainConfigs: DomainConfig[] = allDomains.map((domain) => {
      const certActive = domain.certificate?.status === "active";
      const sslEnabled = domain.sslEnabled && certActive;

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
          : undefined,
        backends: domain.backends
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
            };
          }),
      };
    });

    // Check if Pomerium extension is enabled and fetch routes
    let pomeriumConfig: PomeriumConfig | undefined;
    const pomeriumInternalUrl = process.env.POMERIUM_INTERNAL_URL;

    if (pomeriumInternalUrl) {
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
          };

          console.log(`[HAProxy Init] Pomerium enabled with ${routes.length} routes`);
        }
      } catch (pomeriumError) {
        console.warn("[HAProxy Init] Could not fetch Pomerium config:", pomeriumError);
      }
    }

    // Generate config with or without Pomerium
    if (pomeriumConfig && pomeriumConfig.routes.length > 0) {
      return generateHAProxyConfigWithPomeriumString(domainConfigs, pomeriumConfig, {
        certsDir,
        errorPagesDir,
      });
    }

    return generateHAProxyConfigString(domainConfigs, {
      certsDir,
      errorPagesDir,
    });
  } catch (error) {
    console.warn("[HAProxy Init] Could not query database, generating default config");
    // Return a minimal default config if database is not ready
    return generateHAProxyConfigString([], {
      certsDir,
      errorPagesDir,
    });
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
        `[HAProxy Init] Failed to generate combined PEM for ${domain.hostname}:`,
        error
      );
    }
  }
}

/**
 * Initialize HAProxy config and required directories on startup
 */
export async function initHaproxyConfig(): Promise<void> {
  const configPath = getHaproxyConfigPath();
  const certsDir = getCertsDir();
  const errorPagesDir = getErrorPagesDir();

  console.log("[HAProxy Init] Checking required directories and files...");

  // Ensure all required directories exist
  await ensureDir(dirname(configPath));
  await ensureDir(certsDir);
  await ensureDir(errorPagesDir);

  // Check if config file exists
  const configExists = await fileExists(configPath);

  if (!configExists) {
    console.log("[HAProxy Init] Config file not found, generating...");

    try {
      const config = await generateConfig();
      await writeFile(configPath, config, "utf-8");
      console.log(`[HAProxy Init] Config file created: ${configPath}`);
    } catch (error) {
      console.error("[HAProxy Init] Failed to generate config:", error);
    }
  } else {
    console.log("[HAProxy Init] Config file exists, skipping generation");
  }
}
