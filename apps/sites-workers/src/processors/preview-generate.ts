import { type Job } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import { sites, deployments, s3Providers, siteDomains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { S3Service } from "@uni-proxy-manager/shared/s3";
import type { PreviewGenerateJobData, PreviewGenerateResult } from "@uni-proxy-manager/queue";

// Type definitions for playwright Browser interface
interface PlaywrightBrowser {
  isConnected(): boolean;
  newContext(options?: { viewport?: { width: number; height: number }; userAgent?: string }): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  screenshot(options?: { type?: string; fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: {
    launch(options?: {
      headless?: boolean;
      executablePath?: string;
      args?: string[];
    }): Promise<PlaywrightBrowser>;
  };
}

// Dynamic import for playwright since it may not always be available
const loadPlaywright = async (): Promise<PlaywrightModule | null> => {
  try {
     
    return await import("playwright" as string) as unknown as PlaywrightModule;
  } catch {
    return null;
  }
};

let browser: PlaywrightBrowser | null = null;

async function getBrowser(): Promise<PlaywrightBrowser | null> {
  if (!browser || !browser.isConnected()) {
    const playwright = await loadPlaywright();
    if (!playwright) {
      console.warn("[Preview Generate] Playwright not available");
      return null;
    }

    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return browser;
}

async function generateScreenshot(url: string): Promise<Buffer | null> {
  try {
    console.log(`[Preview Generate] Taking screenshot of ${url}`);

    const browserInstance = await getBrowser();
    if (!browserInstance) {
      console.warn("[Preview Generate] Browser not available, skipping screenshot");
      return null;
    }

    const context = await browserInstance.newContext({
      viewport: { width: 1200, height: 630 },
      userAgent: "Uni-Proxy-Manager Preview Bot/1.0",
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.waitForTimeout(1000);

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
    });

    await page.close();
    await context.close();

    console.log(`[Preview Generate] Screenshot captured`);
    return Buffer.from(screenshot);
  } catch (error) {
    console.error(`[Preview Generate] Screenshot failed:`, error);
    return null;
  }
}

export async function processPreviewGenerate(
  job: Job<PreviewGenerateJobData>
): Promise<PreviewGenerateResult> {
  const { siteId, deploymentId, slug } = job.data;

  try {
    console.log(`[Preview Generate] Generating preview for deployment ${deploymentId}`);

    // Get site info
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
    });

    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    // Get the deployment
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    // Get site domains with hostname to determine the URL for screenshot
    const siteDomainsWithHostname = await db.query.siteDomains.findMany({
      where: eq(siteDomains.siteId, siteId),
      with: {
        domain: true,
      },
    });

    // Determine URL to screenshot - prefer production type domains
    let targetUrl: string | null = null;
    const productionDomain = siteDomainsWithHostname.find(d => d.type === "production" && d.domain?.hostname);
    if (productionDomain && productionDomain.domain) {
      targetUrl = `https://${productionDomain.domain.hostname}`;
    } else if (siteDomainsWithHostname.length > 0 && siteDomainsWithHostname[0]?.domain?.hostname) {
      targetUrl = `https://${siteDomainsWithHostname[0].domain.hostname}`;
    }

    if (targetUrl) {
      console.log(`[Preview Generate] Target URL: ${targetUrl}`);
    } else {
      console.warn("[Preview Generate] No domain found for preview, using placeholder");
    }

    // Generate preview screenshot using Playwright
    const previewBuffer = targetUrl ? await generateScreenshot(targetUrl) : null;

    // Upload to S3
    const s3Provider = await db.query.s3Providers.findFirst({
      where: eq(s3Providers.usedForArtifacts, true),
    });

    let previewUrl: string | undefined = undefined;

    if (!previewBuffer) {
      console.warn("[Preview Generate] No screenshot generated - Playwright may not be available or site unreachable");
    } else if (!s3Provider) {
      console.warn("[Preview Generate] No S3 provider configured for artifacts - cannot store preview");
    } else {
      const s3 = new S3Service({
        endpoint: s3Provider.endpoint,
        region: s3Provider.region,
        bucket: s3Provider.bucket,
        accessKeyId: s3Provider.accessKeyId,
        secretAccessKey: s3Provider.secretAccessKey,
        pathPrefix: s3Provider.pathPrefix || undefined,
      });

      const previewKey = `previews/${siteId}/${deploymentId}.png`;
      await s3.upload(previewKey, previewBuffer, {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000",
      });

      previewUrl = await s3.getPresignedDownloadUrl(previewKey, 86400 * 365); // 1 year
      console.log(`[Preview Generate] Preview uploaded to S3: ${previewKey}`);
    }

    // Update deployment with preview URL (null if generation failed)
    await db
      .update(deployments)
      .set({ previewUrl })
      .where(eq(deployments.id, deploymentId));

    if (previewUrl) {
      console.log(`[Preview Generate] Preview generated successfully`);
    } else {
      console.log(`[Preview Generate] No preview generated - will show fallback icon`);
    }

    return {
      success: true,
      deploymentId,
      previewUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Preview Generate] Failed to generate preview:`, error);

    return {
      success: false,
      deploymentId,
      error: errorMessage,
    };
  }
}

process.on("exit", () => {
  if (browser && browser.isConnected()) {
    browser.close().catch(console.error);
  }
});
