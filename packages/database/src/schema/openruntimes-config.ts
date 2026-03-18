import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

export interface RuntimeInfo {
  id: string;
  name: string;
  version: string;
  supports: string[];
}

export const openruntimesConfig = pgTable("openruntimes_config", {
  id: text("id").primaryKey().default("default"),

  // Executor connection
  executorEndpoint: text("executor_endpoint").default("http://openruntimes-executor:3000"),
  executorSecret: text("executor_secret"),

  // Runtime defaults
  defaultRuntime: text("default_runtime").default("node-20.0"),
  availableRuntimes: jsonb("available_runtimes").$type<RuntimeInfo[]>().default([
    { id: "node-20.0", name: "Node.js", version: "20.0", supports: ["js", "ts"] },
    { id: "node-18.0", name: "Node.js", version: "18.0", supports: ["js", "ts"] },
    { id: "python-3.11", name: "Python", version: "3.11", supports: ["py"] },
    { id: "deno-1.35", name: "Deno", version: "1.35", supports: ["js", "ts"] },
  ]),

  // Network configuration
  networkName: text("network_name").default("uni-proxy-manager_default"),

  // Executor health
  isHealthy: boolean("is_healthy").notNull().default(false),
  lastHealthCheck: timestamp("last_health_check"),
  healthError: text("health_error"),

  // Resource limits for function execution
  maxMemoryMb: text("max_memory_mb").default("2048"),
  maxTimeoutSeconds: text("max_timeout_seconds").default("900"),
  maxConcurrentExecutions: text("max_concurrent_executions").default("100"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OpenRuntimesConfig = typeof openruntimesConfig.$inferSelect;
export type NewOpenRuntimesConfig = typeof openruntimesConfig.$inferInsert;
