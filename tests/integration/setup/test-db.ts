/**
 * Test database utilities
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../../../packages/database/src/schema";

let _client: Sql | null = null;
let _testDb: PostgresJsDatabase<typeof schema> | null = null;

function getConnectionString(): string {
  const connectionString = process.env.UNI_PROXY_MANAGER_DB_URL;
  if (!connectionString) {
    throw new Error("UNI_PROXY_MANAGER_DB_URL is not set");
  }
  return connectionString;
}

function initDb(): PostgresJsDatabase<typeof schema> {
  if (!_testDb) {
    const connectionString = getConnectionString();

    // Parse SSL mode from connection string
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode");
    const sslConfig = sslmode === "disable" ? false : { rejectUnauthorized: false };

    _client = postgres(connectionString, { max: 5, ssl: sslConfig });
    _testDb = drizzle(_client, { schema });
  }
  return _testDb;
}

export function getTestDb(): PostgresJsDatabase<typeof schema> {
  return initDb();
}

// Proxy object for backwards compatibility with test files that import testDb directly
// All method calls are forwarded to the lazily-initialized database
export const testDb = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_, prop) {
    const db = initDb();
    const value = (db as any)[prop];
    if (typeof value === "function") {
      return value.bind(db);
    }
    return value;
  },
});

/**
 * Clear all data from the database respecting foreign key constraints
 */
export async function clearDatabase(): Promise<void> {
  const db = getTestDb();
  // Delete in order respecting foreign keys
  // Sites extension tables first (depend on core tables)
  await db.delete(schema.siteAnalytics);
  await db.delete(schema.siteDomains);
  await db.delete(schema.githubConnections);
  await db.delete(schema.deployments);
  await db.delete(schema.sites);
  await db.delete(schema.s3Providers);
  await db.delete(schema.openruntimesConfig);
  // Pomerium extension tables (routes depend on domains and IdPs)
  await db.delete(schema.pomeriumRoutes);
  await db.delete(schema.pomeriumIdentityProviders);
  await db.delete(schema.pomeriumSettings);
  // Shared backends (FK to domains and sharedBackends)
  await db.delete(schema.domainSharedBackends);
  await db.delete(schema.sharedBackends);
  // Cluster nodes (no FK dependencies)
  await db.delete(schema.clusterNodes);
  // Analytics extension tables (depend on domains via analyticsConfig)
  await db.delete(schema.analyticsFunnelResults);
  await db.delete(schema.analyticsFunnels);
  await db.delete(schema.analyticsConfig);
  // Core tables
  await db.delete(schema.maintenanceWindows);
  await db.delete(schema.certificates);
  await db.delete(schema.backends);
  await db.delete(schema.domains);
  await db.delete(schema.dnsProviders);
  await db.delete(schema.errorPages);
}

/**
 * Seed the database with standard test data
 */
export async function seedTestData(): Promise<{
  domain: typeof schema.domains.$inferSelect;
  backend: typeof schema.backends.$inferSelect;
  dnsProvider: typeof schema.dnsProviders.$inferSelect;
}> {
  const db = getTestDb();

  const [dnsProvider] = await db
    .insert(schema.dnsProviders)
    .values({
      id: "test-dns-provider",
      name: "Test Cloudflare",
      type: "cloudflare",
      credentials: { apiToken: "test-token" },
      isDefault: true,
    })
    .returning();

  const [domain] = await db
    .insert(schema.domains)
    .values({
      id: "test-domain",
      hostname: "test.example.com",
      displayName: "Test Domain",
      status: "active",
      sslEnabled: true,
      forceHttps: true,
    })
    .returning();

  const [backend] = await db
    .insert(schema.backends)
    .values({
      id: "test-backend",
      domainId: domain.id,
      name: "Test Backend",
      address: "127.0.0.1",
      port: 8080,
      protocol: "http",
      weight: 100,
      healthCheckEnabled: true,
      healthCheckPath: "/",
      healthCheckInterval: 5,
      healthCheckTimeout: 2,
      healthCheckFallThreshold: 3,
      healthCheckRiseThreshold: 2,
    })
    .returning();

  return { domain, backend, dnsProvider };
}

/**
 * Close the database connection
 */
export async function closeTestDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _testDb = null;
  }
}

/**
 * Check if database is connected
 */
export async function isDatabaseConnected(): Promise<boolean> {
  try {
    const db = getTestDb();
    await db.execute(`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
