import { defineConfig } from "drizzle-kit";
import { existsSync, readFileSync } from "fs";

/**
 * Reads a secret value from a file if the _FILE variant is set,
 * otherwise returns the direct environment variable value.
 * This duplicates the logic from @uni-proxy-manager/shared/config because
 * drizzle-kit runs independently and may not have access to the shared package.
 */
function getDatabaseUrl(): string {
  // Check for _FILE variants first (Docker secrets)
  const fileEnvKeys = ["UNI_PROXY_MANAGER_DB_URL_FILE", "DATABASE_URL_FILE"];
  for (const fileKey of fileEnvKeys) {
    const filePath = process.env[fileKey];
    if (filePath) {
      if (!existsSync(filePath)) {
        throw new Error(`Secret file not found: ${filePath} (from ${fileKey})`);
      }
      return readFileSync(filePath, "utf-8").trim();
    }
  }

  // Fall back to direct environment variables
  const url = process.env.UNI_PROXY_MANAGER_DB_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL or UNI_PROXY_MANAGER_DB_URL environment variable is not set. " +
      "You can also use UNI_PROXY_MANAGER_DB_URL_FILE or DATABASE_URL_FILE to read from a Docker secret file."
    );
  }
  return url;
}

export default defineConfig({
  schema: ["./src/schema/index.ts"],
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: getDatabaseUrl(),
  },
  schemaFilter: ["public"],
  verbose: true,
  strict: false,
});
