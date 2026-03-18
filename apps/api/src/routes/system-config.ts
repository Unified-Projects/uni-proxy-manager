import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { systemConfig, CONFIG_KEYS, DEFAULT_RETENTION_CONFIG, DEFAULT_BUILD_DEFAULTS_CONFIG, DEFAULT_HAPROXY_WATCHDOG_CONFIG } from "@uni-proxy-manager/database/schema";
import type { RetentionConfig, BuildDefaultsConfig, HaproxyWatchdogConfig } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";

const app = new Hono();

const retentionConfigSchema = z.object({
  maxDeploymentsPerSite: z.number().int().min(1).max(100),
  deploymentMaxAgeDays: z.number().int().min(1).max(365),
  artifactRetentionDays: z.number().int().min(1).max(365),
  logRetentionDays: z.number().int().min(1).max(365),
});

const buildDefaultsConfigSchema = z.object({
  defaultBuildCpus: z.number().min(0.5).max(8),
  defaultBuildMemoryMb: z.number().int().min(512).max(16384),
  defaultBuildTimeoutSeconds: z.number().int().min(60).max(3600),
});

/**
 * GET /api/system-config
 * Get all system configuration
 */
app.get("/", async (c) => {
  try {
    const configs = await db.query.systemConfig.findMany();

    // Convert to key-value object
    const configMap: Record<string, unknown> = {};
    for (const config of configs) {
      configMap[config.key] = config.value;
    }

    // Ensure configs have defaults
    if (!configMap[CONFIG_KEYS.RETENTION]) {
      configMap[CONFIG_KEYS.RETENTION] = DEFAULT_RETENTION_CONFIG;
    }
    if (!configMap[CONFIG_KEYS.BUILD_DEFAULTS]) {
      configMap[CONFIG_KEYS.BUILD_DEFAULTS] = DEFAULT_BUILD_DEFAULTS_CONFIG;
    }
    if (!configMap[CONFIG_KEYS.HAPROXY_WATCHDOG]) {
      configMap[CONFIG_KEYS.HAPROXY_WATCHDOG] = DEFAULT_HAPROXY_WATCHDOG_CONFIG;
    }

    return c.json({ config: configMap });
  } catch (error) {
    console.error("[System Config] Error getting config:", error);
    return c.json({ error: "Failed to get system configuration" }, 500);
  }
});

/**
 * GET /api/system-config/retention
 * Get retention configuration
 */
app.get("/retention", async (c) => {
  try {
    const config = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.key, CONFIG_KEYS.RETENTION),
    });

    if (!config) {
      return c.json({ retention: DEFAULT_RETENTION_CONFIG });
    }

    return c.json({ retention: config.value as RetentionConfig });
  } catch (error) {
    console.error("[System Config] Error getting retention config:", error);
    return c.json({ error: "Failed to get retention configuration" }, 500);
  }
});

/**
 * PUT /api/system-config/retention
 * Update retention configuration
 */
app.put(
  "/retention",
  zValidator("json", retentionConfigSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const existing = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.key, CONFIG_KEYS.RETENTION),
      });

      if (existing) {
        await db
          .update(systemConfig)
          .set({
            value: data,
            updatedAt: new Date(),
          })
          .where(eq(systemConfig.key, CONFIG_KEYS.RETENTION));
      } else {
        await db.insert(systemConfig).values({
          id: nanoid(),
          key: CONFIG_KEYS.RETENTION,
          value: data,
          description: "Retention configuration for deployments, artifacts, and logs",
        });
      }

      return c.json({ retention: data });
    } catch (error) {
      console.error("[System Config] Error updating retention config:", error);
      return c.json({ error: "Failed to update retention configuration" }, 500);
    }
  }
);

/**
 * POST /api/system-config/retention/reset
 * Reset retention configuration to defaults
 */
app.post("/retention/reset", async (c) => {
  try {
    const existing = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.key, CONFIG_KEYS.RETENTION),
    });

    if (existing) {
      await db
        .update(systemConfig)
        .set({
          value: DEFAULT_RETENTION_CONFIG,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.key, CONFIG_KEYS.RETENTION));
    }

    return c.json({ retention: DEFAULT_RETENTION_CONFIG });
  } catch (error) {
    console.error("[System Config] Error resetting retention config:", error);
    return c.json({ error: "Failed to reset retention configuration" }, 500);
  }
});

/**
 * GET /api/system-config/build-defaults
 * Get build defaults configuration
 */
app.get("/build-defaults", async (c) => {
  try {
    const config = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.key, CONFIG_KEYS.BUILD_DEFAULTS),
    });

    if (!config) {
      return c.json({ buildDefaults: DEFAULT_BUILD_DEFAULTS_CONFIG });
    }

    return c.json({ buildDefaults: config.value as BuildDefaultsConfig });
  } catch (error) {
    console.error("[System Config] Error getting build defaults config:", error);
    return c.json({ error: "Failed to get build defaults configuration" }, 500);
  }
});

/**
 * PUT /api/system-config/build-defaults
 * Update build defaults configuration
 */
app.put(
  "/build-defaults",
  zValidator("json", buildDefaultsConfigSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const existing = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.key, CONFIG_KEYS.BUILD_DEFAULTS),
      });

      if (existing) {
        await db
          .update(systemConfig)
          .set({
            value: data,
            updatedAt: new Date(),
          })
          .where(eq(systemConfig.key, CONFIG_KEYS.BUILD_DEFAULTS));
      } else {
        await db.insert(systemConfig).values({
          id: nanoid(),
          key: CONFIG_KEYS.BUILD_DEFAULTS,
          value: data,
          description: "Default build configuration for CPU, memory, and timeout",
        });
      }

      return c.json({ buildDefaults: data });
    } catch (error) {
      console.error("[System Config] Error updating build defaults config:", error);
      return c.json({ error: "Failed to update build defaults configuration" }, 500);
    }
  }
);

/**
 * POST /api/system-config/build-defaults/reset
 * Reset build defaults configuration to defaults
 */
app.post("/build-defaults/reset", async (c) => {
  try {
    const existing = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.key, CONFIG_KEYS.BUILD_DEFAULTS),
    });

    if (existing) {
      await db
        .update(systemConfig)
        .set({
          value: DEFAULT_BUILD_DEFAULTS_CONFIG,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.key, CONFIG_KEYS.BUILD_DEFAULTS));
    }

    return c.json({ buildDefaults: DEFAULT_BUILD_DEFAULTS_CONFIG });
  } catch (error) {
    console.error("[System Config] Error resetting build defaults config:", error);
    return c.json({ error: "Failed to reset build defaults configuration" }, 500);
  }
});

const haproxyWatchdogConfigSchema = z.object({
  enabled: z.boolean(),
});

/**
 * GET /api/system-config/haproxy-watchdog
 * Get HAProxy watchdog configuration
 */
app.get("/haproxy-watchdog", async (c) => {
  try {
    const config = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.key, CONFIG_KEYS.HAPROXY_WATCHDOG),
    });

    if (!config) {
      return c.json({ watchdog: DEFAULT_HAPROXY_WATCHDOG_CONFIG });
    }

    return c.json({ watchdog: config.value as HaproxyWatchdogConfig });
  } catch (error) {
    console.error("[System Config] Error getting haproxy watchdog config:", error);
    return c.json({ error: "Failed to get HAProxy watchdog configuration" }, 500);
  }
});

/**
 * PUT /api/system-config/haproxy-watchdog
 * Update HAProxy watchdog configuration
 */
app.put(
  "/haproxy-watchdog",
  zValidator("json", haproxyWatchdogConfigSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      const existing = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.key, CONFIG_KEYS.HAPROXY_WATCHDOG),
      });

      if (existing) {
        await db
          .update(systemConfig)
          .set({
            value: data,
            updatedAt: new Date(),
          })
          .where(eq(systemConfig.key, CONFIG_KEYS.HAPROXY_WATCHDOG));
      } else {
        await db.insert(systemConfig).values({
          id: nanoid(),
          key: CONFIG_KEYS.HAPROXY_WATCHDOG,
          value: data,
          description: "HAProxy crash detection watchdog configuration",
        });
      }

      return c.json({ watchdog: data });
    } catch (error) {
      console.error("[System Config] Error updating haproxy watchdog config:", error);
      return c.json({ error: "Failed to update HAProxy watchdog configuration" }, 500);
    }
  }
);

export default app;
