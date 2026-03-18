import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    environment: "node",
    setupFiles: ["tests/integration/setup/test-env.ts"],
    globalSetup: ["tests/integration/setup/global-setup.ts"],
    globalTeardown: ["tests/integration/setup/global-teardown.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    maxConcurrency: 1,
    maxWorkers: 1,
    pool: "forks",
    sequence: {
      concurrent: false,
      hooks: "list",
      shuffle: false,
    },
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "apps/api/src/**/*.ts",
        "apps/workers/src/**/*.ts",
        "packages/*/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@uni-proxy-manager/database": resolve(__dirname, "packages/database/src"),
      "@uni-proxy-manager/shared": resolve(__dirname, "packages/shared/src"),
      "@uni-proxy-manager/queue": resolve(__dirname, "packages/queue/src"),
    },
  },
});
