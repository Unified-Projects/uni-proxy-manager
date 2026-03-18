import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const dnsProviderTypeEnum = pgEnum("dns_provider_type", [
  "cloudflare",
  "namecheap",
]);

// Cloudflare credentials structure
export interface CloudflareCredentials {
  // API Token method (preferred)
  apiToken?: string;
  // Global API Key method (legacy)
  email?: string;
  apiKey?: string;
}

// Namecheap credentials structure
export interface NamecheapCredentials {
  apiUser: string;
  apiKey: string;
  clientIp: string; // Whitelisted IP for API access
  username?: string; // If different from apiUser
}

export type DnsProviderCredentials = CloudflareCredentials | NamecheapCredentials;

export const dnsProviders = pgTable("dns_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: dnsProviderTypeEnum("type").notNull(),

  // Encrypted credentials stored as JSON
  // Credentials should be encrypted at rest using application-level encryption
  credentials: jsonb("credentials").$type<DnsProviderCredentials>().notNull(),

  // Default provider for new certificates
  isDefault: boolean("is_default").notNull().default(false),

  // Last validation timestamp
  lastValidated: timestamp("last_validated"),
  validationError: text("validation_error"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const dnsProvidersRelations = relations(dnsProviders, ({ many }) => ({
  certificates: many(certificates),
}));

// Import certificates for relation
import { certificates } from "./certificates";

export type DnsProvider = typeof dnsProviders.$inferSelect;
export type NewDnsProvider = typeof dnsProviders.$inferInsert;
