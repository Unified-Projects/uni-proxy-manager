import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "e2e-real",
    include: ["tests/e2e-real/**/*.test.ts"],
    globals: true,
    environment: "node",
    testTimeout: 300000, // 5 minutes - deployments can take time
    hookTimeout: 180000, // 3 minutes
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially to avoid resource conflicts
      },
    },
    sequence: {
      shuffle: false, // Keep tests in order
    },
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@uni-proxy-manager/database": resolve(__dirname, "packages/database/src"),
      "@uni-proxy-manager/shared": resolve(__dirname, "packages/shared/src"),
      "@uni-proxy-manager/queue": resolve(__dirname, "packages/queue/src"),
    },
  },
});
