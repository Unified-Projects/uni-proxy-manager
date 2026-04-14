import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../apps/analytics/src/clickhouse/client", () => ({
  getClickHouseClient: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue(true),
  })),
  closeClickHouseClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../apps/analytics/src/clickhouse/migrate", () => ({
  runClickHouseMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@uni-proxy-manager/shared/redis", () => ({
  pingRedis: vi.fn().mockResolvedValue(true),
  closeRedisConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../apps/analytics/src/services/config-cache", () => ({
  startConfigCache: vi.fn().mockResolvedValue(undefined),
  stopConfigCache: vi.fn(),
}));

vi.mock("../../../../apps/analytics/src/routes/scripts", () => {
  const { Hono } = require("hono");
  return {
    __esModule: true,
    default: new Hono(),
    preloadScripts: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../../../apps/analytics/src/routes/collect", () => {
  const { Hono } = require("hono");
  return { __esModule: true, default: new Hono() };
});

vi.mock("../../../../apps/analytics/src/routes/pixel", () => {
  const { Hono } = require("hono");
  return { __esModule: true, default: new Hono() };
});

vi.mock("../../../../apps/analytics/src/routes/server-api", () => {
  const { Hono } = require("hono");
  return { __esModule: true, default: new Hono() };
});

vi.mock("../../../../apps/analytics/src/routes/internal", () => {
  const { Hono } = require("hono");
  return { __esModule: true, default: new Hono() };
});

vi.mock("../../../../apps/analytics/src/routes/live", () => {
  const { Hono } = require("hono");
  return {
    __esModule: true,
    default: new Hono(),
    createWebSocketHandler: vi.fn(() => ({})),
  };
});

describe("Analytics service health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 with degraded status when Redis is unavailable", async () => {
    const { pingRedis } = await import("@uni-proxy-manager/shared/redis");
    vi.mocked(pingRedis).mockResolvedValue(false);

    const analytics = await import("../../../../apps/analytics/src/index");
    const res = await analytics.default.fetch(new Request("http://localhost/health"), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.redis).toBe("down");
    expect(body.service).toBe("analytics");
  });

  it("returns 200 with error status when dependency checks throw", async () => {
    const { pingRedis } = await import("@uni-proxy-manager/shared/redis");
    vi.mocked(pingRedis).mockRejectedValue(new Error("redis failed"));

    const analytics = await import("../../../../apps/analytics/src/index");
    const res = await analytics.default.fetch(new Request("http://localhost/health"), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.service).toBe("analytics");
  });
});
