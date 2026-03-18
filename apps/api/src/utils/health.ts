interface HealthStatus {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  redis: "connected" | "disconnected" | "unknown";
  db: "connected" | "disconnected" | "unknown";
  error?: string;
}

export function buildHealthStatus(
  redisOk: boolean | null,
  dbOk: boolean | null,
  err?: unknown
): HealthStatus {
  if (err) {
    return {
      status: "error",
      timestamp: new Date().toISOString(),
      redis: redisOk ? "connected" : "unknown",
      db: dbOk ? "connected" : "unknown",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (redisOk === false || dbOk === false) {
    return {
      status: "degraded",
      timestamp: new Date().toISOString(),
      redis: redisOk ? "connected" : "disconnected",
      db: dbOk ? "connected" : "disconnected",
    };
  }

  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    redis: "connected",
    db: "connected",
  };
}
