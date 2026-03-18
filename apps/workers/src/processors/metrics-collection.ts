import type { Job } from "bullmq";
import type { MetricsCollectionJobData, MetricsCollectionResult } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { trafficMetrics } from "@uni-proxy-manager/database/schema";
import { getHaproxyStats, type BackendStats } from "@uni-proxy-manager/shared/haproxy";
import { nanoid } from "nanoid";
import { lt } from "drizzle-orm";

/**
 * Sanitize hostname to match HAProxy backend naming convention
 * Must match the sanitizeIdentifier in packages/shared/src/haproxy/template.ts
 */
function sanitizeIdentifier(str: string): string {
  // Keep hyphens to match HAProxy template naming
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

export async function processMetricsCollection(
  job: Job<MetricsCollectionJobData>
): Promise<MetricsCollectionResult> {
  const { timestamp } = job.data;

  console.log(`[Metrics Collection] Collecting metrics at ${timestamp}`);

  try {
    const domains = await db.query.domains.findMany();

    if (domains.length === 0) {
      console.log("[Metrics Collection] No active domains found");
      return {
        success: true,
        timestamp,
        metricsCollected: 0,
        domainsProcessed: 0,
      };
    }

    let stats;
    try {
      stats = await getHaproxyStats();
    } catch (error) {
      // HAProxy might not be running or stats socket unavailable
      console.warn("[Metrics Collection] Could not get HAProxy stats:", error instanceof Error ? error.message : error);
      return {
        success: false,
        timestamp,
        metricsCollected: 0,
        domainsProcessed: 0,
        error: "HAProxy stats unavailable",
      };
    }

    // Debug: log available backends from HAProxy
    console.log(`[Metrics Collection] HAProxy returned ${stats.backends.length} backends: ${stats.backends.map(b => b.name).join(", ")}`);

    const metricsToInsert = [];
    let domainsProcessed = 0;

    for (const domain of domains) {
      // Find the corresponding backend in HAProxy stats
      // HAProxy backend names follow the pattern: backend_{sanitized_hostname}
      // Route backends are: backend_{sanitized_hostname}_route_{rule_id}
      const sanitizedHostname = sanitizeIdentifier(domain.hostname);
      const mainBackendName = `backend_${sanitizedHostname}`;

      // Find main backend and any route backends for this domain
      const domainBackends = stats.backends.filter((b) =>
        b.name === mainBackendName ||
        b.name.startsWith(`${mainBackendName}_route_`)
      );

      if (domainBackends.length === 0) {
        console.log(`[Metrics Collection] No backend found for domain ${domain.hostname} (expected: ${mainBackendName})`);
        continue;
      }

      // Aggregate stats from main backend and all route backends
      const aggregatedStats: BackendStats = {
        name: mainBackendName,
        type: "backend",
        status: "UP",
        total_requests: 0,
        http_requests_rate: 0,
        http_responses_1xx: 0,
        http_responses_2xx: 0,
        http_responses_3xx: 0,
        http_responses_4xx: 0,
        http_responses_5xx: 0,
        http_responses_other: 0,
        bytes_in: 0,
        bytes_out: 0,
        current_sessions: 0,
        max_sessions: 0,
        session_limit: 0,
        session_rate: 0,
        session_rate_max: 0,
        current_queue: 0,
        max_queue: 0,
      };

      for (const backend of domainBackends) {
        aggregatedStats.total_requests += backend.total_requests || 0;
        aggregatedStats.http_responses_2xx += backend.http_responses_2xx || 0;
        aggregatedStats.http_responses_3xx += backend.http_responses_3xx || 0;
        aggregatedStats.http_responses_4xx += backend.http_responses_4xx || 0;
        aggregatedStats.http_responses_5xx += backend.http_responses_5xx || 0;
        aggregatedStats.bytes_in += backend.bytes_in || 0;
        aggregatedStats.bytes_out += backend.bytes_out || 0;
        aggregatedStats.current_sessions += backend.current_sessions || 0;
        aggregatedStats.max_sessions = Math.max(aggregatedStats.max_sessions, backend.max_sessions || 0);
      }

      const metric = {
        id: nanoid(),
        domainId: domain.id,
        timestamp: new Date(timestamp),

        // Request counters
        totalRequests: aggregatedStats.total_requests,
        uniqueVisitors: 0, // Tracked separately by HAProxy log parser
        httpRequests: aggregatedStats.total_requests, // HAProxy doesn't distinguish HTTP/HTTPS at backend level
        httpsRequests: 0,

        // Response codes
        status2xx: aggregatedStats.http_responses_2xx,
        status3xx: aggregatedStats.http_responses_3xx,
        status4xx: aggregatedStats.http_responses_4xx,
        status5xx: aggregatedStats.http_responses_5xx,

        // Traffic volume
        bytesIn: aggregatedStats.bytes_in,
        bytesOut: aggregatedStats.bytes_out,

        // Connection stats
        currentConnections: aggregatedStats.current_sessions,
        maxConnections: aggregatedStats.max_sessions,
      };

      metricsToInsert.push(metric);
      domainsProcessed++;
    }

    if (metricsToInsert.length > 0) {
      await db.insert(trafficMetrics).values(metricsToInsert);
      console.log(`[Metrics Collection] Inserted ${metricsToInsert.length} metrics`);
    }

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      await db
        .delete(trafficMetrics)
        .where(lt(trafficMetrics.timestamp, thirtyDaysAgo));

      console.log(`[Metrics Collection] Cleaned up old metrics (>30 days)`);
    } catch (cleanupError) {
      // Don't fail the entire collection if cleanup fails
      console.warn("[Metrics Collection] Failed to cleanup old metrics:", cleanupError instanceof Error ? cleanupError.message : cleanupError);
    }

    return {
      success: true,
      timestamp,
      metricsCollected: metricsToInsert.length,
      domainsProcessed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Metrics Collection] Failed:`, errorMessage);

    return {
      success: false,
      timestamp,
      metricsCollected: 0,
      domainsProcessed: 0,
      error: errorMessage,
    };
  }
}
