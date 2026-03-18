import { test, expect } from "../fixtures/mocked-test";
import { SettingsPage } from "../fixtures/page-objects";

test.describe("Settings Page", () => {
  test("should display settings page", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();
    await settingsPage.expectLoaded();

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("should display all tabs", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await expect(page.getByRole("tab", { name: "HAProxy" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "System" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Export / Import" })).toBeVisible();
  });

  test("should show haproxy tab content by default", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    // HAProxy tab should be active by default
    await expect(page.getByRole("main").getByText("HAProxy Status")).toBeVisible();
  });

  test("should switch to system tab", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await settingsPage.switchToTab("system");

    // System tab should be selected
    await expect(page.getByRole("tab", { name: "System" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "HAProxy" })).toHaveAttribute("aria-selected", "false");
  });

  test("should switch to export/import tab", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await settingsPage.switchToTab("export-import");

    // Export / import tab should be selected
    await expect(page.getByRole("tab", { name: "Export / Import" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "HAProxy" })).toHaveAttribute("aria-selected", "false");
  });

  test("should display haproxy reload button", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    // On HAProxy tab, reload button should be visible
    await expect(page.getByRole("button", { name: /Reload Configuration/i })).toBeVisible();
  });

  test("should reload haproxy successfully", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    const reloadButton = page.getByRole("button", { name: /Reload Configuration/i });
    await reloadButton.click();
    await expect(reloadButton).toBeEnabled({ timeout: 10000 });
  });
});
