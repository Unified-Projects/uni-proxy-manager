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
    await expect(page.getByRole("tab", { name: "Configuration" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "ACME / SSL" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
  });

  test("should show haproxy tab content by default", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    // HAProxy tab should be active by default
    await expect(page.getByRole("main").getByText("HAProxy Status")).toBeVisible();
  });

  test("should switch to configuration tab", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await settingsPage.switchToTab("config");

    // Configuration content should be visible
    await expect(page.getByRole("main").getByRole("heading", { name: "HAProxy Configuration" })).toBeVisible();
  });

  test("should switch to acme tab", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await settingsPage.switchToTab("acme");

    // ACME content should be visible
    await expect(page.getByRole("main").getByText("ACME / Let's Encrypt Settings")).toBeVisible();
  });

  test("should switch to general tab", async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await settingsPage.switchToTab("general");

    // General content should be visible
    await expect(page.getByRole("main").getByRole("heading", { name: "System Information" })).toBeVisible();
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
