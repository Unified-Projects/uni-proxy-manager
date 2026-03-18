import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { domains, certificates, backends, maintenanceWindows } from "@uni-proxy-manager/database/schema";
import { eq, and, gt } from "drizzle-orm";

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
    // Get all domains
    const allDomains = await db.query.domains.findMany();

    // Get all certificates
    const allCertificates = await db.query.certificates.findMany();

    // Get all backends
    const allBackends = await db.query.backends.findMany();

    // Get maintenance windows
    const now = new Date();
    const activeMaintenance = await db.query.maintenanceWindows.findMany({
      where: eq(maintenanceWindows.isActive, true),
    });

    const scheduledMaintenance = await db.query.maintenanceWindows.findMany({
      where: and(
        eq(maintenanceWindows.isActive, false),
        gt(maintenanceWindows.scheduledStartAt, now)
      ),
    });

    // Calculate domain stats
    const domainStats = {
      total: allDomains.length,
      active: allDomains.filter(d => d.status === "active").length,
      pending: allDomains.filter(d => d.status === "pending").length,
      disabled: allDomains.filter(d => d.status === "disabled").length,
      error: allDomains.filter(d => d.status === "error").length,
    };

    // Calculate certificate stats
    const certificateStats = {
      total: allCertificates.length,
      active: allCertificates.filter(c => c.status === "active").length,
      pending: allCertificates.filter(c => c.status === "pending").length,
      expired: allCertificates.filter(c => c.status === "expired").length,
      failed: allCertificates.filter(c => c.status === "failed").length,
    };

    // Calculate backend stats
    const backendStats = computeBackendStats(allBackends);

    // Calculate maintenance stats
    const maintenanceStats = {
      domainsInMaintenance: allDomains.filter(d => d.maintenanceEnabled).length,
      scheduledWindows: scheduledMaintenance.length,
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
