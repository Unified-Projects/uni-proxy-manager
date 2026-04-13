import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { domains, certificates, backends, maintenanceWindows } from "@uni-proxy-manager/database/schema";
import { eq, and, gt, sql } from "drizzle-orm";

export function computeBackendStats(allBackends: Array<{ enabled: boolean; isHealthy: boolean }>) {
  return {
    total: allBackends.length,
    healthy: allBackends.filter(b => b.enabled && b.isHealthy).length,
    unhealthy: allBackends.filter(b => b.enabled && !b.isHealthy).length,
  };
}

const app = new Hono();

// Get dashboard stats
app.get("/dashboard", async (c) => {
  try {
    const now = new Date();
    const [
      [domainStatsRow],
      [certificateStatsRow],
      [backendStatsRow],
      [scheduledMaintenanceRow],
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`COUNT(*)`,
          active: sql<number>`COUNT(*) FILTER (WHERE ${domains.status} = 'active')`,
          pending: sql<number>`COUNT(*) FILTER (WHERE ${domains.status} = 'pending')`,
          disabled: sql<number>`COUNT(*) FILTER (WHERE ${domains.status} = 'disabled')`,
          error: sql<number>`COUNT(*) FILTER (WHERE ${domains.status} = 'error')`,
          domainsInMaintenance: sql<number>`COUNT(*) FILTER (WHERE ${domains.maintenanceEnabled} = true)`,
        })
        .from(domains),
      db
        .select({
          total: sql<number>`COUNT(*)`,
          active: sql<number>`COUNT(*) FILTER (WHERE ${certificates.status} = 'active')`,
          pending: sql<number>`COUNT(*) FILTER (WHERE ${certificates.status} = 'pending')`,
          expired: sql<number>`COUNT(*) FILTER (WHERE ${certificates.status} = 'expired')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${certificates.status} = 'failed')`,
        })
        .from(certificates),
      db
        .select({
          total: sql<number>`COUNT(*)`,
          healthy: sql<number>`COUNT(*) FILTER (WHERE ${backends.enabled} = true AND ${backends.isHealthy} = true)`,
          unhealthy: sql<number>`COUNT(*) FILTER (WHERE ${backends.enabled} = true AND ${backends.isHealthy} = false)`,
        })
        .from(backends),
      db
        .select({
          scheduledWindows: sql<number>`COUNT(*)`,
        })
        .from(maintenanceWindows)
        .where(
          and(
            eq(maintenanceWindows.isActive, false),
            gt(maintenanceWindows.scheduledStartAt, now)
          )
        ),
    ]);

    const domainStats = {
      total: Number(domainStatsRow?.total) || 0,
      active: Number(domainStatsRow?.active) || 0,
      pending: Number(domainStatsRow?.pending) || 0,
      disabled: Number(domainStatsRow?.disabled) || 0,
      error: Number(domainStatsRow?.error) || 0,
    };

    const certificateStats = {
      total: Number(certificateStatsRow?.total) || 0,
      active: Number(certificateStatsRow?.active) || 0,
      pending: Number(certificateStatsRow?.pending) || 0,
      expired: Number(certificateStatsRow?.expired) || 0,
      failed: Number(certificateStatsRow?.failed) || 0,
    };

    const backendStats = {
      total: Number(backendStatsRow?.total) || 0,
      healthy: Number(backendStatsRow?.healthy) || 0,
      unhealthy: Number(backendStatsRow?.unhealthy) || 0,
    };

    const maintenanceStats = {
      domainsInMaintenance: Number(domainStatsRow?.domainsInMaintenance) || 0,
      scheduledWindows: Number(scheduledMaintenanceRow?.scheduledWindows) || 0,
    };

    return c.json({
      domains: domainStats,
      certificates: certificateStats,
      backends: backendStats,
      maintenance: maintenanceStats,
    });
  } catch (error) {
    console.error("[Stats] Error getting dashboard stats:", error);
    return c.json({ error: "Failed to get dashboard stats" }, 500);
  }
});

export default app;
