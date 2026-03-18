import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const s3Providers = pgTable(
  "s3_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),

    // S3-compatible endpoint
    endpoint: text("endpoint").notNull(),
    region: text("region").notNull().default("us-east-1"),
    bucket: text("bucket").notNull(),

    // Path prefix for organization
    pathPrefix: text("path_prefix").default(""),

    // Credentials (should be encrypted at rest)
    accessKeyId: text("access_key_id").notNull(),
    secretAccessKey: text("secret_access_key").notNull(),

    // Usage flags
    isDefault: boolean("is_default").notNull().default(false),
    usedForBuildCache: boolean("used_for_build_cache").notNull().default(true),
    usedForArtifacts: boolean("used_for_artifacts").notNull().default(true),

    // Connection status
    isConnected: boolean("is_connected").notNull().default(false),
    lastConnectionCheck: timestamp("last_connection_check"),
    connectionError: text("connection_error"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    isDefaultIdx: index("s3_providers_is_default_idx").on(table.isDefault),
    nameIdx: index("s3_providers_name_idx").on(table.name),
  })
);

export type S3Provider = typeof s3Providers.$inferSelect;
export type NewS3Provider = typeof s3Providers.$inferInsert;
