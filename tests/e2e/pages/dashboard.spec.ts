import { test, expect } from "../fixtures/mocked-test";
import { DashboardPage, Sidebar } from "../fixtures/page-objects";

test.describe("Dashboard Page", () => {
  test("should display dashboard with metric cards", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.expectLoaded();

    // Check for metric cards (texts instead of heading roles to match UI markup)
    const main = page.getByRole("main");
    await expect(main.getByText("Domains", { exact: true })).toBeVisible();
    await expect(main.getByText("Certificates", { exact: true })).toBeVisible();
    await expect(main.getByText("Backends", { exact: true })).toBeVisible();
    await expect(main.getByText("Maintenance", { exact: true })).toBeVisible();
  });

  test("should display HAProxy status", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // HAProxy status card should be visible
    await expect(page.getByRole("main").getByText("HAProxy Status")).toBeVisible();
  });

  test("should display quick actions", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Quick actions should be visible
    await expect(page.getByRole("main").getByText("Quick Actions")).toBeVisible();
    await expect(page.getByRole("button", { name: /Add New Domain/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Request Certificate/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Configure DNS Provider/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Manage Maintenance/i })).toBeVisible();
  });

  test("should navigate to domains from quick actions", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await page.getByRole("button", { name: /Add New Domain/i }).click();
    await expect(page).toHaveURL(/\/domains/);
  });

  test("should navigate using sidebar", async ({ page }) => {
    const sidebar = new Sidebar(page);
    await page.goto("/");

    // Navigate to Domains
    await sidebar.navigateToDomains();
    await expect(page).toHaveURL("/domains");

    // Navigate to Certificates
    await sidebar.navigateToCertificates();
    await expect(page).toHaveURL("/certificates");

    // Navigate back to Dashboard
    await sidebar.navigateToDashboard();
    await expect(page).toHaveURL("/");
  });
});
