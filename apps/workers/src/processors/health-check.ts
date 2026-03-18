import type { Job } from "bullmq";
import type { HealthCheckJobData } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { backends, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";

interface HealthCheckResult {
  success: boolean;
  checkedCount: number;
  healthyCount: number;
  unhealthyCount: number;
}

export async function processHealthCheck(
  job: Job<HealthCheckJobData>
): Promise<HealthCheckResult> {
  const { scope, domainId, backendId } = job.data;

  console.log(`[Health Check] Running ${scope} health check`);

  try {
    let backendsToCheck: Array<typeof backends.$inferSelect> = [];

    if (scope === "backend" && backendId) {
      const backend = await db.query.backends.findFirst({
        where: eq(backends.id, backendId),
      });
      if (backend && backend.healthCheckEnabled) {
        backendsToCheck = [backend];
      }
    } else if (scope === "domain" && domainId) {
      backendsToCheck = await db.query.backends.findMany({
        where: eq(backends.domainId, domainId),
      });
      backendsToCheck = backendsToCheck.filter((b) => b.healthCheckEnabled);
    } else {
      backendsToCheck = await db.query.backends.findMany();
      backendsToCheck = backendsToCheck.filter((b) => b.healthCheckEnabled);
    }

    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const backend of backendsToCheck) {
      const isHealthy = await checkBackendHealth(backend);

      if (isHealthy !== backend.isHealthy) {
        await db
          .update(backends)
          .set({
            isHealthy,
            lastHealthCheck: new Date(),
            lastHealthError: isHealthy ? null : "Health check failed",
            updatedAt: new Date(),
          })
          .where(eq(backends.id, backend.id));

        console.log(
          `[Health Check] Backend ${backend.name} status changed to ${isHealthy ? "healthy" : "unhealthy"}`
        );
      } else {
        await db
          .update(backends)
          .set({
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(backends.id, backend.id));
      }

      if (isHealthy) {
        healthyCount++;
      } else {
        unhealthyCount++;
      }
    }

    console.log(
      `[Health Check] Completed: ${healthyCount} healthy, ${unhealthyCount} unhealthy`
    );

    return {
      success: true,
      checkedCount: backendsToCheck.length,
      healthyCount,
      unhealthyCount,
    };
  } catch (error) {
    console.error("[Health Check] Failed:", error);

    return {
      success: false,
      checkedCount: 0,
      healthyCount: 0,
      unhealthyCount: 0,
    };
  }
}

async function checkBackendHealth(
  backend: typeof backends.$inferSelect
): Promise<boolean> {
  try {
    const url = `${backend.protocol}://${backend.address}:${backend.port}${backend.healthCheckPath || "/"}`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      (backend.healthCheckTimeout || 2) * 1000
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        // Don't follow redirects for health checks
        redirect: "manual",
      });

      clearTimeout(timeout);

      // Consider 2xx and 3xx as healthy
      return response.status >= 200 && response.status < 400;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}
