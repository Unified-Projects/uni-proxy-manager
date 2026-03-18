import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export interface GeoData {
  [countryCode: string]: number;
}

export interface ReferrerData {
  [domain: string]: number;
}

export interface DeviceData {
  desktop: number;
  mobile: number;
  tablet: number;
  other: number;
}

export interface PathData {
  [path: string]: number;
}

export const siteAnalytics = pgTable(
  "site_analytics",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    domainId: text("domain_id"),
    deploymentId: text("deployment_id"),

    // Time bucket (1-minute granularity)
    timestamp: timestamp("timestamp").notNull(),

    // Traffic metrics
    pageViews: integer("page_views").notNull().default(0),
    uniqueVisitors: integer("unique_visitors").notNull().default(0),

    // Performance
    avgResponseTimeMs: integer("avg_response_time_ms"),
    p95ResponseTimeMs: integer("p95_response_time_ms"),

    // Bandwidth
    bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
    bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),

    // Response codes
    responses2xx: integer("responses_2xx").notNull().default(0),
    responses3xx: integer("responses_3xx").notNull().default(0),
    responses4xx: integer("responses_4xx").notNull().default(0),
    responses5xx: integer("responses_5xx").notNull().default(0),

    // Geographic (aggregated counts per country)
    geoData: jsonb("geo_data").$type<GeoData>().default({}),

    // Referrers (aggregated counts)
    referrers: jsonb("referrers").$type<ReferrerData>().default({}),

    // Device types (aggregated counts)
    devices: jsonb("devices").$type<DeviceData>().default({
      desktop: 0,
      mobile: 0,
      tablet: 0,
      other: 0,
    }),

    // Top paths (aggregated counts)
    paths: jsonb("paths").$type<PathData>().default({}),

    // Browser data
    browsers: jsonb("browsers").$type<Record<string, number>>().default({}),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    siteTimestampIdx: index("site_analytics_site_timestamp_idx").on(
      table.siteId,
      table.timestamp
    ),
    domainTimestampIdx: index("site_analytics_domain_timestamp_idx").on(
      table.domainId,
      table.timestamp
    ),
    deploymentTimestampIdx: index("site_analytics_deployment_timestamp_idx").on(
      table.deploymentId,
      table.timestamp
    ),
    timestampIdx: index("site_analytics_timestamp_idx").on(table.timestamp),
  })
);

import { sites } from "./sites";
import { deployments } from "./deployments";
import { domains } from "./domains";

export const siteAnalyticsRelations = relations(siteAnalytics, ({ one }) => ({
  site: one(sites, {
    fields: [siteAnalytics.siteId],
    references: [sites.id],
  }),
  domain: one(domains, {
    fields: [siteAnalytics.domainId],
    references: [domains.id],
  }),
  deployment: one(deployments, {
    fields: [siteAnalytics.deploymentId],
    references: [deployments.id],
  }),
}));

export type SiteAnalytic = typeof siteAnalytics.$inferSelect;
export type NewSiteAnalytic = typeof siteAnalytics.$inferInsert;
