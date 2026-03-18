/**
 * Next.js Builder Unit Tests
 *
 * Tests for the Next.js framework builder utilities.
 */

import { describe, it, expect } from "vitest";
import {
  getNextJsBuildConfig,
  generateStandaloneConfig,
  getStandaloneDeploymentFiles,
  getNextOutputDirectory,
  parseNextRoutes,
  getNextStartScript,
  getNextRuntimeEnv,
  usesAppRouter,
  hasApiRoutes,
  hasMiddleware,
  type NextConfig,
  type NextBuildInfo,
} from "../../../../packages/shared/src/builders/nextjs";

describe("Next.js Builder", () => {
  // ============================================================================
  // Build Config Tests
  // ============================================================================

  describe("getNextJsBuildConfig", () => {
    it("should return default config without next.config", () => {
      const config = getNextJsBuildConfig({
        buildCommand: undefined,
        outputDirectory: undefined,
        envVariables: {},
      });

      expect(config.framework).toBe("nextjs");
      expect(config.buildCommand).toBe("npm run build");
      expect(config.installCommand).toBe("npm install");
      expect(config.nodeVersion).toBe("20");
    });

    it("should use custom build command", () => {
      const config = getNextJsBuildConfig({
        buildCommand: "pnpm run build",
        outputDirectory: undefined,
        envVariables: {},
      });

      expect(config.buildCommand).toBe("pnpm run build");
    });

    it("should configure for standalone output", () => {
      const nextConfig: NextConfig = { output: "standalone" };
      const config = getNextJsBuildConfig(
        { buildCommand: undefined, outputDirectory: undefined, envVariables: {} },
        nextConfig
      );

      expect(config.renderMode).toBe("ssr");
      expect(config.outputDirectory).toBe(".next/standalone");
      expect(config.entryPoint).toBe("server.js");
      expect(config.runtimePath).toBe(".next/standalone");
    });

    it("should configure for static export", () => {
      const nextConfig: NextConfig = { output: "export" };
      const config = getNextJsBuildConfig(
        { buildCommand: undefined, outputDirectory: undefined, envVariables: {} },
        nextConfig
      );

      expect(config.renderMode).toBe("ssg");
      expect(config.outputDirectory).toBe("out");
      expect(config.entryPoint).toBeUndefined();
    });

    it("should configure for hybrid (default) output", () => {
      const config = getNextJsBuildConfig(
        { buildCommand: undefined, outputDirectory: undefined, envVariables: {} },
        {}
      );

      expect(config.renderMode).toBe("hybrid");
      expect(config.outputDirectory).toBe(".next");
    });

    it("should include NEXT_PUBLIC_ env prefix", () => {
      const config = getNextJsBuildConfig({
        buildCommand: undefined,
        outputDirectory: undefined,
        envVariables: {},
      });

      expect(config.envPrefix).toContain("NEXT_PUBLIC_");
    });
  });

  // ============================================================================
  // Standalone Config Tests
  // ============================================================================

  describe("generateStandaloneConfig", () => {
    it("should generate valid next.config.js content", () => {
      const config = generateStandaloneConfig();

      expect(config).toContain("output: 'standalone'");
      expect(config).toContain("poweredByHeader: false");
      expect(config).toContain("compress: true");
      expect(config).toContain("generateEtags: true");
    });

    it("should include proper module.exports", () => {
      const config = generateStandaloneConfig();

      expect(config).toContain("module.exports = nextConfig");
    });
  });

  // ============================================================================
  // Deployment Files Tests
  // ============================================================================

  describe("getStandaloneDeploymentFiles", () => {
    it("should include all required standalone files", () => {
      const files = getStandaloneDeploymentFiles();

      expect(files).toContain(".next/standalone/**/*");
      expect(files).toContain(".next/static/**/*");
      expect(files).toContain("public/**/*");
    });

    it("should return exactly 3 file patterns", () => {
      const files = getStandaloneDeploymentFiles();
      expect(files).toHaveLength(3);
    });
  });

  // ============================================================================
  // Output Directory Tests
  // ============================================================================

  describe("getNextOutputDirectory", () => {
    it("should return 'out' for export output", () => {
      const dir = getNextOutputDirectory({ output: "export" });
      expect(dir).toBe("out");
    });

    it("should return '.next/standalone' for standalone output", () => {
      const dir = getNextOutputDirectory({ output: "standalone" });
      expect(dir).toBe(".next/standalone");
    });

    it("should return '.next' for default output", () => {
      const dir = getNextOutputDirectory({});
      expect(dir).toBe(".next");
    });

    it("should return '.next' when config is undefined", () => {
      const dir = getNextOutputDirectory(undefined);
      expect(dir).toBe(".next");
    });
  });

  // ============================================================================
  // Route Parsing Tests
  // ============================================================================

  describe("parseNextRoutes", () => {
    it("should identify API routes", () => {
      const pagesManifest = {
        "/api/users": "pages/api/users.js",
        "/api/posts": "pages/api/posts.js",
      };

      const routes = parseNextRoutes(pagesManifest);

      expect(routes.every(r => r.type === "api")).toBe(true);
      expect(routes).toHaveLength(2);
    });

    it("should identify dynamic routes", () => {
      const pagesManifest = {
        "/posts/[id]": "pages/posts/[id].js",
        "/users/[userId]/posts": "pages/users/[userId]/posts.js",
      };

      const routes = parseNextRoutes(pagesManifest);

      expect(routes.every(r => r.type === "dynamic")).toBe(true);
    });

    it("should identify static routes", () => {
      const pagesManifest = {
        "/": "pages/index.js",
        "/about": "pages/about.js",
        "/contact": "pages/contact.js",
      };

      const routes = parseNextRoutes(pagesManifest);

      expect(routes.every(r => r.type === "static")).toBe(true);
    });

    it("should handle app directory routes", () => {
      const pagesManifest = {};
      const appPathsManifest = {
        "/dashboard": "app/dashboard/page.js",
        "/settings/[tab]": "app/settings/[tab]/page.js",
      };

      const routes = parseNextRoutes(pagesManifest, appPathsManifest);

      expect(routes).toHaveLength(2);
      expect(routes.find(r => r.path === "/dashboard")?.type).toBe("static");
      expect(routes.find(r => r.path === "/settings/[tab]")?.type).toBe("dynamic");
    });

    it("should combine pages and app routes", () => {
      const pagesManifest = {
        "/api/health": "pages/api/health.js",
      };
      const appPathsManifest = {
        "/": "app/page.js",
      };

      const routes = parseNextRoutes(pagesManifest, appPathsManifest);

      expect(routes).toHaveLength(2);
    });
  });

  // ============================================================================
  // Start Script Tests
  // ============================================================================

  describe("getNextStartScript", () => {
    it("should generate valid Node.js server script", () => {
      const script = getNextStartScript();

      expect(script).toContain("createServer");
      expect(script).toContain("next");
      expect(script).toContain("app.prepare()");
    });

    it("should use default port 3000", () => {
      const script = getNextStartScript();

      expect(script).toContain("|| 3000");
    });

    it("should use custom port when specified", () => {
      const script = getNextStartScript(8080);

      expect(script).toContain("|| 8080");
    });

    it("should bind to 0.0.0.0", () => {
      const script = getNextStartScript();

      expect(script).toContain("'0.0.0.0'");
    });
  });

  // ============================================================================
  // Runtime Environment Tests
  // ============================================================================

  describe("getNextRuntimeEnv", () => {
    it("should include NODE_ENV production", () => {
      const env = getNextRuntimeEnv({ envVariables: {} }, "https://example.com");

      expect(env.NODE_ENV).toBe("production");
    });

    it("should include HOSTNAME", () => {
      const env = getNextRuntimeEnv({ envVariables: {} }, "https://example.com");

      expect(env.HOSTNAME).toBe("0.0.0.0");
    });

    it("should include deployment URL", () => {
      const env = getNextRuntimeEnv({ envVariables: {} }, "https://my-app.example.com");

      expect(env.NEXT_PUBLIC_DEPLOYMENT_URL).toBe("https://my-app.example.com");
    });

    it("should copy NEXT_PUBLIC_ env variables", () => {
      const env = getNextRuntimeEnv(
        {
          envVariables: {
            NEXT_PUBLIC_API_URL: "https://api.example.com",
            NEXT_PUBLIC_ANALYTICS_ID: "UA-123456",
          },
        },
        "https://example.com"
      );

      expect(env.NEXT_PUBLIC_API_URL).toBe("https://api.example.com");
      expect(env.NEXT_PUBLIC_ANALYTICS_ID).toBe("UA-123456");
    });

    it("should copy non-NEXT_ prefixed variables", () => {
      const env = getNextRuntimeEnv(
        {
          envVariables: {
            DATABASE_URL: "postgresql://localhost/db",
            API_KEY: "secret",
          },
        },
        "https://example.com"
      );

      expect(env.DATABASE_URL).toBe("postgresql://localhost/db");
      expect(env.API_KEY).toBe("secret");
    });
  });

  // ============================================================================
  // Feature Detection Tests
  // ============================================================================

  describe("usesAppRouter", () => {
    it("should detect app router pages", () => {
      const files = [
        "/app/page.tsx",
        "/app/layout.tsx",
        "/app/about/page.tsx",
      ];

      expect(usesAppRouter(files)).toBe(true);
    });

    it("should detect page.js files", () => {
      const files = [
        "/src/app/page.js",
        "/src/app/dashboard/page.js",
      ];

      expect(usesAppRouter(files)).toBe(true);
    });

    it("should return false for pages-only app", () => {
      const files = [
        "/pages/index.tsx",
        "/pages/about.tsx",
        "/pages/api/hello.ts",
      ];

      expect(usesAppRouter(files)).toBe(false);
    });
  });

  describe("hasApiRoutes", () => {
    it("should detect pages/api routes", () => {
      const files = [
        "/pages/api/users.ts",
        "/pages/api/posts/[id].ts",
      ];

      expect(hasApiRoutes(files)).toBe(true);
    });

    it("should detect app/api routes", () => {
      const files = [
        "/app/api/users/route.ts",
        "/app/api/posts/route.js",
      ];

      expect(hasApiRoutes(files)).toBe(true);
    });

    it("should return false without API routes", () => {
      const files = [
        "/pages/index.tsx",
        "/components/Header.tsx",
      ];

      expect(hasApiRoutes(files)).toBe(false);
    });
  });

  describe("hasMiddleware", () => {
    it("should detect root middleware.ts", () => {
      const files = ["middleware.ts", "pages/index.tsx"];

      expect(hasMiddleware(files)).toBe(true);
    });

    it("should detect src/middleware.ts", () => {
      const files = ["src/middleware.ts", "src/pages/index.tsx"];

      expect(hasMiddleware(files)).toBe(true);
    });

    it("should detect middleware.js", () => {
      const files = ["middleware.js"];

      expect(hasMiddleware(files)).toBe(true);
    });

    it("should return false without middleware", () => {
      const files = [
        "pages/index.tsx",
        "lib/utils.ts",
      ];

      expect(hasMiddleware(files)).toBe(false);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("NextConfig type", () => {
    it("should accept valid config options", () => {
      const config: NextConfig = {
        output: "standalone",
        basePath: "/app",
        trailingSlash: true,
        images: {
          unoptimized: true,
          domains: ["example.com"],
        },
      };

      expect(config.output).toBe("standalone");
      expect(config.images?.unoptimized).toBe(true);
    });
  });

  describe("NextBuildInfo type", () => {
    it("should represent build information", () => {
      const info: NextBuildInfo = {
        version: "14.0.0",
        output: "standalone",
        hasServerComponents: true,
        hasApiRoutes: true,
        hasMiddleware: false,
        routes: [
          { path: "/", type: "static" },
          { path: "/api/users", type: "api" },
          { path: "/posts/[id]", type: "dynamic" },
        ],
      };

      expect(info.version).toBe("14.0.0");
      expect(info.hasServerComponents).toBe(true);
      expect(info.routes).toHaveLength(3);
    });
  });
});
