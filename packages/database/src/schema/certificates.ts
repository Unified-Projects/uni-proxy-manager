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
import { domains } from "./domains";
import { dnsProviders } from "./dns-providers";

export const certificateStatusEnum = pgEnum("certificate_status", [
  "pending",
  "issuing",
  "active",
  "expired",
  "failed",
  "revoked",
]);

export const certificateSourceEnum = pgEnum("certificate_source", [
  "manual",       // Manually uploaded
  "letsencrypt",  // Auto-issued via Let's Encrypt
  "acme_other",   // Other ACME CA
]);

export const certificates = pgTable(
  "certificates",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),

    // Certificate details
    commonName: text("common_name").notNull(),
    altNames: jsonb("alt_names").$type<string[]>().default([]),
    isWildcard: boolean("is_wildcard").notNull().default(false),

    // Certificate metadata
    source: certificateSourceEnum("source").notNull().default("manual"),
    issuer: text("issuer"),

    // Status tracking
    status: certificateStatusEnum("status").notNull().default("pending"),
    lastError: text("last_error"),

    // File paths (relative to cert volume)
    certPath: text("cert_path"),
    keyPath: text("key_path"),
    chainPath: text("chain_path"),
    fullchainPath: text("fullchain_path"),

    // Expiry tracking
    issuedAt: timestamp("issued_at"),
    expiresAt: timestamp("expires_at"),

    // Renewal settings
    autoRenew: boolean("auto_renew").notNull().default(true),
    renewBeforeDays: integer("renew_before_days").notNull().default(30),
    lastRenewalAttempt: timestamp("last_renewal_attempt"),
    nextRenewalCheck: timestamp("next_renewal_check"),
    renewalAttempts: integer("renewal_attempts").notNull().default(0),

    // DNS provider for ACME challenge
    dnsProviderId: text("dns_provider_id")
      .references(() => dnsProviders.id, { onDelete: "set null" }),

    // Let's Encrypt account/order info
    acmeAccountUrl: text("acme_account_url"),
    acmeOrderUrl: text("acme_order_url"),

    // Certificate fingerprint for tracking
    fingerprint: text("fingerprint"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("certificates_domain_id_idx").on(table.domainId),
    statusIdx: index("certificates_status_idx").on(table.status),
    expiresAtIdx: index("certificates_expires_at_idx").on(table.expiresAt),
    nextRenewalIdx: index("certificates_next_renewal_idx").on(table.nextRenewalCheck),
  })
);

export const certificatesRelations = relations(certificates, ({ one }) => ({
  domain: one(domains, {
    fields: [certificates.domainId],
    references: [domains.id],
  }),
  dnsProvider: one(dnsProviders, {
    fields: [certificates.dnsProviderId],
    references: [dnsProviders.id],
  }),
}));

export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;
