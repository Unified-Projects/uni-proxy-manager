import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getAcmeConfig } from "@uni-proxy-manager/shared/config";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";

const app = new Hono();

// Validation schemas
const updateAcmeConfigSchema = z.object({
  email: z.string().email("Valid email is required"),
});

// Get ACME configuration
app.get("/acme", async (c) => {
  try {
    const acmeConfig = getAcmeConfig();

    return c.json({
      email: acmeConfig.email || "",
      staging: acmeConfig.staging,
      directoryUrl: acmeConfig.directoryUrl,
    });
  } catch (error) {
    console.error("[Config] Error getting ACME config:", error);
    return c.json({ error: "Failed to get ACME configuration" }, 500);
  }
});

// Update ACME configuration
app.put("/acme", zValidator("json", updateAcmeConfigSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    return c.json({
      success: true,
      message: "ACME email updated. Please update UNI_PROXY_MANAGER_ACME_EMAIL environment variable and restart the service.",
      email: data.email,
    });
  } catch (error) {
    console.error("[Config] Error updating ACME config:", error);
    return c.json({ error: "Failed to update ACME configuration" }, 500);
  }
});

export default app;
