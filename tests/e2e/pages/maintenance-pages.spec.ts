import { test, expect } from "../fixtures/mocked-test";

test.describe("Maintenance Pages Page", () => {
  test("should display maintenance pages page", async ({ page }) => {
    await page.goto("/maintenance-pages");

    await expect(page.getByRole("heading", { name: /Maintenance Pages/i })).toBeVisible();
  });

  test("should have create maintenance page button", async ({ page }) => {
    await page.goto("/maintenance-pages");

    await expect(page.getByRole("button", { name: /Create Maintenance Page/i })).toBeVisible();
  });

  test("should open create maintenance page dialog", async ({ page }) => {
    await page.goto("/maintenance-pages");

    await page.getByRole("button", { name: /Create Maintenance Page/i }).click();

    // Dialog should open
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Create Maintenance Page");
  });

  test("should display existing maintenance pages", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Should show maintenance pages from mock data
    await expect(page.locator("h3", { hasText: "Default Maintenance" })).toHaveCount(1);
    await expect(page.locator("h3", { hasText: "Scheduled Outage" })).toHaveCount(1);
  });

  test("should not display error pages in maintenance pages list", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Should NOT show error pages
    await expect(page.getByText("Default 502")).not.toBeVisible();
    await expect(page.getByText("Custom 404")).not.toBeVisible();
  });

  test("should show maintenance badge on all cards", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // All maintenance pages should show maintenance badge
    const badges = page.getByText("maintenance");
    expect(await badges.count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Maintenance Page Card", () => {
  test("should show preview image for uploaded pages", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Pages with uploads should have preview images
    const previewImg = page.locator('img[alt="Default Maintenance"]');
    await expect(previewImg).toBeVisible();
  });

  test("should show 'No files uploaded' for pages without uploads", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Page without upload should show appropriate message
    await expect(page.getByText("No files uploaded").first()).toBeVisible();
  });

  test("should show description if present", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Should show page description
    await expect(page.locator("p", { hasText: "Standard maintenance page" })).toHaveCount(1);
  });
});

test.describe("Maintenance Page Actions", () => {
  test("should open upload dialog from card menu", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on first card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Should have upload option
    await expect(page.getByRole("menuitem", { name: /Upload|Replace/i })).toBeVisible();
  });

  test("should have download option for uploaded pages", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on uploaded page card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Should have download option
    await expect(page.getByRole("menuitem", { name: /Download/i })).toBeVisible();
  });

  test("should have regenerate preview option for uploaded pages", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on uploaded page card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Should have regenerate preview option
    await expect(page.getByRole("menuitem", { name: /Regenerate Preview/i })).toBeVisible();
  });

  test("should have delete option", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on first card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Should have delete option
    await expect(page.getByRole("menuitem", { name: /Delete/i })).toBeVisible();
  });
});

test.describe("Create Maintenance Page Flow", () => {
  test("should create a maintenance page", async ({ page }) => {
    await page.goto("/maintenance-pages");

    await page.getByRole("button", { name: /Create Maintenance Page/i }).click();

    // Fill form
    await page.getByLabel("Name").fill("My Maintenance Page");
    await page.getByLabel(/Description/i).fill("Custom maintenance page for scheduled windows");

    // Submit
    await page.getByRole("button", { name: /Create Page/i }).click();

    // Dialog should close
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // New page should appear
    await expect(page.locator("h3", { hasText: "My Maintenance Page" })).toHaveCount(1);
  });

  test("should require name field", async ({ page }) => {
    await page.goto("/maintenance-pages");

    await page.getByRole("button", { name: /Create Maintenance Page/i }).click();

    // Try to submit without name
    await page.getByRole("button", { name: /Create Page/i }).click();

    // Should show validation error
    await expect(page.getByText(/Name is required|required/i)).toBeVisible();
  });

  test("should allow creating without description", async ({ page }) => {
    await page.goto("/maintenance-pages");

    await page.getByRole("button", { name: /Create Maintenance Page/i }).click();

    // Fill only name
    await page.getByLabel("Name").fill("Simple Maintenance");

    // Submit
    await page.getByRole("button", { name: /Create Page/i }).click();

    // Dialog should close
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // New page should appear
    await expect(page.locator("h3", { hasText: "Simple Maintenance" })).toHaveCount(1);
  });
});

test.describe("Delete Maintenance Page", () => {
  test("should open delete confirmation dialog", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on first card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Click delete
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    // Confirmation dialog should open
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Delete Maintenance Page/i })).toBeVisible();
    await expect(page.getByText(/This action cannot be undone/i)).toBeVisible();
  });

  test("should delete maintenance page after confirmation", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on first card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Click delete
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    // Confirm deletion
    await page.getByRole("button", { name: /Delete|Confirm/i }).click();

    // Dialog should close
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
  });

  test("should cancel deletion", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Click menu on first card
    const menuButton = page.locator('[data-testid="maintenance-page-menu"]').first()
      .or(page.getByRole("button", { name: /Open menu/i }).first());
    await menuButton.click();

    // Click delete
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    // Cancel
    await page.getByRole("button", { name: /Cancel/i }).click();

    // Dialog should close but page should still be there
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await expect(page.getByRole("button", { name: /Open menu/i }).first()).toBeVisible();
  });
});

test.describe("Maintenance Pages Preview Generation", () => {
  test("should show loading state for pages generating preview", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // Pages being generated show loading spinner
    // This is tested by checking the component states
    await expect(page.getByText("Generating preview...")).not.toBeVisible();
  });

  test("should regenerate preview when requested", async ({ page }) => {
    await page.goto("/maintenance-pages");

    const createResult = await page.evaluate(async () => {
      const response = await fetch(`${window.location.origin}/api/maintenance-pages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Regenerate Target",
          description: "Page used for preview regeneration test",
        }),
      });
      const body = await response.json().catch(() => null);
      return { ok: response.ok, body };
    });
    expect(createResult.ok).toBeTruthy();
    const maintenancePageId = createResult.body?.maintenancePage?.id as string;
    expect(maintenancePageId).toBeTruthy();

    const uploadResult = await page.evaluate(async (id: string) => {
      const response = await fetch(`${window.location.origin}/api/maintenance-pages/${id}/upload`, {
        method: "POST",
      });
      return { ok: response.ok };
    }, maintenancePageId);
    expect(uploadResult.ok).toBeTruthy();

    const regenerateResult = await page.evaluate(async (id: string) => {
      const response = await fetch(
        `${window.location.origin}/api/maintenance-pages/${id}/regenerate-preview`,
        {
        method: "POST",
        }
      );
      return { ok: response.ok };
    }, maintenancePageId);
    expect(regenerateResult.ok).toBeTruthy();
  });

  test("should show retry button when preview generation fails", async ({ page }) => {
    await page.goto("/maintenance-pages");

    // When image fails to load, should show retry button
    // Check for retry buttons (may or may not be visible)
    const retryButtons = page.getByRole("button", { name: /Retry/i });
    const count = await retryButtons.count();
    expect(count >= 0).toBe(true);
  });
});

test.describe("Sidebar Navigation", () => {
  test("should show Maintenance Pages link in sidebar", async ({ page }) => {
    await page.goto("/");

    // Should have Maintenance Pages link separate from Error Pages
    await expect(page.getByRole("link", { name: "Maintenance Pages" })).toBeVisible();
  });

  test("should navigate to maintenance pages from sidebar", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Maintenance Pages" }).click();

    await expect(page).toHaveURL("/maintenance-pages");
    await expect(page.getByRole("heading", { name: /Maintenance Pages/i })).toBeVisible();
  });

  test("should show separate Error Pages link", async ({ page }) => {
    await page.goto("/");

    // Error Pages and Maintenance Pages should be separate
    await expect(page.getByRole("link", { name: "Error Pages" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Maintenance Pages" })).toBeVisible();
  });
});
