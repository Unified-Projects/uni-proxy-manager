import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const deploymentSlotEnum = pgEnum("deployment_slot", ["blue", "green"]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "pending",
  "building",
  "deploying",
  "live",
  "failed",
  "rolled_back",
  "cancelled",
]);

export const deploymentTriggerEnum = pgEnum("deployment_trigger", [
  "manual",
  "webhook",
  "schedule",
  "rollback",
  "upload",
]);

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),

    // Deployment info
    version: integer("version").notNull(),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    branch: text("branch"),

    // Build info
    buildStartedAt: timestamp("build_started_at"),
    buildCompletedAt: timestamp("build_completed_at"),
    buildLogs: text("build_logs"),
    buildDurationMs: integer("build_duration_ms"),

    // Deployment slots (blue-green)
    slot: deploymentSlotEnum("slot"),
    isActive: boolean("is_active").notNull().default(false),

    // Artifacts
    artifactPath: text("artifact_path"),
    artifactSize: bigint("artifact_size", { mode: "number" }),

    // Status
    status: deploymentStatusEnum("status").notNull().default("pending"),
    errorMessage: text("error_message"),

    // Metadata
    triggeredBy: deploymentTriggerEnum("triggered_by").notNull().default("manual"),
    deployedAt: timestamp("deployed_at"),

    // Preview
    previewUrl: text("preview_url"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    siteIdIdx: index("deployments_site_id_idx").on(table.siteId),
    statusIdx: index("deployments_status_idx").on(table.status),
    siteVersionIdx: index("deployments_site_version_idx").on(table.siteId, table.version),
    isActiveIdx: index("deployments_is_active_idx").on(table.siteId, table.isActive),
  })
);

import { sites } from "./sites";
import { siteDomains } from "./site-domains";

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  site: one(sites, {
    fields: [deployments.siteId],
    references: [sites.id],
  }),
  previewDomains: many(siteDomains),
}));

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
