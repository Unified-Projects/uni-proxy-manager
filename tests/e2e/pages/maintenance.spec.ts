import { test, expect } from "../fixtures/mocked-test";
import { MaintenancePage } from "../fixtures/page-objects";

test.describe("Maintenance Page", () => {
  test("should display maintenance page", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();
    await maintenancePage.expectLoaded();

    await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
  });

  test("should have schedule maintenance button", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();

    await expect(page.getByRole("button", { name: /Schedule Maintenance/i })).toBeVisible();
  });

  test("should display overview cards", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();

    // Should have overview cards
    await expect(page.getByText("Domains in Maintenance")).toBeVisible();
    await expect(page.getByText("Active Windows")).toBeVisible();
    await expect(page.getByText("Scheduled Windows")).toBeVisible();
  });

  test("should display domain maintenance status table", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();

    await expect(page.getByRole("main").getByText("Domain Maintenance Status")).toBeVisible();
  });

  test("should display maintenance windows table", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();

    await expect(page.getByRole("main").getByText("Maintenance Windows", { exact: true })).toBeVisible();
  });

  test("should open schedule maintenance dialog", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();

    await page.getByRole("button", { name: /Schedule Maintenance/i }).click();

    // Dialog should open
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Schedule Maintenance");
  });

  test("should have domain selection in schedule dialog", async ({ page }) => {
    const maintenancePage = new MaintenancePage(page);
    await maintenancePage.goto();

    await page.getByRole("button", { name: /Schedule Maintenance/i }).click();

    // Should have domain selection
    await expect(page.getByLabel("Domain")).toBeVisible();
  });
});
