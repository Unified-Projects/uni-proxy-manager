/**
 * Script serving routes.
 * Serves the bootstrap and full tracker JavaScript files.
 * Scripts are pre-loaded at startup and banner-stripped once to avoid
 * per-request I/O and regex processing.
 */

import { Hono } from "hono";
import { getConfigByUuid } from "../services/config-cache";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();

// Copyright banner injected at serve time with the current year.
const BANNER = `/*! UPM Analytics - Privacy-first web analytics (v1) | \u00A9 ${new Date().getFullYear()} Unified Projects LTD. */`;

/** Strip the leading bang-comment from a script body. */
function stripBanner(script: string): string {
  return script.replace(/^\/\*![\s\S]*?\*\/\s*/, "");
}

/** Pre-stripped script contents (populated by preloadScripts). */
let strippedBootstrap = "";
let strippedTracker = "";

/**
 * Pre-load and pre-process scripts at startup.
 * Must be called (and awaited) during init() before accepting requests.
 */
export async function preloadScripts(): Promise<void> {
  const scriptsDir = path.join(__dirname, "../scripts");

  const [bootstrapRaw, trackerRaw] = await Promise.all([
    readFile(path.join(scriptsDir, "bootstrap.js"), "utf-8"),
    readFile(path.join(scriptsDir, "tracker.js"), "utf-8"),
  ]);

  strippedBootstrap = stripBanner(bootstrapRaw);
  strippedTracker = stripBanner(trackerRaw);
}

// GET /:uuid/script.js - Serve bootstrap script with feature toggle injection
app.get("/:uuid/script.js", async (c) => {
  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  if (!config || !config.enabled) {
    return c.text("", 404);
  }

  // Prepend feature toggle config so the bootstrap can read it at runtime.
  const configLine = `window.__upmConfig=${JSON.stringify({
    scrollDepth: config.trackScrollDepth,
    sessionDuration: config.trackSessionDuration,
    outboundLinks: config.trackOutboundLinks,
  })};`;

  return c.text(BANNER + "\n" + configLine + "\n" + strippedBootstrap, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

// GET /:uuid/tracker.js - Serve full tracker
app.get("/:uuid/tracker.js", async (c) => {
  const uuid = c.req.param("uuid");
  const config = getConfigByUuid(uuid);

  if (!config || !config.enabled) {
    return c.text("", 404);
  }

  return c.text(BANNER + "\n" + strippedTracker, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

export default app;
