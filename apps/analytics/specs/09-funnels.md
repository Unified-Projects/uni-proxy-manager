# 09 - Funnels

## Overview

Conversion funnels allow domain owners to define multi-step user journeys and track drop-off rates at each step within a single session. Steps can be URL path visits, custom events, or a mix of both.

**Key principle**: Funnels track session-level completion only. All steps must occur within a single session. This is a deliberate trade-off for privacy, as the analytics system does not track visitors across sessions (no IP processing, no fingerprinting, no persistent visitor identification).

## Funnel Definition

A funnel is an ordered sequence of 2-10 steps. Each step matches either a pageview (by URL path pattern) or a custom event (by event name, optionally with metadata matching).

### Analysis Window

The `analysisWindowDays` value specifies the date range of sessions to analyse (e.g. last 7 days, last 30 days). This is NOT a completion window — it defines which sessions are included in the analysis. Each session within this range is independently evaluated to determine whether it completes the funnel.

**Example**: A funnel with `analysisWindowDays: 7` analyses all sessions from the last 7 days. Each session either completes all steps (within that session) or drops off at a specific step.

### Examples

**Signup Funnel**:
```json
{
  "name": "Signup Flow",
  "steps": [
    { "name": "View pricing", "type": "pageview", "pathPattern": "/pricing" },
    { "name": "Click signup", "type": "event", "eventName": "signup_click" },
    { "name": "Complete registration", "type": "pageview", "pathPattern": "/onboarding" },
    { "name": "First action", "type": "event", "eventName": "first_action_completed" }
  ],
  "analysisWindowDays": 7
}
```

**E-commerce Checkout**:
```json
{
  "name": "Checkout Flow",
  "steps": [
    { "name": "View product", "type": "pageview", "pathPattern": "/products/*" },
    { "name": "Add to cart", "type": "event", "eventName": "add_to_cart" },
    { "name": "Begin checkout", "type": "pageview", "pathPattern": "/checkout" },
    { "name": "Complete purchase", "type": "event", "eventName": "purchase_completed" }
  ],
  "analysisWindowDays": 30
}
```

## Path Pattern Matching

Pageview steps use glob-style path patterns:

| Pattern | Matches |
|---------|---------|
| `/pricing` | Exact match: `/pricing` only |
| `/products/*` | Single level: `/products/shoes`, `/products/hats` |
| `/blog/**` | Recursive: `/blog/2026/hello`, `/blog/category/tech` |
| `/docs/*/getting-started` | Middle wildcard: `/docs/v2/getting-started` |

### Pattern Validation and Security

Path patterns are validated on creation/update to prevent injection attacks:

- **Maximum length**: 500 characters per pattern
- **Allowed characters**: Alphanumeric, `/`, `*`, `-`, `_`, `.` only. Reject patterns containing regex special characters or other unexpected input
- **Glob-to-regex conversion**: Use a known-safe library (e.g. `picomatch` or `micromatch`) for converting glob patterns to regular expressions. Do not implement custom glob-to-regex conversion, as this is error-prone and can lead to ReDoS vulnerabilities
- **ClickHouse queries**: Path patterns are **never** interpolated directly into SQL. The funnel computation uses ClickHouse parameterised queries, and pattern matching is performed in application code (JavaScript) after retrieving events, not in ClickHouse SQL

## Event Metadata Matching

Event steps can optionally require specific metadata values:

```json
{
  "name": "Pro plan purchase",
  "type": "event",
  "eventName": "purchase_completed",
  "eventMetaMatch": { "plan": "pro" }
}
```

Only events where `meta['plan'] === 'pro'` count as completing this step. Metadata values are compared as strings (matching ClickHouse `Map(String, String)` storage).

## Computation Algorithm

Funnels are computed by the `analytics-funnel-compute` BullMQ worker. The algorithm operates on raw events from ClickHouse, grouped by session.

### Algorithm

```
Input: funnel definition, analysis window (e.g. last 7 days)

1. Calculate the time range: [now - analysisWindowDays, now]

2. Query all raw events from ClickHouse for this analytics config within the time range
   - Filter to event types and names relevant to the funnel steps
   - Order by session_id, timestamp ASC

3. Group events by session_id

4. For each session:
   a. Get all events for this session in chronological order
   b. Track which funnel step we're currently matching (starting at step 0)
   c. For each event:
      - Check if it matches the current step's criteria (path pattern or event name + metadata)
      - If yes: advance to the next step
      - If no: continue to next event
   d. Record the furthest step reached by this session
      - If step 0 was never reached: session does not count
      - If step 0 was reached: session entered the funnel
      - If all steps were reached: session completed the funnel

5. Aggregate results:
   - stepCounts[i] = number of sessions that reached step i or beyond
   - stepDropoffs[i] = number of sessions that reached step i but not step i+1
   - stepConversionRates[i] = stepCounts[i+1] / stepCounts[i] * 100
   - overallConversionRate = stepCounts[last] / stepCounts[0] * 100

6. Write results to PostgreSQL analytics_funnel_results table
```

### ClickHouse Query for Event Retrieval

```sql
SELECT
  session_id,
  event_type,
  event_name,
  pathname,
  event_meta,
  timestamp
FROM analytics_events
WHERE analytics_config_id = {configId:String}
  AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
  AND (
    (event_type = 'pageview' AND pathname IN ({relevantPaths:Array(String)}))
    OR
    (event_type = 'event' AND event_name IN ({relevantEventNames:Array(String)}))
  )
ORDER BY session_id, timestamp ASC
```

### Performance Considerations

- Funnels are computed every 15 minutes for common analysis windows (1d, 7d, 30d)
- Results are cached in PostgreSQL `analytics_funnel_results` and served from cache
- The ClickHouse query benefits from the `ORDER BY (analytics_config_id, timestamp, session_id)` primary key
- ClickHouse's columnar storage means only the relevant columns are read from disk

### Scaling Strategy

For long analysis windows with many events, the computation is **batched by session_id** to avoid loading all events into memory at once:

1. Query distinct `session_id` values for the time range (from ClickHouse)
2. Process sessions in batches (e.g. 10,000 at a time) using cursor-based pagination on `session_id`
3. For each batch, query the relevant events for those sessions and run the funnel algorithm
4. Accumulate step counts across batches
5. Write final aggregated results to PostgreSQL

This ensures memory usage remains bounded regardless of the total event volume. The batch size is configurable per funnel computation job.

**Memory limit**: Each funnel computation job should set a memory ceiling (e.g. 512MB). If the batch processing exceeds this limit, the job should fail gracefully and log a warning rather than crashing the worker process.

## API Endpoints

### `GET /api/analytics/funnels/:configId`

List all funnels for an analytics config.

**Response**:
```json
{
  "funnels": [
    {
      "id": "fun_abc123",
      "name": "Signup Flow",
      "description": "Track users from pricing to first action",
      "steps": [...],
      "analysisWindowDays": 7,
      "enabled": true,
      "createdAt": "2026-02-01T00:00:00Z"
    }
  ]
}
```

### `POST /api/analytics/funnels/:configId`

Create a new funnel.

**Request**:
```json
{
  "name": "Signup Flow",
  "description": "Track users from pricing to first action",
  "steps": [
    { "name": "View pricing", "type": "pageview", "pathPattern": "/pricing" },
    { "name": "Click signup", "type": "event", "eventName": "signup_click" }
  ],
  "analysisWindowDays": 7
}
```

**Validation**:
- 2-10 steps required
- Each step must have a `name` and `type`
- Pageview steps require `pathPattern` (validated per [Path Pattern Matching](#pattern-validation-and-security) rules)
- Event steps require `eventName` (must match `^[a-zA-Z0-9_]+$`, max 200 chars)
- `eventMetaMatch` keys must match `^[a-zA-Z0-9_]+$`, values max 500 chars
- `analysisWindowDays` must be between 1 and 90 days
- Funnel name must be unique per analytics config

### `PUT /api/analytics/funnels/:configId/:funnelId`

Update a funnel definition. Clears cached results in PostgreSQL (forces recomputation on next cycle).

### `DELETE /api/analytics/funnels/:configId/:funnelId`

Delete a funnel and all its cached results from PostgreSQL.

### `GET /api/analytics/funnels/:configId/:funnelId/results`

Get funnel results for the configured analysis window.

**Query params**: None (uses the funnel's `analysisWindowDays` configuration)

**Response**:
```json
{
  "funnel": {
    "id": "fun_abc123",
    "name": "Signup Flow",
    "steps": [
      { "name": "View pricing", "type": "pageview", "pathPattern": "/pricing" },
      { "name": "Click signup", "type": "event", "eventName": "signup_click" },
      { "name": "Complete registration", "type": "pageview", "pathPattern": "/onboarding" }
    ],
    "analysisWindowDays": 7
  },
  "results": {
    "periodStart": "2026-01-31T14:30:00Z",
    "periodEnd": "2026-02-07T14:30:00Z",
    "totalSessions": 1200,
    "stepCounts": [1200, 340, 180],
    "stepDropoffs": [860, 160, 180],
    "stepConversionRates": [100, 28.3, 52.9],
    "overallConversionRate": 15.0,
    "computedAt": "2026-02-07T14:30:00Z"
  }
}
```

**Field descriptions**:

- `totalSessions`: Number of sessions that entered step 1 (same as `stepCounts[0]`)
- `stepCounts[i]`: Number of sessions that reached step i
- `stepDropoffs[i]`: Number of sessions that reached step i but did not reach step i+1
- `stepConversionRates[i]`: Percentage of sessions from step i that reached step i+1
- `overallConversionRate`: Percentage of entering sessions that completed all steps

### `POST /api/analytics/funnels/:configId/:funnelId/recompute`

Force immediate recomputation of funnel results. Queues a `ANALYTICS_FUNNEL_COMPUTE` job.

---

## UI Component

### Funnel Visualisation

The funnel tab shows a horizontal bar-chart style visualisation:

```
Signup Flow
Analysis window: Last 7 days             Overall: 15.0% conversion

Step 1: View pricing        ████████████████████████████████  1,200 sessions (100%)
                                          28.3% ->
Step 2: Click signup         █████████                          340 sessions (28.3%)
                                          52.9% ->
Step 3: Complete registration ████                               180 sessions (15.0%)
```

**Features**:
- Horizontal bars with proportional widths
- Conversion rate between each step
- Drop-off counts displayed between steps
- Overall conversion rate
- "Recompute" button for fresh results
- Colour coding: green for high conversion, amber for moderate, red for low

### Funnel Management

- "Create Funnel" button opens a dialogue/modal
- Step editor: drag-and-drop reorderable list
- Each step has:
  - Name field
  - Type selector (Pageview / Event)
  - Path pattern field (for pageview type)
  - Event name field (for event type)
  - Optional metadata match (for event type)
- Analysis window selector (1d, 7d, 30d, 60d, 90d)
- Preview button: shows which events would match each step

### Component Structure

**File**: `apps/web/src/app/analytics/[configId]/_components/analytics-funnels.tsx`

```typescript
// Main component
export function AnalyticsFunnels({ configId }: { configId: string }) {
  // Lists funnels with results
  // "Create funnel" button
}

// Funnel visualisation
function FunnelChart({ funnel, results }: { funnel: Funnel; results: FunnelResults }) {
  // Horizontal bar chart with conversion rates
}

// Funnel creation/edit dialogue
function FunnelDialog({ configId, funnel? }: { configId: string; funnel?: Funnel }) {
  // Step editor with drag-and-drop
}

// Step editor row
function FunnelStepEditor({ step, onChange, onRemove }: StepEditorProps) {
  // Type selector, path/event fields, metadata match
}
```

---

## PostgreSQL Schema

### `analytics_funnels` Table

```sql
CREATE TABLE analytics_funnels (
  id TEXT PRIMARY KEY,
  analytics_config_id TEXT NOT NULL REFERENCES analytics_configs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL, -- Array of step definitions
  analysis_window_days INTEGER NOT NULL DEFAULT 7,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(analytics_config_id, name)
);

CREATE INDEX idx_analytics_funnels_config ON analytics_funnels(analytics_config_id);
```

### `analytics_funnel_results` Table

```sql
CREATE TABLE analytics_funnel_results (
  id SERIAL PRIMARY KEY,
  funnel_id TEXT NOT NULL REFERENCES analytics_funnels(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_sessions INTEGER NOT NULL,
  step_counts INTEGER[] NOT NULL, -- Array of session counts per step
  step_dropoffs INTEGER[] NOT NULL, -- Array of dropoff counts per step
  step_conversion_rates NUMERIC[] NOT NULL, -- Array of percentages
  overall_conversion_rate NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(funnel_id, period_start, period_end)
);

CREATE INDEX idx_funnel_results_funnel ON analytics_funnel_results(funnel_id);
CREATE INDEX idx_funnel_results_computed ON analytics_funnel_results(computed_at);
```

---

## Limitations

### Session-Based Tracking

Funnels track session-level completion only. This has important implications:

**What this means**:

- A visitor who starts a funnel in one session and completes it in another will NOT be counted as a conversion
- Multi-visit conversion journeys are not tracked across sessions
- There is no cross-day or cross-session visitor correlation

**Why this limitation exists**:

- The analytics system follows a privacy-first model (similar to Simple Analytics)
- No IP address processing
- No browser fingerprinting
- No persistent visitor identification across sessions
- This is a deliberate trade-off: privacy over cross-session attribution

**When this is sufficient**:

- Short conversion funnels (e.g. landing → signup → confirmation)
- Single-session user journeys (e.g. checkout flows, onboarding sequences)
- Most B2C conversion funnels where users complete actions in one visit
- Real-time engagement tracking (e.g. video watching, form completion)

**When this is limiting**:

- Long B2B sales cycles with multiple visits over days/weeks
- Content sites tracking reading journeys across multiple visits
- Complex enterprise software evaluation funnels spanning multiple sessions
- Any scenario requiring attribution across multiple days or sessions

**Workaround for multi-session tracking**:

If you need to track conversions across sessions, consider:

- Using custom event metadata to include a user ID (if users are authenticated)
- Building separate analytics for authenticated user journeys
- Accepting undercount as a trade-off for privacy
- Using complementary tools for authenticated conversion tracking

### Step Ordering

Steps must occur in order within a session, but not necessarily consecutively. A session can have other events between funnel steps and still count as progressing through the funnel.

**Example**: If a funnel has steps A → B → C, a session with events A → X → Y → B → Z → C will count as completing the funnel.
