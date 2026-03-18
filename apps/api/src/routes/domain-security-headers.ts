import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { domainSecurityHeaders, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { queueHaproxyReload } from "../utils/haproxy-queue";

const app = new Hono();

// Validation schemas
const updateSecurityHeadersSchema = z.object({
  // X-Frame-Options
  xFrameOptionsEnabled: z.boolean().optional(),
  xFrameOptionsValue: z.enum(["deny", "sameorigin", "allow-from", "disabled"]).optional(),
  xFrameOptionsAllowFrom: z.string().url().nullable().optional(),

  // CSP frame-ancestors
  cspFrameAncestorsEnabled: z.boolean().optional(),
  cspFrameAncestors: z.array(z.string()).optional(),

  // CORS
  corsEnabled: z.boolean().optional(),
  corsAllowOrigins: z.array(z.string()).optional(),
  corsAllowMethods: z.array(z.string()).optional(),
  corsAllowHeaders: z.array(z.string()).optional(),
  corsExposeHeaders: z.array(z.string()).optional(),
  corsAllowCredentials: z.boolean().optional(),
  corsMaxAge: z.number().min(0).max(86400 * 30).optional(), // Max 30 days
});

// Get security headers for domain (creates default if not exists)
app.get("/:domainId/security-headers", async (c) => {
  const { domainId } = c.req.param();

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    let securityHeaders = await db.query.domainSecurityHeaders.findFirst({
      where: eq(domainSecurityHeaders.domainId, domainId),
    });

    // Create default config if not exists
    if (!securityHeaders) {
      const id = nanoid();
      const [newHeaders] = await db
        .insert(domainSecurityHeaders)
        .values({
          id,
          domainId,
          // Defaults
          xFrameOptionsEnabled: false,
          xFrameOptionsValue: "deny",
          cspFrameAncestorsEnabled: false,
          cspFrameAncestors: [],
          corsEnabled: false,
          corsAllowOrigins: [],
          corsAllowMethods: ["GET", "POST", "OPTIONS"],
          corsAllowHeaders: ["Content-Type", "Authorization"],
          corsExposeHeaders: [],
          corsAllowCredentials: false,
          corsMaxAge: 86400,
        })
        .returning();
      securityHeaders = newHeaders;
    }

    return c.json({ securityHeaders });
  } catch (error) {
    console.error("[Domain Security Headers] Error getting security headers:", error);
    return c.json({ error: "Failed to get security headers" }, 500);
  }
});

// Update security headers for domain (upsert)
app.put("/:domainId/security-headers", zValidator("json", updateSecurityHeadersSchema), async (c) => {
  const { domainId } = c.req.param();
  const data = c.req.valid("json");

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Validate X-Frame-Options ALLOW-FROM requires a URL
    if (data.xFrameOptionsValue === "allow-from" && !data.xFrameOptionsAllowFrom) {
      return c.json(
        { error: "X-Frame-Options ALLOW-FROM requires a URL" },
        400
      );
    }

    let securityHeaders = await db.query.domainSecurityHeaders.findFirst({
      where: eq(domainSecurityHeaders.domainId, domainId),
    });

    if (!securityHeaders) {
      // Create new config
      const id = nanoid();
      const [newHeaders] = await db
        .insert(domainSecurityHeaders)
        .values({
          id,
          domainId,
          xFrameOptionsEnabled: data.xFrameOptionsEnabled ?? false,
          xFrameOptionsValue: data.xFrameOptionsValue ?? "deny",
          xFrameOptionsAllowFrom: data.xFrameOptionsAllowFrom,
          cspFrameAncestorsEnabled: data.cspFrameAncestorsEnabled ?? false,
          cspFrameAncestors: data.cspFrameAncestors ?? [],
          corsEnabled: data.corsEnabled ?? false,
          corsAllowOrigins: data.corsAllowOrigins ?? [],
          corsAllowMethods: data.corsAllowMethods ?? ["GET", "POST", "OPTIONS"],
          corsAllowHeaders: data.corsAllowHeaders ?? ["Content-Type", "Authorization"],
          corsExposeHeaders: data.corsExposeHeaders ?? [],
          corsAllowCredentials: data.corsAllowCredentials ?? false,
          corsMaxAge: data.corsMaxAge ?? 86400,
        })
        .returning();
      securityHeaders = newHeaders;
    } else {
      // Update existing config
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.xFrameOptionsEnabled !== undefined)
        updateData.xFrameOptionsEnabled = data.xFrameOptionsEnabled;
      if (data.xFrameOptionsValue !== undefined)
        updateData.xFrameOptionsValue = data.xFrameOptionsValue;
      if (data.xFrameOptionsAllowFrom !== undefined)
        updateData.xFrameOptionsAllowFrom = data.xFrameOptionsAllowFrom;
      if (data.cspFrameAncestorsEnabled !== undefined)
        updateData.cspFrameAncestorsEnabled = data.cspFrameAncestorsEnabled;
      if (data.cspFrameAncestors !== undefined)
        updateData.cspFrameAncestors = data.cspFrameAncestors;
      if (data.corsEnabled !== undefined)
        updateData.corsEnabled = data.corsEnabled;
      if (data.corsAllowOrigins !== undefined)
        updateData.corsAllowOrigins = data.corsAllowOrigins;
      if (data.corsAllowMethods !== undefined)
        updateData.corsAllowMethods = data.corsAllowMethods;
      if (data.corsAllowHeaders !== undefined)
        updateData.corsAllowHeaders = data.corsAllowHeaders;
      if (data.corsExposeHeaders !== undefined)
        updateData.corsExposeHeaders = data.corsExposeHeaders;
      if (data.corsAllowCredentials !== undefined)
        updateData.corsAllowCredentials = data.corsAllowCredentials;
      if (data.corsMaxAge !== undefined)
        updateData.corsMaxAge = data.corsMaxAge;

      const [updated] = await db
        .update(domainSecurityHeaders)
        .set(updateData)
        .where(eq(domainSecurityHeaders.id, securityHeaders.id))
        .returning();
      securityHeaders = updated;
    }

    // Queue HAProxy reload
    await queueHaproxyReload("Security headers updated", "domain", [domainId]);

    return c.json({ securityHeaders });
  } catch (error) {
    console.error("[Domain Security Headers] Error updating security headers:", error);
    return c.json({ error: "Failed to update security headers" }, 500);
  }
});

// Generate preview of headers that will be set
app.get("/:domainId/security-headers/preview", async (c) => {
  const { domainId } = c.req.param();

  try {
    const securityHeaders = await db.query.domainSecurityHeaders.findFirst({
      where: eq(domainSecurityHeaders.domainId, domainId),
    });

    if (!securityHeaders) {
      return c.json({ headers: {} });
    }

    const headers: Record<string, string> = {};

    // X-Frame-Options
    if (securityHeaders.xFrameOptionsEnabled && securityHeaders.xFrameOptionsValue !== "disabled") {
      if (securityHeaders.xFrameOptionsValue === "allow-from" && securityHeaders.xFrameOptionsAllowFrom) {
        headers["X-Frame-Options"] = `ALLOW-FROM ${securityHeaders.xFrameOptionsAllowFrom}`;
      } else {
        headers["X-Frame-Options"] = securityHeaders.xFrameOptionsValue?.toUpperCase() ?? "DENY";
      }
    }

    // CSP frame-ancestors
    if (securityHeaders.cspFrameAncestorsEnabled && securityHeaders.cspFrameAncestors?.length) {
      const ancestors = securityHeaders.cspFrameAncestors.map((a) =>
        a === "self" ? "'self'" : a
      );
      headers["Content-Security-Policy"] = `frame-ancestors ${ancestors.join(" ")}`;
    }

    // CORS headers
    if (securityHeaders.corsEnabled) {
      if (securityHeaders.corsAllowOrigins?.length) {
        headers["Access-Control-Allow-Origin"] = securityHeaders.corsAllowOrigins.includes("*")
          ? "*"
          : securityHeaders.corsAllowOrigins.join(", ");
      }
      if (securityHeaders.corsAllowMethods?.length) {
        headers["Access-Control-Allow-Methods"] = securityHeaders.corsAllowMethods.join(", ");
      }
      if (securityHeaders.corsAllowHeaders?.length) {
        headers["Access-Control-Allow-Headers"] = securityHeaders.corsAllowHeaders.join(", ");
      }
      if (securityHeaders.corsExposeHeaders?.length) {
        headers["Access-Control-Expose-Headers"] = securityHeaders.corsExposeHeaders.join(", ");
      }
      if (securityHeaders.corsAllowCredentials) {
        headers["Access-Control-Allow-Credentials"] = "true";
      }
      if (securityHeaders.corsMaxAge) {
        headers["Access-Control-Max-Age"] = String(securityHeaders.corsMaxAge);
      }
    }

    return c.json({ headers });
  } catch (error) {
    console.error("[Domain Security Headers] Error generating preview:", error);
    return c.json({ error: "Failed to generate preview" }, 500);
  }
});

export default app;
