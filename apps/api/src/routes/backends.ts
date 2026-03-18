import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { backends, domains, sites } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { validateAddressForSSRF, validatePort } from "@uni-proxy-manager/shared";

const app = new Hono();

// Validation schemas
const createBackendSchema = z.object({
  domainId: z.string().min(1),
  name: z.string().min(1),
  backendType: z.enum(["static", "site"]).default("static"),
  // Static backend fields
  address: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional().default(80),
  protocol: z.enum(["http", "https"]).default("http"),
  // Site backend fields
  siteId: z.string().optional(),
  // Common fields
  weight: z.number().int().min(1).max(256).default(100),
  maxConnections: z.number().int().optional(),
  healthCheckEnabled: z.boolean().default(true),
  healthCheckPath: z.string().default("/"),
  healthCheckInterval: z.number().int().default(5),
  healthCheckTimeout: z.number().int().default(2),
  healthCheckFallThreshold: z.number().int().default(3),
  healthCheckRiseThreshold: z.number().int().default(2),
  loadBalanceMethod: z.enum(["roundrobin", "leastconn", "source", "first"]).default("roundrobin"),
  isBackup: z.boolean().default(false),
  // Request modification options
  hostRewrite: z.string().optional(),
  pathPrefixAdd: z.string().optional(),
  pathPrefixStrip: z.string().optional(),
}).refine((data) => {
  // Validate based on backend type
  if (data.backendType === "static") {
    return !!data.address;
  } else if (data.backendType === "site") {
    return !!data.siteId;
  }
  return true;
}, {
  message: "Static backends require address, site backends require siteId",
});

const updateBackendSchema = z.object({
  name: z.string().min(1).optional(),
  backendType: z.enum(["static", "site"]).optional(),
  address: z.string().nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  protocol: z.enum(["http", "https"]).optional(),
  siteId: z.string().nullable().optional(),
  weight: z.number().int().min(1).max(256).optional(),
  maxConnections: z.number().int().nullable().optional(),
  healthCheckEnabled: z.boolean().optional(),
  healthCheckPath: z.string().optional(),
  healthCheckInterval: z.number().int().optional(),
  healthCheckTimeout: z.number().int().optional(),
  healthCheckFallThreshold: z.number().int().optional(),
  healthCheckRiseThreshold: z.number().int().optional(),
  loadBalanceMethod: z.enum(["roundrobin", "leastconn", "source", "first"]).optional(),
  enabled: z.boolean().optional(),
  isBackup: z.boolean().optional(),
  // Request modification options
  hostRewrite: z.string().nullable().optional(),
  pathPrefixAdd: z.string().nullable().optional(),
  pathPrefixStrip: z.string().nullable().optional(),
});

// List all backends (optionally filtered by domain)
app.get("/", async (c) => {
  try {
    const domainId = c.req.query("domainId");

    const allBackends = await db.query.backends.findMany({
      where: domainId ? eq(backends.domainId, domainId) : undefined,
      with: {
        domain: true,
        site: true,
      },
      orderBy: (backends, { desc }) => [desc(backends.createdAt)],
    });

    return c.json({ backends: allBackends });
  } catch (error) {
    console.error("[Backends] Error listing backends:", error);
    return c.json({ error: "Failed to list backends" }, 500);
  }
});

// Get single backend
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const backend = await db.query.backends.findFirst({
      where: eq(backends.id, id),
      with: {
        domain: true,
        site: true,
      },
    });

    if (!backend) {
      return c.json({ error: "Backend not found" }, 404);
    }

    return c.json({ backend });
  } catch (error) {
    console.error("[Backends] Error getting backend:", error);
    return c.json({ error: "Failed to get backend" }, 500);
  }
});

// Create backend
app.post("/", zValidator("json", createBackendSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // SSRF protection: Validate backend address for static backends
    if (data.backendType === "static" && data.address) {
      const ssrfError = validateAddressForSSRF(data.address);
      if (ssrfError) {
        return c.json({ error: ssrfError }, 400);
      }

      if (data.port) {
        const portError = validatePort(data.port);
        if (portError) {
          return c.json({ error: portError }, 400);
        }
      }
    }

    // Check if domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, data.domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Validate site exists for site backends
    if (data.backendType === "site" && data.siteId) {
      const site = await db.query.sites.findFirst({
        where: eq(sites.id, data.siteId),
      });

      if (!site) {
        return c.json({ error: "Site not found" }, 404);
      }
    }

    const id = nanoid();
    const [newBackend] = await db
      .insert(backends)
      .values({
        id,
        domainId: data.domainId,
        name: data.name,
        backendType: data.backendType,
        address: data.backendType === "static" ? data.address : null,
        port: data.backendType === "static" ? data.port : null,
        protocol: data.protocol,
        siteId: data.backendType === "site" ? data.siteId : null,
        weight: data.weight,
        maxConnections: data.maxConnections,
        healthCheckEnabled: data.healthCheckEnabled,
        healthCheckPath: data.healthCheckPath,
        healthCheckInterval: data.healthCheckInterval,
        healthCheckTimeout: data.healthCheckTimeout,
        healthCheckFallThreshold: data.healthCheckFallThreshold,
        healthCheckRiseThreshold: data.healthCheckRiseThreshold,
        loadBalanceMethod: data.loadBalanceMethod,
        isBackup: data.isBackup,
        hostRewrite: data.hostRewrite || null,
        pathPrefixAdd: data.pathPrefixAdd || null,
        pathPrefixStrip: data.pathPrefixStrip || null,
      })
      .returning();

    // Update domain config version and auto-activate if pending
    await db
      .update(domains)
      .set({
        // Auto-activate domain when first backend is added
        status: domain.status === "pending" ? "active" : domain.status,
        configVersion: domain.configVersion + 1,
        lastConfigUpdate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(domains.id, data.domainId));

    return c.json({ backend: newBackend }, 201);
  } catch (error) {
    console.error("[Backends] Error creating backend:", error);
    return c.json({ error: "Failed to create backend" }, 500);
  }
});

// Update backend
app.put("/:id", zValidator("json", updateBackendSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.backends.findFirst({
      where: eq(backends.id, id),
    });

    if (!existing) {
      return c.json({ error: "Backend not found" }, 404);
    }

    // SSRF protection: Validate address if being updated
    if (data.address) {
      const ssrfError = validateAddressForSSRF(data.address);
      if (ssrfError) {
        return c.json({ error: ssrfError }, 400);
      }
    }

    if (data.port) {
      const portError = validatePort(data.port);
      if (portError) {
        return c.json({ error: portError }, 400);
      }
    }

    const [updated] = await db
      .update(backends)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(backends.id, id))
      .returning();

    // Update domain config version
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, existing.domainId),
    });

    if (domain) {
      await db
        .update(domains)
        .set({
          configVersion: domain.configVersion + 1,
          lastConfigUpdate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(domains.id, domain.id));
    }

    return c.json({ backend: updated });
  } catch (error) {
    console.error("[Backends] Error updating backend:", error);
    return c.json({ error: "Failed to update backend" }, 500);
  }
});

// Delete backend
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.backends.findFirst({
      where: eq(backends.id, id),
    });

    if (!existing) {
      return c.json({ error: "Backend not found" }, 404);
    }

    await db.delete(backends).where(eq(backends.id, id));

    // Update domain config version
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, existing.domainId),
    });

    if (domain) {
      await db
        .update(domains)
        .set({
          configVersion: domain.configVersion + 1,
          lastConfigUpdate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(domains.id, domain.id));
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[Backends] Error deleting backend:", error);
    return c.json({ error: "Failed to delete backend" }, 500);
  }
});

export default app;
