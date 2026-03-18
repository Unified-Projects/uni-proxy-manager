import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { domains } from "./domains";

// Maintenance window/history tracking
export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),

    // Title/reason for the maintenance
    title: text("title"),
    reason: text("reason"),

    // Scheduling (null means immediate/manual)
    scheduledStartAt: timestamp("scheduled_start_at"),
    scheduledEndAt: timestamp("scheduled_end_at"),

    // Actual activation times
    activatedAt: timestamp("activated_at"),
    deactivatedAt: timestamp("deactivated_at"),

    // Status
    isActive: boolean("is_active").notNull().default(false),

    // Who triggered it
    triggeredBy: text("triggered_by"), // User ID or "scheduled" or "api"

    // Bypass IPs for this specific window (overrides domain default if set)
    bypassIps: jsonb("bypass_ips").$type<string[]>(),

    // Notification settings
    notifyOnStart: boolean("notify_on_start").notNull().default(false),
    notifyOnEnd: boolean("notify_on_end").notNull().default(false),
    notificationWebhook: text("notification_webhook"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    domainIdIdx: index("maintenance_windows_domain_id_idx").on(table.domainId),
    activeIdx: index("maintenance_windows_active_idx").on(table.isActive),
    scheduledStartIdx: index("maintenance_windows_scheduled_start_idx").on(table.scheduledStartAt),
  })
);

export const maintenanceWindowsRelations = relations(maintenanceWindows, ({ one }) => ({
  domain: one(domains, {
    fields: [maintenanceWindows.domainId],
    references: [domains.id],
  }),
}));

export type MaintenanceWindow = typeof maintenanceWindows.$inferSelect;
export type NewMaintenanceWindow = typeof maintenanceWindows.$inferInsert;
