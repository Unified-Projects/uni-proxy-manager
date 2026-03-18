export type Framework = "nextjs" | "sveltekit" | "static" | "custom";
export type RenderMode = "ssr" | "ssg" | "hybrid";

/**
 * Subset of Site properties used by builder utilities.
 * Defined locally to avoid circular dependency with database package.
 */
export interface SiteBuildConfig {
  buildCommand?: string | null;
  outputDirectory?: string | null;
  envVariables?: Record<string, string> | null;
  framework?: Framework | null;
}

export interface FrameworkConfig {
  framework: Framework;
  renderMode: RenderMode;
  buildCommand: string;
  installCommand: string;
  outputDirectory: string;
  nodeVersion: string;
  entryPoint?: string;
  runtimePath?: string;
  envPrefix?: string[];
}

export interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DetectionResult {
  framework: Framework;
  renderMode: RenderMode;
  confidence: number;
  details: string;
}

/**
 * Detect framework from package.json
 */
export function detectFramework(packageJson: PackageJson): DetectionResult {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (deps["next"]) {
    const hasExport = packageJson.scripts?.build?.includes("next export");
    const hasOutput = packageJson.scripts?.build?.includes("output");

    return {
      framework: "nextjs",
      renderMode: hasExport ? "ssg" : "hybrid",
      confidence: 0.95,
      details: `Next.js ${deps["next"]} detected`,
    };
  }

  if (deps["@sveltejs/kit"]) {
    const hasAdapter = Object.keys(deps).some(
      (key) =>
        key.startsWith("@sveltejs/adapter-") && key !== "@sveltejs/adapter-auto"
    );

    let renderMode: RenderMode = "hybrid";
    if (deps["@sveltejs/adapter-static"]) {
      renderMode = "ssg";
    } else if (deps["@sveltejs/adapter-node"]) {
      renderMode = "ssr";
    }

    return {
      framework: "sveltekit",
      renderMode,
      confidence: 0.95,
      details: `SvelteKit ${deps["@sveltejs/kit"]} detected`,
    };
  }

  if (deps["astro"]) {
    return {
      framework: "static",
      renderMode: "ssg",
      confidence: 0.9,
      details: `Astro ${deps["astro"]} detected`,
    };
  }

  if (deps["gatsby"]) {
    return {
      framework: "static",
      renderMode: "ssg",
      confidence: 0.9,
      details: `Gatsby ${deps["gatsby"]} detected`,
    };
  }

  if (deps["vite"] && !deps["react"] && !deps["vue"]) {
    return {
      framework: "static",
      renderMode: "ssg",
      confidence: 0.7,
      details: "Vite detected (assuming static)",
    };
  }

  return {
    framework: "static",
    renderMode: "ssg",
    confidence: 0.5,
    details: "Unknown framework, defaulting to static",
  };
}

/**
 * Get default configuration for a framework
 */
export function getFrameworkDefaults(
  framework: Framework,
  packageJson?: PackageJson
): FrameworkConfig {
  const baseConfig: FrameworkConfig = {
    framework,
    renderMode: "ssg",
    buildCommand: packageJson?.scripts?.build ? "npm run build" : "echo 'No build script'",
    installCommand: "npm install",
    outputDirectory: "dist",
    nodeVersion: "20",
  };

  switch (framework) {
    case "nextjs":
      return {
        ...baseConfig,
        renderMode: "hybrid",
        outputDirectory: ".next",
        entryPoint: "server.js",
        runtimePath: ".next/standalone",
        envPrefix: ["NEXT_PUBLIC_"],
      };

    case "sveltekit":
      return {
        ...baseConfig,
        renderMode: "hybrid",
        outputDirectory: "build",
        entryPoint: "index.js",
        runtimePath: "build",
        envPrefix: ["PUBLIC_", "VITE_"],
      };

    case "static":
      return {
        ...baseConfig,
        renderMode: "ssg",
        outputDirectory: "dist",
      };

    case "custom":
    default:
      return baseConfig;
  }
}

/**
 * Generate build environment variables
 */
export function generateBuildEnv(
  site: Pick<SiteBuildConfig, "envVariables" | "framework">,
  additionalEnv?: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: "production",
    CI: "true",
    ...additionalEnv,
  };

  if (site.envVariables) {
    Object.assign(env, site.envVariables);
  }

  switch (site.framework) {
    case "nextjs":
      env.NEXT_TELEMETRY_DISABLED = "1";
      break;
    case "sveltekit":
      env.VITE_BUILD_TIME = new Date().toISOString();
      break;
  }

  return env;
}

/**
 * Get the start command for a deployed site
 */
export function getStartCommand(
  framework: Framework,
  renderMode: RenderMode
): string {
  if (renderMode === "ssg") {
    return "npx serve -s";
  }

  switch (framework) {
    case "nextjs":
      return "node server.js";
    case "sveltekit":
      return "node build/index.js";
    default:
      return "node server.js";
  }
}

/**
 * Get port configuration for runtime
 */
export function getRuntimePort(framework: Framework): number {
  switch (framework) {
    case "nextjs":
      return 3000;
    case "sveltekit":
      return 3000;
    default:
      return 3000;
  }
}

/**
 * Validate build configuration
 */
export function validateBuildConfig(config: Partial<FrameworkConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.buildCommand?.trim()) {
    errors.push("Build command is required");
  }

  if (!config.outputDirectory?.trim()) {
    errors.push("Output directory is required");
  }

  const nodeVersionMatch = config.nodeVersion?.match(/^(\d+)(\.\d+)?(\.\d+)?$/);
  if (!nodeVersionMatch || !nodeVersionMatch[1]) {
    errors.push("Invalid Node.js version format");
  } else {
    const majorVersion = parseInt(nodeVersionMatch[1], 10);
    if (majorVersion < 18) {
      errors.push("Node.js version must be 18 or higher");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
