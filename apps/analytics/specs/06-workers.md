# 06 - Workers

## Overview

The analytics extension runs background jobs for funnel computation, anomaly detection, and aggregate cleanup. Jobs use BullMQ (matching the existing pattern) and run in a **separate process** from the analytics HTTP server, matching the existing `apps/workers`, `apps/sites-workers`, `apps/pomerium-workers` pattern. This prevents CPU-intensive tasks (funnel computation, anomaly detection) from blocking beacon collection.

**Note**: Aggregation and retention are handled natively by ClickHouse (Materialized Views and TTL respectively), so no BullMQ workers are needed for those.

## Queue Definitions

**File to modify**: `packages/queue/src/queues.ts`

```typescript
// Analytics extension queues
/** Queue for computing funnel results */
ANALYTICS_FUNNEL_COMPUTE: "analytics-funnel-compute",
/** Queue for anomaly baseline computation */
ANALYTICS_ANOMALY_DETECT: "analytics-anomaly-detect",
/** Queue for cleaning up expired aggregates */
ANALYTICS_AGGREGATE_CLEANUP: "analytics-aggregate-cleanup",
```

## Queue Configurations

```typescript
// In QUEUE_CONFIG:

[QUEUES.ANALYTICS_FUNNEL_COMPUTE]: {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 100 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
  },
},
[QUEUES.ANALYTICS_ANOMALY_DETECT]: {
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: { age: 24 * 60 * 60, count: 50 },
  },
},
[QUEUES.ANALYTICS_AGGREGATE_CLEANUP]: {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 300000 },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 60 * 60, count: 10 },
  },
},
```

## Job Types

### Job Data Interfaces

```typescript
// In packages/queue/src/types.ts (or co-located)

export interface AnalyticsFunnelComputeJobData {
  funnelId: string;
  periodStart: string;  // ISO 8601
  periodEnd: string;    // ISO 8601
}

export interface AnalyticsAnomalyDetectJobData {
  analyticsConfigId?: string;
}

export interface AnalyticsAggregateCleanupJobData {
  // No data needed - processes all configs
}
```

## Scheduled Jobs

Set up in the analytics worker process startup:

```typescript
// In apps/analytics-workers/src/index.ts

// Funnel computation: every 15 minutes (processes all enabled funnels)
await funnelQueue.add(
  "funnel-compute-all",
  {},
  {
    repeat: { pattern: "*/15 * * * *" }, // every 15 minutes
    jobId: "analytics-funnel-compute-all",
  }
);

// Anomaly detection: every 5 minutes (reads cached baseline from Redis)
await anomalyQueue.add(
  "anomaly-detect",
  {},
  {
    repeat: { pattern: "*/5 * * * *" },  // every 5 minutes
    jobId: "analytics-anomaly-detect",
  }
);

// Anomaly baseline recomputation: daily at 01:00
await anomalyQueue.add(
  "anomaly-baseline-recompute",
  {},
  {
    repeat: { pattern: "0 1 * * *" },    // 01:00 daily
    jobId: "analytics-anomaly-baseline",
  }
);

// Aggregate cleanup: daily at 03:00
await aggregateCleanupQueue.add(
  "aggregate-cleanup",
  {},
  {
    repeat: { pattern: "0 3 * * *" },    // 03:00 daily
    jobId: "analytics-aggregate-cleanup",
  }
);
```

## Worker Processors

### 1. Funnel Compute Processor

**File**: `apps/analytics/src/processors/funnel-compute.ts`

**Concurrency**: 2

**Logic**:

Funnels now use **session-based step tracking** only. The algorithm operates as follows:

1. Fetch events for the funnel's config within the computation window
2. Group events by `session_id` (not by visitor_hash, which no longer exists)
3. For each session, check if the events match the funnel steps in order
4. A visitor can only complete a funnel within a single session
5. Multi-day funnels are not supported (funnels operate within session scope)

**Computation window**: Instead of a time-based window for cross-session tracking, the computation window determines which sessions to analyse (e.g. "sessions from the last 7 days"). Each session is evaluated independently to see if it contains all the funnel steps in order.

**Performance considerations**:
- Batched processing to handle large event volumes
- Memory limits to prevent OOM errors
- BullMQ retry/backoff configuration handles transient failures

Detailed funnel computation algorithm is documented in [09-funnels.md](./09-funnels.md). Results are written to PostgreSQL `analytics_funnel_results` table.

### 2. Anomaly Detection Processor

**File**: `apps/analytics/src/processors/anomaly-detect.ts`

**Concurrency**: 1

**Logic**:

1. For each analytics config, read the **cached baseline** from Redis (`analytics:baseline:{configId}`). The baseline contains mean and standard deviation per time-of-day/day-of-week bucket, computed from the last 30 days of day aggregates
2. Compare the last 5 minutes of traffic (from ClickHouse minute aggregates) against the expected baseline for this time of day/week
3. If traffic deviates by more than 2 standard deviations:
   - Publish an anomaly event to Redis: `analytics:anomaly:{configId}`
   - Store the anomaly in a Redis sorted set (for dashboard display, auto-expires after 24h)

**Baseline recomputation**: The baseline is recomputed **daily** (not every 5 minutes) to avoid repeatedly querying 30 days of aggregate data across all configs. A separate scheduled job (`analytics-baseline-recompute`) runs at 01:00 daily and writes the baseline to Redis with a 48h TTL. The 5-minute anomaly detection job only reads the cached baseline.

**Anomaly types**:
- `traffic_spike` - Significantly higher than expected
- `traffic_drop` - Significantly lower than expected

### 3. Aggregate Cleanup Processor

**File**: `apps/analytics/src/processors/aggregate-cleanup.ts`

**Concurrency**: 1

**Logic**:

Cleans up expired minute-level aggregates from ClickHouse. Day and hour aggregates are retained longer per the standard retention policy.

**TTL settings**:
- Minute aggregates: 7 days
- Hour aggregates: per standard retention policy
- Day aggregates: per standard retention policy

Runs daily at 03:00 to remove minute aggregates older than 7 days.

## Worker Concurrency Settings

```typescript
// In apps/analytics-workers/src/index.ts

const workers = [
  { queue: QUEUES.ANALYTICS_FUNNEL_COMPUTE, processor: funnelComputeProcessor, concurrency: 2 },
  { queue: QUEUES.ANALYTICS_ANOMALY_DETECT, processor: anomalyDetectProcessor, concurrency: 1 },
  { queue: QUEUES.ANALYTICS_AGGREGATE_CLEANUP, processor: aggregateCleanupProcessor, concurrency: 1 },
];
```

## Redis Pub/Sub Channels

Used for inter-process communication between the analytics HTTP server and workers:

| Channel | Publisher | Subscriber | Purpose |
|---------|-----------|------------|---------|
| `analytics:live:{configId}` | HTTP server (on event ingest) | WebSocket handler | Real-time event broadcast |
| `analytics:anomaly:{configId}` | Anomaly detector | WebSocket handler | Anomaly notifications |

## Redis Data Structures

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `analytics:active:{configId}` | Sorted Set | trimmed to 5 min | Live stats: active visitors/pages in last 5 minutes |
| `analytics:baseline:{configId}` | Hash | 48h | Anomaly detection baseline (mean/stddev per time bucket) |
| `analytics:anomalies:{configId}` | Sorted Set | 24h | Recent anomaly events for dashboard display |
| `analytics:funnel-cache:{funnelId}:{period}` | String | 15 min | Cached funnel computation results |
| `analytics:ratelimit:{ip}` | String | 1 min | Rate limiting for beacon ingestion |
| `bull:{queue}:*` | Various | Various | BullMQ job queue data structures |
