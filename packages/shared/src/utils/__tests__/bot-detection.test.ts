import { describe, it, expect } from "vitest";
import { isBot, getBotType, shouldBlockBot } from "../bot-detection";

describe("Bot Detection", () => {
  describe("isBot", () => {
    it("should detect search engine crawlers", () => {
      expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
      expect(isBot("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
      expect(isBot("Mozilla/5.0 (compatible; Yahoo! Slurp)")).toBe(true);
      expect(isBot("DuckDuckBot/1.0")).toBe(true);
    });

    it("should detect social media bots", () => {
      expect(isBot("facebookexternalhit/1.1")).toBe(true);
      expect(isBot("Twitterbot/1.0")).toBe(true);
      expect(isBot("LinkedInBot/1.0")).toBe(true);
      expect(isBot("TelegramBot")).toBe(true);
    });

    it("should detect monitoring tools", () => {
      expect(isBot("UptimeRobot/2.0")).toBe(true);
      expect(isBot("Pingdom.com_bot_version_1.4")).toBe(true);
      expect(isBot("StatusCake")).toBe(true);
    });

    it("should detect SEO tools", () => {
      expect(isBot("AhrefsBot/7.0")).toBe(true);
      expect(isBot("SemrushBot/7~bl")).toBe(true);
      expect(isBot("rogerbot/1.0")).toBe(true);
    });

    it("should detect security scanners", () => {
      expect(isBot("Nessus/10.0")).toBe(true);
      expect(isBot("nikto/2.1.6")).toBe(true);
      expect(isBot("Shodan/1.0")).toBe(true);
    });

    it("should detect HTTP clients", () => {
      expect(isBot("curl/7.68.0")).toBe(true);
      expect(isBot("Wget/1.20.3")).toBe(true);
      expect(isBot("python-requests/2.28.1")).toBe(true);
      expect(isBot("axios/1.4.0")).toBe(true);
    });

    it("should detect headless browsers", () => {
      expect(isBot("HeadlessChrome/90.0")).toBe(true);
      expect(isBot("PhantomJS/2.1.1")).toBe(true);
      expect(isBot("Selenium/3.141.0")).toBe(true);
      expect(isBot("Puppeteer/10.0.0")).toBe(true);
    });

    it("should detect AI crawlers", () => {
      expect(isBot("GPTBot/1.0")).toBe(true);
      expect(isBot("anthropic-ai")).toBe(true);
      expect(isBot("Claude-Web/1.0")).toBe(true);
    });

    it("should detect RSS readers", () => {
      expect(isBot("Feedly/1.0")).toBe(true);
      expect(isBot("NewsBlur Feed Finder")).toBe(true);
      expect(isBot("Flipboard")).toBe(true);
    });

    it("should NOT detect regular browsers", () => {
      expect(
        isBot(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        )
      ).toBe(false);
      expect(
        isBot(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
        )
      ).toBe(false);
      expect(
        isBot(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1"
        )
      ).toBe(false);
      expect(
        isBot(
          "Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0"
        )
      ).toBe(false);
    });

    it("should handle empty or null user agents", () => {
      expect(isBot(null)).toBe(false);
      expect(isBot(undefined)).toBe(false);
      expect(isBot("")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isBot("GOOGLEBOT/2.1")).toBe(true);
      expect(isBot("googlebot/2.1")).toBe(true);
      expect(isBot("GoogleBot/2.1")).toBe(true);
    });
  });

  describe("getBotType", () => {
    it("should categorize search engines", () => {
      expect(getBotType("Googlebot/2.1")).toBe("search-engine");
      expect(getBotType("bingbot/2.0")).toBe("search-engine");
    });

    it("should categorize social media", () => {
      expect(getBotType("facebookexternalhit/1.1")).toBe("social-media");
      expect(getBotType("Twitterbot/1.0")).toBe("social-media");
    });

    it("should categorize SEO tools", () => {
      expect(getBotType("AhrefsBot/7.0")).toBe("seo-tool");
      expect(getBotType("SemrushBot/7~bl")).toBe("seo-tool");
    });

    it("should categorize monitoring tools", () => {
      expect(getBotType("UptimeRobot/2.0")).toBe("monitoring");
      expect(getBotType("Pingdom.com_bot_version_1.4")).toBe("monitoring");
    });

    it("should categorize security scanners", () => {
      expect(getBotType("Nessus/10.0")).toBe("security-scanner");
      expect(getBotType("Shodan/1.0")).toBe("security-scanner");
    });

    it("should categorize AI crawlers", () => {
      expect(getBotType("GPTBot/1.0")).toBe("ai-crawler");
      expect(getBotType("anthropic-ai")).toBe("ai-crawler");
    });

    it("should categorize HTTP clients", () => {
      expect(getBotType("curl/7.68.0")).toBe("http-client");
      expect(getBotType("python-requests/2.28.1")).toBe("http-client");
    });

    it("should categorize generic crawlers", () => {
      expect(getBotType("SomeBot-Crawler/1.0")).toBe("crawler");
      expect(getBotType("WebScraper/1.0")).toBe("crawler");
    });

    it("should return unknown for empty user agent", () => {
      expect(getBotType("")).toBe("unknown");
      expect(getBotType(null as any)).toBe("unknown");
    });

    it("should return other-bot for unrecognized bots", () => {
      expect(getBotType("RandomBot/1.0")).toBe("other-bot");
    });
  });

  describe("shouldBlockBot", () => {
    it("should recommend blocking known bots", () => {
      expect(shouldBlockBot("Googlebot/2.1")).toBe(true);
      expect(shouldBlockBot("curl/7.68.0")).toBe(true);
      expect(shouldBlockBot("Nessus/10.0")).toBe(true);
    });

    it("should not block regular browsers", () => {
      expect(
        shouldBlockBot(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
      ).toBe(false);
    });

    it("should not block empty user agents by default", () => {
      expect(shouldBlockBot(null)).toBe(false);
      expect(shouldBlockBot(undefined)).toBe(false);
      expect(shouldBlockBot("")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle user agents with special characters", () => {
      expect(isBot("Bot-Name/1.0 (+http://example.com)")).toBe(true);
      expect(isBot("crawler [bot] v2.0")).toBe(true);
    });

    it("should handle very long user agents", () => {
      const longUA =
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
      expect(isBot(longUA)).toBe(true);
    });

    it("should handle user agents with bot in middle", () => {
      expect(isBot("MyApp/1.0 bot-agent")).toBe(true);
      expect(isBot("spider-tool/2.0")).toBe(true);
    });
  });

  describe("Real-world examples", () => {
    const realBots = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Twitterbot/1.0",
      "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
      "AhrefsBot/7.0; +http://ahrefs.com/robot/",
      "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
      "curl/7.68.0",
      "python-requests/2.28.1",
      "PostmanRuntime/7.29.2",
      "Go-http-client/1.1",
    ];

    const realBrowsers = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.1 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0",
    ];

    it("should detect all real bot examples", () => {
      realBots.forEach((ua) => {
        expect(isBot(ua)).toBe(true);
      });
    });

    it("should NOT detect real browsers as bots", () => {
      realBrowsers.forEach((ua) => {
        expect(isBot(ua)).toBe(false);
      });
    });
  });
});
