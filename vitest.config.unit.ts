import { defineConfig } from "vitest/config";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    include: [
      // Unit tests in dedicated tests/unit directory
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      // Unit tests co-located with source code
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "packages/*/tests/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.tsx",
      "apps/*/tests/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "tests/e2e/**",
      "tests/integration/**",
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
        minThreads: 1,
      },
    },

    reporters: ["default"],
    env: {
      UNI_PROXY_MANAGER_DB_URL:
        "postgresql://test:test@localhost:5432/test_db?sslmode=disable",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "packages/*/src/**/*.ts",
        "packages/*/src/**/*.tsx",
        "apps/*/src/**/*.ts",
        "apps/*/src/**/*.tsx",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "**/node_modules/**",
        "**/dist/**",
        "**/types/**",
        "**/*.d.ts",
        "**/index.ts", // Usually just re-exports
        "apps/web/src/app/**", // Next.js app router pages
      ],
      thresholds: {
        lines: 30,
        branches: 30,
        functions: 30,
        statements: 30,
      },
    },
  },
  resolve: {
    // Array format so more-specific entries are matched first.
    alias: [
      { find: "@", replacement: resolve(__dirname, "apps/web/src") },
      { find: "@ui", replacement: resolve(__dirname, "packages/ui/src") },
      {
        find: "@uni-proxy-manager/database/schema",
        replacement: path.resolve(
          __dirname,
          "packages/database/src/schema/index.ts"
        ),
      },
      {
        find: "@uni-proxy-manager/database",
        replacement: path.resolve(__dirname, "packages/database/src/index.ts"),
      },
      {
        find: "@uni-proxy-manager/shared",
        replacement: path.resolve(__dirname, "packages/shared/src"),
      },
      {
        find: "@uni-proxy-manager/queue",
        replacement: path.resolve(__dirname, "packages/queue/src/index.ts"),
      },
      {
        find: "@uni-proxy-manager/ui",
        replacement: path.resolve(__dirname, "packages/ui/src/index.ts"),
      },
      {
        find: /^apps\/(.*)/,
        replacement: `${__dirname}/apps/$1`,
      },
    ],
  },
});
