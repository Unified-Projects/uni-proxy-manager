import {
  pgTable,
  text,
  timestamp,
  boolean,
  bigint,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const githubConnections = pgTable(
  "github_connections",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().unique(),

    // GitHub App installation
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    repositoryId: bigint("repository_id", { mode: "number" }).notNull(),
    repositoryFullName: text("repository_full_name").notNull(),
    repositoryUrl: text("repository_url"),
    defaultBranch: text("default_branch").default("main"),

    // Branch configuration
    productionBranch: text("production_branch").default("main"),
    previewBranches: jsonb("preview_branches").$type<string[]>().default(["*"]),

    // Webhook settings
    autoDeploy: boolean("auto_deploy").notNull().default(true),
    webhookId: bigint("webhook_id", { mode: "number" }),
    webhookSecret: text("webhook_secret"),

    // Access token (encrypted, refreshed automatically)
    accessToken: text("access_token"),
    tokenExpiresAt: timestamp("token_expires_at"),

    // Last sync info
    lastSyncAt: timestamp("last_sync_at"),
    lastCommitSha: text("last_commit_sha"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    siteIdIdx: index("github_connections_site_id_idx").on(table.siteId),
    installationIdIdx: index("github_connections_installation_id_idx").on(table.installationId),
    repositoryIdIdx: index("github_connections_repository_id_idx").on(table.repositoryId),
  })
);

import { sites } from "./sites";

export const githubConnectionsRelations = relations(githubConnections, ({ one }) => ({
  site: one(sites, {
    fields: [githubConnections.siteId],
    references: [sites.id],
  }),
}));

export type GitHubConnection = typeof githubConnections.$inferSelect;
export type NewGitHubConnection = typeof githubConnections.$inferInsert;
