/**
 * Playwright availability check for integration tests.
 * Tests that depend on real Playwright/Chromium for preview generation
 * should use this to skip cleanly when Chromium is unavailable.
 */

let _available: boolean | null = null;

/**
 * Check if Playwright Chromium can be launched.
 * Result is cached for the entire test run.
 */
export async function checkPlaywrightAvailable(): Promise<boolean> {
  if (_available !== null) {
    return _available;
  }

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    await browser.close();
    _available = true;
  } catch {
    console.warn(
      "[playwright-check] Chromium not available -- preview generation tests will be skipped"
    );
    _available = false;
  }

  return _available;
}
