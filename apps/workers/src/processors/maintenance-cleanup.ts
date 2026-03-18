import type { Job } from "bullmq";
import type { MaintenanceCleanupJobData, MaintenanceCleanupResult } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { certificates, sites, domains } from "@uni-proxy-manager/database/schema";
import { getCertsDir } from "@uni-proxy-manager/shared/config";
import { readdir, rm, stat } from "fs/promises";
import { join } from "path";

const SITES_SOURCE_DIR = process.env.SITES_SOURCE_DIR || "/data/sites/sources";

export async function processMaintenanceCleanup(
  job: Job<MaintenanceCleanupJobData>
): Promise<MaintenanceCleanupResult> {
  const { type } = job.data;

  console.log(`[Maintenance] Starting cleanup (type: ${type})`);

  const result: MaintenanceCleanupResult = {
    success: true,
    cleanedCertificateDirs: 0,
    cleanedSiteSourceDirs: 0,
    cleanedDeploymentArtifacts: 0,
    errors: [],
  };

  try {
    if (type === "all" || type === "certificates") {
      const certCleanup = await cleanupOrphanedCertificates();
      result.cleanedCertificateDirs = certCleanup.cleaned;
      result.errors.push(...certCleanup.errors);
    }

    if (type === "all" || type === "sites") {
      const siteCleanup = await cleanupOrphanedSiteSources();
      result.cleanedSiteSourceDirs = siteCleanup.cleaned;
      result.errors.push(...siteCleanup.errors);
    }

    console.log(`[Maintenance] Cleanup complete:`, {
      certificateDirs: result.cleanedCertificateDirs,
      siteSourceDirs: result.cleanedSiteSourceDirs,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Maintenance] Cleanup failed:`, errorMessage);
    result.success = false;
    result.errors.push(errorMessage);
    return result;
  }
}

async function cleanupOrphanedCertificates(): Promise<{ cleaned: number; errors: string[] }> {
  const certsDir = getCertsDir();
  const errors: string[] = [];
  let cleaned = 0;

  try {
    // Get all domain IDs from database
    const allDomains = await db.query.domains.findMany({
      columns: { id: true },
    });
    const validDomainIds = new Set(allDomains.map((d) => d.id));

    // Get all directories in certs folder
    let entries: string[] = [];
    try {
      entries = await readdir(certsDir);
    } catch {
      // Certs directory doesn't exist yet
      return { cleaned: 0, errors: [] };
    }

    for (const entry of entries) {
      const entryPath = join(certsDir, entry);

      // Check if it's a directory (domain ID folder) or .pem file
      try {
        const entryStat = await stat(entryPath);

        if (entryStat.isDirectory()) {
          // Check if this domain ID exists in database
          if (!validDomainIds.has(entry)) {
            console.log(`[Maintenance] Removing orphaned certificate directory: ${entry}`);
            await rm(entryPath, { recursive: true, force: true });
            cleaned++;
          }
        } else if (entry.endsWith(".pem")) {
          // HAProxy PEM file - extract domain ID from filename
          const domainId = entry.replace(".pem", "");
          if (!validDomainIds.has(domainId)) {
            console.log(`[Maintenance] Removing orphaned HAProxy PEM: ${entry}`);
            await rm(entryPath, { force: true });
            cleaned++;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Failed to process ${entry}: ${errMsg}`);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    errors.push(`Certificate cleanup failed: ${errMsg}`);
  }

  return { cleaned, errors };
}

async function cleanupOrphanedSiteSources(): Promise<{ cleaned: number; errors: string[] }> {
  const errors: string[] = [];
  let cleaned = 0;

  try {
    // Get all site IDs from database
    const allSites = await db.query.sites.findMany({
      columns: { id: true },
    });
    const validSiteIds = new Set(allSites.map((s) => s.id));

    // Get all directories in sites source folder
    let entries: string[] = [];
    try {
      entries = await readdir(SITES_SOURCE_DIR);
    } catch {
      // Sites source directory doesn't exist yet
      return { cleaned: 0, errors: [] };
    }

    for (const entry of entries) {
      const entryPath = join(SITES_SOURCE_DIR, entry);

      try {
        const entryStat = await stat(entryPath);

        if (entryStat.isDirectory()) {
          // Check if this site ID exists in database
          if (!validSiteIds.has(entry)) {
            console.log(`[Maintenance] Removing orphaned site source directory: ${entry}`);
            await rm(entryPath, { recursive: true, force: true });
            cleaned++;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Failed to process ${entry}: ${errMsg}`);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    errors.push(`Site source cleanup failed: ${errMsg}`);
  }

  return { cleaned, errors };
}
