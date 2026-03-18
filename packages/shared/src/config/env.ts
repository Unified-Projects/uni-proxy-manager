import { readFileSync, existsSync } from "fs";
import { z } from "zod";

/**
 * List of environment variable keys that support the _FILE suffix pattern
 * for Docker secrets. When VAR_FILE is set, the value is read from the file
 * at the specified path instead of directly from the environment variable.
 */
const SECRET_ENV_KEYS = [
  // Database
  "UNI_PROXY_MANAGER_DB_URL",
  "DATABASE_URL",
  // Redis
  "UNI_PROXY_MANAGER_REDIS_URL",
  "REDIS_URL",
  // API Authentication
  "UNI_PROXY_MANAGER_API_KEY",
  // HAProxy Stats
  "UNI_PROXY_MANAGER_STATS_PASSWORD",
  // DNS Providers
  "UNI_PROXY_MANAGER_CLOUDFLARE_API_TOKEN",
  "UNI_PROXY_MANAGER_NAMECHEAP_API_KEY",
  // Analytics
  "UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD",
  "UNI_PROXY_MANAGER_INTERNAL_SECRET",
  "UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET",
] as const;

/**
 * Reads a secret value from a file if the _FILE variant is set,
 * otherwise returns the direct environment variable value.
 */
export function readFileSecret(envKey: string): string | undefined {
  const fileEnvKey = `${envKey}_FILE`;
  const filePath = process.env[fileEnvKey];

  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`Secret file not found: ${filePath} (from ${fileEnvKey})`);
    }
    return readFileSync(filePath, "utf-8").trim();
  }

  return process.env[envKey];
}

/**
 * Reads a secret from a file path
 */
export function readSecretFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Secret file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf-8").trim();
}

/**
 * Resolves all _FILE variants for secret environment variables.
 */
function resolveFileSecrets(): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = {};

  for (const key of SECRET_ENV_KEYS) {
    const value = readFileSecret(key);
    if (value !== undefined) {
      resolved[key] = value;
    }
  }

  return resolved;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return Boolean(value);
}

// Environment schema
const envSchema = z.object({
  // App
  UNI_PROXY_MANAGER_URL: z.string().default("http://localhost"),
  UNI_PROXY_MANAGER_API_PORT: z.coerce.number().default(3001),

  // Database
  UNI_PROXY_MANAGER_DB_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  // Redis
  UNI_PROXY_MANAGER_REDIS_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // HAProxy
  UNI_PROXY_MANAGER_HAPROXY_SOCKET: z.string().default("/var/run/haproxy/haproxy.sock"),
  UNI_PROXY_MANAGER_HAPROXY_CONFIG_PATH: z.string().default("/data/haproxy/haproxy.cfg"),
  UNI_PROXY_MANAGER_HAPROXY_STATS_URL: z.string().default("http://localhost:8404/stats"),

  // File paths
  UNI_PROXY_MANAGER_CERTS_DIR: z.string().default("/data/certificates"),
  UNI_PROXY_MANAGER_ERROR_PAGES_DIR: z.string().default("/data/error-pages"),

  // ACME / Let's Encrypt
  UNI_PROXY_MANAGER_ACME_EMAIL: z.string().optional(),
  UNI_PROXY_MANAGER_ACME_STAGING: z
    .union([z.boolean(), z.string()])
    .transform(coerceBoolean)
    .default(false),
  UNI_PROXY_MANAGER_ACME_DIRECTORY_URL: z.string().optional(),

  // DNS Providers (can be set via env for initial seeding)
  UNI_PROXY_MANAGER_CLOUDFLARE_API_TOKEN: z.string().optional(),
  UNI_PROXY_MANAGER_NAMECHEAP_API_USER: z.string().optional(),
  UNI_PROXY_MANAGER_NAMECHEAP_API_KEY: z.string().optional(),
  UNI_PROXY_MANAGER_NAMECHEAP_CLIENT_IP: z.string().optional(),

  // CORS
  UNI_PROXY_MANAGER_CORS_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform(coerceBoolean)
    .default(true),
  UNI_PROXY_MANAGER_CORS_ORIGINS: z.string().optional(),

  // API Authentication
  UNI_PROXY_MANAGER_API_KEY: z.string().optional(),
  UNI_PROXY_MANAGER_AUTH_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform(coerceBoolean)
    .default(true),

  // HAProxy Stats Protection
  UNI_PROXY_MANAGER_STATS_USER: z.string().default("admin"),
  UNI_PROXY_MANAGER_STATS_PASSWORD: z.string().optional(),

  // Analytics extension
  UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT: z.string().optional(),
  UNI_PROXY_MANAGER_CLICKHOUSE_URL: z.string().optional(),
  UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD: z.string().optional(),
  UNI_PROXY_MANAGER_INTERNAL_SECRET: z.string().optional(),
  UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const fileSecrets = resolveFileSecrets();
  const merged = { ...process.env, ...fileSecrets };

  const filtered = Object.fromEntries(
    Object.entries(merged).filter(([_, v]) => v !== undefined)
  );

  return envSchema.parse(filtered);
}

let _env: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!_env) {
    _env = parseEnv();
  }
  return _env;
}

export function resetEnvCache(): void {
  _env = null;
}

export function getAppUrl(): string {
  return getEnv().UNI_PROXY_MANAGER_URL.replace(/\/$/, "");
}

export function getApiPort(): number {
  return getEnv().UNI_PROXY_MANAGER_API_PORT;
}

export function getDatabaseUrl(): string {
  const env = getEnv();
  const url = env.UNI_PROXY_MANAGER_DB_URL || env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL or UNI_PROXY_MANAGER_DB_URL environment variable is not set."
    );
  }
  return url;
}

export function getRedisUrl(): string {
  const env = getEnv();
  return env.UNI_PROXY_MANAGER_REDIS_URL || env.REDIS_URL || "redis://localhost:6379";
}

export function getHaproxySocketPath(): string {
  return getEnv().UNI_PROXY_MANAGER_HAPROXY_SOCKET;
}

export function getHaproxyConfigPath(): string {
  return getEnv().UNI_PROXY_MANAGER_HAPROXY_CONFIG_PATH;
}

export function getHaproxyStatsUrl(): string {
  return getEnv().UNI_PROXY_MANAGER_HAPROXY_STATS_URL;
}

export function getCertsDir(): string {
  return getEnv().UNI_PROXY_MANAGER_CERTS_DIR;
}

export function getErrorPagesDir(): string {
  return getEnv().UNI_PROXY_MANAGER_ERROR_PAGES_DIR;
}

export function getAcmeConfig(): {
  email?: string;
  staging: boolean;
  directoryUrl: string;
} {
  const env = getEnv();
  const staging = env.UNI_PROXY_MANAGER_ACME_STAGING;
  const directoryUrl = env.UNI_PROXY_MANAGER_ACME_DIRECTORY_URL ||
    (staging
      ? "https://acme-staging-v02.api.letsencrypt.org/directory"
      : "https://acme-v02.api.letsencrypt.org/directory");

  return {
    email: env.UNI_PROXY_MANAGER_ACME_EMAIL,
    staging,
    directoryUrl,
  };
}

export function getCorsConfig(): { enabled: boolean; origins: string[] } {
  const env = getEnv();
  const enabled = env.UNI_PROXY_MANAGER_CORS_ENABLED;

  const origins: string[] = [];
  origins.push(getAppUrl());
  origins.push("http://localhost:3000");

  if (env.UNI_PROXY_MANAGER_CORS_ORIGINS) {
    const extra = env.UNI_PROXY_MANAGER_CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    origins.push(...extra);
  }

  return { enabled, origins: [...new Set(origins)] };
}

export function getAuthConfig(): { enabled: boolean; apiKey: string } {
  const env = getEnv();
  const apiKey = env.UNI_PROXY_MANAGER_API_KEY || "";
  const enabled = env.UNI_PROXY_MANAGER_AUTH_ENABLED && apiKey.length > 0;

  if (enabled && apiKey.length < 32) {
    console.warn(
      "[Security] API key is less than 32 characters. A minimum of 32 characters is required for security."
    );
    throw new Error(
      "[Security] API key must be at least 32 characters long. " +
      "Set UNI_PROXY_MANAGER_API_KEY to a value with 32 or more characters, " +
      "or disable auth by setting UNI_PROXY_MANAGER_AUTH_ENABLED=false."
    );
  }

  return { enabled, apiKey };
}

export function getStatsConfig(): { user: string; password: string | undefined } {
  const env = getEnv();
  return {
    user: env.UNI_PROXY_MANAGER_STATS_USER,
    password: env.UNI_PROXY_MANAGER_STATS_PASSWORD,
  };
}

export function getAnalyticsEndpoint(): string {
  const endpoint = getEnv().UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT;
  if (!endpoint) {
    throw new Error("UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT environment variable is not set.");
  }
  return endpoint;
}

export function getClickHouseUrl(): string {
  const url = getEnv().UNI_PROXY_MANAGER_CLICKHOUSE_URL;
  if (!url) {
    throw new Error("UNI_PROXY_MANAGER_CLICKHOUSE_URL environment variable is not set.");
  }
  return url;
}

export function getClickHousePassword(): string {
  const password = getEnv().UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD;
  if (!password) {
    throw new Error("UNI_PROXY_MANAGER_CLICKHOUSE_PASSWORD environment variable is not set.");
  }
  return password;
}

export function getInternalSecret(): string {
  const secret = getEnv().UNI_PROXY_MANAGER_INTERNAL_SECRET;
  if (!secret) {
    throw new Error("UNI_PROXY_MANAGER_INTERNAL_SECRET environment variable is not set.");
  }
  return secret;
}

export function getAnalyticsJwtSecret(): string {
  const secret = getEnv().UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET;
  if (!secret) {
    throw new Error("UNI_PROXY_MANAGER_ANALYTICS_JWT_SECRET environment variable is not set.");
  }
  return secret;
}
