import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { backendProtocolEnum, loadBalanceMethodEnum } from "./backends";

export const sharedBackends = pgTable(
  "shared_backends",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),

    // Server address
    address: text("address").notNull(),
    port: integer("port").notNull().default(80),
    protocol: backendProtocolEnum("protocol").notNull().default("http"),

    // Load balancing
    weight: integer("weight").notNull().default(100),
    maxConnections: integer("max_connections"),
    loadBalanceMethod: loadBalanceMethodEnum("load_balance_method").notNull().default("roundrobin"),

    // Health check
    healthCheckEnabled: boolean("health_check_enabled").notNull().default(true),
    healthCheckPath: text("health_check_path").default("/"),
    healthCheckInterval: integer("health_check_interval").notNull().default(5),
    healthCheckTimeout: integer("health_check_timeout").notNull().default(2),
    healthCheckFall: integer("health_check_fall").notNull().default(3),
    healthCheckRise: integer("health_check_rise").notNull().default(2),
    isHealthy: boolean("is_healthy").notNull().default(true),
    lastHealthCheck: timestamp("last_health_check"),
    lastHealthError: text("last_health_error"),

    // State
    enabled: boolean("enabled").notNull().default(true),
    isBackup: boolean("is_backup").notNull().default(false),

    // Request modification
    hostRewrite: text("host_rewrite"),
    pathPrefixAdd: text("path_prefix_add"),
    pathPrefixStrip: text("path_prefix_strip"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index("shared_backends_name_idx").on(table.name),
  })
);

export const sharedBackendsRelations = relations(sharedBackends, ({ many }) => ({
  domainLinks: many(domainSharedBackends),
}));

import { domainSharedBackends } from "./domain-shared-backends";

export type SharedBackend = typeof sharedBackends.$inferSelect;
export type NewSharedBackend = typeof sharedBackends.$inferInsert;
