import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const pomeriumIdpTypeEnum = pgEnum("pomerium_idp_type", [
  "google",
  "azure",
  "github",
  "oidc",
]);

export const pomeriumRouteProtectionEnum = pgEnum("pomerium_route_protection", [
  "protected",
  "public",
  "passthrough",
]);

export interface GoogleIdpCredentials {
  clientId: string;
  clientSecret: string;
  hostedDomain?: string;
  serviceAccount?: string;
  serviceAccountKey?: string;
}

export interface AzureIdpCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export interface GitHubIdpCredentials {
  clientId: string;
  clientSecret: string;
  allowedOrganizations?: string[];
  allowedTeams?: string[];
}

export interface OidcIdpCredentials {
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  scopes?: string[];
}

export type PomeriumIdpCredentials =
  | GoogleIdpCredentials
  | AzureIdpCredentials
  | GitHubIdpCredentials
  | OidcIdpCredentials;

export interface PomeriumPolicyConfig {
  allowedUsers?: string[];
  allowedGroups?: string[];
  allowedDomains?: string[];
  allowedEmailPatterns?: string[];
  corsAllowPreflight?: boolean;
  passIdentityHeaders?: boolean;
  setRequestHeaders?: Record<string, string>;
  removeRequestHeaders?: string[];
  timeout?: number;
  idleTimeout?: number;
  websocketsEnabled?: boolean;
  preserveHostHeader?: boolean;
  tlsSkipVerify?: boolean;
}

export const pomeriumIdentityProviders = pgTable(
  "pomerium_identity_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    displayName: text("display_name"),
    type: pomeriumIdpTypeEnum("type").notNull(),

    // Encrypted credentials stored as JSON
    // Credentials should be encrypted at rest using application-level encryption
    credentials: jsonb("credentials").$type<PomeriumIdpCredentials>().notNull(),

    enabled: boolean("enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),

    lastValidated: timestamp("last_validated"),
    validationError: text("validation_error"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    typeIdx: index("pomerium_idp_type_idx").on(table.type),
    enabledIdx: index("pomerium_idp_enabled_idx").on(table.enabled),
  })
);

export const pomeriumRoutes = pgTable(
  "pomerium_routes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),

    // Link to existing domain
    domainId: text("domain_id").notNull(),

    // Path matching (supports glob patterns like /admin/*, /api/**)
    pathPattern: text("path_pattern").notNull().default("/*"),

    protection: pomeriumRouteProtectionEnum("protection")
      .notNull()
      .default("protected"),

    // Which IdP to use (null = use default)
    identityProviderId: text("identity_provider_id"),

    // Policy configuration
    policyConfig: jsonb("policy_config")
      .$type<PomeriumPolicyConfig>()
      .default({}),

    // Priority for route matching (lower = higher priority)
    priority: integer("priority").notNull().default(100),

    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("pomerium_routes_domain_id_idx").on(table.domainId),
    enabledIdx: index("pomerium_routes_enabled_idx").on(table.enabled),
    priorityIdx: index("pomerium_routes_priority_idx").on(table.priority),
    idpIdx: index("pomerium_routes_idp_idx").on(table.identityProviderId),
  })
);

export const pomeriumSettings = pgTable("pomerium_settings", {
  id: text("id").primaryKey().default("default"),

  // Secrets (auto-generated on first access)
  sharedSecret: text("shared_secret"),
  cookieSecret: text("cookie_secret"),
  signingKey: text("signing_key"),

  // Public authenticate service URL
  authenticateServiceUrl: text("authenticate_service_url"),

  // Cookie settings
  cookieName: text("cookie_name").default("_pomerium"),
  cookieExpire: text("cookie_expire").default("14h"),
  cookieDomain: text("cookie_domain"),
  cookieSecure: boolean("cookie_secure").default(true),
  cookieHttpOnly: boolean("cookie_http_only").default(true),

  // Global enable/disable
  enabled: boolean("enabled").notNull().default(false),

  logLevel: text("log_level").default("info"),

  // Forward auth endpoint (internal)
  forwardAuthUrl: text("forward_auth_url"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const pomeriumIdentityProvidersRelations = relations(
  pomeriumIdentityProviders,
  ({ many }) => ({
    routes: many(pomeriumRoutes),
  })
);

export const pomeriumRoutesRelations = relations(pomeriumRoutes, ({ one }) => ({
  identityProvider: one(pomeriumIdentityProviders, {
    fields: [pomeriumRoutes.identityProviderId],
    references: [pomeriumIdentityProviders.id],
  }),
  domain: one(domains, {
    fields: [pomeriumRoutes.domainId],
    references: [domains.id],
  }),
}));

import { domains } from "./domains";

export type PomeriumIdentityProvider =
  typeof pomeriumIdentityProviders.$inferSelect;
export type NewPomeriumIdentityProvider =
  typeof pomeriumIdentityProviders.$inferInsert;
export type PomeriumRoute = typeof pomeriumRoutes.$inferSelect;
export type NewPomeriumRoute = typeof pomeriumRoutes.$inferInsert;
export type PomeriumSettings = typeof pomeriumSettings.$inferSelect;
export type NewPomeriumSettings = typeof pomeriumSettings.$inferInsert;
