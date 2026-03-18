/**
 * SvelteKit Builder Unit Tests
 *
 * Tests for the SvelteKit framework builder utilities.
 */

import { describe, it, expect } from "vitest";
import {
  getSvelteKitBuildConfig,
  detectAdapter,
  generateNodeAdapterConfig,
  generateStaticAdapterConfig,
  getNodeDeploymentFiles,
  getStaticDeploymentFiles,
  getSvelteKitStartScript,
  getSvelteKitRuntimeEnv,
  parseSvelteKitRoutes,
  hasServerRoutes,
  hasFormActions,
  hasHooks,
  recommendAdapter,
  type SvelteKitAdapter,
  type SvelteKitConfig,
  type SvelteKitBuildInfo,
} from "../../../../packages/shared/src/builders/sveltekit";

describe("SvelteKit Builder", () => {
  // ============================================================================
  // Build Config Tests
  // ============================================================================

  describe("getSvelteKitBuildConfig", () => {
    it("should return default config without svelte.config", () => {
      const config = getSvelteKitBuildConfig({
        buildCommand: undefined,
        outputDirectory: undefined,
        envVariables: {},
      });

      expect(config.framework).toBe("sveltekit");
      expect(config.buildCommand).toBe("npm run build");
      expect(config.installCommand).toBe("npm install");
      expect(config.nodeVersion).toBe("20");
    });

    it("should use custom build command", () => {
      const config = getSvelteKitBuildConfig({
        buildCommand: "pnpm run build",
        outputDirectory: undefined,
        envVariables: {},
      });

      expect(config.buildCommand).toBe("pnpm run build");
    });

    it("should configure for node adapter", () => {
      const svelteConfig: SvelteKitConfig = { adapter: "node" };
      const config = getSvelteKitBuildConfig(
        { buildCommand: undefined, outputDirectory: undefined, envVariables: {} },
        svelteConfig
      );

      expect(config.renderMode).toBe("ssr");
      expect(config.entryPoint).toBe("index.js");
      expect(config.outputDirectory).toBe("build");
    });

    it("should configure for static adapter", () => {
      const svelteConfig: SvelteKitConfig = { adapter: "static" };
      const config = getSvelteKitBuildConfig(
        { buildCommand: undefined, outputDirectory: undefined, envVariables: {} },
        svelteConfig
      );

      expect(config.renderMode).toBe("ssg");
      expect(config.entryPoint).toBeUndefined();
    });

    it("should include PUBLIC_ and VITE_ env prefixes", () => {
      const config = getSvelteKitBuildConfig({
        buildCommand: undefined,
        outputDirectory: undefined,
        envVariables: {},
      });

      expect(config.envPrefix).toContain("PUBLIC_");
      expect(config.envPrefix).toContain("VITE_");
    });
  });

  // ============================================================================
  // Adapter Detection Tests
  // ============================================================================

  describe("detectAdapter", () => {
    it("should detect node adapter", () => {
      const deps = { "@sveltejs/adapter-node": "^1.0.0" };
      expect(detectAdapter(deps)).toBe("node");
    });

    it("should detect static adapter", () => {
      const deps = { "@sveltejs/adapter-static": "^2.0.0" };
      expect(detectAdapter(deps)).toBe("static");
    });

    it("should detect vercel adapter", () => {
      const deps = { "@sveltejs/adapter-vercel": "^3.0.0" };
      expect(detectAdapter(deps)).toBe("vercel");
    });

    it("should detect netlify adapter", () => {
      const deps = { "@sveltejs/adapter-netlify": "^2.0.0" };
      expect(detectAdapter(deps)).toBe("netlify");
    });

    it("should detect cloudflare adapter", () => {
      const deps = { "@sveltejs/adapter-cloudflare": "^2.0.0" };
      expect(detectAdapter(deps)).toBe("cloudflare");
    });

    it("should detect cloudflare-workers adapter", () => {
      const deps = { "@sveltejs/adapter-cloudflare-workers": "^1.0.0" };
      expect(detectAdapter(deps)).toBe("cloudflare-workers");
    });

    it("should return auto when no adapter found", () => {
      const deps = { svelte: "^4.0.0" };
      expect(detectAdapter(deps)).toBe("auto");
    });
  });

  // ============================================================================
  // Config Generation Tests
  // ============================================================================

  describe("generateNodeAdapterConfig", () => {
    it("should generate valid svelte.config.js content", () => {
      const config = generateNodeAdapterConfig();

      expect(config).toContain("adapter-node");
      expect(config).toContain("vitePreprocess");
      expect(config).toContain("out: 'build'");
      expect(config).toContain("precompress: true");
    });

    it("should use custom output directory", () => {
      const config = generateNodeAdapterConfig({ out: "dist" });

      expect(config).toContain("out: 'dist'");
    });

    it("should respect precompress option", () => {
      const config = generateNodeAdapterConfig({ precompress: false });

      expect(config).toContain("precompress: false");
    });

    it("should include env prefix when provided", () => {
      const config = generateNodeAdapterConfig({ envPrefix: "CUSTOM_" });

      expect(config).toContain("envPrefix: 'CUSTOM_'");
    });
  });

  describe("generateStaticAdapterConfig", () => {
    it("should generate valid static adapter config", () => {
      const config = generateStaticAdapterConfig();

      expect(config).toContain("adapter-static");
      expect(config).toContain("pages: 'build'");
      expect(config).toContain("precompress: true");
      expect(config).toContain("strict: true");
    });

    it("should use custom pages directory", () => {
      const config = generateStaticAdapterConfig({ pages: "public" });

      expect(config).toContain("pages: 'public'");
    });

    it("should include fallback when provided", () => {
      const config = generateStaticAdapterConfig({ fallback: "200.html" });

      expect(config).toContain("fallback: '200.html'");
    });

    it("should respect strict option", () => {
      const config = generateStaticAdapterConfig({ strict: false });

      expect(config).toContain("strict: false");
    });
  });

  // ============================================================================
  // Deployment Files Tests
  // ============================================================================

  describe("getNodeDeploymentFiles", () => {
    it("should include build files and package.json", () => {
      const files = getNodeDeploymentFiles();

      expect(files).toContain("build/**/*");
      expect(files).toContain("package.json");
    });
  });

  describe("getStaticDeploymentFiles", () => {
    it("should include only build files", () => {
      const files = getStaticDeploymentFiles();

      expect(files).toContain("build/**/*");
      expect(files).toHaveLength(1);
    });
  });

  // ============================================================================
  // Start Script Tests
  // ============================================================================

  describe("getSvelteKitStartScript", () => {
    it("should generate valid Node.js server script", () => {
      const script = getSvelteKitStartScript();

      expect(script).toContain("handler");
      expect(script).toContain("polka");
      expect(script).toContain("server.listen");
    });

    it("should use default port 3000", () => {
      const script = getSvelteKitStartScript();

      expect(script).toContain("|| 3000");
    });

    it("should use custom port when specified", () => {
      const script = getSvelteKitStartScript(8080);

      expect(script).toContain("|| 8080");
    });

    it("should bind to 0.0.0.0", () => {
      const script = getSvelteKitStartScript();

      expect(script).toContain("'0.0.0.0'");
    });
  });

  // ============================================================================
  // Runtime Environment Tests
  // ============================================================================

  describe("getSvelteKitRuntimeEnv", () => {
    it("should include NODE_ENV production", () => {
      const env = getSvelteKitRuntimeEnv({ envVariables: {} });

      expect(env.NODE_ENV).toBe("production");
    });

    it("should include HOST", () => {
      const env = getSvelteKitRuntimeEnv({ envVariables: {} });

      expect(env.HOST).toBe("0.0.0.0");
    });

    it("should include ORIGIN when provided", () => {
      const env = getSvelteKitRuntimeEnv(
        { envVariables: {} },
        { origin: "https://example.com" }
      );

      expect(env.ORIGIN).toBe("https://example.com");
    });

    it("should include protocol and host headers when provided", () => {
      const env = getSvelteKitRuntimeEnv(
        { envVariables: {} },
        {
          protocolHeader: "X-Forwarded-Proto",
          hostHeader: "X-Forwarded-Host",
        }
      );

      expect(env.PROTOCOL_HEADER).toBe("X-Forwarded-Proto");
      expect(env.HOST_HEADER).toBe("X-Forwarded-Host");
    });

    it("should copy PUBLIC_ env variables", () => {
      const env = getSvelteKitRuntimeEnv({
        envVariables: {
          PUBLIC_API_URL: "https://api.example.com",
        },
      });

      expect(env.PUBLIC_API_URL).toBe("https://api.example.com");
    });

    it("should copy VITE_ env variables", () => {
      const env = getSvelteKitRuntimeEnv({
        envVariables: {
          VITE_API_KEY: "key123",
        },
      });

      expect(env.VITE_API_KEY).toBe("key123");
    });
  });

  // ============================================================================
  // Route Parsing Tests
  // ============================================================================

  describe("parseSvelteKitRoutes", () => {
    it("should identify endpoints", () => {
      const manifest = {
        routes: [
          { id: "/api/users+server.ts", type: "endpoint", pattern: "/api/users" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.json", manifest);

      expect(routes[0]?.type).toBe("endpoint");
    });

    it("should identify prerendered routes", () => {
      const manifest = {
        routes: [
          { id: "/about+page.svelte", type: "prerendered", pattern: "/about" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.json", manifest);

      expect(routes[0]?.type).toBe("prerendered");
    });

    it("should identify regular pages", () => {
      const manifest = {
        routes: [
          { id: "/+page.svelte", type: "page", pattern: "/" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.json", manifest);

      expect(routes[0]?.type).toBe("page");
    });

    it("should strip route file suffixes from path", () => {
      const manifest = {
        routes: [
          { id: "/dashboard+page.svelte", type: "page", pattern: "/dashboard" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.json", manifest);

      expect(routes[0]?.path).toBe("/dashboard");
    });
  });

  // ============================================================================
  // Feature Detection Tests
  // ============================================================================

  describe("hasServerRoutes", () => {
    it("should detect +server files", () => {
      const files = [
        "src/routes/api/users/+server.ts",
        "src/routes/api/posts/+server.js",
      ];

      expect(hasServerRoutes(files)).toBe(true);
    });

    it("should detect +page.server files without prerender", () => {
      const files = [
        "src/routes/dashboard/+page.server.ts",
      ];

      expect(hasServerRoutes(files)).toBe(true);
    });

    it("should return false for static-only app", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/routes/about/+page.svelte",
      ];

      expect(hasServerRoutes(files)).toBe(false);
    });
  });

  describe("hasFormActions", () => {
    it("should detect +page.server files", () => {
      const files = [
        "src/routes/login/+page.server.ts",
        "src/routes/signup/+page.server.js",
      ];

      expect(hasFormActions(files)).toBe(true);
    });

    it("should return false without form actions", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/routes/api/+server.ts",
      ];

      expect(hasFormActions(files)).toBe(false);
    });
  });

  describe("hasHooks", () => {
    it("should detect hooks.server.ts", () => {
      const files = ["src/hooks.server.ts", "src/routes/+page.svelte"];

      expect(hasHooks(files)).toBe(true);
    });

    it("should detect hooks.server.js", () => {
      const files = ["src/hooks.server.js"];

      expect(hasHooks(files)).toBe(true);
    });

    it("should detect hooks.client.ts", () => {
      const files = ["src/hooks.client.ts"];

      expect(hasHooks(files)).toBe(true);
    });

    it("should return false without hooks", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/lib/utils.ts",
      ];

      expect(hasHooks(files)).toBe(false);
    });
  });

  // ============================================================================
  // Adapter Recommendation Tests
  // ============================================================================

  describe("recommendAdapter", () => {
    it("should recommend static for fully prerenderable app", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: false,
        hasFormActions: false,
        hasHooks: false,
        allPagesPrerenderable: true,
      });

      expect(adapter).toBe("static");
    });

    it("should recommend node when has server routes", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: true,
        hasFormActions: false,
        hasHooks: false,
        allPagesPrerenderable: true,
      });

      expect(adapter).toBe("node");
    });

    it("should recommend node when has form actions", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: false,
        hasFormActions: true,
        hasHooks: false,
        allPagesPrerenderable: true,
      });

      expect(adapter).toBe("node");
    });

    it("should recommend node when not all pages prerenderable", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: false,
        hasFormActions: false,
        hasHooks: false,
        allPagesPrerenderable: false,
      });

      expect(adapter).toBe("node");
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("SvelteKitAdapter type", () => {
    it("should accept all valid adapter values", () => {
      const adapters: SvelteKitAdapter[] = [
        "auto",
        "node",
        "static",
        "vercel",
        "netlify",
        "cloudflare",
        "cloudflare-workers",
      ];

      expect(adapters).toHaveLength(7);
    });
  });

  describe("SvelteKitConfig type", () => {
    it("should accept valid config options", () => {
      const config: SvelteKitConfig = {
        adapter: "node",
        paths: {
          base: "/app",
          assets: "https://cdn.example.com",
        },
        prerender: {
          entries: ["/", "/about"],
          handleHttpError: "warn",
        },
        csrf: {
          checkOrigin: true,
        },
      };

      expect(config.adapter).toBe("node");
      expect(config.paths?.base).toBe("/app");
    });
  });

  describe("SvelteKitBuildInfo type", () => {
    it("should represent build information", () => {
      const info: SvelteKitBuildInfo = {
        version: "2.0.0",
        adapter: "node",
        hasServerRoutes: true,
        hasPrerenderedRoutes: true,
        routes: [
          { path: "/", type: "page" },
          { path: "/api/users", type: "endpoint" },
          { path: "/about", type: "prerendered" },
        ],
      };

      expect(info.version).toBe("2.0.0");
      expect(info.hasServerRoutes).toBe(true);
      expect(info.routes).toHaveLength(3);
    });
  });
});
