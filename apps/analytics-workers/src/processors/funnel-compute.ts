/**
 * Funnel computation processor.
 *
 * Evaluates funnel step completion across sessions by querying raw events
 * from ClickHouse and checking each session against the funnel definition.
 */

import { type Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { analyticsFunnels, analyticsFunnelResults } from "@uni-proxy-manager/database";
import { eq, and } from "drizzle-orm";
import { getClickHouseClient } from "../clickhouse";
import { nanoid } from "nanoid";
import picomatch from "picomatch";
import type { AnalyticsFunnelComputeJobData } from "@uni-proxy-manager/queue";

/**
 * Hard cap on the number of events fetched per funnel computation.
 * Prevents OOM when a high-traffic site generates millions of matching rows.
 */
const MAX_FUNNEL_EVENTS = 500_000;

interface FunnelStep {
  name: string;
  type: "pageview" | "event";
  pathPattern?: string;
  eventName?: string;
  eventMetaMatch?: Record<string, string | number | boolean>;
}

interface RawEvent {
  session_id: string;
  event_type: string;
  event_name: string;
  pathname: string;
  event_meta: Record<string, string>;
  timestamp: string;
}

/**
 * Pre-compile picomatch patterns to avoid recompiling on every event comparison.
 */
const matcherCache = new Map<string, picomatch.Matcher>();

function getCompiledMatcher(pattern: string): picomatch.Matcher {
  let matcher = matcherCache.get(pattern);
  if (!matcher) {
    matcher = picomatch(pattern);
    matcherCache.set(pattern, matcher);
  }
  return matcher;
}

/**
 * Check whether a raw event matches a funnel step definition.
 */
function eventMatchesStep(event: RawEvent, step: FunnelStep): boolean {
  if (step.type === "pageview") {
    if (event.event_type !== "pageview") return false;
    if (!step.pathPattern) return true;
    return getCompiledMatcher(step.pathPattern)(event.pathname);
  }

  if (step.type === "event") {
    if (event.event_type !== "event") return false;
    if (event.event_name !== step.eventName) return false;
    if (step.eventMetaMatch) {
      for (const [key, expected] of Object.entries(step.eventMetaMatch)) {
        if (event.event_meta[key] !== String(expected)) return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Process a single funnel definition.
 */
async function computeFunnel(
  funnel: typeof analyticsFunnels.$inferSelect,
  periodStartOverride?: Date,
  periodEndOverride?: Date,
): Promise<void> {
  const steps = funnel.steps as FunnelStep[];
  if (!steps || steps.length < 2) return;

  const now = new Date();
  const periodEnd = periodEndOverride ?? now;
  const periodStart = periodStartOverride ?? new Date(periodEnd.getTime() - funnel.windowMs);

  const client = getClickHouseClient();

  // Collect event names for filtering.
  const eventNames = steps
    .filter((s) => s.type === "event" && s.eventName)
    .map((s) => s.eventName!);

  // Query raw events with a hard row cap to prevent OOM.
  const query = `
    SELECT session_id, event_type, event_name, pathname, event_meta, timestamp
    FROM analytics_events
    WHERE analytics_config_id = {configId:String}
      AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
      AND (
        event_type = 'pageview'
        OR (event_type = 'event' ${eventNames.length > 0 ? "AND event_name IN ({eventNames:Array(String)})" : ""})
      )
    ORDER BY session_id, timestamp ASC
    LIMIT {maxEvents:UInt32}
  `;

  const startStr = periodStart.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
  const endStr = periodEnd.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

  const result = await client.query({
    query,
    query_params: {
      configId: funnel.analyticsConfigId,
      start: startStr,
      end: endStr,
      maxEvents: MAX_FUNNEL_EVENTS,
      ...(eventNames.length > 0 ? { eventNames } : {}),
    },
    format: "JSONEachRow",
  });

  const events = await result.json<RawEvent[]>();

  if (events.length >= MAX_FUNNEL_EVENTS) {
    console.warn(
      `[Funnel Compute] Hit ${MAX_FUNNEL_EVENTS} row limit for funnel ${funnel.id} — results may be approximate`,
    );
  }

  // Group events by session.
  const sessionMap = new Map<string, RawEvent[]>();
  for (const event of events) {
    if (!event.session_id) continue;
    const list = sessionMap.get(event.session_id) || [];
    list.push(event);
    sessionMap.set(event.session_id, list);
  }

  // Evaluate each session against the funnel.
  const stepCounts = new Array(steps.length).fill(0);

  for (const [, sessionEvents] of sessionMap) {
    let currentStep = 0;

    for (const event of sessionEvents) {
      if (currentStep >= steps.length) break;
      if (eventMatchesStep(event, steps[currentStep])) {
        currentStep++;
      }
    }

    // Record the furthest step reached.
    for (let i = 0; i < currentStep; i++) {
      stepCounts[i]++;
    }
  }

  // Calculate step dropoffs.
  const stepDropoffs = steps.map((_, i) => {
    if (i === steps.length - 1) return stepCounts[i];
    return stepCounts[i] - stepCounts[i + 1];
  });

  // Calculate conversion rates.
  const stepConversionRates = steps.map((_, i) => {
    if (i === 0) return stepCounts[0] > 0 ? 100 : 0;
    return stepCounts[i - 1] > 0
      ? Math.round((stepCounts[i] / stepCounts[i - 1]) * 1000) / 10
      : 0;
  });

  const totalEntrants = stepCounts[0] || 0;
  const overallConversionRate = totalEntrants > 0
    ? Math.round((stepCounts[steps.length - 1] / totalEntrants) * 1000) / 10
    : 0;

  // Upsert results.
  const id = nanoid();
  await db
    .insert(analyticsFunnelResults)
    .values({
      id,
      funnelId: funnel.id,
      periodStart,
      periodEnd,
      stepCounts,
      stepDropoffs,
      stepConversionRates,
      overallConversionRate,
      totalEntrants,
      computedAt: now,
    })
    .onConflictDoUpdate({
      target: [analyticsFunnelResults.funnelId, analyticsFunnelResults.periodStart, analyticsFunnelResults.periodEnd],
      set: {
        stepCounts,
        stepDropoffs,
        stepConversionRates,
        overallConversionRate,
        totalEntrants,
        computedAt: now,
      },
    });
}

export async function processFunnelCompute(job: Job<AnalyticsFunnelComputeJobData>): Promise<void> {
  const { funnelId, periodStart, periodEnd } = job.data;

  // Parse optional period overrides from job data.
  const startOverride = periodStart ? new Date(periodStart) : undefined;
  const endOverride = periodEnd ? new Date(periodEnd) : undefined;

  if (funnelId) {
    // Process a specific funnel.
    const funnel = await db.query.analyticsFunnels.findFirst({
      where: eq(analyticsFunnels.id, funnelId),
    });
    if (funnel && funnel.enabled) {
      await computeFunnel(funnel, startOverride, endOverride);
    }
  } else {
    // Process all enabled funnels.
    const funnels = await db.query.analyticsFunnels.findMany({
      where: eq(analyticsFunnels.enabled, true),
    });

    for (const funnel of funnels) {
      try {
        await computeFunnel(funnel, startOverride, endOverride);
      } catch (err) {
        console.error(`[Funnel Compute] Failed for funnel ${funnel.id}:`, err);
      }
    }
  }
}
