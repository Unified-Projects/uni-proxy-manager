import { chromium, type Browser } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join, isAbsolute } from "path";
import { getErrorPagesDir } from "@uni-proxy-manager/shared/config";

let browser: Browser | null = null;

/**
 * Get or create a shared browser instance
 */
async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // Use system Chromium if specified via environment variable
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

    browser = await chromium.launch({
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

/**
 * Close the shared browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browser && browser.isConnected()) {
    await browser.close();
    browser = null;
  }
}

/**
 * Generate a preview image for an error page
 * @param errorPageId - The error page ID
 * @param htmlPath - Path to the HTML file to render (can be relative or absolute)
 * @returns Path to the generated preview image (relative to error pages directory)
 */
export async function generatePreview(
  errorPageId: string,
  htmlPath: string
): Promise<string> {
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    // Ensure htmlPath is absolute
    const absoluteHtmlPath = isAbsolute(htmlPath)
      ? htmlPath
      : join(getErrorPagesDir(), htmlPath);

    console.log(`[PreviewGenerator] Generating preview for ${errorPageId} from ${absoluteHtmlPath}`);

    // Load the HTML file
    await page.goto(`file://${absoluteHtmlPath}`, {
      waitUntil: "networkidle",
      timeout: 10000,
    });

    // Give it a moment to render
    await page.waitForTimeout(500);

    // Take screenshot
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
    });

    // Close the page and context
    await page.close();
    await context.close();

    // Save preview image
    const errorPagesDir = getErrorPagesDir();
    const previewDir = join(errorPagesDir, errorPageId);
    const previewPath = join(previewDir, "preview.png");

    // Ensure directory exists
    await mkdir(previewDir, { recursive: true });

    // Write screenshot
    await writeFile(previewPath, screenshot);

    // Return relative path
    return `${errorPageId}/preview.png`;
  } catch (error) {
    console.error(`[PreviewGenerator] Error generating preview for ${errorPageId}:`, error);
    throw new Error(
      `Failed to generate preview: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/**
 * Generate preview for multiple error pages in batch
 * @param errorPages - Array of {errorPageId, htmlPath}
 * @returns Array of {errorPageId, previewPath} results
 */
export async function generatePreviews(
  errorPages: Array<{ errorPageId: string; htmlPath: string }>
): Promise<Array<{ errorPageId: string; previewPath: string | null; error?: string }>> {
  const results: Array<{ errorPageId: string; previewPath: string | null; error?: string }> = [];

  for (const { errorPageId, htmlPath } of errorPages) {
    try {
      const previewPath = await generatePreview(errorPageId, htmlPath);
      results.push({ errorPageId, previewPath });
    } catch (error) {
      results.push({
        errorPageId,
        previewPath: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

// Cleanup on process exit
process.on("exit", () => {
  if (browser && browser.isConnected()) {
    browser.close().catch(console.error);
  }
});
