import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@uni-proxy-manager/database";
import { pomeriumSettings } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type {
  PomeriumConfigJobData,
  PomeriumRestartJobData,
} from "@uni-proxy-manager/queue";
import crypto from "crypto";

const app = new Hono();

const updateSettingsSchema = z.object({
  authenticateServiceUrl: z.string().url().optional().or(z.literal("")),
  cookieName: z.string().min(1).max(50).optional().or(z.literal("")),
  cookieExpire: z.string().optional().or(z.literal("")),
  cookieDomain: z.string().nullable().optional().or(z.literal("")),
  cookieSecure: z.boolean().optional(),
  cookieHttpOnly: z.boolean().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional().or(z.literal("")),
  forwardAuthUrl: z.string().url().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
});

// Generate secure random secret (base64 encoded 32 bytes)
function generateSecret(): string {
  return crypto.randomBytes(32).toString("base64");
}

// Generate a valid ECDSA P-256 signing key as base64-encoded PEM
function generateSigningKey(): string {
  const { privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return Buffer.from(pem).toString("base64");
}

// Mask secrets in response
function maskSecrets(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...settings,
    sharedSecret: settings.sharedSecret ? "[CONFIGURED]" : null,
    cookieSecret: settings.cookieSecret ? "[CONFIGURED]" : null,
    signingKey: settings.signingKey ? "[CONFIGURED]" : null,
  };
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
      { reason, triggeredBy: "settings" },
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
      console.error(
        "[Pomerium Settings] Failed to queue config regeneration:",
        error
      );
    }
  }
}

// Get current settings (auto-initialize if needed)
app.get("/", async (c) => {
  try {
    let settings = await db.query.pomeriumSettings.findFirst({
      where: eq(pomeriumSettings.id, "default"),
    });

    // Initialize default settings if not exist
    if (!settings) {
      const [newSettings] = await db
        .insert(pomeriumSettings)
        .values({
          id: "default",
          sharedSecret: generateSecret(),
          cookieSecret: generateSecret(),
          signingKey: generateSigningKey(),
          enabled: false,
          logLevel: "info",
        })
        .returning();

      settings = newSettings;
      console.log("[Pomerium Settings] Initialized default settings with auto-generated secrets");
    }

    return c.json({
      settings: maskSecrets(settings as unknown as Record<string, unknown>),
    });
  } catch (error) {
    console.error("[Pomerium Settings] Error getting settings:", error);
    return c.json({ error: "Failed to get settings" }, 500);
  }
});

// Update settings
app.put("/", zValidator("json", updateSettingsSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.authenticateServiceUrl !== undefined && data.authenticateServiceUrl !== "")
      updateData.authenticateServiceUrl = data.authenticateServiceUrl;
    if (data.cookieName !== undefined && data.cookieName !== "")
      updateData.cookieName = data.cookieName;
    if (data.cookieExpire !== undefined && data.cookieExpire !== "")
      updateData.cookieExpire = data.cookieExpire;
    if (data.cookieDomain !== undefined)
      updateData.cookieDomain = data.cookieDomain;
    if (data.cookieSecure !== undefined)
      updateData.cookieSecure = data.cookieSecure;
    if (data.cookieHttpOnly !== undefined)
      updateData.cookieHttpOnly = data.cookieHttpOnly;
    if (data.logLevel !== undefined && data.logLevel !== "")
      updateData.logLevel = data.logLevel;
    if (data.forwardAuthUrl !== undefined && data.forwardAuthUrl !== "")
      updateData.forwardAuthUrl = data.forwardAuthUrl;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    // Use upsert pattern to handle concurrent requests atomically
    const [updated] = await db
      .insert(pomeriumSettings)
      .values({
        id: "default",
        sharedSecret: generateSecret(),
        cookieSecret: generateSecret(),
        signingKey: generateSigningKey(),
        enabled: false,
        ...updateData,
      })
      .onConflictDoUpdate({
        target: pomeriumSettings.id,
        set: updateData,
      })
      .returning();

    // Queue config regeneration
    await queueConfigRegeneration("Settings updated");

    return c.json({
      settings: maskSecrets(updated as unknown as Record<string, unknown>),
    });
  } catch (error) {
    console.error("[Pomerium Settings] Error updating settings:", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
});

// Regenerate all secrets
app.post("/regenerate-secrets", async (c) => {
  try {
    const newSecrets = {
      sharedSecret: generateSecret(),
      cookieSecret: generateSecret(),
      signingKey: generateSigningKey(),
      updatedAt: new Date(),
    };

    // Use upsert to handle case where settings don't exist yet
    const [updated] = await db
      .insert(pomeriumSettings)
      .values({
        id: "default",
        ...newSecrets,
        enabled: false,
      })
      .onConflictDoUpdate({
        target: pomeriumSettings.id,
        set: newSecrets,
      })
      .returning();

    // Queue config regeneration
    await queueConfigRegeneration("Secrets regenerated");

    return c.json({
      success: true,
      message:
        "Secrets regenerated successfully. Pomerium will need to be restarted to use new secrets.",
      settings: maskSecrets(updated as unknown as Record<string, unknown>),
    });
  } catch (error) {
    console.error("[Pomerium Settings] Error regenerating secrets:", error);
    return c.json({ error: "Failed to regenerate secrets" }, 500);
  }
});

function sanitizeHealthError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes("socket connection") || msg.includes("econnreset")) {
    return "Pomerium service is unreachable (connection reset)";
  }
  if (msg.includes("econnrefused")) {
    return "Cannot connect to Pomerium service";
  }
  if (msg.includes("aborted") || msg.includes("timeout")) {
    return "Pomerium health check timed out";
  }
  return "Pomerium health check failed";
}

// Get Pomerium service status
app.get("/status", async (c) => {
  try {
    const settings = await db.query.pomeriumSettings.findFirst({
      where: eq(pomeriumSettings.id, "default"),
    });

    // Check Pomerium health — only when enabled
    let healthy = false;
    let healthError: string | null = null;

    if (settings?.enabled) {
      const pomeriumUrl =
        process.env.POMERIUM_INTERNAL_URL || "http://pomerium:80";

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${pomeriumUrl}/.pomerium/ping`, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        // Accept any non-5xx response — Pomerium may return 404 when not fully
        // configured (no authenticate_service_url), but the service IS running.
        if (response.status < 500) {
          healthy = true;
        } else {
          healthError = `Pomerium returned HTTP ${response.status}`;
        }
      } catch (e) {
        healthError = sanitizeHealthError(e);
      }
    }

    // Check if properly configured
    const configured = !!(
      settings?.sharedSecret &&
      settings?.cookieSecret &&
      settings?.authenticateServiceUrl
    );

    return c.json({
      enabled: settings?.enabled ?? false,
      configured,
      healthy,
      error: healthError,
      authenticateUrl: settings?.authenticateServiceUrl || null,
    });
  } catch (error) {
    console.error("[Pomerium Settings] Error getting status:", error);
    return c.json({ error: "Failed to get status" }, 500);
  }
});

// Restart Pomerium service
app.post("/restart", async (c) => {
  try {
    const redis = getRedisClient();
    const queue = new Queue<PomeriumRestartJobData>(QUEUES.POMERIUM_RESTART, {
      connection: redis,
    });
    await queue.add(
      `pomerium-restart-${Date.now()}`,
      { reason: "Manual restart from UI" },
      { jobId: `pomerium-restart-${Date.now()}` }
    );
    return c.json({ success: true, message: "Pomerium restart queued" });
  } catch (error) {
    console.error("[Pomerium Settings] Error queuing restart:", error);
    return c.json({ error: "Failed to queue restart" }, 500);
  }
});

// Get raw secrets (for Docker compose environment - only in development)
app.get("/secrets", async (c) => {
  // Only allow in development mode
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "Not available in production" }, 403);
  }

  try {
    const settings = await db.query.pomeriumSettings.findFirst({
      where: eq(pomeriumSettings.id, "default"),
    });

    if (!settings) {
      return c.json({ error: "Settings not initialized" }, 404);
    }

    return c.json({
      sharedSecret: settings.sharedSecret,
      cookieSecret: settings.cookieSecret,
      signingKey: settings.signingKey,
    });
  } catch (error) {
    console.error("[Pomerium Settings] Error getting secrets:", error);
    return c.json({ error: "Failed to get secrets" }, 500);
  }
});

export default app;
