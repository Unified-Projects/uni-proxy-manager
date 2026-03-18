import type { FrameworkConfig, SiteBuildConfig } from "./index";

export type SvelteKitAdapter =
  | "auto"
  | "node"
  | "static"
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "cloudflare-workers";

export interface SvelteKitConfig {
  adapter?: SvelteKitAdapter;
  paths?: {
    base?: string;
    assets?: string;
  };
  prerender?: {
    entries?: string[];
    handleHttpError?: "fail" | "warn" | "ignore";
  };
  csrf?: {
    checkOrigin?: boolean;
  };
}

export interface SvelteKitBuildInfo {
  version: string;
  adapter: SvelteKitAdapter;
  hasServerRoutes: boolean;
  hasPrerenderedRoutes: boolean;
  routes: Array<{
    path: string;
    type: "page" | "endpoint" | "prerendered";
  }>;
}

/**
 * Get SvelteKit specific build configuration
 */
export function getSvelteKitBuildConfig(
  site: Pick<SiteBuildConfig, "buildCommand" | "outputDirectory" | "envVariables">,
  svelteConfig?: SvelteKitConfig
): FrameworkConfig {
  const adapter = svelteConfig?.adapter || "node";
  const isStatic = adapter === "static";

  return {
    framework: "sveltekit",
    renderMode: isStatic ? "ssg" : "ssr",
    buildCommand: site.buildCommand || "npm run build",
    installCommand: "npm install",
    outputDirectory: isStatic ? "build" : "build",
    nodeVersion: "20",
    entryPoint: isStatic ? undefined : "index.js",
    runtimePath: "build",
    envPrefix: ["PUBLIC_", "VITE_"],
  };
}

/**
 * Detect which adapter is being used from package.json
 */
export function detectAdapter(
  dependencies: Record<string, string>
): SvelteKitAdapter {
  if (dependencies["@sveltejs/adapter-node"]) return "node";
  if (dependencies["@sveltejs/adapter-static"]) return "static";
  if (dependencies["@sveltejs/adapter-vercel"]) return "vercel";
  if (dependencies["@sveltejs/adapter-netlify"]) return "netlify";
  if (dependencies["@sveltejs/adapter-cloudflare"]) return "cloudflare";
  if (dependencies["@sveltejs/adapter-cloudflare-workers"])
    return "cloudflare-workers";
  return "auto";
}

/**
 * Generate svelte.config.js for node adapter
 */
export function generateNodeAdapterConfig(options?: {
  out?: string;
  precompress?: boolean;
  envPrefix?: string;
}): string {
  const out = options?.out || "build";
  const precompress = options?.precompress ?? true;
  const envPrefix = options?.envPrefix || "";

  return `
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      out: '${out}',
      precompress: ${precompress},
      envPrefix: '${envPrefix}'
    })
  }
};

export default config;
`.trim();
}

/**
 * Generate svelte.config.js for static adapter
 */
export function generateStaticAdapterConfig(options?: {
  pages?: string;
  assets?: string;
  fallback?: string;
  precompress?: boolean;
  strict?: boolean;
}): string {
  const pages = options?.pages || "build";
  const assets = options?.assets || pages;
  const fallback = options?.fallback;
  const precompress = options?.precompress ?? true;
  const strict = options?.strict ?? true;

  return `
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: '${pages}',
      assets: '${assets}',
      ${fallback ? `fallback: '${fallback}',` : ""}
      precompress: ${precompress},
      strict: ${strict}
    })
  }
};

export default config;
`.trim();
}

/**
 * Get the list of files needed for node adapter deployment
 */
export function getNodeDeploymentFiles(): string[] {
  return ["build/**/*", "package.json"];
}

/**
 * Get the list of files needed for static adapter deployment
 */
export function getStaticDeploymentFiles(): string[] {
  return ["build/**/*"];
}

/**
 * Get server start script for SvelteKit node adapter
 */
export function getSvelteKitStartScript(port: number = 3000): string {
  return `
import { handler } from './build/handler.js';
import { createServer } from 'http';
import polka from 'polka';

const port = process.env.PORT || ${port};
const host = process.env.HOST || '0.0.0.0';

const server = polka().use(handler);

server.listen({ port, host }, () => {
  console.log(\`> Ready on http://\${host}:\${port}\`);
});
`.trim();
}

/**
 * Get environment variables needed for SvelteKit at runtime
 */
export function getSvelteKitRuntimeEnv(
  site: Pick<SiteBuildConfig, "envVariables">,
  options?: {
    origin?: string;
    protocolHeader?: string;
    hostHeader?: string;
  }
): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
  };

  if (options?.origin) {
    env.ORIGIN = options.origin;
  }

  if (options?.protocolHeader) {
    env.PROTOCOL_HEADER = options.protocolHeader;
  }

  if (options?.hostHeader) {
    env.HOST_HEADER = options.hostHeader;
  }

  // Copy over public env variables
  if (site.envVariables) {
    for (const [key, value] of Object.entries(site.envVariables)) {
      if (key.startsWith("PUBLIC_") || key.startsWith("VITE_")) {
        env[key] = String(value);
      }
    }
  }

  return env;
}

/**
 * Parse routes from SvelteKit build output
 */
export function parseSvelteKitRoutes(
  manifestPath: string,
  manifest: {
    routes: Array<{
      id: string;
      type: string;
      pattern: RegExp | string;
    }>;
  }
): Array<{ path: string; type: "page" | "endpoint" | "prerendered" }> {
  return manifest.routes.map((route) => {
    let type: "page" | "endpoint" | "prerendered" = "page";

    if (route.id.includes("+server")) {
      type = "endpoint";
    } else if (route.type === "prerendered") {
      type = "prerendered";
    }

    return {
      path: route.id.replace(/\+page.*$/, "").replace(/\+server.*$/, ""),
      type,
    };
  });
}

/**
 * Check if a SvelteKit app has server-side routes
 */
export function hasServerRoutes(fileList: string[]): boolean {
  return fileList.some(
    (f) =>
      f.includes("+server.") ||
      (f.includes("+page.server.") && !f.includes(".prerender"))
  );
}

/**
 * Check if a SvelteKit app has form actions
 */
export function hasFormActions(fileList: string[]): boolean {
  return fileList.some((f) => f.includes("+page.server."));
}

/**
 * Check if a SvelteKit app has hooks
 */
export function hasHooks(fileList: string[]): boolean {
  return fileList.some(
    (f) =>
      f === "src/hooks.server.ts" ||
      f === "src/hooks.server.js" ||
      f === "src/hooks.client.ts" ||
      f === "src/hooks.client.js"
  );
}

/**
 * Get recommended adapter based on app features
 */
export function recommendAdapter(features: {
  hasServerRoutes: boolean;
  hasFormActions: boolean;
  hasHooks: boolean;
  allPagesPrerenderable: boolean;
}): SvelteKitAdapter {
  if (
    features.allPagesPrerenderable &&
    !features.hasServerRoutes &&
    !features.hasFormActions
  ) {
    return "static";
  }
  return "node";
}
