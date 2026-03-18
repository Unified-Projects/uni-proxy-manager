import { describe, expect, it } from "vitest";
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
} from "../../src/builders/nextjs";

describe("Next.js Builder", () => {
  describe("getNextJsBuildConfig", () => {
    it("returns SSG config for export output", () => {
      const site = {
        buildCommand: "npm run build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getNextJsBuildConfig(site, { output: "export" });

      expect(config.framework).toBe("nextjs");
      expect(config.renderMode).toBe("ssg");
      expect(config.outputDirectory).toBe("out");
      expect(config.entryPoint).toBeUndefined();
    });

    it("returns SSR config for standalone output", () => {
      const site = {
        buildCommand: "npm run build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getNextJsBuildConfig(site, { output: "standalone" });

      expect(config.framework).toBe("nextjs");
      expect(config.renderMode).toBe("ssr");
      expect(config.outputDirectory).toBe(".next/standalone");
      expect(config.entryPoint).toBe("server.js");
      expect(config.runtimePath).toBe(".next/standalone");
    });

    it("returns hybrid config for default output", () => {
      const site = {
        buildCommand: "npm run build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getNextJsBuildConfig(site, {});

      expect(config.renderMode).toBe("hybrid");
      expect(config.outputDirectory).toBe(".next");
    });

    it("uses custom build command from site", () => {
      const site = {
        buildCommand: "pnpm build",
        outputDirectory: null,
        envVariables: {},
      };

      const config = getNextJsBuildConfig(site);

      expect(config.buildCommand).toBe("pnpm build");
    });

    it("sets correct env prefix", () => {
      const site = { buildCommand: null, outputDirectory: null, envVariables: {} };
      const config = getNextJsBuildConfig(site);

      expect(config.envPrefix).toEqual(["NEXT_PUBLIC_"]);
    });
  });

  describe("generateStandaloneConfig", () => {
    it("generates valid next.config.js", () => {
      const config = generateStandaloneConfig();

      expect(config).toContain("output: 'standalone'");
      expect(config).toContain("poweredByHeader: false");
      expect(config).toContain("compress: true");
      expect(config).toContain("generateEtags: true");
    });
  });

  describe("getStandaloneDeploymentFiles", () => {
    it("returns required file patterns", () => {
      const files = getStandaloneDeploymentFiles();

      expect(files).toContain(".next/standalone/**/*");
      expect(files).toContain(".next/static/**/*");
      expect(files).toContain("public/**/*");
    });
  });

  describe("getNextOutputDirectory", () => {
    it("returns 'out' for export", () => {
      expect(getNextOutputDirectory({ output: "export" })).toBe("out");
    });

    it("returns '.next/standalone' for standalone", () => {
      expect(getNextOutputDirectory({ output: "standalone" })).toBe(".next/standalone");
    });

    it("returns '.next' for default", () => {
      expect(getNextOutputDirectory({})).toBe(".next");
      expect(getNextOutputDirectory()).toBe(".next");
    });
  });

  describe("parseNextRoutes", () => {
    it("parses pages directory routes", () => {
      const pagesManifest = {
        "/": "pages/index.js",
        "/about": "pages/about.js",
        "/api/users": "pages/api/users.js",
        "/posts/[id]": "pages/posts/[id].js",
      };

      const routes = parseNextRoutes(pagesManifest);

      expect(routes).toContainEqual({ path: "/", type: "static" });
      expect(routes).toContainEqual({ path: "/about", type: "static" });
      expect(routes).toContainEqual({ path: "/api/users", type: "api" });
      expect(routes).toContainEqual({ path: "/posts/[id]", type: "dynamic" });
    });

    it("parses app directory routes", () => {
      const pagesManifest = {};
      const appPathsManifest = {
        "/": "app/page.js",
        "/dashboard": "app/dashboard/page.js",
        "/users/[id]": "app/users/[id]/page.js",
      };

      const routes = parseNextRoutes(pagesManifest, appPathsManifest);

      expect(routes).toContainEqual({ path: "/", type: "static" });
      expect(routes).toContainEqual({ path: "/dashboard", type: "static" });
      expect(routes).toContainEqual({ path: "/users/[id]", type: "dynamic" });
    });
  });

  describe("getNextStartScript", () => {
    it("generates server script with default port", () => {
      const script = getNextStartScript();

      expect(script).toContain("const port = process.env.PORT || 3000");
      expect(script).toContain("const hostname = '0.0.0.0'");
      expect(script).toContain("app.prepare()");
    });

    it("generates server script with custom port", () => {
      const script = getNextStartScript(8080);

      expect(script).toContain("const port = process.env.PORT || 8080");
    });
  });

  describe("getNextRuntimeEnv", () => {
    it("includes base environment variables", () => {
      const site = { envVariables: {} };
      const env = getNextRuntimeEnv(site, "https://app.example.com");

      expect(env.NODE_ENV).toBe("production");
      expect(env.HOSTNAME).toBe("0.0.0.0");
      expect(env.NEXT_PUBLIC_DEPLOYMENT_URL).toBe("https://app.example.com");
    });

    it("copies NEXT_PUBLIC_ and non-NEXT_ variables", () => {
      const site = {
        envVariables: {
          NEXT_PUBLIC_API_URL: "https://api.example.com",
          DATABASE_URL: "postgres://...",
          API_KEY: "secret",
        },
      };
      const env = getNextRuntimeEnv(site, "");

      expect(env.NEXT_PUBLIC_API_URL).toBe("https://api.example.com");
      expect(env.API_KEY).toBe("secret");
      // DATABASE_URL is copied because it doesn't start with NEXT_
      expect(env.DATABASE_URL).toBe("postgres://...");
    });

    it("does not include NEXT_ prefixed non-public variables", () => {
      const site = {
        envVariables: {
          NEXT_PRIVATE_KEY: "secret",
          NEXT_PUBLIC_KEY: "public",
        },
      };
      const env = getNextRuntimeEnv(site, "");

      expect(env.NEXT_PUBLIC_KEY).toBe("public");
      expect(env.NEXT_PRIVATE_KEY).toBeUndefined();
    });
  });

  describe("usesAppRouter", () => {
    it("returns true when app directory has page files", () => {
      const files = [
        "/app/page.tsx",
        "/app/layout.tsx",
        "/app/dashboard/page.tsx",
      ];

      expect(usesAppRouter(files)).toBe(true);
    });

    it("returns false for pages directory only", () => {
      const files = [
        "/pages/index.tsx",
        "/pages/about.tsx",
        "/pages/_app.tsx",
      ];

      expect(usesAppRouter(files)).toBe(false);
    });
  });

  describe("hasApiRoutes", () => {
    it("returns true for pages/api routes", () => {
      const files = [
        "/pages/index.tsx",
        "/pages/api/users.ts",
        "/pages/api/posts/[id].ts",
      ];

      expect(hasApiRoutes(files)).toBe(true);
    });

    it("returns true for app/api routes", () => {
      const files = [
        "/app/page.tsx",
        "/app/api/health/route.ts",
      ];

      expect(hasApiRoutes(files)).toBe(true);
    });

    it("returns false when no API routes", () => {
      const files = [
        "/pages/index.tsx",
        "/pages/about.tsx",
      ];

      expect(hasApiRoutes(files)).toBe(false);
    });
  });

  describe("hasMiddleware", () => {
    it("returns true for root middleware.ts", () => {
      expect(hasMiddleware(["middleware.ts"])).toBe(true);
    });

    it("returns true for root middleware.js", () => {
      expect(hasMiddleware(["middleware.js"])).toBe(true);
    });

    it("returns true for src/middleware.ts", () => {
      expect(hasMiddleware(["src/middleware.ts"])).toBe(true);
    });

    it("returns true for src/middleware.js", () => {
      expect(hasMiddleware(["src/middleware.js"])).toBe(true);
    });

    it("returns false when no middleware", () => {
      const files = [
        "pages/index.tsx",
        "utils/middleware.ts",
      ];

      expect(hasMiddleware(files)).toBe(false);
    });
  });
});
