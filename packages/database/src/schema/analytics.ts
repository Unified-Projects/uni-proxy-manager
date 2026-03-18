import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  real,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export interface AnalyticsFunnelStep {
  name: string;
  type: "pageview" | "event";
  pathPattern?: string;
  eventName?: string;
  eventMetaMatch?: Record<string, string | number | boolean>;
}

export const analyticsConfig = pgTable(
  "analytics_config",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .unique()
      .references(() => domains.id, { onDelete: "cascade" }),
    trackingUuid: text("tracking_uuid").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
    apiTokenHash: text("api_token_hash"),
    apiTokenSha256: text("api_token_sha256"),
    rawRetentionDays: integer("raw_retention_days").notNull().default(90),
    aggregateRetentionDays: integer("aggregate_retention_days").notNull().default(365),
    maxBreakdownEntries: integer("max_breakdown_entries").notNull().default(100),
    publicDashboardEnabled: boolean("public_dashboard_enabled").notNull().default(false),
    publicDashboardToken: text("public_dashboard_token"),
    publicDashboardPasswordHash: text("public_dashboard_password_hash"),
    trackScrollDepth: boolean("track_scroll_depth").notNull().default(true),
    trackSessionDuration: boolean("track_session_duration").notNull().default(true),
    trackOutboundLinks: boolean("track_outbound_links").notNull().default(true),
    captureUtmParams: boolean("capture_utm_params").notNull().default(true),
    ignoredPaths: jsonb("ignored_paths").$type<string[]>().default([]),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    trackingUuidIdx: uniqueIndex("analytics_config_tracking_uuid_idx").on(table.trackingUuid),
    domainIdIdx: uniqueIndex("analytics_config_domain_id_idx").on(table.domainId),
  })
);

export const analyticsFunnels = pgTable(
  "analytics_funnels",
  {
    id: text("id").primaryKey(),
    analyticsConfigId: text("analytics_config_id")
      .notNull()
      .references(() => analyticsConfig.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    steps: jsonb("steps").$type<AnalyticsFunnelStep[]>().notNull(),
    windowMs: bigint("window_ms", { mode: "number" }).notNull().default(86400000),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    configIdx: index("analytics_funnels_config_idx").on(table.analyticsConfigId),
    uniqueNamePerConfig: uniqueIndex("analytics_funnels_name_config_idx").on(
      table.analyticsConfigId,
      table.name,
    ),
  })
);

export const analyticsFunnelResults = pgTable(
  "analytics_funnel_results",
  {
    id: text("id").primaryKey(),
    funnelId: text("funnel_id")
      .notNull()
      .references(() => analyticsFunnels.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    stepCounts: jsonb("step_counts").$type<number[]>().notNull(),
    stepDropoffs: jsonb("step_dropoffs").$type<number[]>().notNull(),
    stepConversionRates: jsonb("step_conversion_rates").$type<number[]>().notNull(),
    overallConversionRate: real("overall_conversion_rate").notNull().default(0),
    totalEntrants: integer("total_entrants").notNull().default(0),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (table) => ({
    funnelPeriodIdx: uniqueIndex("analytics_funnel_results_funnel_period_idx").on(
      table.funnelId,
      table.periodStart,
      table.periodEnd,
    ),
  })
);

import { domains } from "./domains";

export const analyticsConfigRelations = relations(analyticsConfig, ({ one, many }) => ({
  domain: one(domains, {
    fields: [analyticsConfig.domainId],
    references: [domains.id],
  }),
  funnels: many(analyticsFunnels),
}));

export const analyticsFunnelsRelations = relations(analyticsFunnels, ({ one, many }) => ({
  config: one(analyticsConfig, {
    fields: [analyticsFunnels.analyticsConfigId],
    references: [analyticsConfig.id],
  }),
  results: many(analyticsFunnelResults),
}));

export const analyticsFunnelResultsRelations = relations(analyticsFunnelResults, ({ one }) => ({
  funnel: one(analyticsFunnels, {
    fields: [analyticsFunnelResults.funnelId],
    references: [analyticsFunnels.id],
  }),
}));

export type AnalyticsConfig = typeof analyticsConfig.$inferSelect;
export type NewAnalyticsConfig = typeof analyticsConfig.$inferInsert;
export type AnalyticsFunnel = typeof analyticsFunnels.$inferSelect;
export type NewAnalyticsFunnel = typeof analyticsFunnels.$inferInsert;
export type AnalyticsFunnelResult = typeof analyticsFunnelResults.$inferSelect;
export type NewAnalyticsFunnelResult = typeof analyticsFunnelResults.$inferInsert;
