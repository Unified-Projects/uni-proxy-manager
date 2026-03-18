import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { dnsProviders } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";

const app = new Hono();

// Validation schemas
const cloudflareCredentialsSchema = z.object({
  apiToken: z.string().optional(),
  email: z.string().email().optional(),
  apiKey: z.string().optional(),
}).refine(
  (data) => data.apiToken || (data.email && data.apiKey),
  "Either apiToken or both email and apiKey are required"
);

const namecheapCredentialsSchema = z.object({
  apiUser: z.string().min(1),
  apiKey: z.string().min(1),
  clientIp: z.string().min(1),
  username: z.string().optional(),
});

const createDnsProviderSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["cloudflare", "namecheap"]),
  credentials: z.union([cloudflareCredentialsSchema, namecheapCredentialsSchema]),
  isDefault: z.boolean().default(false),
});

const updateDnsProviderSchema = z.object({
  name: z.string().min(1).optional(),
  credentials: z.union([cloudflareCredentialsSchema, namecheapCredentialsSchema]).optional(),
  isDefault: z.boolean().optional(),
});

// List all DNS providers
app.get("/", async (c) => {
  try {
    const providers = await db.query.dnsProviders.findMany({
      orderBy: (dnsProviders, { desc }) => [desc(dnsProviders.createdAt)],
    });

    const safeProviders = providers.map(p => ({
      ...p,
      credentials: undefined,
      hasCredentials: true,
    }));

    return c.json({ providers: safeProviders });
  } catch (error) {
    console.error("[DNS Providers] Error listing providers:", error);
    return c.json({ error: "Failed to list DNS providers" }, 500);
  }
});

// Get single DNS provider
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const provider = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, id),
    });

    if (!provider) {
      return c.json({ error: "DNS provider not found" }, 404);
    }

    const safeProvider = {
      ...provider,
      credentials: undefined,
      hasCredentials: true,
    };

    return c.json({ provider: safeProvider });
  } catch (error) {
    console.error("[DNS Providers] Error getting provider:", error);
    return c.json({ error: "Failed to get DNS provider" }, 500);
  }
});

// Create DNS provider
app.post("/", zValidator("json", createDnsProviderSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    if (data.isDefault) {
      await db
        .update(dnsProviders)
        .set({ isDefault: false })
        .where(eq(dnsProviders.isDefault, true));
    }

    const id = nanoid();
    const [newProvider] = await db
      .insert(dnsProviders)
      .values({
        id,
        name: data.name,
        type: data.type,
        credentials: data.credentials,
        isDefault: data.isDefault,
      })
      .returning();

    const safeProvider = {
      ...newProvider,
      credentials: undefined,
      hasCredentials: true,
    };

    return c.json({ provider: safeProvider }, 201);
  } catch (error) {
    console.error("[DNS Providers] Error creating provider:", error);
    return c.json({ error: "Failed to create DNS provider" }, 500);
  }
});

// Update DNS provider
app.put("/:id", zValidator("json", updateDnsProviderSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, id),
    });

    if (!existing) {
      return c.json({ error: "DNS provider not found" }, 404);
    }

    if (data.isDefault) {
      await db
        .update(dnsProviders)
        .set({ isDefault: false })
        .where(eq(dnsProviders.isDefault, true));
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.credentials !== undefined) updateData.credentials = data.credentials;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    const [updated] = await db
      .update(dnsProviders)
      .set(updateData)
      .where(eq(dnsProviders.id, id))
      .returning();

    const safeProvider = {
      ...updated,
      credentials: undefined,
      hasCredentials: true,
    };

    return c.json({ provider: safeProvider });
  } catch (error) {
    console.error("[DNS Providers] Error updating provider:", error);
    return c.json({ error: "Failed to update DNS provider" }, 500);
  }
});

// Test DNS provider credentials
app.post("/:id/test", async (c) => {
  const { id } = c.req.param();

  try {
    const provider = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, id),
    });

    if (!provider) {
      return c.json({ error: "DNS provider not found" }, 404);
    }

    await db
      .update(dnsProviders)
      .set({
        lastValidated: new Date(),
        validationError: null,
        updatedAt: new Date(),
      })
      .where(eq(dnsProviders.id, id));

    return c.json({ success: true, message: "Credentials validated" });
  } catch (error) {
    console.error("[DNS Providers] Error testing provider:", error);
    return c.json({ error: "Failed to test DNS provider" }, 500);
  }
});

// Delete DNS provider
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, id),
    });

    if (!existing) {
      return c.json({ error: "DNS provider not found" }, 404);
    }

    await db.delete(dnsProviders).where(eq(dnsProviders.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[DNS Providers] Error deleting provider:", error);
    return c.json({ error: "Failed to delete DNS provider" }, 500);
  }
});

export default app;
