import { describe, expect, it } from "vitest";
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
} from "../../src/builders/sveltekit";

describe("SvelteKit Builder", () => {
  describe("getSvelteKitBuildConfig", () => {
    it("returns SSG config for static adapter", () => {
      const site = {
        buildCommand: "npm run build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getSvelteKitBuildConfig(site, { adapter: "static" });

      expect(config.framework).toBe("sveltekit");
      expect(config.renderMode).toBe("ssg");
      expect(config.outputDirectory).toBe("build");
      expect(config.entryPoint).toBeUndefined();
    });

    it("returns SSR config for node adapter", () => {
      const site = {
        buildCommand: "npm run build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getSvelteKitBuildConfig(site, { adapter: "node" });

      expect(config.framework).toBe("sveltekit");
      expect(config.renderMode).toBe("ssr");
      expect(config.outputDirectory).toBe("build");
      expect(config.entryPoint).toBe("index.js");
      expect(config.runtimePath).toBe("build");
    });

    it("defaults to node adapter when not specified", () => {
      const site = { buildCommand: null, outputDirectory: null, envVariables: {} };
      const config = getSvelteKitBuildConfig(site);

      expect(config.renderMode).toBe("ssr");
      expect(config.entryPoint).toBe("index.js");
    });

    it("uses custom build command from site", () => {
      const site = {
        buildCommand: "pnpm build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getSvelteKitBuildConfig(site);

      expect(config.buildCommand).toBe("pnpm build");
    });

    it("sets correct env prefixes", () => {
      const site = { buildCommand: null, outputDirectory: null, envVariables: {} };
      const config = getSvelteKitBuildConfig(site);

      expect(config.envPrefix).toEqual(["PUBLIC_", "VITE_"]);
    });
  });

  describe("detectAdapter", () => {
    it("detects node adapter", () => {
      expect(detectAdapter({ "@sveltejs/adapter-node": "^1.0.0" })).toBe("node");
    });

    it("detects static adapter", () => {
      expect(detectAdapter({ "@sveltejs/adapter-static": "^2.0.0" })).toBe("static");
    });

    it("detects vercel adapter", () => {
      expect(detectAdapter({ "@sveltejs/adapter-vercel": "^3.0.0" })).toBe("vercel");
    });

    it("detects netlify adapter", () => {
      expect(detectAdapter({ "@sveltejs/adapter-netlify": "^2.0.0" })).toBe("netlify");
    });

    it("detects cloudflare adapter", () => {
      expect(detectAdapter({ "@sveltejs/adapter-cloudflare": "^2.0.0" })).toBe("cloudflare");
    });

    it("detects cloudflare-workers adapter", () => {
      expect(detectAdapter({ "@sveltejs/adapter-cloudflare-workers": "^1.0.0" })).toBe("cloudflare-workers");
    });

    it("returns auto when no adapter found", () => {
      expect(detectAdapter({ svelte: "^4.0.0" })).toBe("auto");
    });
  });

  describe("generateNodeAdapterConfig", () => {
    it("generates config with defaults", () => {
      const config = generateNodeAdapterConfig();

      expect(config).toContain("import adapter from '@sveltejs/adapter-node'");
      expect(config).toContain("out: 'build'");
      expect(config).toContain("precompress: true");
      expect(config).toContain("envPrefix: ''");
    });

    it("generates config with custom options", () => {
      const config = generateNodeAdapterConfig({
        out: "dist",
        precompress: false,
        envPrefix: "APP_",
      });

      expect(config).toContain("out: 'dist'");
      expect(config).toContain("precompress: false");
      expect(config).toContain("envPrefix: 'APP_'");
    });
  });

  describe("generateStaticAdapterConfig", () => {
    it("generates config with defaults", () => {
      const config = generateStaticAdapterConfig();

      expect(config).toContain("import adapter from '@sveltejs/adapter-static'");
      expect(config).toContain("pages: 'build'");
      expect(config).toContain("assets: 'build'");
      expect(config).toContain("precompress: true");
      expect(config).toContain("strict: true");
    });

    it("generates config with custom options", () => {
      const config = generateStaticAdapterConfig({
        pages: "dist",
        assets: "dist/assets",
        fallback: "404.html",
        precompress: false,
        strict: false,
      });

      expect(config).toContain("pages: 'dist'");
      expect(config).toContain("assets: 'dist/assets'");
      expect(config).toContain("fallback: '404.html'");
      expect(config).toContain("precompress: false");
      expect(config).toContain("strict: false");
    });
  });

  describe("getNodeDeploymentFiles", () => {
    it("returns required file patterns", () => {
      const files = getNodeDeploymentFiles();

      expect(files).toContain("build/**/*");
      expect(files).toContain("package.json");
    });
  });

  describe("getStaticDeploymentFiles", () => {
    it("returns required file patterns", () => {
      const files = getStaticDeploymentFiles();

      expect(files).toContain("build/**/*");
    });
  });

  describe("getSvelteKitStartScript", () => {
    it("generates server script with default port", () => {
      const script = getSvelteKitStartScript();

      expect(script).toContain("const port = process.env.PORT || 3000");
      expect(script).toContain("const host = process.env.HOST || '0.0.0.0'");
      expect(script).toContain("import { handler } from './build/handler.js'");
    });

    it("generates server script with custom port", () => {
      const script = getSvelteKitStartScript(8080);

      expect(script).toContain("const port = process.env.PORT || 8080");
    });
  });

  describe("getSvelteKitRuntimeEnv", () => {
    it("includes base environment variables", () => {
      const site = { envVariables: {} };
      const env = getSvelteKitRuntimeEnv(site);

      expect(env.NODE_ENV).toBe("production");
      expect(env.HOST).toBe("0.0.0.0");
    });

    it("includes origin options", () => {
      const site = { envVariables: {} };
      const env = getSvelteKitRuntimeEnv(site, {
        origin: "https://app.example.com",
        protocolHeader: "x-forwarded-proto",
        hostHeader: "x-forwarded-host",
      });

      expect(env.ORIGIN).toBe("https://app.example.com");
      expect(env.PROTOCOL_HEADER).toBe("x-forwarded-proto");
      expect(env.HOST_HEADER).toBe("x-forwarded-host");
    });

    it("copies PUBLIC_ and VITE_ variables", () => {
      const site = {
        envVariables: {
          PUBLIC_API_URL: "https://api.example.com",
          VITE_APP_NAME: "My App",
          DATABASE_URL: "postgres://...",
          API_KEY: "secret",
        },
      };
      const env = getSvelteKitRuntimeEnv(site);

      expect(env.PUBLIC_API_URL).toBe("https://api.example.com");
      expect(env.VITE_APP_NAME).toBe("My App");
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.API_KEY).toBeUndefined();
    });
  });

  describe("parseSvelteKitRoutes", () => {
    it("parses page routes", () => {
      const manifest = {
        routes: [
          { id: "/", type: "page", pattern: "/" },
          { id: "/about", type: "page", pattern: "/about" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.js", manifest);

      expect(routes).toContainEqual({ path: "/", type: "page" });
      expect(routes).toContainEqual({ path: "/about", type: "page" });
    });

    it("parses endpoint routes", () => {
      const manifest = {
        routes: [
          { id: "/api/users/+server", type: "endpoint", pattern: "/api/users" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.js", manifest);

      expect(routes).toContainEqual({ path: "/api/users/", type: "endpoint" });
    });

    it("parses prerendered routes", () => {
      const manifest = {
        routes: [
          { id: "/posts/[slug]+page", type: "prerendered", pattern: "/posts/*" },
        ],
      };

      const routes = parseSvelteKitRoutes("manifest.js", manifest);

      expect(routes).toContainEqual({ path: "/posts/[slug]", type: "prerendered" });
    });
  });

  describe("hasServerRoutes", () => {
    it("returns true for +server files", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/routes/api/+server.ts",
      ];

      expect(hasServerRoutes(files)).toBe(true);
    });

    it("returns true for +page.server files", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/routes/dashboard/+page.server.ts",
      ];

      expect(hasServerRoutes(files)).toBe(true);
    });

    it("returns false for static only", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/routes/about/+page.svelte",
      ];

      expect(hasServerRoutes(files)).toBe(false);
    });
  });

  describe("hasFormActions", () => {
    it("returns true for +page.server files", () => {
      const files = [
        "src/routes/login/+page.server.ts",
      ];

      expect(hasFormActions(files)).toBe(true);
    });

    it("returns false without +page.server files", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/routes/api/+server.ts",
      ];

      expect(hasFormActions(files)).toBe(false);
    });
  });

  describe("hasHooks", () => {
    it("returns true for hooks.server.ts", () => {
      expect(hasHooks(["src/hooks.server.ts"])).toBe(true);
    });

    it("returns true for hooks.server.js", () => {
      expect(hasHooks(["src/hooks.server.js"])).toBe(true);
    });

    it("returns true for hooks.client.ts", () => {
      expect(hasHooks(["src/hooks.client.ts"])).toBe(true);
    });

    it("returns true for hooks.client.js", () => {
      expect(hasHooks(["src/hooks.client.js"])).toBe(true);
    });

    it("returns false without hooks", () => {
      const files = [
        "src/routes/+page.svelte",
        "src/lib/utils.ts",
      ];

      expect(hasHooks(files)).toBe(false);
    });
  });

  describe("recommendAdapter", () => {
    it("recommends static for fully prerenderable apps", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: false,
        hasFormActions: false,
        hasHooks: false,
        allPagesPrerenderable: true,
      });

      expect(adapter).toBe("static");
    });

    it("recommends node for apps with server routes", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: true,
        hasFormActions: false,
        hasHooks: false,
        allPagesPrerenderable: true,
      });

      expect(adapter).toBe("node");
    });

    it("recommends node for apps with form actions", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: false,
        hasFormActions: true,
        hasHooks: false,
        allPagesPrerenderable: true,
      });

      expect(adapter).toBe("node");
    });

    it("recommends node for apps with non-prerenderable pages", () => {
      const adapter = recommendAdapter({
        hasServerRoutes: false,
        hasFormActions: false,
        hasHooks: true,
        allPagesPrerenderable: false,
      });

      expect(adapter).toBe("node");
    });
  });
});
