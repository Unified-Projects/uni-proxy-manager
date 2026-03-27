import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments, siteDomains, githubConnections } from "@uni-proxy-manager/database/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { mkdir, rm, stat, readdir, readFile, rename, copyFile, writeFile } from "fs/promises";
import { join } from "path";
import { getOpenRuntimesClient, isOpenRuntimesConfigured } from "@uni-proxy-manager/shared/openruntimes";

const SITES_SOURCE_DIR = process.env.SITES_SOURCE_DIR || "/data/sites/sources";

const app = new Hono();

// Validation schemas
const createSiteSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  framework: z.enum(["nextjs", "sveltekit", "static", "custom"]).default("static"),
  renderMode: z.enum(["ssr", "ssg", "hybrid"]).default("ssg"),
  buildCommand: z.string().optional(),
  outputDirectory: z.string().optional(),
  installCommand: z.string().optional(),
  nodeVersion: z.string().optional(),
  envVariables: z.record(z.string()).optional(),
  buildFlags: z.array(z.string()).optional(),
  runtimePath: z.string().optional(),
  entryPoint: z.string().optional(),
  // Runtime resource specs (for serving requests)
  memoryMb: z.number().min(128).max(2048).optional(),
  cpuLimit: z.string().optional(),
  timeoutSeconds: z.number().min(1).max(900).optional(),
  maxConcurrency: z.number().min(1).max(100).optional(),
  coldStartEnabled: z.boolean().optional(),
  // Build resource specs (for executor-based builds)
  buildCpus: z.string().optional(),
  buildMemoryMb: z.number().min(512).max(8192).optional(),
  buildTimeoutSeconds: z.number().min(60).max(3600).optional(),
  productionDomainId: z.string().optional(),
  errorPageId: z.string().optional(),
  maintenancePageId: z.string().optional(),
  maintenanceEnabled: z.boolean().optional(),
  s3ProviderId: z.string().optional(),
});

const updateSiteSchema = createSiteSchema.partial().extend({
  status: z.enum(["active", "building", "deploying", "error", "disabled"]).optional(),
});

const updateEnvSchema = z.object({
  envVariables: z.record(z.string()),
});

/**
 * GET /api/sites
 * List all sites with their latest deployment
 */
app.get("/", async (c) => {
  try {
    const statusFilter = c.req.query("status");

    const allSites = await db.query.sites.findMany({
      where: statusFilter ? eq(sites.status, statusFilter as any) : undefined,
      orderBy: [desc(sites.createdAt)],
    });

    // Get deployment summary for each site
    const sitesWithDeployments = await Promise.all(
      allSites.map(async (site) => {
        const latestDeployment = await db.query.deployments.findFirst({
          where: eq(deployments.siteId, site.id),
          orderBy: [desc(deployments.createdAt)],
        });

        // Get deployment counts
        const allDeployments = await db.query.deployments.findMany({
          where: eq(deployments.siteId, site.id),
          columns: { status: true, createdAt: true },
        });

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const deploymentSummary = {
          total: allDeployments.length,
          live: allDeployments.filter(d => d.status === "live").length,
          failed: allDeployments.filter(d => d.status === "failed").length,
          recentFailed: allDeployments.filter(
            d => d.status === "failed" && new Date(d.createdAt) > sevenDaysAgo
          ).length,
        };

        const domains = await db.query.siteDomains.findMany({
          where: eq(siteDomains.siteId, site.id),
        });

        const github = await db.query.githubConnections.findFirst({
          where: eq(githubConnections.siteId, site.id),
        });

        return {
          ...site,
          latestDeployment,
          deploymentSummary,
          domains,
          githubConnected: !!github,
        };
      })
    );

    return c.json({ sites: sitesWithDeployments });
  } catch (error) {
    console.error("[Sites] Error listing sites:", error);
    return c.json({ error: "Failed to list sites" }, 500);
  }
});

/**
 * GET /api/sites/:id
 * Get a single site with deployments
 */
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const siteDeployments = await db.query.deployments.findMany({
      where: eq(deployments.siteId, id),
      orderBy: [desc(deployments.createdAt)],
      limit: 10,
    });

    const domains = await db.query.siteDomains.findMany({
      where: eq(siteDomains.siteId, id),
    });

    const github = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, id),
    });

    return c.json({
      site: {
        ...site,
        deployments: siteDeployments,
        domains,
        githubConnection: github,
      },
    });
  } catch (error) {
    console.error("[Sites] Error getting site:", error);
    return c.json({ error: "Failed to get site" }, 500);
  }
});

/**
 * POST /api/sites
 * Create a new site
 */
app.post("/", zValidator("json", createSiteSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Check if slug already exists
    const existing = await db.query.sites.findFirst({
      where: eq(sites.slug, data.slug),
    });

    if (existing) {
      return c.json({ error: "A site with this slug already exists" }, 409);
    }

    const id = nanoid();

    const [newSite] = await db
      .insert(sites)
      .values({
        id,
        name: data.name,
        slug: data.slug,
        framework: data.framework,
        renderMode: data.renderMode,
        buildCommand: data.buildCommand,
        outputDirectory: data.outputDirectory,
        installCommand: data.installCommand,
        nodeVersion: data.nodeVersion,
        envVariables: data.envVariables || {},
        buildFlags: data.buildFlags || [],
        runtimePath: data.runtimePath,
        entryPoint: data.entryPoint,
        // Runtime resource specs
        memoryMb: data.memoryMb || 256,
        cpuLimit: data.cpuLimit || "0.5",
        timeoutSeconds: data.timeoutSeconds || 30,
        maxConcurrency: data.maxConcurrency || 10,
        coldStartEnabled: data.coldStartEnabled ?? true,
        // Build resource specs
        buildCpus: data.buildCpus || "1.0",
        buildMemoryMb: data.buildMemoryMb || 2048,
        buildTimeoutSeconds: data.buildTimeoutSeconds || 900,
        productionDomainId: data.productionDomainId,
        errorPageId: data.errorPageId,
        maintenancePageId: data.maintenancePageId,
        maintenanceEnabled: data.maintenanceEnabled ?? false,
        s3ProviderId: data.s3ProviderId,
        status: "disabled",
      })
      .returning();

    // Create siteDomain record if productionDomainId is provided
    if (data.productionDomainId) {
      await db.insert(siteDomains).values({
        id: nanoid(),
        siteId: id,
        domainId: data.productionDomainId,
        type: "production",
        isActive: true,
      });
    }

    return c.json({ site: newSite }, 201);
  } catch (error) {
    console.error("[Sites] Error creating site:", error);
    return c.json({ error: "Failed to create site" }, 500);
  }
});

/**
 * PUT /api/sites/:id
 * Update a site
 */
app.put("/:id", zValidator("json", updateSiteSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!existing) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Check slug uniqueness if being changed
    if (data.slug && data.slug !== existing.slug) {
      const slugExists = await db.query.sites.findFirst({
        where: eq(sites.slug, data.slug),
      });
      if (slugExists) {
        return c.json({ error: "A site with this slug already exists" }, 409);
      }
    }

    const [updatedSite] = await db
      .update(sites)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, id))
      .returning();

    // Handle productionDomainId change - create/update siteDomain record
    if (data.productionDomainId !== undefined && data.productionDomainId !== existing.productionDomainId) {
      // Remove old production domain link if exists
      if (existing.productionDomainId) {
        await db.delete(siteDomains).where(
          and(
            eq(siteDomains.siteId, id),
            eq(siteDomains.domainId, existing.productionDomainId),
            eq(siteDomains.type, "production")
          )
        );
      }

      // Add new production domain link if provided
      if (data.productionDomainId) {
        // Check if siteDomain already exists for this domain
        const existingSiteDomain = await db.query.siteDomains.findFirst({
          where: and(
            eq(siteDomains.siteId, id),
            eq(siteDomains.domainId, data.productionDomainId)
          ),
        });

        if (existingSiteDomain) {
          // Update existing record to production type
          await db.update(siteDomains).set({
            type: "production",
            isActive: true,
          }).where(eq(siteDomains.id, existingSiteDomain.id));
        } else {
          // Create new siteDomain record
          await db.insert(siteDomains).values({
            id: nanoid(),
            siteId: id,
            domainId: data.productionDomainId,
            type: "production",
            isActive: true,
          });
        }
      }
    }

    return c.json({ site: updatedSite });
  } catch (error) {
    console.error("[Sites] Error updating site:", error);
    return c.json({ error: "Failed to update site" }, 500);
  }
});

/**
 * DELETE /api/sites/:id
 * Delete a site and all its deployments
 */
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!existing) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Clean up the active runtime container in URT
    if (existing.activeDeploymentId && isOpenRuntimesConfigured()) {
      const runtimeId = `${id}-${existing.activeDeploymentId}`;
      try {
        const openruntimes = getOpenRuntimesClient();
        const runtime = await openruntimes.getRuntime(runtimeId);
        if (runtime) {
          await openruntimes.deleteRuntime(runtimeId);
          console.log(`[Sites] Deleted runtime ${runtimeId} for site ${id}`);
        }
      } catch (runtimeError) {
        // Log but don't block DB cleanup
        console.error(`[Sites] Failed to delete runtime ${runtimeId}:`, runtimeError);
      }
    }

    // Clean up source directory before deleting from database
    const sourceDir = join(SITES_SOURCE_DIR, id);
    try {
      await rm(sourceDir, { recursive: true, force: true });
      console.log(`[Sites] Deleted source directory: ${sourceDir}`);
    } catch (cleanupError) {
      console.error("[Sites] Failed to delete source directory:", cleanupError);
    }

    // Delete in order: deployments, domains, github connection, site
    await db.delete(deployments).where(eq(deployments.siteId, id));
    await db.delete(siteDomains).where(eq(siteDomains.siteId, id));
    await db.delete(githubConnections).where(eq(githubConnections.siteId, id));
    await db.delete(sites).where(eq(sites.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[Sites] Error deleting site:", error);
    return c.json({ error: "Failed to delete site" }, 500);
  }
});

/**
 * POST /api/sites/:id/deploy
 * Trigger a manual deployment
 */
app.post("/:id/deploy", async (c) => {
  const { id } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Get the GitHub connection if exists
    const github = await db.query.githubConnections.findFirst({
      where: eq(githubConnections.siteId, id),
    });

    // Check if we have a source available
    const siteSourceDir = join(SITES_SOURCE_DIR, id);
    let hasSourceFiles = false;
    try {
      const sourceStat = await stat(siteSourceDir);
      if (sourceStat.isDirectory()) {
        const files = await readdir(siteSourceDir);
        hasSourceFiles = files.length > 0;
      }
    } catch {
      // Source directory doesn't exist
    }

    // If no GitHub connection and no source files, return error
    if (!github && !hasSourceFiles) {
      return c.json({
        error: "No source available. Connect GitHub or upload a ZIP file first.",
        hint: "Use POST /api/sites/:id/upload to upload a ZIP file",
      }, 400);
    }

    // Get latest deployment to determine version and slot
    const latestDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.siteId, id),
      orderBy: [desc(deployments.version)],
    });

    const nextVersion = (latestDeployment?.version || 0) + 1;
    const targetSlot = latestDeployment?.slot === "blue" ? "green" : "blue";

    // Determine if we're using GitHub or uploaded source
    const useGitHub = !!github;
    const branch = useGitHub ? (github.productionBranch || "main") : "upload";

    // Create deployment record
    const deploymentId = nanoid();
    const [deployment] = await db
      .insert(deployments)
      .values({
        id: deploymentId,
        siteId: id,
        version: nextVersion,
        slot: targetSlot,
        branch,
        status: "pending",
        triggeredBy: "manual",
      })
      .returning();

    // Update site status
    await db
      .update(sites)
      .set({
        status: "building",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, id));

    // Queue build job
    try {
      const redis = getRedisClient();
      const queue = new Queue("site-build", { connection: redis });

      await queue.add(
        `build-${deploymentId}`,
        {
          siteId: id,
          deploymentId,
          commitSha: useGitHub ? github.lastCommitSha : undefined,
          branch,
          envVariables: site.envVariables || {},
          buildCommand: site.buildCommand || "npm run build",
          installCommand: site.installCommand || "npm install",
          nodeVersion: site.nodeVersion || "20",
          framework: site.framework,
          sourcePath: !useGitHub ? siteSourceDir : undefined,
          // Build resource configuration for executor-based builds
          buildConfig: {
            cpus: parseFloat(site.buildCpus || "1.0"),
            memoryMb: site.buildMemoryMb || 2048,
            timeoutSeconds: site.buildTimeoutSeconds || 900,
          },
        },
        { jobId: `site-build-${deploymentId}` }
      );
    } catch (queueError) {
      console.error("[Sites] Failed to queue build job:", queueError);
      // Update deployment status to failed
      await db
        .update(deployments)
        .set({
          status: "failed",
          errorMessage: "Failed to queue build job",
        })
        .where(eq(deployments.id, deploymentId));

      await db
        .update(sites)
        .set({
          status: "error",
          updatedAt: new Date(),
        })
        .where(eq(sites.id, id));

      return c.json({ error: "Failed to queue deployment" }, 500);
    }

    return c.json({
      deployment,
      message: "Deployment queued successfully",
      source: useGitHub ? "github" : "upload",
    });
  } catch (error) {
    console.error("[Sites] Error triggering deployment:", error);
    return c.json({ error: "Failed to trigger deployment" }, 500);
  }
});

/**
 * POST /api/sites/:id/rollback/:deploymentId
 * Rollback to a previous deployment
 */
app.post("/:id/rollback/:deploymentId", async (c) => {
  const { id, deploymentId } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const targetDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (!targetDeployment || targetDeployment.siteId !== id) {
      return c.json({ error: "Deployment not found" }, 404);
    }

    if (targetDeployment.status !== "live" && targetDeployment.status !== "rolled_back") {
      return c.json({ error: "Can only rollback to live or previously rolled back deployments" }, 400);
    }

    // Get latest deployment to determine new version
    const latestDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.siteId, id),
      orderBy: [desc(deployments.version)],
    });

    const nextVersion = (latestDeployment?.version || 0) + 1;
    const targetSlot = site.activeSlot === "blue" ? "green" : "blue";

    // Create new deployment record for rollback
    const newDeploymentId = nanoid();
    const [deployment] = await db
      .insert(deployments)
      .values({
        id: newDeploymentId,
        siteId: id,
        version: nextVersion,
        slot: targetSlot,
        commitSha: targetDeployment.commitSha,
        commitMessage: `Rollback to v${targetDeployment.version}`,
        branch: targetDeployment.branch,
        artifactPath: targetDeployment.artifactPath,
        status: "pending",
        triggeredBy: "rollback",
      })
      .returning();

    // Queue deploy job (skip build, use existing artifact)
    try {
      const redis = getRedisClient();
      const queue = new Queue("site-deploy", { connection: redis });

      await queue.add(
        `deploy-${newDeploymentId}`,
        {
          siteId: id,
          deploymentId: newDeploymentId,
          targetSlot,
          artifactPath: targetDeployment.artifactPath,
          runtimeConfig: {
            cpus: parseFloat(site.cpuLimit || "0.5"),
            memoryMb: site.memoryMb,
            timeout: site.timeoutSeconds,
          },
        },
        { jobId: `site-deploy-${newDeploymentId}` }
      );
    } catch (queueError) {
      console.error("[Sites] Failed to queue rollback job:", queueError);
      return c.json({ error: "Failed to queue rollback" }, 500);
    }

    return c.json({
      deployment,
      message: "Rollback queued successfully",
    });
  } catch (error) {
    console.error("[Sites] Error rolling back:", error);
    return c.json({ error: "Failed to rollback" }, 500);
  }
});

/**
 * GET /api/sites/:id/env
 * Get environment variables (values masked)
 */
app.get("/:id/env", async (c) => {
  const { id } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Mask sensitive values
    const maskedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(site.envVariables || {})) {
      if (key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("password") ||
          key.toLowerCase().includes("key") ||
          key.toLowerCase().includes("token")) {
        maskedEnv[key] = "********";
      } else {
        maskedEnv[key] = value;
      }
    }

    return c.json({
      envVariables: maskedEnv,
      count: Object.keys(site.envVariables || {}).length,
    });
  } catch (error) {
    console.error("[Sites] Error getting env vars:", error);
    return c.json({ error: "Failed to get environment variables" }, 500);
  }
});

/**
 * PUT /api/sites/:id/env
 * Update environment variables
 */
app.put("/:id/env", zValidator("json", updateEnvSchema), async (c) => {
  const { id } = c.req.param();
  const { envVariables } = c.req.valid("json");

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const [updatedSite] = await db
      .update(sites)
      .set({
        envVariables,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, id))
      .returning();

    return c.json({
      success: true,
      count: Object.keys(envVariables).length,
    });
  } catch (error) {
    console.error("[Sites] Error updating env vars:", error);
    return c.json({ error: "Failed to update environment variables" }, 500);
  }
});

/**
 * POST /api/sites/:id/upload
 * Upload a ZIP or tar.gz file to deploy without GitHub
 */
app.post("/:id/upload", async (c) => {
  const { id } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    const body = await c.req.parseBody();
    const file = body.file;

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded. Use form-data with 'file' field." }, 400);
    }

    const isZip = file.name.endsWith(".zip");
    const isTarGz = file.name.endsWith(".tar.gz") || file.name.endsWith(".tgz");

    if (!isZip && !isTarGz) {
      return c.json({ error: "Only ZIP and tar.gz files are supported" }, 400);
    }

    const siteSourceDir = join(SITES_SOURCE_DIR, id);

    try {
      await rm(siteSourceDir, { recursive: true, force: true });
    } catch (rmError) {
      console.warn(`[Sites] Failed to clean up source directory before upload: ${siteSourceDir}`, rmError);
    }
    await mkdir(siteSourceDir, { recursive: true });

    const fileBuffer = await file.arrayBuffer();

    // Track for direct tar.gz passthrough to build worker
    let directTarPath: string | undefined;

    if (isTarGz) {
      // For tar.gz, save the file and also extract for framework detection
      directTarPath = join(siteSourceDir, "source.tar.gz");
      await writeFile(directTarPath, Buffer.from(fileBuffer));

      // Extract to siteSourceDir for framework detection
      await tar.extract({
        file: directTarPath,
        cwd: siteSourceDir,
      });

      // Check for single root folder and flatten
      const contents = await readdir(siteSourceDir);
      const nonTarContents = contents.filter(f => f !== "source.tar.gz");
      if (nonTarContents.length === 1) {
        const rootFolder = nonTarContents[0];
        if (!rootFolder) {
          throw new Error("Failed to extract root folder from tar.gz");
        }
        const nestedPath = join(siteSourceDir, rootFolder);
        try {
          const nestedStat = await stat(nestedPath);
          if (nestedStat.isDirectory()) {
            const nestedContents = await readdir(nestedPath);
            for (const item of nestedContents) {
              const src = join(nestedPath, item);
              const dest = join(siteSourceDir, item);
              const srcStat = await stat(src);
              if (srcStat.isDirectory()) {
                await rename(src, dest);
              } else {
                await copyFile(src, dest);
              }
            }
            try {
              await rm(nestedPath, { recursive: true, force: true });
            } catch (rmError) {
              console.warn(`[Sites] Failed to remove nested tar.gz root folder: ${nestedPath}`, rmError);
            }
          }
        } catch {
          // Keep nested structure if move fails
        }
      }
    } else {
      // ZIP file handling
      const zip = new AdmZip(Buffer.from(fileBuffer));

      const entries = zip.getEntries();
      const rootFolders = new Set<string>();
      entries.forEach((entry) => {
        const parts = entry.entryName.split("/");
        if (parts.length > 1 && parts[0]) {
          rootFolders.add(parts[0]);
        }
      });

      zip.extractAllTo(siteSourceDir, true);

      if (rootFolders.size === 1) {
        const rootFolder = Array.from(rootFolders)[0];
        if (!rootFolder) {
          throw new Error("Failed to extract root folder from zip");
        }
        const nestedPath = join(siteSourceDir, rootFolder);

        try {
          const nestedStat = await stat(nestedPath);
          if (nestedStat.isDirectory()) {
            const nestedContents = await readdir(nestedPath);
            for (const item of nestedContents) {
              const src = join(nestedPath, item);
              const dest = join(siteSourceDir, item);
              const srcStat = await stat(src);
              if (srcStat.isDirectory()) {
                await rename(src, dest);
              } else {
                await copyFile(src, dest);
              }
            }
            try {
              await rm(nestedPath, { recursive: true, force: true });
            } catch (rmError) {
              console.warn(`[Sites] Failed to remove nested ZIP root folder: ${nestedPath}`, rmError);
            }
          }
        } catch {
          // Keep nested structure if move fails
        }
      }
    }

    let detectedFramework = site.framework;
    let detectedBuildCommand = site.buildCommand;
    const detectedInstallCommand = site.installCommand;

    try {
      const packageJsonPath = join(siteSourceDir, "package.json");
      const packageJsonContent = await readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageJsonContent);

      if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
        detectedFramework = "nextjs";
        detectedBuildCommand = detectedBuildCommand || "npm run build";
      } else if (
        packageJson.dependencies?.["@sveltejs/kit"] ||
        packageJson.devDependencies?.["@sveltejs/kit"]
      ) {
        detectedFramework = "sveltekit";
        detectedBuildCommand = detectedBuildCommand || "npm run build";
      } else {
        // Has package.json but no known framework - could be a custom or static site
        detectedFramework = "static";
      }

      if (packageJson.scripts?.build && !site.buildCommand) {
        detectedBuildCommand = "npm run build";
      }
    } catch {
      // No package.json or invalid JSON - treat as static site
      detectedFramework = "static";
    }

    const latestDeployment = await db.query.deployments.findFirst({
      where: eq(deployments.siteId, id),
      orderBy: [desc(deployments.version)],
    });

    const nextVersion = (latestDeployment?.version || 0) + 1;
    const targetSlot = latestDeployment?.slot === "blue" ? "green" : "blue";

    const deploymentId = nanoid();
    const [deployment] = await db
      .insert(deployments)
      .values({
        id: deploymentId,
        siteId: id,
        version: nextVersion,
        slot: targetSlot,
        branch: "upload",
        status: "pending",
        triggeredBy: "upload",
        commitMessage: `ZIP upload: ${file.name}`,
      })
      .returning();

    await db
      .update(sites)
      .set({
        status: "building",
        framework: detectedFramework,
        buildCommand: detectedBuildCommand || "npm run build",
        installCommand: detectedInstallCommand || "npm install",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, id));

    try {
      const redis = getRedisClient();
      const queue = new Queue("site-build", { connection: redis });

      await queue.add(
        `build-${deploymentId}`,
        {
          siteId: id,
          deploymentId,
          branch: "upload",
          envVariables: site.envVariables || {},
          buildCommand: detectedBuildCommand || site.buildCommand || "npm run build",
          installCommand: detectedInstallCommand || site.installCommand || "npm install",
          nodeVersion: site.nodeVersion || "22",
          framework: detectedFramework,
          // Pass direct tar.gz path if available, otherwise extracted source dir
          sourcePath: directTarPath || siteSourceDir,
          // Build resource configuration for executor-based builds
          buildConfig: {
            cpus: parseFloat(site.buildCpus || "1.0"),
            memoryMb: site.buildMemoryMb || 2048,
            timeoutSeconds: site.buildTimeoutSeconds || 900,
          },
        },
        { jobId: `site-build-${deploymentId}` }
      );
    } catch (queueError) {
      console.error("[Sites] Failed to queue build job:", queueError);

      await db
        .update(deployments)
        .set({
          status: "failed",
          errorMessage: "Failed to queue build job",
        })
        .where(eq(deployments.id, deploymentId));

      await db
        .update(sites)
        .set({
          status: "error",
          updatedAt: new Date(),
        })
        .where(eq(sites.id, id));

      return c.json({ error: "Failed to queue deployment" }, 500);
    }

    return c.json({
      success: true,
      message: `${isTarGz ? "tar.gz" : "ZIP"} uploaded and deployment queued`,
      deployment,
      stats: {
        originalFileName: file.name,
        detectedFramework,
        directTarPath: directTarPath ? true : false,
      },
    });
  } catch (error) {
    console.error("[Sites] Error uploading archive:", error);
    return c.json({ error: "Failed to upload file" }, 500);
  }
});

/**
 * GET /api/sites/:id/domains
 * Get all domains for a site
 */
app.get("/:id/domains", async (c) => {
  const { id } = c.req.param();

  try {
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
    });

    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }

    // Import domains from schema
    const { domains: domainsTable } = await import("@uni-proxy-manager/database/schema");

    const siteDomainRecords = await db.query.siteDomains.findMany({
      where: eq(siteDomains.siteId, id),
      with: {
        domain: true,
      },
    });

    return c.json({ siteDomains: siteDomainRecords });
  } catch (error) {
    console.error("[Sites] Error getting domains:", error);
    return c.json({ error: "Failed to get domains" }, 500);
  }
});

export default app;
