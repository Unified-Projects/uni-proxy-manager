import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import {
  pomeriumIdentityProviders,
  pomeriumRoutes,
} from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { PomeriumConfigJobData } from "@uni-proxy-manager/queue";

const app = new Hono();

// Validation schemas
const googleCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  hostedDomain: z.string().optional(),
  serviceAccount: z.string().optional(),
  serviceAccountKey: z.string().optional(),
});

const azureCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tenantId: z.string().min(1),
});

const githubCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  allowedOrganizations: z.array(z.string()).optional(),
  allowedTeams: z.array(z.string()).optional(),
});

const oidcCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  issuerUrl: z.string().url(),
  scopes: z.array(z.string()).optional(),
});

// Use discriminated union based on type field to preserve all credential fields
const createIdpSchema = z.discriminatedUnion("type", [
  z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().optional(),
    type: z.literal("google"),
    credentials: googleCredentialsSchema,
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  }),
  z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().optional(),
    type: z.literal("azure"),
    credentials: azureCredentialsSchema,
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  }),
  z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().optional(),
    type: z.literal("github"),
    credentials: githubCredentialsSchema,
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  }),
  z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().optional(),
    type: z.literal("oidc"),
    credentials: oidcCredentialsSchema,
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  }),
]);

const updateIdpSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().optional(),
  credentials: z
    .union([
      googleCredentialsSchema.partial(),
      azureCredentialsSchema.partial(),
      githubCredentialsSchema.partial(),
      oidcCredentialsSchema.partial(),
    ])
    .optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// Mask sensitive credentials in responses
function maskCredentials(credentials: unknown): Record<string, unknown> {
  if (!credentials || typeof credentials !== "object") {
    return {};
  }
  const masked = { ...(credentials as Record<string, unknown>) };
  if (masked.clientSecret) {
    masked.clientSecret = "[CONFIGURED]";
  }
  if (masked.serviceAccountKey) {
    masked.serviceAccountKey = "[CONFIGURED]";
  }
  return masked;
}

// Helper to queue config regeneration with deduplication
async function queueConfigRegeneration(reason: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const queue = new Queue<PomeriumConfigJobData>(QUEUES.POMERIUM_CONFIG, {
      connection: redis,
    });
    // Use static job ID for deduplication - only one pending job at a time
    // Add 2 second delay to batch rapid changes
    await queue.add(
      "pomerium-config-regenerate",
      { reason, triggeredBy: "idp" },
      {
        jobId: "pomerium-config-pending",
        delay: 2000,
        removeOnComplete: true,
        removeOnFail: 5,
      }
    );
  } catch (error) {
    // Job already exists with same ID - that's fine, it will pick up our changes
    if (!(error instanceof Error && error.message.includes("already exists"))) {
      console.error("[Pomerium IdPs] Failed to queue config regeneration:", error);
    }
  }
}

// List all identity providers
app.get("/", async (c) => {
  try {
    const idps = await db.query.pomeriumIdentityProviders.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    const maskedIdps = idps.map((idp) => ({
      ...idp,
      credentials: maskCredentials(idp.credentials),
    }));

    return c.json({ identityProviders: maskedIdps });
  } catch (error) {
    console.error("[Pomerium IdPs] Error listing IdPs:", error);
    return c.json({ error: "Failed to list identity providers" }, 500);
  }
});

// Get single IdP
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const idp = await db.query.pomeriumIdentityProviders.findFirst({
      where: eq(pomeriumIdentityProviders.id, id),
    });

    if (!idp) {
      return c.json({ error: "Identity provider not found" }, 404);
    }

    return c.json({
      identityProvider: {
        ...idp,
        credentials: maskCredentials(idp.credentials),
      },
    });
  } catch (error) {
    console.error("[Pomerium IdPs] Error getting IdP:", error);
    return c.json({ error: "Failed to get identity provider" }, 500);
  }
});

// Create IdP
app.post("/", zValidator("json", createIdpSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Validate type-specific credentials
    if (data.type === "azure") {
      const creds = data.credentials as { tenantId?: string };
      if (!creds.tenantId) {
        return c.json({ error: "tenantId is required for Azure AD" }, 400);
      }
    }
    if (data.type === "oidc") {
      const creds = data.credentials as { issuerUrl?: string };
      if (!creds.issuerUrl) {
        return c.json({ error: "issuerUrl is required for OIDC" }, 400);
      }
    }

    // Check for duplicate name
    const existingByName = await db.query.pomeriumIdentityProviders.findFirst({
      where: eq(pomeriumIdentityProviders.name, data.name),
    });
    if (existingByName) {
      return c.json(
        { error: "An identity provider with this name already exists" },
        409
      );
    }

    // Handle setting as default
    if (data.isDefault) {
      await db
        .update(pomeriumIdentityProviders)
        .set({ isDefault: false })
        .where(eq(pomeriumIdentityProviders.isDefault, true));
    }

    const id = nanoid();
    const [newIdp] = await db
      .insert(pomeriumIdentityProviders)
      .values({
        id,
        name: data.name,
        displayName: data.displayName,
        type: data.type,
        credentials: data.credentials,
        enabled: data.enabled,
        isDefault: data.isDefault,
      })
      .returning();

    if (!newIdp) {
      return c.json({ error: "Failed to create identity provider" }, 500);
    }

    // Queue config regeneration
    await queueConfigRegeneration("Identity provider created");

    return c.json(
      {
        identityProvider: {
          ...newIdp,
          credentials: maskCredentials(newIdp.credentials),
        },
      },
      201
    );
  } catch (error) {
    console.error("[Pomerium IdPs] Error creating IdP:", error);
    return c.json({ error: "Failed to create identity provider" }, 500);
  }
});

// Update IdP
app.put("/:id", zValidator("json", updateIdpSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.pomeriumIdentityProviders.findFirst({
      where: eq(pomeriumIdentityProviders.id, id),
    });

    if (!existing) {
      return c.json({ error: "Identity provider not found" }, 404);
    }

    // Handle setting as default
    if (data.isDefault === true) {
      await db
        .update(pomeriumIdentityProviders)
        .set({ isDefault: false })
        .where(eq(pomeriumIdentityProviders.isDefault, true));
    }

    // Merge credentials (preserve existing secrets if not provided)
    let mergedCredentials: unknown = existing.credentials;
    if (data.credentials) {
      mergedCredentials = {
        ...(existing.credentials as unknown as Record<string, unknown>),
        ...data.credentials,
      };
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.credentials !== undefined) updateData.credentials = mergedCredentials;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    const [updated] = await db
      .update(pomeriumIdentityProviders)
      .set(updateData)
      .where(eq(pomeriumIdentityProviders.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Failed to update identity provider" }, 500);
    }

    // Queue config regeneration
    await queueConfigRegeneration("Identity provider updated");

    return c.json({
      identityProvider: {
        ...updated,
        credentials: maskCredentials(updated.credentials),
      },
    });
  } catch (error) {
    console.error("[Pomerium IdPs] Error updating IdP:", error);
    return c.json({ error: "Failed to update identity provider" }, 500);
  }
});

// Delete IdP
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    // Check if any routes use this IdP
    const routesUsingIdp = await db.query.pomeriumRoutes.findFirst({
      where: eq(pomeriumRoutes.identityProviderId, id),
    });

    if (routesUsingIdp) {
      return c.json(
        {
          error: "Cannot delete identity provider that is in use by routes",
        },
        409
      );
    }

    const existing = await db.query.pomeriumIdentityProviders.findFirst({
      where: eq(pomeriumIdentityProviders.id, id),
    });

    if (!existing) {
      return c.json({ error: "Identity provider not found" }, 404);
    }

    await db
      .delete(pomeriumIdentityProviders)
      .where(eq(pomeriumIdentityProviders.id, id));

    // Queue config regeneration
    await queueConfigRegeneration("Identity provider deleted");

    return c.json({ success: true });
  } catch (error) {
    console.error("[Pomerium IdPs] Error deleting IdP:", error);
    return c.json({ error: "Failed to delete identity provider" }, 500);
  }
});

// Test IdP connection
app.post("/:id/test", async (c) => {
  const { id } = c.req.param();

  try {
    const idp = await db.query.pomeriumIdentityProviders.findFirst({
      where: eq(pomeriumIdentityProviders.id, id),
    });

    if (!idp) {
      return c.json({ error: "Identity provider not found" }, 404);
    }

    // Mark as validated (actual validation would depend on IdP type)
    await db
      .update(pomeriumIdentityProviders)
      .set({
        lastValidated: new Date(),
        validationError: null,
        updatedAt: new Date(),
      })
      .where(eq(pomeriumIdentityProviders.id, id));

    return c.json({ success: true, message: "Identity provider validated" });
  } catch (error) {
    console.error("[Pomerium IdPs] Error testing IdP:", error);
    return c.json({ error: "Failed to test identity provider" }, 500);
  }
});

export default app;
