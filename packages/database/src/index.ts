import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "@uni-proxy-manager/shared/config";
import * as schema from "./schema";

const connectionString = getDatabaseUrl();

if (!connectionString) {
  throw new Error(
    "DATABASE_URL or UNI_PROXY_MANAGER_DB_URL environment variable is not set. " +
    "You can also use UNI_PROXY_MANAGER_DB_URL_FILE to read the value from a Docker secret file."
  );
}

// Parse SSL mode from connection string
const url = new URL(connectionString);
const sslmode = url.searchParams.get("sslmode");

// Configure SSL options based on sslmode parameter
const sslConfig = sslmode === "disable"
  ? false
  : { rejectUnauthorized: false }; // Accept self-signed certs for require/no-verify/default

const poolSize = parseInt(process.env.UNI_PROXY_MANAGER_DB_POOL_SIZE || "10", 10);
const idleTimeout = parseInt(process.env.UNI_PROXY_MANAGER_DB_IDLE_TIMEOUT || "20", 10);

const client = postgres(connectionString, {
  max: poolSize,
  idle_timeout: idleTimeout,
  connect_timeout: 10,
  ssl: sslConfig,
});

export const db = drizzle(client, { schema });

/**
 * Run a lightweight query to verify database connectivity.
 * Returns true when the database responds, false otherwise.
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export type Database = typeof db;

export * from "./schema";
