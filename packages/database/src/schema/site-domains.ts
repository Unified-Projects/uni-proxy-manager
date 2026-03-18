import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const siteDomainTypeEnum = pgEnum("site_domain_type", [
  "production",
  "preview",
  "branch",
]);

export const siteDomains = pgTable(
  "site_domains",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    domainId: text("domain_id").notNull(),

    // Domain type
    type: siteDomainTypeEnum("type").notNull().default("production"),
    branchName: text("branch_name"),

    // Preview-specific
    deploymentId: text("deployment_id"),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    siteIdIdx: index("site_domains_site_id_idx").on(table.siteId),
    domainIdIdx: index("site_domains_domain_id_idx").on(table.domainId),
    typeIdx: index("site_domains_type_idx").on(table.type),
    siteTypeIdx: index("site_domains_site_type_idx").on(table.siteId, table.type),
  })
);

import { sites } from "./sites";
import { deployments } from "./deployments";
import { domains } from "./domains";

export const siteDomainsRelations = relations(siteDomains, ({ one }) => ({
  site: one(sites, {
    fields: [siteDomains.siteId],
    references: [sites.id],
  }),
  domain: one(domains, {
    fields: [siteDomains.domainId],
    references: [domains.id],
  }),
  deployment: one(deployments, {
    fields: [siteDomains.deploymentId],
    references: [deployments.id],
  }),
}));

export type SiteDomain = typeof siteDomains.$inferSelect;
export type NewSiteDomain = typeof siteDomains.$inferInsert;
