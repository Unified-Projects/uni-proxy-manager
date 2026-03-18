import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { domainIpRules, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { queueHaproxyReload } from "../utils/haproxy-queue";

const app = new Hono();

// IP/CIDR validation regex
const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(\/\d{1,3})?$/;

function isValidIpOrCidr(value: string): boolean {
  return ipv4Regex.test(value) || ipv6Regex.test(value);
}

// Validation schemas
const updateIpRuleSchema = z.object({
  mode: z.enum(["whitelist", "blacklist"]).optional(),
  ipAddresses: z
    .array(z.string())
    .optional()
    .refine(
      (ips) => !ips || ips.every(isValidIpOrCidr),
      { message: "Invalid IP address or CIDR notation" }
    ),
  enabled: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

const validateIpsSchema = z.object({
  ipAddresses: z.array(z.string()),
});

// Get IP rule for domain (creates default if not exists)
app.get("/:domainId/ip-rules", async (c) => {
  const { domainId } = c.req.param();

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    let ipRule = await db.query.domainIpRules.findFirst({
      where: eq(domainIpRules.domainId, domainId),
    });

    // Create default rule if not exists
    if (!ipRule) {
      const id = nanoid();
      const [newRule] = await db
        .insert(domainIpRules)
        .values({
          id,
          domainId,
          mode: "whitelist",
          ipAddresses: [],
          enabled: false,
        })
        .returning();
      ipRule = newRule;
    }

    return c.json({ ipRule });
  } catch (error) {
    console.error("[Domain IP Rules] Error getting IP rule:", error);
    return c.json({ error: "Failed to get IP rule" }, 500);
  }
});

// Update IP rule for domain (upsert)
app.put("/:domainId/ip-rules", zValidator("json", updateIpRuleSchema), async (c) => {
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

    let ipRule = await db.query.domainIpRules.findFirst({
      where: eq(domainIpRules.domainId, domainId),
    });

    if (!ipRule) {
      // Create new rule
      const id = nanoid();
      const [newRule] = await db
        .insert(domainIpRules)
        .values({
          id,
          domainId,
          mode: data.mode ?? "whitelist",
          ipAddresses: data.ipAddresses ?? [],
          enabled: data.enabled ?? false,
          description: data.description,
        })
        .returning();
      ipRule = newRule;
    } else {
      // Update existing rule
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.mode !== undefined) updateData.mode = data.mode;
      if (data.ipAddresses !== undefined) updateData.ipAddresses = data.ipAddresses;
      if (data.enabled !== undefined) updateData.enabled = data.enabled;
      if (data.description !== undefined) updateData.description = data.description;

      const [updated] = await db
        .update(domainIpRules)
        .set(updateData)
        .where(eq(domainIpRules.id, ipRule.id))
        .returning();
      ipRule = updated;
    }

    // Queue HAProxy reload
    await queueHaproxyReload("IP rule updated", "domain", [domainId]);

    return c.json({ ipRule });
  } catch (error) {
    console.error("[Domain IP Rules] Error updating IP rule:", error);
    return c.json({ error: "Failed to update IP rule" }, 500);
  }
});

// Toggle IP rule enabled/disabled
app.post("/:domainId/ip-rules/toggle", async (c) => {
  const { domainId } = c.req.param();

  try {
    // Validate domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const ipRule = await db.query.domainIpRules.findFirst({
      where: eq(domainIpRules.domainId, domainId),
    });

    if (!ipRule) {
      return c.json({ error: "IP rule not found. Create one first." }, 404);
    }

    const [updated] = await db
      .update(domainIpRules)
      .set({
        enabled: !ipRule.enabled,
        updatedAt: new Date(),
      })
      .where(eq(domainIpRules.id, ipRule.id))
      .returning();

    if (!updated) {
      return c.json({ error: "IP rule not found" }, 404);
    }

    // Queue HAProxy reload
    await queueHaproxyReload("IP rule toggled", "domain", [domainId]);

    return c.json({ ipRule: updated, enabled: updated.enabled });
  } catch (error) {
    console.error("[Domain IP Rules] Error toggling IP rule:", error);
    return c.json({ error: "Failed to toggle IP rule" }, 500);
  }
});

// Validate IP addresses (returns validation results)
app.post("/:domainId/ip-rules/validate", zValidator("json", validateIpsSchema), async (c) => {
  const { ipAddresses } = c.req.valid("json");

  const results = ipAddresses.map((ip) => ({
    ip,
    valid: isValidIpOrCidr(ip),
    type: ipv4Regex.test(ip) ? "ipv4" : ipv6Regex.test(ip) ? "ipv6" : "invalid",
    isCidr: ip.includes("/"),
  }));

  const allValid = results.every((r) => r.valid);
  const errors = results.filter((r) => !r.valid).map((r) => `Invalid: ${r.ip}`);

  return c.json({ valid: allValid, results, errors });
});

export default app;
