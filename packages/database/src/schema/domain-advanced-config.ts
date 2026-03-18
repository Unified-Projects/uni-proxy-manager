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
import { backends } from "./backends";

// Enums
export const ipAccessModeEnum = pgEnum("ip_access_mode", [
  "whitelist",
  "blacklist",
]);

export const xFrameOptionsEnum = pgEnum("x_frame_options", [
  "deny",
  "sameorigin",
  "allow-from",
  "disabled",
]);

export const routeActionTypeEnum = pgEnum("route_action_type", [
  "backend",
  "redirect",
]);

// ============================================================================
// Domain Route Rules - URI-based routing to different backends
// ============================================================================

export const domainRouteRules = pgTable(
  "domain_route_rules",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pathPattern: text("path_pattern").notNull(), // Supports glob: /api/*, /dashboard/**

    // Action type: route to backend or redirect to URL
    actionType: routeActionTypeEnum("action_type").notNull().default("backend"),

    // Backend routing (when actionType = "backend")
    backendId: text("backend_id")
      .references(() => backends.id, { onDelete: "cascade" }),

    // Redirect options (when actionType = "redirect")
    redirectUrl: text("redirect_url"), // Target URL, supports {path} placeholder
    redirectStatusCode: integer("redirect_status_code").default(302), // 301, 302, 303, 307, 308
    redirectPreservePath: boolean("redirect_preserve_path").default(false), // Append original path to redirect URL
    redirectPreserveQuery: boolean("redirect_preserve_query").default(true), // Preserve query string

    priority: integer("priority").notNull().default(100), // Lower = higher priority
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("domain_route_rules_domain_id_idx").on(table.domainId),
    priorityIdx: index("domain_route_rules_priority_idx").on(table.priority),
    enabledIdx: index("domain_route_rules_enabled_idx").on(table.enabled),
    backendIdIdx: index("domain_route_rules_backend_id_idx").on(table.backendId),
  })
);

export const domainRouteRulesRelations = relations(domainRouteRules, ({ one }) => ({
  domain: one(domains, {
    fields: [domainRouteRules.domainId],
    references: [domains.id],
  }),
  backend: one(backends, {
    fields: [domainRouteRules.backendId],
    references: [backends.id],
  }),
}));

export type DomainRouteRule = typeof domainRouteRules.$inferSelect;
export type NewDomainRouteRule = typeof domainRouteRules.$inferInsert;

// ============================================================================
// Domain IP Rules - Whitelist/Blacklist IP access control
// ============================================================================

export const domainIpRules = pgTable(
  "domain_ip_rules",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" })
      .unique(), // One per domain
    mode: ipAccessModeEnum("mode").notNull().default("whitelist"),
    ipAddresses: jsonb("ip_addresses").$type<string[]>().notNull().default([]), // Supports CIDR
    enabled: boolean("enabled").notNull().default(false),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("domain_ip_rules_domain_id_idx").on(table.domainId),
    enabledIdx: index("domain_ip_rules_enabled_idx").on(table.enabled),
  })
);

export const domainIpRulesRelations = relations(domainIpRules, ({ one }) => ({
  domain: one(domains, {
    fields: [domainIpRules.domainId],
    references: [domains.id],
  }),
}));

export type DomainIpRule = typeof domainIpRules.$inferSelect;
export type NewDomainIpRule = typeof domainIpRules.$inferInsert;

// ============================================================================
// Domain Security Headers - X-Frame-Options, CSP, CORS configuration
// ============================================================================

export const domainSecurityHeaders = pgTable(
  "domain_security_headers",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" })
      .unique(), // One per domain

    // X-Frame-Options
    xFrameOptionsEnabled: boolean("x_frame_options_enabled").notNull().default(false),
    xFrameOptionsValue: xFrameOptionsEnum("x_frame_options_value").default("deny"),
    xFrameOptionsAllowFrom: text("x_frame_options_allow_from"), // URL for ALLOW-FROM

    // CSP frame-ancestors
    cspFrameAncestorsEnabled: boolean("csp_frame_ancestors_enabled").notNull().default(false),
    cspFrameAncestors: jsonb("csp_frame_ancestors").$type<string[]>().default([]), // ['self', 'https://example.com']

    // CORS
    corsEnabled: boolean("cors_enabled").notNull().default(false),
    corsAllowOrigins: jsonb("cors_allow_origins").$type<string[]>().default([]), // ['*'] or specific origins
    corsAllowMethods: jsonb("cors_allow_methods").$type<string[]>().default(["GET", "POST", "OPTIONS"]),
    corsAllowHeaders: jsonb("cors_allow_headers").$type<string[]>().default(["Content-Type", "Authorization"]),
    corsExposeHeaders: jsonb("cors_expose_headers").$type<string[]>().default([]),
    corsAllowCredentials: boolean("cors_allow_credentials").notNull().default(false),
    corsMaxAge: integer("cors_max_age").default(86400), // Seconds

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("domain_security_headers_domain_id_idx").on(table.domainId),
  })
);

export const domainSecurityHeadersRelations = relations(domainSecurityHeaders, ({ one }) => ({
  domain: one(domains, {
    fields: [domainSecurityHeaders.domainId],
    references: [domains.id],
  }),
}));

export type DomainSecurityHeader = typeof domainSecurityHeaders.$inferSelect;
export type NewDomainSecurityHeader = typeof domainSecurityHeaders.$inferInsert;

// ============================================================================
// Domain Blocked Routes - HAProxy-level path blocking
// ============================================================================

export const domainBlockedRoutes = pgTable(
  "domain_blocked_routes",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    pathPattern: text("path_pattern").notNull(), // /admin/*, /console
    enabled: boolean("enabled").notNull().default(true),
    httpStatusCode: integer("http_status_code").notNull().default(403),
    customResponseBody: text("custom_response_body"), // Optional custom error HTML
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("domain_blocked_routes_domain_id_idx").on(table.domainId),
    enabledIdx: index("domain_blocked_routes_enabled_idx").on(table.enabled),
  })
);

export const domainBlockedRoutesRelations = relations(domainBlockedRoutes, ({ one }) => ({
  domain: one(domains, {
    fields: [domainBlockedRoutes.domainId],
    references: [domains.id],
  }),
}));

export type DomainBlockedRoute = typeof domainBlockedRoutes.$inferSelect;
export type NewDomainBlockedRoute = typeof domainBlockedRoutes.$inferInsert;
