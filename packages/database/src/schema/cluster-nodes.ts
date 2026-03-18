import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const clusterNodeStatusEnum = pgEnum("cluster_node_status", [
  "online",
  "offline",
  "syncing",
  "error",
  "unknown",
]);

export const clusterNodes = pgTable("cluster_nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  apiUrl: text("api_url").notNull().unique(),
  apiKey: text("api_key").notNull(),
  status: clusterNodeStatusEnum("status").notNull().default("unknown"),
  lastSeenAt: timestamp("last_seen_at"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  configVersion: text("config_version"),
  isLocal: boolean("is_local").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const clusterNodesRelations = relations(clusterNodes, () => ({}));

export type ClusterNode = typeof clusterNodes.$inferSelect;
export type InsertClusterNode = typeof clusterNodes.$inferInsert;
