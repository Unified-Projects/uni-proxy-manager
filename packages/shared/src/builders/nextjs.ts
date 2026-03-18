import type { FrameworkConfig, SiteBuildConfig } from "./index";

export interface NextConfig {
  output?: "standalone" | "export";
  basePath?: string;
  trailingSlash?: boolean;
  images?: {
    unoptimized?: boolean;
    domains?: string[];
    remotePatterns?: Array<{
      protocol?: string;
      hostname: string;
      port?: string;
      pathname?: string;
    }>;
  };
  experimental?: Record<string, unknown>;
}

export interface NextBuildInfo {
  version: string;
  output: "standalone" | "export" | "default";
  hasServerComponents: boolean;
  hasApiRoutes: boolean;
  hasMiddleware: boolean;
  routes: Array<{
    path: string;
    type: "static" | "dynamic" | "api";
  }>;
}

/**
 * Get Next.js specific build configuration
 */
export function getNextJsBuildConfig(
  site: Pick<SiteBuildConfig, "buildCommand" | "outputDirectory" | "envVariables">,
  nextConfig?: NextConfig
): FrameworkConfig {
  const isStandalone = nextConfig?.output === "standalone";
  const isExport = nextConfig?.output === "export";

  return {
    framework: "nextjs",
    renderMode: isExport ? "ssg" : isStandalone ? "ssr" : "hybrid",
    buildCommand: site.buildCommand || "npm run build",
    installCommand: "npm install",
    outputDirectory: isExport ? "out" : isStandalone ? ".next/standalone" : ".next",
    nodeVersion: "20",
    entryPoint: isStandalone ? "server.js" : undefined,
    runtimePath: isStandalone ? ".next/standalone" : ".next",
    envPrefix: ["NEXT_PUBLIC_"],
  };
}

/**
 * Generate next.config.js modifications for standalone output
 */
export function generateStandaloneConfig(): string {
  return `
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Optimize for production
  poweredByHeader: false,
  compress: true,
  // Generate ETags for caching
  generateEtags: true,
};

module.exports = nextConfig;
`.trim();
}

/**
 * Get the list of files needed for standalone deployment
 */
export function getStandaloneDeploymentFiles(): string[] {
  return [
    ".next/standalone/**/*",
    ".next/static/**/*",
    "public/**/*",
  ];
}

/**
 * Get the correct output directory based on Next.js config
 */
export function getNextOutputDirectory(nextConfig?: NextConfig): string {
  if (nextConfig?.output === "export") {
    return "out";
  }
  if (nextConfig?.output === "standalone") {
    return ".next/standalone";
  }
  return ".next";
}

/**
 * Parse routes from Next.js build manifest
 */
export function parseNextRoutes(
  pagesManifest: Record<string, string>,
  appPathsManifest?: Record<string, string>
): Array<{ path: string; type: "static" | "dynamic" | "api" }> {
  const routes: Array<{ path: string; type: "static" | "dynamic" | "api" }> = [];

  // Parse pages directory routes
  for (const [route, file] of Object.entries(pagesManifest)) {
    if (route.startsWith("/api/")) {
      routes.push({ path: route, type: "api" });
    } else if (route.includes("[") && route.includes("]")) {
      routes.push({ path: route, type: "dynamic" });
    } else {
      routes.push({ path: route, type: "static" });
    }
  }

  // Parse app directory routes
  if (appPathsManifest) {
    for (const [route] of Object.entries(appPathsManifest)) {
      if (route.includes("[") && route.includes("]")) {
        routes.push({ path: route, type: "dynamic" });
      } else {
        routes.push({ path: route, type: "static" });
      }
    }
  }

  return routes;
}

/**
 * Get server start script for Next.js standalone
 */
export function getNextStartScript(port: number = 3000): string {
  return `
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = false;
const hostname = '0.0.0.0';
const port = process.env.PORT || ${port};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  })
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(\`> Ready on http://\${hostname}:\${port}\`);
    });
});
`.trim();
}

/**
 * Get environment variables needed for Next.js at runtime
 */
export function getNextRuntimeEnv(
  site: Pick<SiteBuildConfig, "envVariables">,
  deploymentUrl: string
): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: "production",
    HOSTNAME: "0.0.0.0",
  };

  // Add deployment URL for next/image optimization
  if (deploymentUrl) {
    env.NEXT_PUBLIC_DEPLOYMENT_URL = deploymentUrl;
  }

  // Copy over public env variables
  if (site.envVariables) {
    for (const [key, value] of Object.entries(site.envVariables)) {
      if (key.startsWith("NEXT_PUBLIC_") || !key.startsWith("NEXT_")) {
        env[key] = String(value);
      }
    }
  }

  return env;
}

/**
 * Check if a Next.js app uses the App Router
 */
export function usesAppRouter(fileList: string[]): boolean {
  return fileList.some(
    (f) => f.includes("/app/") && (f.endsWith("page.tsx") || f.endsWith("page.js"))
  );
}

/**
 * Check if a Next.js app has API routes
 */
export function hasApiRoutes(fileList: string[]): boolean {
  return fileList.some(
    (f) =>
      (f.includes("/pages/api/") || f.includes("/app/api/")) &&
      (f.endsWith(".ts") || f.endsWith(".js"))
  );
}

/**
 * Check if a Next.js app has middleware
 */
export function hasMiddleware(fileList: string[]): boolean {
  return fileList.some(
    (f) =>
      f === "middleware.ts" ||
      f === "middleware.js" ||
      f === "src/middleware.ts" ||
      f === "src/middleware.js"
  );
}
