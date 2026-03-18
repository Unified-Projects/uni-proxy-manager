import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { domains } from "./domains";
import { sharedBackends } from "./shared-backends";

export const domainSharedBackends = pgTable(
  "domain_shared_backends",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    sharedBackendId: text("shared_backend_id")
      .notNull()
      .references(() => sharedBackends.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    domainSharedBackendUnique: uniqueIndex("domain_shared_backend_unique_idx").on(
      table.domainId,
      table.sharedBackendId
    ),
  })
);

export const domainSharedBackendsRelations = relations(domainSharedBackends, ({ one }) => ({
  domain: one(domains, {
    fields: [domainSharedBackends.domainId],
    references: [domains.id],
  }),
  sharedBackend: one(sharedBackends, {
    fields: [domainSharedBackends.sharedBackendId],
    references: [sharedBackends.id],
  }),
}));

export type DomainSharedBackend = typeof domainSharedBackends.$inferSelect;
export type NewDomainSharedBackend = typeof domainSharedBackends.$inferInsert;
