import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildHealthStatus } from "../src/utils/health";

describe("buildHealthStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  it("marks status ok when redis and db are healthy", () => {
    const result = buildHealthStatus(true, true);
    expect(result.status).toBe("ok");
    expect(result.redis).toBe("connected");
    expect(result.db).toBe("connected");
    expect(result.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns degraded when redis is unreachable", () => {
    const result = buildHealthStatus(false, true);
    expect(result.status).toBe("degraded");
    expect(result.redis).toBe("disconnected");
    expect(result.db).toBe("connected");
  });

  it("returns degraded when db is unreachable", () => {
    const result = buildHealthStatus(true, false);
    expect(result.status).toBe("degraded");
    expect(result.redis).toBe("connected");
    expect(result.db).toBe("disconnected");
  });

  it("reports error details when an exception is passed", () => {
    const result = buildHealthStatus(false, false, new Error("boom"));
    expect(result.status).toBe("error");
    expect(result.error).toBe("boom");
  });
});
