import type { Job } from "bullmq";
import type { HaproxyLogParseJobData, HaproxyLogParseResult } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { trafficMetrics, domains } from "@uni-proxy-manager/database/schema";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import Dockerode from "dockerode";
import { createHash } from "crypto";
import { isBot } from "@uni-proxy-manager/shared/utils/bot-detection";

interface HaproxyLogEntry {
  ts: number;
  fe: string;
  host: string;
  path: string;
  st: number;
  bo: number;
  bi: number;
  tr: number;
  ci: string;
  ua?: string;
}

interface DomainMetrics {
  domainId: string;
  hostname: string;
  totalRequests: number;
  uniqueVisitors: Set<string>;
  bytesIn: number;
  bytesOut: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  filterBotsFromStats: boolean;
}

const LAST_TIMESTAMP_KEY = "haproxy-log-parser:last-timestamp";

/**
 * Hash client IP for privacy while maintaining uniqueness tracking
 */
function hashClientIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").substring(0, 16);
}

export async function processHaproxyLogParse(
  job: Job<HaproxyLogParseJobData>
): Promise<HaproxyLogParseResult> {
  const { timestamp } = job.data;

  console.log(`[HAProxy Log Parser] Parsing logs at ${timestamp}`);

  try {
    const redis = getRedisClient();
    const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock" });
    const containerName = process.env.HAPROXY_CONTAINER_NAME || "uni-proxy-manager-haproxy";

    // Get last processed timestamp from Redis
    const lastTimestamp = await redis.get(LAST_TIMESTAMP_KEY);
    let sinceTimestamp = lastTimestamp ? parseInt(lastTimestamp, 10) : Math.floor(Date.now() / 1000) - 120;

    // If parseInt failed (NaN), use current time
    if (isNaN(sinceTimestamp)) {
      console.warn(`[HAProxy Log Parser] Invalid timestamp in Redis: ${lastTimestamp}, using current time`);
      sinceTimestamp = Math.floor(Date.now() / 1000) - 120;
    }

    console.log(`[HAProxy Log Parser] Fetching logs since Unix timestamp: ${sinceTimestamp}`);

    // Get HAProxy container
    let container: Dockerode.Container;
    try {
      container = docker.getContainer(containerName);
      await container.inspect();
    } catch (error) {
      console.warn(`[HAProxy Log Parser] Container ${containerName} not found or not accessible`);
      return {
        success: false,
        timestamp,
        linesProcessed: 0,
        domainsUpdated: 0,
        error: `Container ${containerName} not accessible`,
      };
    }

    // Fetch logs since last timestamp
    // Note: HAProxy sends logs to stderr even when configured with "log stdout"
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      since: sinceTimestamp,
      timestamps: false,
      follow: false,
    });

    // Parse logs
    const logs = logStream.toString("utf-8");
    const lines: string[] = logs.split("\n").filter((line: string) => line.trim());

    console.log(`[HAProxy Log Parser] Fetched ${lines.length} log lines, first 200 chars: ${logs.substring(0, 200)}`);

    // Get all domains from database for hostname lookup
    const allDomains = await db.query.domains.findMany();
    const hostnameToId = new Map<string, string>();
    const domainFilterBots = new Map<string, boolean>();
    for (const domain of allDomains) {
      hostnameToId.set(domain.hostname.toLowerCase(), domain.id);
      domainFilterBots.set(domain.id, domain.filterBotsFromStats ?? true);
    }

    // Aggregate metrics by domain
    const metricsMap = new Map<string, DomainMetrics>();
    let linesProcessed = 0;
    let latestTimestamp = sinceTimestamp;
    let parseErrors = 0;

    for (const line of lines) {
      let jsonStr: string | undefined;
      try {
        // Docker log format includes 8-byte header, skip it
        const jsonStart = line.indexOf("{");
        if (jsonStart === -1) continue;

        jsonStr = line.slice(jsonStart);
        const entry: HaproxyLogEntry = JSON.parse(jsonStr);

        if (!entry.host || !entry.ts) continue;

        // Track latest timestamp
        if (entry.ts > latestTimestamp) {
          latestTimestamp = entry.ts;
        }

        // Look up domain ID
        const parsedHostname = entry.host.toLowerCase().split(":")[0] || ""; // Remove port if present
        const domainId = hostnameToId.get(parsedHostname);

        if (!domainId) continue;

        // Check if this is a bot and should be filtered from stats
        const shouldFilterBots = domainFilterBots.get(domainId) ?? true;
        const isBotRequest = entry.ua ? isBot(entry.ua) : false;

        // Skip bot requests if filtering is enabled for this domain
        if (shouldFilterBots && isBotRequest) {
          continue;
        }

        // Get or create metrics entry
        const existingMetrics = metricsMap.get(domainId);
        const metrics: DomainMetrics = existingMetrics ?? {
          domainId,
          hostname: parsedHostname,
          totalRequests: 0,
          uniqueVisitors: new Set<string>(),
          bytesIn: 0,
          bytesOut: 0,
          status2xx: 0,
          status3xx: 0,
          status4xx: 0,
          status5xx: 0,
          filterBotsFromStats: shouldFilterBots,
        };

        if (!existingMetrics) {
          metricsMap.set(domainId, metrics);
        }

        // Track unique visitor (hash client IP for privacy)
        if (entry.ci) {
          metrics.uniqueVisitors.add(hashClientIp(entry.ci));
        }

        // Aggregate
        metrics.totalRequests++;
        metrics.bytesIn += entry.bi || 0;
        metrics.bytesOut += entry.bo || 0;

        const statusCode = entry.st;
        if (statusCode >= 200 && statusCode < 300) {
          metrics.status2xx++;
        } else if (statusCode >= 300 && statusCode < 400) {
          metrics.status3xx++;
        } else if (statusCode >= 400 && statusCode < 500) {
          metrics.status4xx++;
        } else if (statusCode >= 500) {
          metrics.status5xx++;
        }

        linesProcessed++;
      } catch (error) {
        // Log first few parse errors for debugging
        if (parseErrors < 3) {
          console.warn(`[HAProxy Log Parser] Failed to parse line: ${jsonStr?.substring(0, 200)}`, error);
          parseErrors++;
        }
        continue;
      }
    }

    // Insert aggregated metrics into database
    const metricsToInsert = [];
    // Use current time, not job timestamp, so "today" queries pick it up
    const now = new Date();

    for (const metrics of metricsMap.values()) {
      metricsToInsert.push({
        id: nanoid(),
        domainId: metrics.domainId,
        timestamp: now,
        totalRequests: metrics.totalRequests,
        uniqueVisitors: metrics.uniqueVisitors.size,
        httpRequests: metrics.totalRequests,
        httpsRequests: 0,
        status2xx: metrics.status2xx,
        status3xx: metrics.status3xx,
        status4xx: metrics.status4xx,
        status5xx: metrics.status5xx,
        bytesIn: metrics.bytesIn,
        bytesOut: metrics.bytesOut,
        currentConnections: 0,
        maxConnections: 0,
      });
    }

    if (metricsToInsert.length > 0) {
      await db.insert(trafficMetrics).values(metricsToInsert);
      console.log(`[HAProxy Log Parser] Inserted ${metricsToInsert.length} metrics for ${metricsMap.size} domains`);
    }

    // Store visitor hashes in Redis for deduplication across time ranges
    const hourKey = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD

    for (const metrics of metricsMap.values()) {
      if (metrics.uniqueVisitors.size > 0) {
        const visitorArray = Array.from(metrics.uniqueVisitors);

        // Store in hourly sets (25 hour TTL for 1-hour lookback)
        const hourlyKey = `visitors:hourly:${metrics.domainId}:${hourKey}`;
        await redis.sadd(hourlyKey, ...visitorArray);
        await redis.expire(hourlyKey, 25 * 60 * 60); // 25 hours

        // Store in daily sets (8 day TTL for 7-day lookback)
        const dailyKey = `visitors:daily:${metrics.domainId}:${dayKey}`;
        await redis.sadd(dailyKey, ...visitorArray);
        await redis.expire(dailyKey, 8 * 24 * 60 * 60); // 8 days
      }
    }

    // Update last processed timestamp
    await redis.set(LAST_TIMESTAMP_KEY, latestTimestamp.toString());

    console.log(`[HAProxy Log Parser] Processed ${linesProcessed} log lines, updated ${metricsMap.size} domains`);

    return {
      success: true,
      timestamp,
      linesProcessed,
      domainsUpdated: metricsMap.size,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[HAProxy Log Parser] Failed:`, errorMessage);

    return {
      success: false,
      timestamp,
      linesProcessed: 0,
      domainsUpdated: 0,
      error: errorMessage,
    };
  }
}
