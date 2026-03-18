/**
 * Bot detection utility for filtering bot traffic from statistics
 * and optionally blocking at the proxy level
 */

/**
 * Comprehensive list of bot user agent patterns
 * Includes crawlers, monitoring tools, scrapers, and automated tools
 */
export const BOT_USER_AGENT_PATTERNS = [
  // Search engine crawlers
  /googlebot/i,
  /bingbot/i,
  /slurp/i, // Yahoo
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /sogou/i,
  /exabot/i,
  /facebot/i, // Facebook
  /ia_archiver/i, // Alexa

  // Social media bots
  /facebookexternalhit/i,
  /twitterbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /slackbot/i,
  /discordbot/i,
  /linkedinbot/i,
  /pinterestbot/i,
  /skypeuripreview/i,

  // SEO and monitoring tools
  /ahrefsbot/i,
  /semrushbot/i,
  /dotbot/i,
  /rogerbot/i, // Moz
  /blexbot/i,
  /dataforseo/i,
  /petalbot/i,
  /mj12bot/i, // Majestic
  /screaming frog/i,
  /sitebulb/i,

  // Content aggregators and readers
  /feedfetcher/i,
  /feedly/i,
  /newsblur/i,
  /flipboard/i,
  /apple-pubsub/i,
  /pocket/i,

  // Uptime monitors
  /uptimerobot/i,
  /pingdom/i,
  /statuscake/i,
  /site24x7/i,
  /jetmon/i,
  /freshping/i,
  /hetrixtools/i,
  /monit/i,

  // Security scanners
  /nessus/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /censys/i,
  /shodan/i,
  /security.*scan/i,

  // Generic bot patterns
  /bot[\s_-]/i,
  /[\s_-]bot$/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /httpx/i,
  /go-http-client/i,
  /java\//i,
  /okhttp/i,
  /axios/i,
  /node-fetch/i,
  /got\//i, // Node.js HTTP client

  // Headless browsers (often used for automation)
  /headless/i,
  /phantomjs/i,
  /phantom/i,
  /selenium/i,
  /webdriver/i,
  /puppeteer/i,
  /playwright/i,
  /nightmare/i,
  /__polypane/i,

  // RSS readers
  /feedburner/i,
  /feedparser/i,
  /rss/i,

  // Archive crawlers
  /archive.*org/i,
  /wayback/i,
  /heritrix/i,

  // Vulnerability scanners
  /acunetix/i,
  /burp/i,
  /sqlmap/i,
  /w3af/i,
  /wpscan/i,
  /nuclei/i,

  // AI scrapers
  /gptbot/i,
  /anthropic-ai/i,
  /claude-web/i,
  /cohere-ai/i,
  /omgilibot/i,
  /omgili/i,
  /perplexity/i,

  // Link validators
  /w3c.*validator/i,
  /html.*validator/i,
  /linkchecker/i,
  /deadlinkchecker/i,

  // Development tools
  /postman/i,
  /insomnia/i,
  /httpie/i,
  /rest-client/i,
];

/**
 * Additional patterns for aggressive blocking
 * These are more general and may catch some legitimate tools
 * Only use when aggressive bot blocking is enabled
 */
export const AGGRESSIVE_BOT_PATTERNS = [
  /^python\//i,
  /^php\//i,
  /^ruby\//i,
  /^perl\//i,
  /^libwww/i,
  /^httpclient/i,
  /^apache-httpclient/i,
  /^jakarta/i,
];

/**
 * Empty or suspicious user agent patterns
 */
export const SUSPICIOUS_USER_AGENT_PATTERNS = [
  /^-$/,
  /^$/,
  /^\s*$/,
  /^mozilla\/4\.0$/i, // Default IE UA often used by bots
];

/**
 * Check if a user agent string matches a bot pattern
 * @param userAgent - The user agent string to check
 * @param includeAggressive - Whether to include aggressive patterns
 * @returns true if the user agent is identified as a bot
 */
export function isBot(userAgent: string | null | undefined, includeAggressive = false): boolean {
  if (!userAgent) {
    // Empty user agents are often bots, but might be legitimate privacy-focused users
    // Don't count as bot by default to avoid false positives in stats
    return false;
  }

  // Check standard bot patterns
  for (const pattern of BOT_USER_AGENT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return true;
    }
  }

  // Check aggressive patterns if enabled
  if (includeAggressive) {
    for (const pattern of AGGRESSIVE_BOT_PATTERNS) {
      if (pattern.test(userAgent)) {
        return true;
      }
    }
  }

  // Check suspicious patterns
  for (const pattern of SUSPICIOUS_USER_AGENT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a user agent should be blocked at proxy level
 * More conservative than isBot() to avoid blocking legitimate traffic
 * @param userAgent - The user agent string to check
 * @returns true if the user agent should be blocked
 */
export function shouldBlockBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) {
    // Don't block empty user agents by default
    return false;
  }

  // Only block clear bot patterns, not generic HTTP clients
  // This avoids blocking legitimate API clients or mobile apps
  return isBot(userAgent, false);
}

/**
 * Categorize a bot user agent into a type
 * Useful for analytics and reporting
 */
export function getBotType(userAgent: string): string {
  if (!userAgent) return "unknown";

  const ua = userAgent.toLowerCase();

  // Search engines
  if (/(google|bing|yahoo|duckduck|baidu|yandex)bot/i.test(ua)) {
    return "search-engine";
  }

  // Social media
  if (/(facebook|twitter|linkedin|pinterest|telegram|discord|slack|whatsapp)bot|facebookexternalhit|twitterbot|linkedinbot/i.test(ua)) {
    return "social-media";
  }

  // SEO tools
  if (/(ahrefs|semrush|moz|majestic|blexbot)/i.test(ua)) {
    return "seo-tool";
  }

  // Monitoring
  if (/(uptime|pingdom|statuscake|monitor)/i.test(ua)) {
    return "monitoring";
  }

  // Security scanner
  if (/(nessus|nikto|nmap|scan|shodan|censys)/i.test(ua)) {
    return "security-scanner";
  }

  // AI crawler
  if (/(gpt|anthropic|claude|cohere|perplexity)/i.test(ua)) {
    return "ai-crawler";
  }

  // Generic crawler
  if (/(crawler|spider|scraper)/i.test(ua)) {
    return "crawler";
  }

  // HTTP client
  if (/(curl|wget|python|java|node|axios|okhttp)/i.test(ua)) {
    return "http-client";
  }

  return "other-bot";
}

/**
 * Generate HAProxy ACL pattern for bot user agents
 * Returns a regex pattern that can be used in HAProxy configuration
 */
export function generateHAProxyBotPattern(): string {
  // Convert regex patterns to HAProxy-compatible strings
  // HAProxy uses PCRE regex, so we need to extract the pattern part
  const patterns = BOT_USER_AGENT_PATTERNS.map((pattern) => {
    // Extract the pattern string from the RegExp object
    let patternStr = pattern.source;

    // Remove the case-insensitive flag handling (HAProxy uses -i flag separately)
    // Remove anchors as we want substring matching
    patternStr = patternStr.replace(/^\^/, "").replace(/\$$/, "");

    return patternStr;
  });

  // Join with pipe (OR) operator
  return patterns.join("|");
}

/**
 * Get human-readable description of bot filtering
 */
export function getBotFilterDescription(enabled: boolean, aggressive = false): string {
  if (!enabled) {
    return "Bot filtering disabled - all traffic counted in statistics";
  }

  if (aggressive) {
    return "Aggressive bot filtering enabled - blocks most automated tools and HTTP clients";
  }

  return "Standard bot filtering enabled - blocks known crawlers, scanners, and monitoring tools";
}
