import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { domains } from "./domains";

/**
 * Traffic metrics table
 * Stores per-domain traffic statistics collected from HAProxy stats socket
 * Data is aggregated per minute and retained for 30 days
 */
export const trafficMetrics = pgTable(
  "traffic_metrics",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp").notNull(),

    // Request counters
    totalRequests: integer("total_requests").notNull().default(0),
    uniqueVisitors: integer("unique_visitors").notNull().default(0),
    httpRequests: integer("http_requests").notNull().default(0),
    httpsRequests: integer("https_requests").notNull().default(0),

    // Response codes
    status2xx: integer("status_2xx").notNull().default(0),
    status3xx: integer("status_3xx").notNull().default(0),
    status4xx: integer("status_4xx").notNull().default(0),
    status5xx: integer("status_5xx").notNull().default(0),

    // Traffic volume (using bigint for large byte counts)
    bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
    bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),

    // Connection stats
    currentConnections: integer("current_connections").notNull().default(0),
    maxConnections: integer("max_connections").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // Index for efficient time-range queries by domain
    domainTimeIdx: index("traffic_metrics_domain_time_idx").on(table.domainId, table.timestamp.desc()),
    // Index for cleanup queries (delete old metrics)
    timestampIdx: index("traffic_metrics_timestamp_idx").on(table.timestamp),
  })
);

export const trafficMetricsRelations = relations(trafficMetrics, ({ one }) => ({
  domain: one(domains, {
    fields: [trafficMetrics.domainId],
    references: [domains.id],
  }),
}));

export type TrafficMetric = typeof trafficMetrics.$inferSelect;
export type NewTrafficMetric = typeof trafficMetrics.$inferInsert;
