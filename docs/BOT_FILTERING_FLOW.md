# Bot Filtering Flow Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Bot Detection System                         │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Client     │
│   Request    │
└──────┬───────┘
       │
       ↓
┌─────────────────────────────────────────┐
│          HAProxy (Proxy Layer)          │
│  ┌────────────────────────────────┐     │
│  │  User Agent Header Captured    │     │
│  └────────────────────────────────┘     │
│                                          │
│  ┌────────────────────────────────┐     │
│  │  Bot Blocking ACL (optional)   │     │
│  │  if blockBots = true:          │     │
│  │    ✗ Block with 403            │     │
│  └────────────────────────────────┘     │
└───────────┬──────────────────────────────┘
            │
            ↓
      ┌──────────┐
      │ Backend  │
      │ Server   │
      └──────────┘
            │
            ↓
      ┌──────────────────────┐
      │  HAProxy Logs        │
      │  (JSON with UA)      │
      └──────┬───────────────┘
             │
             ↓
      ┌─────────────────────────────┐
      │  Log Parser Worker          │
      │  ┌────────────────────────┐ │
      │  │ Extract User Agent     │ │
      │  └────────────────────────┘ │
      │  ┌────────────────────────┐ │
      │  │ Check isBot()          │ │
      │  └────────────────────────┘ │
      │  ┌────────────────────────┐ │
      │  │ if filterBotsFromStats │ │
      │  │   ✗ Skip from metrics  │ │
      │  └────────────────────────┘ │
      └───────────┬─────────────────┘
                  │
                  ↓
         ┌────────────────┐
         │  PostgreSQL    │
         │  (Metrics)     │
         │  - No bots     │
         │  - Clean stats │
         └────────────────┘
```

## Request Flow - Normal Browser

```
1. Browser Request
   User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...
   ↓
2. HAProxy
   ✓ Not a bot
   ✓ Forward to backend
   ↓
3. Backend
   ✓ Process request
   ✓ Return response
   ↓
4. HAProxy Logs
   {"ts":123,"host":"example.com","ua":"Mozilla/5.0...","st":200}
   ↓
5. Log Parser
   ✓ Not a bot
   ✓ Include in metrics
   ↓
6. Database
   ✓ totalRequests++
   ✓ uniqueVisitors++
   ✓ bytesOut += response_size

Result: Request counted in statistics
```

## Request Flow - Bot with Filtering Only

```
1. Bot Request
   User-Agent: Googlebot/2.1
   ↓
2. HAProxy
   ✓ Not blocking (blockBots = false)
   ✓ Forward to backend
   ↓
3. Backend
   ✓ Process request
   ✓ Return response
   ↓
4. HAProxy Logs
   {"ts":123,"host":"example.com","ua":"Googlebot/2.1","st":200}
   ↓
5. Log Parser
   ✗ Detected as bot (isBot = true)
   ✗ Domain has filterBotsFromStats = true
   ✗ Skip from metrics
   ↓
6. Database
   ✗ Not recorded

Result: Bot accessed site but not in statistics
```

## Request Flow - Bot with Proxy Blocking

```
1. Bot Request
   User-Agent: Googlebot/2.1
   ↓
2. HAProxy
   ✗ Bot detected via ACL
   ✗ Domain has blockBots = true
   ✗ Return 403 Forbidden
   ✗ Never reaches backend
   ↓
3. Backend
   (not reached)
   ↓
4. HAProxy Logs
   {"ts":123,"host":"example.com","ua":"Googlebot/2.1","st":403}
   ↓
5. Log Parser
   ✗ Detected as bot
   ✗ Skip from metrics (403 response)
   ↓
6. Database
   ✗ Not recorded

Result: Bot blocked and not in statistics
```

## Configuration Decision Tree

```
                     ┌──────────────────┐
                     │  What's your     │
                     │  use case?       │
                     └────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ↓               ↓               ↓
    ┌─────────────────┐ ┌────────────┐ ┌─────────────┐
    │ Public Website  │ │ Internal   │ │ Development │
    │ (need SEO)      │ │ Tool/API   │ │ /Testing    │
    └────────┬────────┘ └──────┬─────┘ └──────┬──────┘
             │                 │               │
             ↓                 ↓               ↓
    ┌────────────────────┐ ┌─────────────┐ ┌──────────────┐
    │ filterBotsFromStats│ │ blockBots   │ │ Both false   │
    │ = true             │ │ = true      │ │              │
    │ blockBots = false  │ │ filterBots  │ │ Allow all    │
    │                    │ │ = true      │ │ traffic      │
    └────────────────────┘ └─────────────┘ └──────────────┘
    │                    │ │             │ │              │
    ↓                    │ ↓             │ ↓              │
    ✓ Accurate stats     │ ✓ Blocks bots │ ✓ See all    │
    ✓ SEO friendly       │ ✓ Saves CPU   │   traffic    │
    ✓ Bots can crawl     │ ✗ No SEO      │ ✓ Debug mode │
    └──────────────────────┴─────────────┴──────────────┘
```

## HAProxy ACL Logic

### When `blockBots = false` (Default)

```haproxy
# No bot blocking ACL added
# All requests forwarded to backend
frontend https_front
    acl host_example_com hdr(host) -i example.com
    use_backend backend_example_com if host_example_com
```

### When `blockBots = true`

```haproxy
frontend https_front
    # Host ACL
    acl host_example_com hdr(host) -i example.com

    # Bot detection ACL
    acl bot_example_com req.hdr(User-Agent) -i -m reg "googlebot|bingbot|curl|wget|..."

    # Deny bot requests for this domain
    http-request deny deny_status 403 if host_example_com bot_example_com

    # Normal routing (only non-bots reach here)
    use_backend backend_example_com if host_example_com
```

## Database Schema Relationships

```
┌──────────────────────────────────────────┐
│             domains table                │
├──────────────────────────────────────────┤
│ id                      (PK)             │
│ hostname                                 │
│ block_bots              ← NEW (default: false)
│ filter_bots_from_stats  ← NEW (default: true)
│ ...                                      │
└──────────────┬───────────────────────────┘
               │
               │ 1:N
               ↓
┌──────────────────────────────────────────┐
│         traffic_metrics table            │
├──────────────────────────────────────────┤
│ id                      (PK)             │
│ domain_id               (FK) ───────────┐│
│ timestamp                                ││
│ total_requests          ← Excludes bots  ││
│ unique_visitors         ← Excludes bots  ││
│ bytes_in                ← Excludes bots  ││
│ bytes_out               ← Excludes bots  ││
│ ...                                      ││
└──────────────────────────────────────────┘│
                                            │
               If filterBotsFromStats=true: │
               Bot requests not inserted ───┘
```

## Performance Comparison

### Without Bot Filtering

```
Request Flow:
Browser → HAProxy (5ms) → Backend (50ms) → Response
Bot     → HAProxy (5ms) → Backend (50ms) → Response
Bot     → HAProxy (5ms) → Backend (50ms) → Response

Database Writes: 3 metrics (browser + 2 bots)
Backend Load: 3 requests processed
Statistics: Inflated by bots
```

### With Bot Filtering (filterBotsFromStats=true)

```
Request Flow:
Browser → HAProxy (5ms) → Backend (50ms) → Response
Bot     → HAProxy (5ms) → Backend (50ms) → Response (not logged)
Bot     → HAProxy (5ms) → Backend (50ms) → Response (not logged)

Database Writes: 1 metric (browser only)
Backend Load: 3 requests processed
Statistics: Clean, accurate
Benefit: -66% database writes
```

### With Bot Blocking (blockBots=true)

```
Request Flow:
Browser → HAProxy (5ms) → Backend (50ms) → Response
Bot     → HAProxy (5ms) → 403 Forbidden (immediate)
Bot     → HAProxy (5ms) → 403 Forbidden (immediate)

Database Writes: 1 metric (browser only)
Backend Load: 1 request processed
Statistics: Clean, accurate
Benefit: -66% database writes, -66% backend CPU
```

## Migration Path

```
┌─────────────────────┐
│   Initial State     │
│                     │
│ No bot filtering    │
│ All traffic counted │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────────────────┐
│   Step 1: Add Database Fields   │
│   Run migration                 │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│   Step 2: Update Code           │
│   Deploy new log parser         │
│   Deploy HAProxy template       │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│   Step 3: Enable Filtering      │
│   filterBotsFromStats = true    │
│   (per domain)                  │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│   Step 4: Test & Monitor        │
│   Check logs                    │
│   Verify statistics             │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│   Step 5 (optional): Block      │
│   blockBots = true              │
│   (for specific domains)        │
└─────────────────────────────────┘
```

## Monitoring Dashboard Concept

```
┌────────────────────────────────────────────────┐
│           Domain: example.com                  │
├────────────────────────────────────────────────┤
│                                                │
│  Real Traffic     │  Bot Traffic (if tracked) │
│  ┌──────────────┐ │  ┌──────────────┐        │
│  │ 10,234 reqs  │ │  │ 5,421 reqs   │        │
│  │ 3,421 users  │ │  │ 234 bots     │        │
│  └──────────────┘ │  └──────────────┘        │
│                   │                           │
│  Bot Types Detected:                         │
│  ├─ Search Engines: 156                      │
│  ├─ SEO Tools: 45                            │
│  ├─ Monitoring: 23                           │
│  ├─ Security Scanners: 8                     │
│  └─ Other: 2                                 │
│                                               │
│  Settings:                                   │
│  ☑ Filter bots from statistics               │
│  ☐ Block bots at proxy level                 │
│     ⚠ Enabling blocks search engines         │
│                                               │
└───────────────────────────────────────────────┘
```
