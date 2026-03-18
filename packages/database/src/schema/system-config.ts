import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const systemConfig = pgTable(
  "system_config",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    value: jsonb("value").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    keyIdx: index("system_config_key_idx").on(table.key),
  })
);

export type SystemConfig = typeof systemConfig.$inferSelect;
export type NewSystemConfig = typeof systemConfig.$inferInsert;

// Retention configuration type
export interface RetentionConfig {
  maxDeploymentsPerSite: number;
  deploymentMaxAgeDays: number;
  artifactRetentionDays: number;
  logRetentionDays: number;
}

// Default retention configuration
export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  maxDeploymentsPerSite: 10,
  deploymentMaxAgeDays: 90,
  artifactRetentionDays: 30,
  logRetentionDays: 30,
};

// Build defaults configuration type
export interface BuildDefaultsConfig {
  defaultBuildCpus: number;
  defaultBuildMemoryMb: number;
  defaultBuildTimeoutSeconds: number;
}

// Default build configuration
export const DEFAULT_BUILD_DEFAULTS_CONFIG: BuildDefaultsConfig = {
  defaultBuildCpus: 1.0,
  defaultBuildMemoryMb: 2048,
  defaultBuildTimeoutSeconds: 900, // 15 minutes
};

// HAProxy watchdog configuration type
export interface HaproxyWatchdogConfig {
  enabled: boolean;
}

// Default HAProxy watchdog configuration
export const DEFAULT_HAPROXY_WATCHDOG_CONFIG: HaproxyWatchdogConfig = {
  enabled: true,
};

// Configuration keys
export const CONFIG_KEYS = {
  RETENTION: "retention",
  BUILD_DEFAULTS: "build_defaults",
  HAPROXY_WATCHDOG: "haproxy_watchdog",
} as const;
