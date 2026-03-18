import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { s3Providers } from "@uni-proxy-manager/database/schema";
import { eq, and, ne } from "drizzle-orm";
import { S3Service } from "@uni-proxy-manager/shared/s3";

const app = new Hono();

const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  endpoint: z.string().url(),
  region: z.string().default("us-east-1"),
  bucket: z.string().min(1),
  pathPrefix: z.string().optional(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  isDefault: z.boolean().default(false),
  usedForBuildCache: z.boolean().default(true),
  usedForArtifacts: z.boolean().default(true),
});

const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  endpoint: z.string().url().optional(),
  region: z.string().optional(),
  bucket: z.string().min(1).optional(),
  pathPrefix: z.string().optional(),
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
  usedForBuildCache: z.boolean().optional(),
  usedForArtifacts: z.boolean().optional(),
});

/**
 * GET /api/s3-providers
 * List all S3 providers
 */
app.get("/", async (c) => {
  try {
    const providers = await db.query.s3Providers.findMany({
      orderBy: (providers, { desc }) => [desc(providers.createdAt)],
    });

    // Mask sensitive data
    const maskedProviders = providers.map((provider) => ({
      ...provider,
      accessKeyId: maskString(provider.accessKeyId),
      secretAccessKey: "********",
    }));

    return c.json({ providers: maskedProviders });
  } catch (error) {
    console.error("[S3 Providers] Error listing providers:", error);
    return c.json({ error: "Failed to list S3 providers" }, 500);
  }
});

/**
 * GET /api/s3-providers/default
 * Get the default S3 provider
 * NOTE: This route must be defined BEFORE /:id to avoid path conflicts
 */
app.get("/default", async (c) => {
  try {
    const provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.isDefault, true),
    });

    if (!provider) {
      return c.json({ error: "No default S3 provider configured" }, 404);
    }

    return c.json({
      provider: {
        ...provider,
        accessKeyId: maskString(provider.accessKeyId),
        secretAccessKey: "********",
      },
    });
  } catch (error) {
    console.error("[S3 Providers] Error getting default:", error);
    return c.json({ error: "Failed to get default provider" }, 500);
  }
});

/**
 * GET /api/s3-providers/:id
 * Get a single S3 provider
 */
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.id, id),
    });

    if (!provider) {
      return c.json({ error: "S3 provider not found" }, 404);
    }

    return c.json({
      provider: {
        ...provider,
        accessKeyId: maskString(provider.accessKeyId),
        secretAccessKey: "********",
      },
    });
  } catch (error) {
    console.error("[S3 Providers] Error getting provider:", error);
    return c.json({ error: "Failed to get S3 provider" }, 500);
  }
});

/**
 * POST /api/s3-providers
 * Create a new S3 provider
 */
app.post("/", zValidator("json", createProviderSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Check if this is the first provider - if so, make it default
    const existingProviders = await db.query.s3Providers.findMany({ limit: 1 });
    const shouldBeDefault = data.isDefault || existingProviders.length === 0;

    if (shouldBeDefault && existingProviders.length > 0) {
      await db
        .update(s3Providers)
        .set({ isDefault: false })
        .where(eq(s3Providers.isDefault, true));
    }

    const id = nanoid();

    const [provider] = await db
      .insert(s3Providers)
      .values({
        id,
        name: data.name,
        endpoint: data.endpoint,
        region: data.region,
        bucket: data.bucket,
        pathPrefix: data.pathPrefix || "",
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        isDefault: shouldBeDefault,
        usedForBuildCache: data.usedForBuildCache,
        usedForArtifacts: data.usedForArtifacts,
        isConnected: false,
      })
      .returning();

    // Test connection immediately
    try {
      const client = new S3Service({
        endpoint: data.endpoint,
        region: data.region,
        bucket: data.bucket,
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
      });

      const testResult = await client.testConnection();

      await db
        .update(s3Providers)
        .set({
          isConnected: testResult.success,
          lastConnectionCheck: new Date(),
          connectionError: testResult.success ? null : testResult.error,
        })
        .where(eq(s3Providers.id, id));

      if (provider) {
        provider.isConnected = testResult.success;
        provider.connectionError = testResult.success ? null : (testResult.error ?? null);
      }
    } catch (testError) {
      console.warn("[S3 Providers] Connection test failed:", testError);
    }

    if (!provider) {
      return c.json({ error: "Failed to create S3 provider" }, 500);
    }

    return c.json(
      {
        provider: {
          ...provider,
          accessKeyId: maskString(provider.accessKeyId),
          secretAccessKey: "********",
        },
      },
      201
    );
  } catch (error) {
    console.error("[S3 Providers] Error creating provider:", error);
    return c.json({ error: "Failed to create S3 provider" }, 500);
  }
});

/**
 * PUT /api/s3-providers/:id
 * Update an S3 provider
 */
app.put("/:id", zValidator("json", updateProviderSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.id, id),
    });

    if (!existing) {
      return c.json({ error: "S3 provider not found" }, 404);
    }

    if (data.isDefault) {
      await db
        .update(s3Providers)
        .set({ isDefault: false })
        .where(and(eq(s3Providers.isDefault, true), ne(s3Providers.id, id)));
    }

    const updateData: Partial<typeof s3Providers.$inferInsert> = {
      ...data,
      updatedAt: new Date(),
    };

    // If credentials changed, mark as needing retest
    if (data.accessKeyId || data.secretAccessKey || data.endpoint || data.bucket) {
      updateData.isConnected = false;
      updateData.connectionError = null;
    }

    const [updated] = await db
      .update(s3Providers)
      .set(updateData)
      .where(eq(s3Providers.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Failed to update S3 provider" }, 500);
    }

    return c.json({
      provider: {
        ...updated,
        accessKeyId: maskString(updated.accessKeyId),
        secretAccessKey: "********",
      },
    });
  } catch (error) {
    console.error("[S3 Providers] Error updating provider:", error);
    return c.json({ error: "Failed to update S3 provider" }, 500);
  }
});

/**
 * DELETE /api/s3-providers/:id
 * Delete an S3 provider
 */
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.id, id),
    });

    if (!existing) {
      return c.json({ error: "S3 provider not found" }, 404);
    }

    await db.delete(s3Providers).where(eq(s3Providers.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[S3 Providers] Error deleting provider:", error);
    return c.json({ error: "Failed to delete S3 provider" }, 500);
  }
});

/**
 * POST /api/s3-providers/:id/test
 * Test connection to an S3 provider
 */
app.post("/:id/test", async (c) => {
  const { id } = c.req.param();

  try {
    const provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.id, id),
    });

    if (!provider) {
      return c.json({ error: "S3 provider not found" }, 404);
    }

    const client = new S3Service({
      endpoint: provider.endpoint,
      region: provider.region,
      bucket: provider.bucket,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
    });

    const testResult = await client.testConnection();

    // Update connection status
    await db
      .update(s3Providers)
      .set({
        isConnected: testResult.success,
        lastConnectionCheck: new Date(),
        connectionError: testResult.success ? null : testResult.error,
        updatedAt: new Date(),
      })
      .where(eq(s3Providers.id, id));

    if (testResult.success) {
      return c.json({
        success: true,
        message: "Connection successful",
        bucketInfo: testResult.bucketInfo,
      });
    } else {
      return c.json(
        {
          success: false,
          error: testResult.error,
        },
        400
      );
    }
  } catch (error) {
    console.error("[S3 Providers] Error testing connection:", error);
    return c.json({ error: "Failed to test connection" }, 500);
  }
});

/**
 * POST /api/s3-providers/:id/set-default
 * Set a provider as the default
 */
app.post("/:id/set-default", async (c) => {
  const { id } = c.req.param();

  try {
    const provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.id, id),
    });

    if (!provider) {
      return c.json({ error: "S3 provider not found" }, 404);
    }

    // Unset existing default
    await db
      .update(s3Providers)
      .set({ isDefault: false })
      .where(eq(s3Providers.isDefault, true));

    // Set new default
    await db
      .update(s3Providers)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(s3Providers.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[S3 Providers] Error setting default:", error);
    return c.json({ error: "Failed to set default provider" }, 500);
  }
});

/**
 * GET /api/s3-providers/:id/usage
 * Get usage statistics for an S3 provider
 */
app.get("/:id/usage", async (c) => {
  const { id } = c.req.param();

  try {
    const provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.id, id),
    });

    if (!provider) {
      return c.json({ error: "S3 provider not found" }, 404);
    }

    const client = new S3Service({
      endpoint: provider.endpoint,
      region: provider.region,
      bucket: provider.bucket,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      pathPrefix: provider.pathPrefix || undefined,
    });

    const usage = await client.getBucketUsage();

    return c.json({
      providerId: id,
      usage,
    });
  } catch (error) {
    console.error("[S3 Providers] Error getting usage:", error);
    return c.json({ error: "Failed to get usage statistics" }, 500);
  }
});

// Helper function to mask sensitive strings
function maskString(str: string): string {
  if (str.length <= 4) {
    return "****";
  }
  return str.substring(0, 4) + "****" + str.substring(str.length - 4);
}

export default app;
