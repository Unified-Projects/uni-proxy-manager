import { type Job } from "bullmq";
import { Queue } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments, githubConnections, s3Providers } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { getGitHubApp, isGitHubAppConfigured } from "@uni-proxy-manager/shared/github";
import { getOpenRuntimesClient } from "@uni-proxy-manager/shared/openruntimes";
import { S3Service, joinS3Key } from "@uni-proxy-manager/shared/s3";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { SiteBuildJobData, SiteBuildResult, SiteDeployJobData } from "@uni-proxy-manager/queue";
import { spawn } from "child_process";
import { mkdir, rm, writeFile, readFile, stat, access, copyFile } from "fs/promises";
import * as tar from "tar";
import { join } from "path";

const BUILD_DIR = process.env.SITES_BUILD_DIR || "/tmp/builds";
const ARTIFACTS_DIR = process.env.SITES_ARTIFACTS_DIR || "/data/sites/artifacts";
const STORAGE_DIR = process.env.SITES_STORAGE_DIR || "/storage/functions";
const BUILDS_DIR = process.env.SITES_BUILDS_DIR || "/storage/builds";

const USE_EXECUTOR_BUILDS = process.env.SITES_USE_EXECUTOR_BUILDS !== "false";

interface BuildContext {
  workDir: string;
  artifactPath: string;
  logs: string[];
}

// SSR detection patterns per framework
const SSR_DETECTION: Record<string, {
  patterns: string[];
  entryPoint: string;
  runtimePath: string;
}> = {
  nextjs: {
    patterns: [".next/standalone/server.js", ".next/server"],
    entryPoint: "server.js",
    // After bundling, server.js is at root, not in .next/standalone
    // server.sh handles this correctly - it looks for ./server.js
    runtimePath: "",
  },
  sveltekit: {
    patterns: ["build/index.js", "build/server"],
    entryPoint: "index.js",
    runtimePath: "build",
  },
  astro: {
    patterns: ["dist/server/entry.mjs", "dist/server"],
    entryPoint: "entry.mjs",
    runtimePath: "dist/server",
  },
};

// Framework-specific build configurations (URT-compatible)
// URT v5 uses standard npm commands, no PHP helper scripts
const FRAMEWORK_BUILD_CONFIG: Record<string, {
  envCommand?: string;
  bundleCommand?: string;
  outputDirectory: string;
  buildCommand?: string;
  installCommand?: string;
}> = {
  nextjs: {
    envCommand: undefined,
    bundleCommand: undefined,
    outputDirectory: "./.next",
    buildCommand: "npx next build",
    installCommand: undefined,
  },
  sveltekit: {
    envCommand: undefined,
    bundleCommand: undefined,
    outputDirectory: "./.svelte-kit",
    buildCommand: undefined,
    installCommand: undefined,
  },
  astro: {
    envCommand: undefined,
    bundleCommand: undefined,
    outputDirectory: "./dist",
    buildCommand: undefined,
    installCommand: undefined,
  },
  static: {
    envCommand: undefined,
    bundleCommand: undefined,
    outputDirectory: "dist",
    buildCommand: undefined,
    installCommand: undefined,
  },
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Execute build using URT executor (Unified Runtimes)
 *
 * This uses URT's buildRuntime() which:
 * 1. Creates a build container
 * 2. Runs the build command via bash
 * 3. Packages the output with proper .open-runtimes marker
 * 4. Returns the artifact path
 *
 * If sourceTarPath is provided (direct tar.gz upload), it skips repacking
 * and uses the uploaded tarball directly.
 */
async function executeExecutorBuild(params: {
  siteId: string;
  deploymentId: string;
  sourceDir: string;
  sourceTarPath?: string; // Direct tar.gz upload path (skip repacking)
  framework: string;
  nodeVersion: string;
  installCommand: string;
  buildCommand: string;
  buildFlags?: string[];
  outputDirectory?: string;
  envVariables: Record<string, string>;
  buildConfig: { cpus: number; memoryMb: number; timeoutSeconds: number };
  s3?: S3Service | null;
  s3PathPrefix?: string;
  log: (message: string) => Promise<void>;
}): Promise<{
  artifactPath: string;
  artifactSize: number;
  logs: string;
}> {
  const {
    siteId,
    deploymentId,
    sourceDir,
    sourceTarPath: directTarPath,
    framework,
    nodeVersion,
    installCommand,
    buildCommand,
    buildFlags,
    outputDirectory,
    envVariables,
    s3 = null,
    s3PathPrefix,
    log,
  } = params;

  // Enforce minimum resources for builds (matching Appwrite's approach)
  // Some frameworks need more memory and CPUs to compile
  let minMemory = 2048; // Default minimum for sites
  let minCpus = 1;
  if (framework === "nextjs") {
    minMemory = 8192; // Next.js 15 needs significant memory for webpack compilation
    minCpus = 2; // Parallel compilation benefits from multiple CPUs
  } else if (framework === "sveltekit" || framework === "astro") {
    minMemory = 4096;
    minCpus = 2;
  }
  const buildConfig = {
    cpus: Math.max(params.buildConfig.cpus, minCpus),
    memoryMb: Math.max(params.buildConfig.memoryMb, minMemory),
    timeoutSeconds: Math.max(params.buildConfig.timeoutSeconds, 900), // At least 15 minutes
  };

  const openruntimes = getOpenRuntimesClient();

  await mkdir(BUILDS_DIR, { recursive: true });
  let sourceTarPath: string;
  let needsCleanup = false;
  let s3SourceKey: string | null = null;

  if (s3) {
    // S3 mode: upload source to S3, executor fetches it directly
    s3SourceKey = joinS3Key(s3PathPrefix, `builds/${deploymentId}/source.tar.gz`);
    if (directTarPath && directTarPath.endsWith(".tar.gz")) {
      await log(`Uploading source to S3: ${s3SourceKey}`);
      const tarBuffer = await readFile(directTarPath);
      await s3.upload(s3SourceKey, tarBuffer, { contentType: "application/gzip" });
      const sourceStats = await stat(directTarPath);
      await log(`Source uploaded: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB (direct upload, no repacking)`);
    } else {
      await log("Packaging source code and uploading to S3...");
      const tmpTarPath = `/tmp/${deploymentId}-source.tar.gz`;
      await tar.create(
        {
          gzip: true,
          file: tmpTarPath,
          cwd: sourceDir,
          portable: true,
          noMtime: true,
        },
        ["."]
      );
      const tarBuffer = await readFile(tmpTarPath);
      await s3.upload(s3SourceKey, tarBuffer, { contentType: "application/gzip" });
      const sourceStats = await stat(tmpTarPath);
      await log(`Source packaged and uploaded: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB`);
      try {
        await rm(tmpTarPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    sourceTarPath = s3SourceKey;
  } else {
    if (directTarPath && directTarPath.endsWith(".tar.gz")) {
      // Direct tar.gz upload - use it directly without repacking
      await log(`Using direct tar.gz upload: ${directTarPath}`);

      // Copy to BUILDS_DIR so executor can access it
      sourceTarPath = join(BUILDS_DIR, `${siteId}-${deploymentId}-source.tar.gz`);
      await copyFile(directTarPath, sourceTarPath);
      needsCleanup = true;

      const sourceStats = await stat(sourceTarPath);
      await log(`Source tarball: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB (direct upload, no repacking)`);
    } else {
      // Create tarball from source directory
      await log("Packaging source code for executor build...");
      sourceTarPath = join(BUILDS_DIR, `${siteId}-${deploymentId}-source.tar.gz`);
      needsCleanup = true;

      // Create tarball of source directory
      // Use portable: true to avoid macOS-specific extended attributes
      await tar.create(
        {
          gzip: true,
          file: sourceTarPath,
          cwd: sourceDir,
          portable: true, // Avoid OS-specific attributes
          noMtime: true,  // Avoid mtime issues
        },
        ["."]
      );

      const sourceStats = await stat(sourceTarPath);
      await log(`Source packaged: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  // OpenRuntimes image tags: node 22+ uses just major version ("22", "23"), older versions use "20.0", "18.0" etc.
  let runtimeNodeVersion: string;
  const majorVersion = nodeVersion.split(".")[0] || "20";
  if (parseInt(majorVersion, 10) >= 22) {
    runtimeNodeVersion = majorVersion;
  } else {
    runtimeNodeVersion = nodeVersion.includes(".") ? nodeVersion : `${nodeVersion}.0`;
  }
  const runtimeImage = `openruntimes/node:v5-${runtimeNodeVersion}`;
  const defaultFrameworkConfig = { envCommand: "", bundleCommand: "", outputDirectory: "dist", buildCommand: undefined, installCommand: undefined };
  const frameworkConfig = FRAMEWORK_BUILD_CONFIG[framework] ?? defaultFrameworkConfig;
  const finalOutputDir = outputDirectory || frameworkConfig.outputDirectory;

  // Build the full command (matches Appwrite's getCommand logic)
  const commands: string[] = [];

  // Add env command if exists
  if (frameworkConfig.envCommand) {
    commands.push(frameworkConfig.envCommand);
  }

  // Add install command
  commands.push(installCommand);

  const effectiveBuildCommand = buildCommand || frameworkConfig.buildCommand;
  if (effectiveBuildCommand) {
    const fullBuildCommand = buildFlags && buildFlags.length > 0
      ? `${effectiveBuildCommand} ${buildFlags.join(" ")}`
      : effectiveBuildCommand;
    commands.push(fullBuildCommand);
  }

  // Add framework bundle command if exists
  if (frameworkConfig.bundleCommand) {
    commands.push(frameworkConfig.bundleCommand);
  }

  const finalCommand = commands.filter(Boolean).join(" && ");
  await log(`URT build command: ${finalCommand}`);
  await log(`Output directory: ${finalOutputDir}`);

  const destination = s3
    ? joinS3Key(s3PathPrefix, `artifacts/${siteId}/${deploymentId}`)
    : `${BUILDS_DIR}/site-${siteId}`;
  if (!s3) {
    await mkdir(destination, { recursive: true });
  }

  await log(`Starting URT build with image: ${runtimeImage}`);
  await log(`Build resources: ${buildConfig.cpus} CPUs, ${buildConfig.memoryMb}MB RAM, ${buildConfig.timeoutSeconds}s timeout`);
  await log(`Source tarball: ${sourceTarPath}`);
  await log(`Destination: ${destination}`);
  await log(`Build command: ${finalCommand}`);
  await log(`Output directory: ${finalOutputDir}`);

  // Call URT buildRuntime - this is synchronous, logs come back in response
  // URT-style: build runs, waits for completion, returns logs
  // Merge user env vars with required build env vars (NODE_ENV=production is critical for Next.js)
  const buildVariables: Record<string, string> = {
    NODE_ENV: "production",
    ...envVariables, // User vars can override if needed
  };

  let buildResult;
  try {
    buildResult = await openruntimes.buildRuntime({
      deploymentId,
      projectId: siteId,
      source: sourceTarPath,
      image: runtimeImage,
      version: "v5",
      cpus: buildConfig.cpus,
      memory: buildConfig.memoryMb,
      timeout: buildConfig.timeoutSeconds,
      remove: true, // Remove build container after completion
      destination,
      variables: buildVariables,
      command: finalCommand,
      outputDirectory: finalOutputDir,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await log(`[ERROR] URT build failed: ${errorMsg}`);
    throw error;
  }

  await log(`Build completed! Artifact: ${buildResult.path} (${(buildResult.size / 1024 / 1024).toFixed(2)} MB)`);

  // Get logs from build result - executor may return logs in different formats
  let combinedLogs = "";
  if (buildResult.output) {
    if (Array.isArray(buildResult.output)) {
      combinedLogs = buildResult.output.map((o) => typeof o === "string" ? o : o.content || "").join("");
    } else if (typeof buildResult.output === "string") {
      combinedLogs = buildResult.output;
    }
  }
  // Also check for logs field (some executor versions use this)
  const resultAny = buildResult as unknown as Record<string, unknown>;
  if (!combinedLogs && resultAny.logs) {
    const logs = resultAny.logs;
    combinedLogs = typeof logs === "string" ? logs : JSON.stringify(logs);
  }

  // Stream build output to our log system
  if (combinedLogs) {
    await log(`[build] --- Build Output ---`);
    const lines = combinedLogs.split("\n").filter(Boolean);
    for (const line of lines) {
      await log(`[build] ${line}`);
    }
    await log(`[build] --- End Build Output ---`);
  } else {
    await log(`[build] No build output captured (logs may have been streamed separately)`);
  }

  if (s3) {
    // S3 mode: executor wrote artifact to S3, clean up source key
    if (s3SourceKey) {
      try {
        await s3.delete(s3SourceKey);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      artifactPath: buildResult.path,
      artifactSize: buildResult.size,
      logs: combinedLogs,
    };
  } else {
    const artifactLocalPath = join(STORAGE_DIR, deploymentId, "artifact.tar.gz");
    await mkdir(join(STORAGE_DIR, deploymentId), { recursive: true });

    await copyFile(buildResult.path, artifactLocalPath);

    // Clean up source tarball (only if we created it)
    if (needsCleanup) {
      try {
        await rm(sourceTarPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      artifactPath: `local:${artifactLocalPath}`,
      artifactSize: buildResult.size,
      logs: combinedLogs,
    };
  }
}

export async function processSiteBuild(
  job: Job<SiteBuildJobData>
): Promise<SiteBuildResult> {
  const {
    siteId,
    deploymentId,
    branch,
    framework,
    buildCommand,
    installCommand,
    nodeVersion,
    envVariables,
    buildFlags,
    outputDirectory,
    commitSha,
    sourcePath,
    buildConfig,
  } = job.data;

  const startTime = Date.now();
  const redis = getRedisClient();
  const logChannel = `deployment-logs:${deploymentId}`;
  const statusChannel = `deployment-status:${deploymentId}`;
  const cancelChannel = `deployment-cancel:${deploymentId}`;

  const ctx: BuildContext = {
    workDir: join(BUILD_DIR, deploymentId),
    artifactPath: "",
    logs: [],
  };

  const logBufferKey = `deployment-logs-buffer:${deploymentId}`;

  const log = async (message: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;
    ctx.logs.push(logLine);

    // Store in Redis list for persistence (survives reconnects)
    await redis.rpush(logBufferKey, logLine);
    await redis.expire(logBufferKey, 86400); // 24 hour TTL

    // Publish for real-time subscribers
    await redis.publish(logChannel, logLine);

    console.log(`[Build ${deploymentId}] ${message}`);

    // Periodically flush logs to database during build
    if (ctx.logs.length % 50 === 0) {
      await db
        .update(deployments)
        .set({ buildLogs: ctx.logs.join("\n") })
        .where(eq(deployments.id, deploymentId));
    }
  };

  let cancelled = false;
  const subscriber = redis.duplicate();
  subscriber.on("message", (channel) => {
    if (channel === cancelChannel) {
      cancelled = true;
    }
  });
  await subscriber.subscribe(cancelChannel);

  try {
    await log("Starting build process...");
    await log(`Node.js version: ${nodeVersion}`);
    await log(`Framework: ${framework}`);
    await log(`Build resources: ${buildConfig.cpus} CPUs, ${buildConfig.memoryMb}MB RAM, ${buildConfig.timeoutSeconds}s timeout`);

    // Update deployment status to building
    await db
      .update(deployments)
      .set({
        status: "building",
        buildStartedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));

    await redis.publish(statusChannel, JSON.stringify({ status: "building" }));

    await log("Phase 1: Preparing source code...");

    await mkdir(ctx.workDir, { recursive: true });
    await mkdir(join(STORAGE_DIR, deploymentId), { recursive: true });

    // Get site info
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    // Track if source is a direct tar.gz upload (skip repacking in executor build)
    let directTarPath: string | undefined;

    // Get source: either from uploaded path, GitHub, or error
    if (sourcePath) {
      if (sourcePath.endsWith(".tar.gz")) {
        // Direct tar.gz upload - pass to executor without repacking
        await log(`Using direct tar.gz upload: ${sourcePath}`);
        directTarPath = sourcePath;
        // Still extract to workDir for SSR detection and local builds
        await tar.extract({ file: sourcePath, cwd: ctx.workDir });
        await log("Source tarball extracted to work directory");
      } else {
        // Directory upload - copy files
        await log(`Using pre-uploaded source from: ${sourcePath}`);
        await runCommand("cp", ["-r", `${sourcePath}/.`, "."], ctx.workDir, log);
        await log("Source files copied to work directory");
      }
    } else {
      const github = await db.query.githubConnections.findFirst({
        where: eq(githubConnections.siteId, siteId),
      });

      if (github && isGitHubAppConfigured()) {
        await log("Cloning repository from GitHub...");
        const gitHubApp = getGitHubApp();
        const repoParts = github.repositoryFullName.split("/");
        const owner = repoParts[0];
        const repo = repoParts[1];

        if (!owner || !repo) {
          throw new Error(`Invalid repository format: ${github.repositoryFullName}`);
        }

        const cloneUrl = await gitHubApp.getAuthenticatedCloneUrl(
          github.installationId,
          owner,
          repo
        );

        await runCommand(
          "git",
          ["clone", "--depth", "1", "--branch", branch, cloneUrl, "."],
          ctx.workDir,
          log
        );
        await log("Repository cloned successfully");

        if (!commitSha) {
          const latestCommit = await gitHubApp.getLatestCommit(
            github.installationId,
            owner,
            repo,
            branch
          );
          await db
            .update(deployments)
            .set({
              commitSha: latestCommit.sha,
              commitMessage: latestCommit.message,
            })
            .where(eq(deployments.id, deploymentId));
        }
      } else {
        throw new Error("No source files available. Either connect GitHub or upload a ZIP file.");
      }
    }

    if (cancelled) {
      throw new Error("Build cancelled");
    }

    // Write .nvmrc for node version
    await writeFile(join(ctx.workDir, ".nvmrc"), nodeVersion);
    await log(`Using Node.js ${nodeVersion}`);

    // Write environment variables to .env file
    if (Object.keys(envVariables).length > 0) {
      const envContent = Object.entries(envVariables)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      await writeFile(join(ctx.workDir, ".env"), envContent);
      await log(`Wrote ${Object.keys(envVariables).length} environment variables`);
    }

    if (cancelled) {
      throw new Error("Build cancelled");
    }

    // Detection variables for SSR detection (used later in deploy job)
    let detectedRenderMode: "ssr" | "ssg" = "ssg";
    let resolvedEntryPoint = site.entryPoint || undefined;
    let resolvedRuntimePath = site.runtimePath || undefined;
    let artifactStats: { size: number };

    // Check for S3 provider (used for caching and backup)
    const s3Provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.usedForArtifacts, true),
    });

    const s3Service = s3Provider ? new S3Service({
      endpoint: s3Provider.endpoint,
      region: s3Provider.region,
      bucket: s3Provider.bucket,
      accessKeyId: s3Provider.accessKeyId,
      secretAccessKey: s3Provider.secretAccessKey,
    }) : null;
    const s3PathPrefix = s3Provider?.pathPrefix || undefined;

    if (USE_EXECUTOR_BUILDS) {
      await log("Using URT executor for build...");

      const executorResult = await executeExecutorBuild({
        siteId,
        deploymentId,
        sourceDir: ctx.workDir,
        sourceTarPath: directTarPath, // Pass direct tar.gz to skip repacking
        framework,
        nodeVersion,
        installCommand,
        buildCommand,
        buildFlags,
        outputDirectory,
        envVariables,
        buildConfig: {
          cpus: buildConfig.cpus,
          memoryMb: buildConfig.memoryMb,
          timeoutSeconds: buildConfig.timeoutSeconds,
        },
        s3: s3Service,
        s3PathPrefix,
        log,
      });

      ctx.artifactPath = executorResult.artifactPath;
      artifactStats = { size: executorResult.artifactSize };

      // Detect SSR/SSG based on framework patterns
      const detection = SSR_DETECTION[framework];
      if (detection) {
        // Check if standalone/server files exist in source before build
        // The executor handles proper packaging with .open-runtimes file
        for (const pattern of detection.patterns) {
          const checkPath = join(ctx.workDir, pattern);
          if (await fileExists(checkPath)) {
            detectedRenderMode = "ssr";
            resolvedEntryPoint = resolvedEntryPoint || detection.entryPoint;
            resolvedRuntimePath = resolvedRuntimePath || detection.runtimePath;
            await log(`Detected SSR: Found ${pattern}`);
            break;
          }
        }
      }

      await log(`URT build completed: ${executorResult.artifactPath}`);

    } else {
      await log("Phase 2: Installing dependencies (local build)...");

      if (s3Service) {
        try {
          const cacheKey = joinS3Key(s3PathPrefix, `cache/${siteId}/node_modules.tar.gz`);
          const cacheBuffer = await s3Service.downloadBuffer(cacheKey);
          const cachePath = join(ctx.workDir, "node_modules_cache.tar.gz");
          await writeFile(cachePath, cacheBuffer);
          await tar.extract({
            file: cachePath,
            cwd: ctx.workDir,
          });
          await rm(cachePath);
          await log("Restored node_modules from cache");
        } catch {
          await log("No cache found, performing fresh install");
        }
      }

      // Run install command
      await log(`Running: ${installCommand}`);
      await runShellCommand(installCommand, ctx.workDir, log, envVariables, buildConfig.timeoutSeconds);

      if (cancelled) {
        throw new Error("Build cancelled");
      }

      // Run build command - user's buildCommand takes precedence, framework config is fallback
      await log("Phase 3: Building application...");
      const frameworkBuildConfig = FRAMEWORK_BUILD_CONFIG[framework];
      const effectiveBuildCmd = buildCommand || frameworkBuildConfig?.buildCommand;

      if (!effectiveBuildCmd) {
        throw new Error(`No build command specified and no default build command for framework: ${framework}`);
      }

      const fullBuildCommand = buildFlags && buildFlags.length > 0
        ? `${effectiveBuildCmd} ${buildFlags.join(" ")}`
        : effectiveBuildCmd;

      await log(`Running: ${fullBuildCommand}`);
      await runShellCommand(fullBuildCommand, ctx.workDir, log, envVariables, buildConfig.timeoutSeconds);

      if (cancelled) {
        throw new Error("Build cancelled");
      }

      await log("Phase 4: Processing build output...");

      // Detect SSR vs SSG
      const detection = SSR_DETECTION[framework];
      if (detection) {
        for (const pattern of detection.patterns) {
          const checkPath = join(ctx.workDir, pattern);
          if (await fileExists(checkPath)) {
            detectedRenderMode = "ssr";
            resolvedEntryPoint = resolvedEntryPoint || detection.entryPoint;
            resolvedRuntimePath = resolvedRuntimePath || detection.runtimePath;
            await log(`Detected SSR: Found ${pattern}`);
            break;
          }
        }
      }

      // Determine output directory based on framework
      let output = outputDirectory;
      if (!output) {
        switch (framework) {
          case "nextjs":
            output = ".next";
            break;
          case "sveltekit":
            output = ".svelte-kit";
            break;
          case "static":
            output = "dist";
            break;
          default:
            output = "dist";
        }
      }

      await log(`Packaging build output from: ${output}`);

      // Create artifact for deployment (stored in STORAGE_DIR for executor access)
      const artifactName = "artifact.tar.gz";
      const artifactLocalPath = join(STORAGE_DIR, deploymentId, artifactName);

      // Package the build output
      const outputPath = join(ctx.workDir, output);
      const nodeModulesPath = join(ctx.workDir, "node_modules");
      const packageJsonPath = join(ctx.workDir, "package.json");

      const filesToPackage: string[] = [];
      if (await fileExists(outputPath)) filesToPackage.push(output);
      if (await fileExists(nodeModulesPath)) filesToPackage.push("node_modules");
      if (await fileExists(packageJsonPath)) filesToPackage.push("package.json");

      // For SSR, also include standalone directory if it exists
      if (detectedRenderMode === "ssr" && framework === "nextjs") {
        const standalonePath = join(ctx.workDir, ".next", "standalone");
        if (await fileExists(standalonePath)) {
          await log("Including Next.js standalone build");
        }
      }

      if (filesToPackage.length === 0) {
        throw new Error(`No build output found. Expected: ${output}`);
      }

      await log(`Creating artifact with: ${filesToPackage.join(", ")}`);

      await tar.create(
        {
          gzip: true,
          file: artifactLocalPath,
          cwd: ctx.workDir,
        },
        filesToPackage
      );

      artifactStats = await stat(artifactLocalPath);
      await log(`Artifact created: ${(artifactStats.size / 1024 / 1024).toFixed(2)} MB`);

      // Store artifact path - use local storage by default for executor access
      // The executor needs direct file system access to the artifact
      ctx.artifactPath = `local:${artifactLocalPath}`;
      await log(`Artifact stored at: ${artifactLocalPath}`);
    }

    // Update site with detected configuration (both paths)
    if (
      resolvedEntryPoint !== site.entryPoint ||
      resolvedRuntimePath !== site.runtimePath
    ) {
      await db
        .update(sites)
        .set({
          entryPoint: resolvedEntryPoint,
          runtimePath: resolvedRuntimePath,
          updatedAt: new Date(),
        })
        .where(eq(sites.id, siteId));

      await log(
        `Updated runtime config: entryPoint=${resolvedEntryPoint || "n/a"}, runtimePath=${resolvedRuntimePath || "n/a"}`
      );
    }

    // S3 artifact handling
    if (s3Provider && s3Service) {
      if (USE_EXECUTOR_BUILDS) {
        // Executor already wrote artifact to S3; ctx.artifactPath is already the S3 key
        await log(`Artifact already in S3 at: ${ctx.artifactPath}`);
      } else {
        // Local build: upload artifact to S3 and switch to S3 key
        try {
          await log("Uploading artifact to S3...");
          const s3ArtifactPath = joinS3Key(s3PathPrefix, `artifacts/${siteId}/${deploymentId}.tar.gz`);

          const localArtifactPath = ctx.artifactPath.startsWith("local:")
            ? ctx.artifactPath.substring(6)
            : join(STORAGE_DIR, deploymentId, "artifact.tar.gz");

          const artifactBuffer = await readFile(localArtifactPath);
          await s3Service.upload(s3ArtifactPath, artifactBuffer, {
            contentType: "application/gzip",
          });
          await log("Artifact uploaded to S3");

          // Use S3 key as artifact path going forward (no local: prefix)
          ctx.artifactPath = s3ArtifactPath;

          // Update build cache
          try {
            await log("Updating build cache...");
            const cacheLocalPath = join(BUILD_DIR, `${siteId}_cache.tar.gz`);
            const nodeModulesPath = join(ctx.workDir, "node_modules");
            if (await fileExists(nodeModulesPath)) {
              await tar.create(
                {
                  gzip: true,
                  file: cacheLocalPath,
                  cwd: ctx.workDir,
                },
                ["node_modules"]
              );
              const cacheBuffer = await readFile(cacheLocalPath);
              const cacheKey = joinS3Key(s3PathPrefix, `cache/${siteId}/node_modules.tar.gz`);
              await s3Service.upload(cacheKey, cacheBuffer, {
                contentType: "application/gzip",
              });
              await rm(cacheLocalPath);
              await log("Build cache updated");
            }
          } catch (cacheError) {
            await log(`Cache update failed (non-fatal): ${cacheError}`);
          }
        } catch (s3Error) {
          await log(`S3 upload failed (non-fatal): ${s3Error}`);
        }
      }
    }

    const buildDuration = Date.now() - startTime;

    // Update deployment with build info
    await db
      .update(deployments)
      .set({
        status: "deploying",
        artifactPath: ctx.artifactPath,
        artifactSize: artifactStats.size,
        buildCompletedAt: new Date(),
        buildDurationMs: buildDuration,
        buildLogs: ctx.logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    await redis.publish(statusChannel, JSON.stringify({ status: "deploying" }));

    // Queue deploy job
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (deployment) {
      const deployQueue = new Queue<SiteDeployJobData>(QUEUES.SITE_DEPLOY, { connection: redis });

      await deployQueue.add(
        `deploy-${deploymentId}`,
        {
          siteId,
          deploymentId,
          targetSlot: deployment.slot || "blue",
          artifactPath: ctx.artifactPath,
          runtimeConfig: {
            cpus: parseFloat(site.cpuLimit || "0.5"),
            memoryMb: site.memoryMb || 256,
            timeout: site.timeoutSeconds || 30,
          },
          entryPoint: resolvedEntryPoint,
          runtimePath: resolvedRuntimePath,
        },
        { jobId: `site-deploy-${deploymentId}` }
      );
    }

    await log(`Build completed in ${(buildDuration / 1000).toFixed(1)}s`);

    // Clean up work directory (keep artifact in STORAGE_DIR for deploy)
    await rm(ctx.workDir, { recursive: true, force: true });

    // Set shorter TTL on log buffer (1 hour after completion for late reconnects)
    await redis.expire(logBufferKey, 3600);

    await subscriber.unsubscribe(cancelChannel);
    await subscriber.quit();

    return {
      success: true,
      deploymentId,
      artifactPath: ctx.artifactPath,
      artifactSize: artifactStats.size,
      buildDurationMs: buildDuration,
      detectedRenderMode,
      detectedEntryPoint: resolvedEntryPoint,
      detectedRuntimePath: resolvedRuntimePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await log(`Build failed: ${errorMessage}`);

    // Update deployment status
    await db
      .update(deployments)
      .set({
        status: cancelled ? "cancelled" : "failed",
        errorMessage,
        buildCompletedAt: new Date(),
        buildLogs: ctx.logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    // Update site status
    await db
      .update(sites)
      .set({
        status: "error",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, siteId));

    await redis.publish(statusChannel, JSON.stringify({
      status: cancelled ? "cancelled" : "failed",
      error: errorMessage
    }));

    // Clean up
    try {
      await rm(ctx.workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Set shorter TTL on log buffer (1 hour after completion for late reconnects)
    await redis.expire(logBufferKey, 3600);

    await subscriber.unsubscribe(cancelChannel);
    await subscriber.quit();

    return {
      success: false,
      deploymentId,
      error: errorMessage,
    };
  }
}

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  log: (msg: string) => Promise<void>,
  env?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
        HOME: cwd,
        PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((line: string) => log(`[stdout] ${line}`));
    });

    proc.stderr.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((line: string) => log(`[stderr] ${line}`));
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start process: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}

async function runShellCommand(
  command: string,
  cwd: string,
  log: (msg: string) => Promise<void>,
  envVars: Record<string, string>,
  timeoutSeconds: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      env: {
        ...process.env,
        ...envVars,
        HOME: cwd,
        PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Build command timed out after ${timeoutSeconds} seconds`));
    }, timeoutSeconds * 1000);

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((line: string) => log(`[stdout] ${line}`));
    });

    proc.stderr.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((line: string) => log(`[stderr] ${line}`));
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start process: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build command failed with exit code ${code}`));
      }
    });
  });
}
