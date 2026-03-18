import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { domains } from "./domains";
import { sites } from "./sites";

export const backendProtocolEnum = pgEnum("backend_protocol", [
  "http",
  "https",
]);

export const loadBalanceMethodEnum = pgEnum("load_balance_method", [
  "roundrobin",
  "leastconn",
  "source",
  "first",
]);

export const backendTypeEnum = pgEnum("backend_type", [
  "static",
  "site",
]);

export const backends = pgTable(
  "backends",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    // Backend type: static (IP/hostname) or site (OpenRuntimes site)
    backendType: backendTypeEnum("backend_type").notNull().default("static"),

    // Static backend fields (required when backendType = "static")
    address: text("address"), // hostname or IP - nullable for site backends
    port: integer("port").default(80),
    protocol: backendProtocolEnum("protocol").notNull().default("http"),

    // Site backend fields (required when backendType = "site")
    siteId: text("site_id").references(() => sites.id, { onDelete: "cascade" }),

    // Load balancing
    weight: integer("weight").notNull().default(100),
    maxConnections: integer("max_connections"),
    loadBalanceMethod: loadBalanceMethodEnum("load_balance_method").notNull().default("roundrobin"),

    // Health check
    healthCheckEnabled: boolean("health_check_enabled").notNull().default(true),
    healthCheckPath: text("health_check_path").default("/"),
    healthCheckInterval: integer("health_check_interval").notNull().default(5), // seconds
    healthCheckTimeout: integer("health_check_timeout").notNull().default(2), // seconds
    healthCheckFallThreshold: integer("health_check_fall").notNull().default(3),
    healthCheckRiseThreshold: integer("health_check_rise").notNull().default(2),

    // Current status
    isHealthy: boolean("is_healthy").notNull().default(true),
    lastHealthCheck: timestamp("last_health_check"),
    lastHealthError: text("last_health_error"),

    enabled: boolean("enabled").notNull().default(true),
    isBackup: boolean("is_backup").notNull().default(false),

    // Request modification options
    /** Override Host header sent to backend (e.g., "api.internal.example.com") */
    hostRewrite: text("host_rewrite"),
    /** Path prefix to add to requests (e.g., "/api/v1") */
    pathPrefixAdd: text("path_prefix_add"),
    /** Path prefix to strip from requests (e.g., "/legacy") */
    pathPrefixStrip: text("path_prefix_strip"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("backends_domain_id_idx").on(table.domainId),
    enabledIdx: index("backends_enabled_idx").on(table.enabled),
    siteIdIdx: index("backends_site_id_idx").on(table.siteId),
    backendTypeIdx: index("backends_backend_type_idx").on(table.backendType),
  })
);

export const backendsRelations = relations(backends, ({ one }) => ({
  domain: one(domains, {
    fields: [backends.domainId],
    references: [domains.id],
  }),
  site: one(sites, {
    fields: [backends.siteId],
    references: [sites.id],
  }),
}));

export type Backend = typeof backends.$inferSelect;
export type NewBackend = typeof backends.$inferInsert;
