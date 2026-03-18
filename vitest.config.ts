import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "tests/e2e/**",
      "**/integration/**",
    ],
    server: {
      deps: {
        inline: ["ua-parser-js", "picomatch"],
      },
    },
    // Provide a dummy DB URL so packages that check for it at init time don't
    // throw during unit tests. Actual DB calls are intercepted by vi.mock().
    env: {
      UNI_PROXY_MANAGER_DB_URL:
        "postgresql://test:test@localhost:5432/test_db?sslmode=disable",
    },
  },
  resolve: {
    // Array format so specific entries match first -- keeps vi.mock() paths
    // stable across different pnpm node_modules resolutions.
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "apps/web/src") },
      { find: "@ui", replacement: path.resolve(__dirname, "packages/ui/src") },
      {
        find: "@uni-proxy-manager/database/schema",
        replacement: path.resolve(
          __dirname,
          "packages/database/src/schema/index.ts"
        ),
      },
      {
        find: "@uni-proxy-manager/database",
        replacement: path.resolve(
          __dirname,
          "packages/database/src/index.ts"
        ),
      },
      {
        find: "@uni-proxy-manager/shared",
        replacement: path.resolve(__dirname, "packages/shared/src"),
      },
      {
        find: "@uni-proxy-manager/queue",
        replacement: path.resolve(
          __dirname,
          "packages/queue/src/index.ts"
        ),
      },
    ],
  },
});
