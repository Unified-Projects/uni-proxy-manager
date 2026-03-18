import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const domainStatusEnum = pgEnum("domain_status", [
  "active",
  "pending",
  "disabled",
  "error",
]);

export const acmeVerificationMethodEnum = pgEnum("acme_verification_method", [
  "dns-01",
  "http-01",
  "none",
]);

export const domains = pgTable(
  "domains",
  {
    id: text("id").primaryKey(),
    hostname: text("hostname").notNull().unique(),
    displayName: text("display_name"),
    status: domainStatusEnum("status").notNull().default("pending"),

    // SSL settings
    sslEnabled: boolean("ssl_enabled").notNull().default(true),
    forceHttps: boolean("force_https").notNull().default(true),

    // ACME certificate settings
    acmeVerificationMethod: acmeVerificationMethodEnum("acme_verification_method").default("dns-01"),
    acmeDnsProviderId: text("acme_dns_provider_id"),

    // Maintenance mode
    maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
    maintenanceBypassIps: jsonb("maintenance_bypass_ips").$type<string[]>().default([]),

    // Bot filtering and blocking
    blockBots: boolean("block_bots").notNull().default(false),
    filterBotsFromStats: boolean("filter_bots_from_stats").notNull().default(true),

    // Error page references (foreign keys added via relations)
    errorPageId: text("error_page_id"),
    maintenancePageId: text("maintenance_page_id"),

    // Certificate reference
    certificateId: text("certificate_id"),

    // WWW redirect and subdomain aliases
    wwwRedirectEnabled: boolean("www_redirect_enabled").notNull().default(false),
    subdomainAliases: jsonb("subdomain_aliases").$type<string[]>().default([]),

    // HAProxy config version tracking
    configVersion: integer("config_version").notNull().default(0),
    lastConfigUpdate: timestamp("last_config_update"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    hostnameIdx: index("domains_hostname_idx").on(table.hostname),
    statusIdx: index("domains_status_idx").on(table.status),
  })
);

// Forward declare for relations (actual relations defined in their respective files)
export const domainsRelations = relations(domains, ({ many, one }) => ({
  backends: many(backends),
  certificate: one(certificates, {
    fields: [domains.certificateId],
    references: [certificates.id],
  }),
}));

// Import backends and certificates for relation (will be circular, but Drizzle handles this)
import { backends } from "./backends";
import { certificates } from "./certificates";

export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
