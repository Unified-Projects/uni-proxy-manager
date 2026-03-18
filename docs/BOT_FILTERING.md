# Bot Detection and Filtering

This document describes the bot detection and filtering system in Uni Proxy Manager.

## Overview

The system provides two levels of bot protection:

1. **Statistics Filtering** - Removes bot traffic from analytics and metrics (enabled by default)
2. **Proxy-Level Blocking** - Blocks bot requests at HAProxy level with 403 status (optional)

## Bot Detection Patterns

The system detects bots using comprehensive user agent pattern matching, including:

### Search Engine Crawlers
- Googlebot, Bingbot, Yahoo Slurp
- DuckDuckBot, BaiduSpider, YandexBot
- Facebot (Facebook), Alexa

### Social Media Bots
- FacebookExternalHit, TwitterBot
- WhatsApp, Telegram, Slack, Discord
- LinkedIn, Pinterest, Skype

### SEO and Monitoring Tools
- AhrefsBot, SEMrushBot, Moz
- Screaming Frog, Sitebulb
- UptimeRobot, Pingdom, StatusCake
- Site24x7, Jetmon, FreshPing

### Security Scanners
- Nessus, Nikto, Nmap, Masscan
- Shodan, Censys, ZGrab

### Generic Bot Patterns
- curl, wget
- Python-requests, httpx, axios
- Java HTTP clients, OkHttp
- Go-http-client, node-fetch

### Headless Browsers
- Puppeteer, Playwright
- Selenium, PhantomJS, WebDriver

### AI Scrapers
- GPTBot, Anthropic-AI, Claude-Web
- Cohere-AI, Perplexity

### RSS Readers & Content Aggregators
- Feedly, NewsBlur, Flipboard
- FeedBurner, FeedParser

### Archive Crawlers
- Archive.org, Wayback Machine, Heritrix

## Database Schema

Two new fields in the `domains` table:

```sql
block_bots BOOLEAN NOT NULL DEFAULT false
filter_bots_from_stats BOOLEAN NOT NULL DEFAULT true
```

### Field Descriptions

- **`filter_bots_from_stats`** (default: `true`)
  - When enabled, bot requests are excluded from traffic metrics and analytics
  - Bots can still access the site, but won't inflate visitor counts
  - Recommended for accurate analytics

- **`block_bots`** (default: `false`)
  - When enabled, bot requests are blocked at HAProxy level with 403 status
  - Use this for aggressive bot protection
  - May impact SEO if search engine bots are blocked

## How It Works

### 1. Log Collection
HAProxy logs now include user agent in JSON format:

```json
{
  "ts": 1234567890,
  "fe": "https_front",
  "host": "example.com",
  "path": "/api/users",
  "st": 200,
  "bo": 1024,
  "bi": 512,
  "tr": 45,
  "ci": "192.168.1.1",
  "ua": "Mozilla/5.0 (compatible; Googlebot/2.1)"
}
```

### 2. Statistics Filtering (Log Parser)
The HAProxy log parser (`haproxy-log-parser.ts`) checks each request:

```typescript
const isBotRequest = entry.ua ? isBot(entry.ua) : false;
if (shouldFilterBots && isBotRequest) {
  continue; // Skip from metrics
}
```

Bot requests are not counted in:
- Total requests
- Unique visitors
- Bandwidth statistics
- Status code counts

### 3. Proxy-Level Blocking (HAProxy Config)
When `block_bots` is enabled, HAProxy configuration includes ACL rules:

```haproxy
acl bot_example_com req.hdr(User-Agent) -i -m reg "googlebot|bingbot|..."
http-request deny deny_status 403 if host_example_com bot_example_com
```

This blocks bot requests before they reach the backend server.

## Configuration

### Per-Domain Configuration

#### Via API/Database
```typescript
await db.update(domains)
  .set({
    filterBotsFromStats: true,  // Remove bots from stats
    blockBots: false,           // Allow bots to access site
  })
  .where(eq(domains.id, domainId));
```

#### Via Web UI
Navigate to Domain Settings → Bot Protection:

- **Filter bots from statistics** - Toggle to exclude bots from analytics
- **Block bots at proxy level** - Toggle to deny bot requests with 403

## Use Cases

### Recommended: Filter but Don't Block
```typescript
{
  filterBotsFromStats: true,
  blockBots: false
}
```

**Best for:**
- Production websites needing accurate analytics
- SEO-sensitive sites (allows search engine crawling)
- Sites that want to track real user behavior

**Benefits:**
- Accurate unique visitor counts
- Clean analytics data
- Search engines can still crawl
- Monitoring tools can still check uptime

### Aggressive: Block All Bots
```typescript
{
  filterBotsFromStats: true,
  blockBots: true
}
```

**Best for:**
- API endpoints (non-public)
- Admin interfaces
- Internal tools
- Sites under bot attack

**Considerations:**
- Blocks search engine crawlers (impacts SEO)
- Blocks uptime monitoring
- May block legitimate API clients

### Permissive: Allow All Traffic
```typescript
{
  filterBotsFromStats: false,
  blockBots: false
}
```

**Best for:**
- Testing and development
- Sites that want to track all traffic including bots
- APIs with bot clients

## Performance Considerations

### Statistics Filtering
- **Impact:** Minimal (pattern matching on log parsing)
- **Processing:** Runs async in background worker
- **Storage:** Reduces database writes (fewer metrics for bot traffic)

### Proxy-Level Blocking
- **Impact:** Very low (efficient HAProxy ACL matching)
- **Performance:** Blocks bots before backend processing
- **Bandwidth:** Saves bandwidth (403 response is small)

## Monitoring

### Check Bot Detection

View logs to see detected bots:
```bash
docker logs uni-proxy-manager-workers 2>&1 | grep "Bot detected"
```

### View HAProxy Bot Blocks

Check HAProxy stats for 403 responses:
```bash
curl http://localhost:8404/stats
```

Look for `hrsp_4xx` counter on frontends.

## Bot Type Categorization

The system categorizes bots for analytics:

- `search-engine` - Google, Bing, Yahoo
- `social-media` - Facebook, Twitter, LinkedIn
- `seo-tool` - Ahrefs, SEMrush, Moz
- `monitoring` - UptimeRobot, Pingdom
- `security-scanner` - Nessus, Shodan
- `ai-crawler` - GPT, Claude, Cohere
- `crawler` - Generic web crawlers
- `http-client` - curl, wget, requests
- `other-bot` - Unclassified bots

## Customization

### Adding Custom Bot Patterns

Edit `packages/shared/src/utils/bot-detection.ts`:

```typescript
export const BOT_USER_AGENT_PATTERNS = [
  // ... existing patterns
  /my-custom-bot/i,
  /another-pattern/i,
];
```

### Whitelisting Specific Bots

To allow certain bots through proxy-level blocking, modify the HAProxy config template to add exceptions:

```haproxy
# Allow Googlebot even when bot blocking is enabled
acl is_googlebot req.hdr(User-Agent) -i -m sub "Googlebot"
http-request allow if host_example_com is_googlebot bot_example_com
```

## Troubleshooting

### Legitimate Traffic Blocked

If legitimate users are blocked:

1. Check user agent patterns in `bot-detection.ts`
2. Disable `blockBots` temporarily
3. Review HAProxy logs for blocked requests
4. Add exception rules if needed

### Bots Still in Statistics

If bots appear in stats with filtering enabled:

1. Verify `filter_bots_from_stats = true` in database
2. Check log parser is extracting user agent
3. Verify bot patterns match the user agent
4. Check Redis for cached metrics

### Bot Blocking Not Working

If bots aren't blocked at proxy level:

1. Verify `block_bots = true` in database
2. Check HAProxy config regeneration
3. Reload HAProxy after config changes
4. Verify ACL rules in `/data/haproxy.cfg`

## Best Practices

1. **Start with filtering only** - Enable `filterBotsFromStats` first
2. **Monitor before blocking** - Check logs before enabling `blockBots`
3. **Whitelist monitoring** - Keep uptime monitors working
4. **Consider SEO impact** - Blocking search crawlers affects ranking
5. **Test on staging** - Verify bot blocking doesn't break functionality
6. **Review patterns** - Periodically update bot detection patterns
7. **Document exceptions** - If whitelisting bots, document why

## API Integration

### Update Domain Bot Settings

```bash
curl -X PATCH http://localhost:3001/api/domains/:id \
  -H "Content-Type: application/json" \
  -d '{
    "blockBots": true,
    "filterBotsFromStats": true
  }'
```

### Get Domain Bot Settings

```bash
curl http://localhost:3001/api/domains/:id
```

Response:
```json
{
  "id": "domain_123",
  "hostname": "example.com",
  "blockBots": false,
  "filterBotsFromStats": true,
  ...
}
```

## Related Files

- **Bot Detection Logic**: `packages/shared/src/utils/bot-detection.ts`
- **Database Schema**: `packages/database/src/schema/domains.ts`
- **Log Parser**: `apps/workers/src/processors/haproxy-log-parser.ts`
- **HAProxy Config**: `packages/shared/src/haproxy/template.ts`
- **HAProxy Template**: `docker/haproxy/haproxy.cfg.template`
- **Migration**: `packages/database/migrations/0000_add_bot_filtering.sql`

## Future Enhancements

Potential improvements:

1. **Bot Analytics Dashboard** - Show bot traffic separately
2. **Rate Limiting** - Limit bot request rates per domain
3. **CAPTCHA Challenge** - Challenge suspicious bots
4. **Machine Learning** - Detect bots by behavior patterns
5. **Geo-blocking** - Block bots from specific countries
6. **Allowlist Management** - UI for managing allowed bots
7. **Bot Traffic Insights** - Analyze bot types and patterns
