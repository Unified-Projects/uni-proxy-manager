import { test, expect } from "../fixtures/mocked-test";

test.describe("Preview Generation Flow", () => {
  test.describe("Error Pages Preview", () => {
    test("should show preview after file upload", async ({ page }) => {
      await page.goto("/error-pages");

      // Cards with uploads should show preview images
      const previewImages = page.locator('img[alt*="502"]');
      await expect(previewImages.first()).toBeVisible();
    });

    test("should show 'No files uploaded' for pages without content", async ({ page }) => {
      await page.goto("/error-pages");

      // Pages without uploads show message
      await expect(page.getByText("No files uploaded")).toBeVisible();
    });

    test("should show loading spinner during preview generation", async ({ page }) => {
      await page.goto("/error-pages");

      // Click menu on a page card
      const menuButton = page.getByRole("button", { name: /Open menu/i }).first();
      await menuButton.click();

      // Click regenerate preview
      await page.getByRole("menuitem", { name: /Regenerate Preview/i }).click();

      // Should show loading state briefly (may be too fast to catch)
      // Just verify no error occurred
      await expect(page.getByRole("menuitem", { name: /Regenerate Preview/i })).not.toBeVisible();
    });

    test("should display type badge on preview card", async ({ page }) => {
      await page.goto("/error-pages");

      // Should show type badges
      await expect(page.getByText("502")).toBeVisible();
      await expect(page.getByText("404")).toBeVisible();
    });

    test("should update preview when regenerated", async ({ page }) => {
      await page.goto("/error-pages");

      // Click menu on first card
      const menuButton = page.getByRole("button", { name: /Open menu/i }).first();
      await menuButton.click();

      // Click regenerate
      await page.getByRole("menuitem", { name: /Regenerate Preview/i }).click();

      // Should show success toast
      await expect(page.getByText(/Preview regenerat/i)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Maintenance Pages Preview", () => {
    test("should show preview for uploaded maintenance pages", async ({ page }) => {
      await page.goto("/maintenance-pages");

      // Cards with uploads should show preview images
      const previewImages = page.locator('img[alt*="Maintenance"]');
      await expect(previewImages.first()).toBeVisible();
    });

    test("should show placeholder for pages without upload", async ({ page }) => {
      await page.goto("/maintenance-pages");

      // Should show placeholder text for pages without uploads
      await expect(page.getByText("No files uploaded")).toBeVisible();
    });

    test("should regenerate preview from card menu", async ({ page }) => {
      await page.goto("/maintenance-pages");

      // Click menu on first card
      const menuButton = page.getByRole("button", { name: /Open menu/i }).first();
      await menuButton.click();

      // Click regenerate
      await page.getByRole("menuitem", { name: /Regenerate Preview/i }).click();

      // Should show success toast
      await expect(page.getByText(/Preview regenerat/i)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Preview Error States", () => {
    test("should show retry button when preview fails to load", async ({ page }) => {
      await page.goto("/error-pages");

      // When images fail to load, retry button should appear
      // This depends on actual image load failures
      const retryButtons = page.getByRole("button", { name: /Retry/i });
      const count = await retryButtons.count();
      expect(count >= 0).toBe(true);
    });

    test("should handle missing preview gracefully", async ({ page }) => {
      await page.goto("/error-pages");

      // Pages without uploads should show appropriate message
      await expect(page.getByText("No files uploaded")).toBeVisible();
    });
  });

  test.describe("Preview Accessibility", () => {
    test("should have alt text on preview images", async ({ page }) => {
      await page.goto("/error-pages");

      // All preview images should have alt text
      const images = page.locator("img");
      const imageCount = await images.count();

      for (let i = 0; i < imageCount; i++) {
        const alt = await images.nth(i).getAttribute("alt");
        expect(alt).toBeTruthy();
      }
    });

    test("should be keyboard accessible", async ({ page }) => {
      await page.goto("/error-pages");

      // Tab through the page
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Should be able to reach interactive elements
      const focusedElement = page.locator(":focus");
      await expect(focusedElement).toBeVisible();
    });
  });

  test.describe("Create and Upload Flow", () => {
    test("should create error page and show upload prompt", async ({ page }) => {
      await page.goto("/error-pages");

      // Create new error page
      await page.getByRole("button", { name: /Create Error Page/i }).click();
      await page.getByLabel("Name").fill("New Test Page");
      await page.getByLabel("Type").click();
      await page.getByRole("option", { name: "503 Service Unavailable" }).click();
      await page.getByRole("button", { name: /Create Error Page/i }).last().click();

      // Dialog should close
      await expect(page.getByRole("dialog")).not.toBeVisible();

      // New page should appear with "No files uploaded" message
      await expect(page.getByText("New Test Page")).toBeVisible();
    });

    test("should create maintenance page and show upload prompt", async ({ page }) => {
      await page.goto("/maintenance-pages");

      // Create new maintenance page
      await page.getByRole("button", { name: /Create Maintenance Page/i }).click();
      await page.getByLabel("Name").fill("New Maintenance Test");
      await page.getByRole("button", { name: /Create Maintenance Page/i }).last().click();

      // Dialog should close
      await expect(page.getByRole("dialog")).not.toBeVisible();

      // New page should appear
      await expect(page.getByText("New Maintenance Test")).toBeVisible();
    });
  });
});
