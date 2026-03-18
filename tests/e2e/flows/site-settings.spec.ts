import { test, expect } from "../fixtures/mocked-test";
import { SiteDetailPage } from "../fixtures/sites-page-objects";

test.describe("Site Settings Flow", () => {
  test("should open settings tab and show settings sections", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");

    const settingsPanel = page.getByRole("tabpanel", { name: /Settings/i });
    await expect(settingsPanel.getByRole("tab", { name: "Build", exact: true })).toBeVisible();
    await expect(settingsPanel.getByRole("tab", { name: "Runtime", exact: true })).toBeVisible();
    await expect(settingsPanel.getByRole("tab", { name: "Environment", exact: true })).toBeVisible();
    await expect(settingsPanel.getByText(/Build Configuration/i)).toBeVisible();
  });

  test("should show default build settings values", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");

    const settingsPanel = page.getByRole("tabpanel", { name: /Settings/i });
    await expect(settingsPanel.getByLabel(/Install Command/i)).toHaveValue("npm install");
    await expect(settingsPanel.getByLabel(/Build Command/i)).toHaveValue("npm run build");
    await expect(settingsPanel.getByLabel(/Output Directory/i)).toHaveValue(".next");
  });

  test("should save build settings", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");

    const settingsPanel = page.getByRole("tabpanel", { name: /Settings/i });
    await settingsPanel.getByLabel(/Install Command/i).fill("pnpm install");
    await settingsPanel.getByLabel(/Build Command/i).fill("pnpm build");
    await settingsPanel.getByLabel(/Output Directory/i).fill("dist");

    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/sites/site-1") &&
        response.request().method() === "PUT"
    );
    await settingsPanel.getByRole("button", { name: /Save Build Settings/i }).click();

    const response = await updateResponse;
    expect(response.ok()).toBeTruthy();
  });

  test("should show runtime settings controls", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");

    const settingsPanel = page.getByRole("tabpanel", { name: /Settings/i });
    await settingsPanel.getByRole("tab", { name: "Runtime", exact: true }).click();

    await expect(settingsPanel.getByText(/Runtime Configuration/i)).toBeVisible();
    await expect(settingsPanel.getByText(/Memory Limit:/i)).toBeVisible();
    await expect(settingsPanel.getByText(/Request Timeout:/i)).toBeVisible();
    await expect(settingsPanel.getByText(/Max Concurrency:/i)).toBeVisible();
    await expect(settingsPanel.getByRole("switch")).toBeVisible();
  });

  test("should save runtime settings", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");

    const settingsPanel = page.getByRole("tabpanel", { name: /Settings/i });
    await settingsPanel.getByRole("tab", { name: "Runtime", exact: true }).click();

    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/sites/site-1") &&
        response.request().method() === "PUT"
    );
    await settingsPanel.getByRole("button", { name: /Save Runtime Settings/i }).click();

    const response = await updateResponse;
    expect(response.ok()).toBeTruthy();
  });

  test("should show and edit environment variables", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");

    const settingsPanel = page.getByRole("tabpanel", { name: /Settings/i });
    await settingsPanel.getByRole("tab", { name: "Environment", exact: true }).click();

    await expect(settingsPanel.getByText("Environment Variables", { exact: true })).toBeVisible();
    await expect(settingsPanel.locator('input[value="NODE_ENV"]').first()).toBeVisible();
    await expect(settingsPanel.getByRole("button", { name: /Add Variable/i })).toBeVisible();

    await settingsPanel.getByRole("button", { name: /Add Variable/i }).click();
    await expect(settingsPanel.getByPlaceholder("VARIABLE_NAME").last()).toBeVisible();
  });
});
