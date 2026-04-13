import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb } from "../setup/test-db";

const BASE_URL = "http://localhost:3001";

async function loadApp() {
  vi.resetModules();
  const mod = await import("../../../apps/api/src/index");
  await mod.waitForRoutes();
  return mod.default;
}

async function fetchJson(
  app: Awaited<ReturnType<typeof loadApp>>,
  path: string,
  init?: RequestInit,
) {
  const response = await app.fetch(new Request(`${BASE_URL}${path}`, init));
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { response, body };
}

describe("API auth stack", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("fails closed when auth is enabled without an API key", async () => {
    process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "true";
    delete process.env.UNI_PROXY_MANAGER_API_KEY;

    vi.resetModules();
    await expect(import("../../../apps/api/src/index")).rejects.toThrow(
      "UNI_PROXY_MANAGER_API_KEY",
    );
  });

  it("requires auth on protected routes but preserves /health and analytics-public bypasses", async () => {
    process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "true";
    process.env.UNI_PROXY_MANAGER_API_KEY = "a".repeat(32);

    const app = await loadApp();

    const protectedRoute = await fetchJson(app, "/api/stats/dashboard");
    expect(protectedRoute.response.status).toBe(401);

    const healthRoute = await fetchJson(app, "/health");
    expect(healthRoute.response.status).toBe(200);

    const publicAnalytics = await fetchJson(app, "/api/analytics-public/missing-token/verify");
    expect(publicAnalytics.response.status).toBe(200);
    expect(publicAnalytics.body).toEqual({ valid: false });
  });

  it("rate limits repeated authentication failures when the limiter is enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.VITEST = "";
    process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "true";
    process.env.UNI_PROXY_MANAGER_API_KEY = "b".repeat(32);

    const app = await loadApp();
    const headers = {
      Authorization: "Bearer invalid-api-key",
      "X-Real-IP": "198.51.100.24",
    };

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await fetchJson(app, "/api/stats/dashboard", { headers });
      expect(result.response.status).toBe(401);
    }

    const blocked = await fetchJson(app, "/api/stats/dashboard", { headers });
    expect(blocked.response.status).toBe(429);
    expect(blocked.response.headers.get("retry-after")).toBeTruthy();
  });
});
