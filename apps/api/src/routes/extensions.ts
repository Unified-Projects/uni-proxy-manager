import { Hono } from "hono";
import {
  getExtensionStatus,
  getExtensionConfig,
  validateExtensionConfig,
} from "../extensions";

const app = new Hono();

/**
 * GET /api/extensions
 *
 * Returns the status of all extensions.
 * Used by the frontend to conditionally render UI elements.
 */
app.get("/", async (c) => {
  try {
    const status = getExtensionStatus();
    return c.json({ extensions: status });
  } catch (error) {
    console.error("[Extensions] Error getting extension status:", error);
    return c.json({ error: "Failed to get extension status" }, 500);
  }
});

/**
 * GET /api/extensions/config
 *
 * Returns detailed configuration for all extensions.
 * Sensitive values are masked.
 */
app.get("/config", async (c) => {
  try {
    const config = getExtensionConfig();
    return c.json({ config });
  } catch (error) {
    console.error("[Extensions] Error getting extension config:", error);
    return c.json({ error: "Failed to get extension config" }, 500);
  }
});

/**
 * GET /api/extensions/:name/validate
 *
 * Validates the configuration for a specific extension.
 */
app.get("/:name/validate", async (c) => {
  const { name } = c.req.param();

  if (name !== "sites") {
    return c.json({ error: "Unknown extension" }, 404);
  }

  try {
    const result = validateExtensionConfig(name);
    return c.json(result);
  } catch (error) {
    console.error(`[Extensions] Error validating ${name}:`, error);
    return c.json({ error: "Failed to validate extension" }, 500);
  }
});

export default app;
