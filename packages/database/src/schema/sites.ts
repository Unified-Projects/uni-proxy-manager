import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  index,
  jsonb,
  numeric,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const siteFrameworkEnum = pgEnum("site_framework", [
  "nextjs",
  "sveltekit",
  "static",
  "custom",
]);

export const siteRenderModeEnum = pgEnum("site_render_mode", [
  "ssr",
  "ssg",
  "hybrid",
]);

export const siteStatusEnum = pgEnum("site_status", [
  "active",
  "building",
  "deploying",
  "error",
  "disabled",
]);

export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    framework: siteFrameworkEnum("framework").notNull().default("static"),
    renderMode: siteRenderModeEnum("render_mode").notNull().default("ssg"),

    // Build configuration
    buildCommand: text("build_command").default("npm run build"),
    outputDirectory: text("output_directory"),
    installCommand: text("install_command").default("npm install"),
    nodeVersion: text("node_version").default("20"),
    envVariables: jsonb("env_variables").$type<Record<string, string>>().default({}),
    buildFlags: jsonb("build_flags").$type<string[]>().default([]),

    // Runtime configuration
    runtimePath: text("runtime_path"),
    entryPoint: text("entry_point"),

    // Runtime resource specs (for serving requests)
    memoryMb: integer("memory_mb").notNull().default(256),
    cpuLimit: numeric("cpu_limit", { precision: 3, scale: 2 }).notNull().default("0.5"),
    timeoutSeconds: integer("timeout_seconds").notNull().default(30),
    maxConcurrency: integer("max_concurrency").notNull().default(10),
    coldStartEnabled: boolean("cold_start_enabled").notNull().default(true),

    // Build resource specs (for executor-based builds)
    buildCpus: numeric("build_cpus", { precision: 3, scale: 2 }).notNull().default("1.0"),
    buildMemoryMb: integer("build_memory_mb").notNull().default(2048),
    buildTimeoutSeconds: integer("build_timeout_seconds").notNull().default(900),

    // Domain linkage
    productionDomainId: text("production_domain_id"),

    // Error/maintenance pages
    errorPageId: text("error_page_id"),
    maintenancePageId: text("maintenance_page_id"),
    maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
    maintenanceBypassIps: jsonb("maintenance_bypass_ips").$type<string[]>().default([]),

    // S3 provider for this site
    s3ProviderId: text("s3_provider_id"),

    // Preview image
    previewUrl: text("preview_url"),

    // Status
    status: siteStatusEnum("status").notNull().default("disabled"),

    // Active deployment tracking
    activeDeploymentId: text("active_deployment_id"),
    activeSlot: text("active_slot").$type<"blue" | "green">(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index("sites_slug_idx").on(table.slug),
    statusIdx: index("sites_status_idx").on(table.status),
    frameworkIdx: index("sites_framework_idx").on(table.framework),
  })
);

// Forward declarations for relations
import { deployments } from "./deployments";
import { githubConnections } from "./github-connections";
import { siteDomains } from "./site-domains";
import { siteAnalytics } from "./site-analytics";

export const sitesRelations = relations(sites, ({ one, many }) => ({
  deployments: many(deployments),
  githubConnection: one(githubConnections),
  siteDomains: many(siteDomains),
  analytics: many(siteAnalytics),
}));

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
