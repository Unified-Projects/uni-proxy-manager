import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import {
  domains,
  errorPages,
  maintenanceWindows,
} from "@uni-proxy-manager/database/schema";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, type HaproxyReloadJobData } from "@uni-proxy-manager/queue";
import { validateBypassIPs } from "@uni-proxy-manager/shared";
import { compileMaintenancePage } from "../services/maintenance-page-compiler";

const app = new Hono();

// Validation schemas
const enableMaintenanceSchema = z.object({
  reason: z.string().optional(),
  bypassIps: z.array(z.string()).optional(),
});

const updateBypassIpsSchema = z.object({
  bypassIps: z.array(z.string()),
});

const scheduleMaintenanceSchema = z.object({
  domainId: z.string().min(1),
  title: z.string().optional(),
  reason: z.string().optional(),
  scheduledStartAt: z.string().datetime(),
  scheduledEndAt: z.string().datetime().optional(),
  bypassIps: z.array(z.string()).optional(),
});

// Get maintenance status for domain
app.get("/domains/:domainId", async (c) => {
  const { domainId } = c.req.param();

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Get active maintenance window if any
    const activeWindow = await db.query.maintenanceWindows.findFirst({
      where: and(
        eq(maintenanceWindows.domainId, domainId),
        eq(maintenanceWindows.isActive, true),
      ),
    });

    return c.json({
      maintenanceEnabled: domain.maintenanceEnabled,
      bypassIps: domain.maintenanceBypassIps,
      activeWindow,
    });
  } catch (error) {
    console.error("[Maintenance] Error getting status:", error);
    return c.json({ error: "Failed to get maintenance status" }, 500);
  }
});

// Enable maintenance mode for domain
app.post(
  "/domains/:domainId/enable",
  zValidator("json", enableMaintenanceSchema),
  async (c) => {
    const { domainId } = c.req.param();
    const data = c.req.valid("json");

    try {
      const domain = await db.query.domains.findFirst({
        where: eq(domains.id, domainId),
      });

      if (!domain) {
        return c.json({ error: "Domain not found" }, 404);
      }

      // Validate bypass IPs if provided
      let validatedBypassIps = data.bypassIps;
      if (data.bypassIps && data.bypassIps.length > 0) {
        const ipValidation = validateBypassIPs(data.bypassIps);
        if (ipValidation.errors.length > 0) {
          return c.json(
            {
              error: "Invalid bypass IP addresses",
              details: ipValidation.errors,
            },
            400,
          );
        }
        validatedBypassIps = ipValidation.valid;
      }

      if (domain.maintenancePageId) {
        const maintenancePage = await db.query.errorPages.findFirst({
          where: eq(errorPages.id, domain.maintenancePageId),
        });

        if (maintenancePage?.uploadedAt) {
          try {
            await compileMaintenancePage(
              maintenancePage.directoryPath,
              maintenancePage.entryFile,
            );
          } catch (compileError) {
            console.error(
              "[Maintenance] Failed to compile maintenance page:",
              compileError,
            );
            return c.json(
              { error: "Failed to prepare maintenance page for serving" },
              500,
            );
          }
        }
      }

      // Update domain maintenance status
      await db
        .update(domains)
        .set({
          maintenanceEnabled: true,
          maintenanceBypassIps:
            validatedBypassIps || domain.maintenanceBypassIps,
          configVersion: domain.configVersion + 1,
          lastConfigUpdate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(domains.id, domainId));

      // Create maintenance window record
      const windowId = nanoid();
      await db.insert(maintenanceWindows).values({
        id: windowId,
        domainId,
        reason: data.reason,
        bypassIps: validatedBypassIps,
        isActive: true,
        activatedAt: new Date(),
        triggeredBy: "api",
      });

      // Queue HAProxy reload
      await queueHaproxyReload("maintenance", [domainId]);

      return c.json({ success: true, maintenanceWindowId: windowId });
    } catch (error) {
      console.error("[Maintenance] Error enabling maintenance:", error);
      return c.json({ error: "Failed to enable maintenance mode" }, 500);
    }
  },
);

// Disable maintenance mode for domain
app.post("/domains/:domainId/disable", async (c) => {
  const { domainId } = c.req.param();

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Update domain maintenance status
    await db
      .update(domains)
      .set({
        maintenanceEnabled: false,
        configVersion: domain.configVersion + 1,
        lastConfigUpdate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(domains.id, domainId));

    // Deactivate any active maintenance windows
    await db
      .update(maintenanceWindows)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(maintenanceWindows.domainId, domainId),
          eq(maintenanceWindows.isActive, true),
        ),
      );

    // Queue HAProxy reload
    await queueHaproxyReload("maintenance", [domainId]);

    return c.json({ success: true });
  } catch (error) {
    console.error("[Maintenance] Error disabling maintenance:", error);
    return c.json({ error: "Failed to disable maintenance mode" }, 500);
  }
});

// Update bypass IPs for domain
app.put(
  "/domains/:domainId/bypass-ips",
  zValidator("json", updateBypassIpsSchema),
  async (c) => {
    const { domainId } = c.req.param();
    const data = c.req.valid("json");

    try {
      const domain = await db.query.domains.findFirst({
        where: eq(domains.id, domainId),
      });

      if (!domain) {
        return c.json({ error: "Domain not found" }, 404);
      }

      // Validate all bypass IPs
      const ipValidation = validateBypassIPs(data.bypassIps);
      if (ipValidation.errors.length > 0) {
        return c.json(
          {
            error: "Invalid bypass IP addresses",
            details: ipValidation.errors,
          },
          400,
        );
      }

      await db
        .update(domains)
        .set({
          maintenanceBypassIps: ipValidation.valid,
          configVersion: domain.configVersion + 1,
          lastConfigUpdate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(domains.id, domainId));

      // If maintenance is active, reload HAProxy
      if (domain.maintenanceEnabled) {
        await queueHaproxyReload("maintenance", [domainId]);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("[Maintenance] Error updating bypass IPs:", error);
      return c.json({ error: "Failed to update bypass IPs" }, 500);
    }
  },
);

// Get maintenance windows for a specific domain
app.get("/domains/:domainId/windows", async (c) => {
  const { domainId } = c.req.param();
  const active = c.req.query("active");

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const windowsList = await db.query.maintenanceWindows.findMany({
      where:
        active === "true"
          ? and(
              eq(maintenanceWindows.domainId, domainId),
              eq(maintenanceWindows.isActive, true),
            )
          : eq(maintenanceWindows.domainId, domainId),
      with: {
        domain: true,
      },
      orderBy: (maintenanceWindows, { desc }) => [
        desc(maintenanceWindows.createdAt),
      ],
    });

    // Map activatedAt to startedAt for API compatibility
    const windows = windowsList.map((w) => ({
      ...w,
      startedAt: w.activatedAt,
      endedAt: w.deactivatedAt,
    }));

    return c.json({ windows });
  } catch (error) {
    console.error("[Maintenance] Error listing domain windows:", error);
    return c.json({ error: "Failed to list maintenance windows" }, 500);
  }
});

// List maintenance windows
app.get("/windows", async (c) => {
  const domainId = c.req.query("domainId");
  const active = c.req.query("active");

  try {
    let windows;

    if (domainId) {
      windows = await db.query.maintenanceWindows.findMany({
        where:
          active === "true"
            ? and(
                eq(maintenanceWindows.domainId, domainId),
                eq(maintenanceWindows.isActive, true),
              )
            : eq(maintenanceWindows.domainId, domainId),
        with: {
          domain: true,
        },
        orderBy: (maintenanceWindows, { desc }) => [
          desc(maintenanceWindows.createdAt),
        ],
      });
    } else {
      windows = await db.query.maintenanceWindows.findMany({
        where:
          active === "true" ? eq(maintenanceWindows.isActive, true) : undefined,
        with: {
          domain: true,
        },
        orderBy: (maintenanceWindows, { desc }) => [
          desc(maintenanceWindows.createdAt),
        ],
      });
    }

    return c.json({ windows });
  } catch (error) {
    console.error("[Maintenance] Error listing windows:", error);
    return c.json({ error: "Failed to list maintenance windows" }, 500);
  }
});

// Schedule maintenance window
app.post(
  "/windows",
  zValidator("json", scheduleMaintenanceSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const domain = await db.query.domains.findFirst({
        where: eq(domains.id, data.domainId),
      });

      if (!domain) {
        return c.json({ error: "Domain not found" }, 404);
      }

      // Validate bypass IPs if provided
      let validatedBypassIps = data.bypassIps;
      if (data.bypassIps && data.bypassIps.length > 0) {
        const ipValidation = validateBypassIPs(data.bypassIps);
        if (ipValidation.errors.length > 0) {
          return c.json(
            {
              error: "Invalid bypass IP addresses",
              details: ipValidation.errors,
            },
            400,
          );
        }
        validatedBypassIps = ipValidation.valid;
      }

      const id = nanoid();
      const [window] = await db
        .insert(maintenanceWindows)
        .values({
          id,
          domainId: data.domainId,
          title: data.title,
          reason: data.reason,
          scheduledStartAt: new Date(data.scheduledStartAt),
          scheduledEndAt: data.scheduledEndAt
            ? new Date(data.scheduledEndAt)
            : null,
          bypassIps: validatedBypassIps,
          isActive: false,
          triggeredBy: "scheduled",
        })
        .returning();

      return c.json({ window }, 201);
    } catch (error) {
      console.error("[Maintenance] Error scheduling window:", error);
      return c.json({ error: "Failed to schedule maintenance window" }, 500);
    }
  },
);

// Helper function to queue HAProxy reload
async function queueHaproxyReload(
  reason: HaproxyReloadJobData["triggeredBy"],
  affectedDomainIds: string[],
) {
  try {
    const redis = getRedisClient();
    const queue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, {
      connection: redis,
    });

    await queue.add(
      `reload-${Date.now()}`,
      {
        reason: `Maintenance mode change`,
        triggeredBy: reason,
        affectedDomainIds,
      },
      { jobId: `haproxy-reload-${Date.now()}` },
    );
  } catch (error) {
    console.error("[Maintenance] Failed to queue HAProxy reload:", error);
  }
}

export default app;
