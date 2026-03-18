import { test, expect } from "../fixtures/mocked-test";
import { Sidebar } from "../fixtures/page-objects";

test.describe("Navigation Flow", () => {
  test("should navigate through all main pages", async ({ page }) => {
    const sidebar = new Sidebar(page);

    // Start at dashboard
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Navigate to Domains
    await sidebar.navigateToDomains();
    await expect(page).toHaveURL("/domains");
    await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();

    // Navigate to Certificates
    await sidebar.navigateToCertificates();
    await expect(page).toHaveURL("/certificates");
    await expect(page.getByRole("heading", { name: "Certificates" })).toBeVisible();

    // Navigate to DNS Providers
    await sidebar.navigateToDnsProviders();
    await expect(page).toHaveURL("/dns-providers");
    await expect(page.getByRole("heading", { name: "DNS Providers" })).toBeVisible();

    // Navigate to Error Pages
    await sidebar.navigateToErrorPages();
    await expect(page).toHaveURL("/error-pages");
    await expect(page.getByRole("heading", { name: "Error Pages" })).toBeVisible();

    // Navigate to Maintenance Pages
    await sidebar.navigateToMaintenancePages();
    await expect(page).toHaveURL("/maintenance-pages");
    await expect(page.getByRole("heading", { name: /Maintenance Pages/i })).toBeVisible();

    // Navigate to Maintenance Mode
    await sidebar.navigateToMaintenanceMode();
    await expect(page).toHaveURL("/maintenance");
    await expect(page.getByRole("heading", { name: /Maintenance/i })).toBeVisible();

    // Navigate to Settings
    await sidebar.navigateToSettings();
    await expect(page).toHaveURL("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Navigate back to Dashboard
    await sidebar.navigateToDashboard();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("should maintain navigation on page refresh", async ({ page }) => {
    // Navigate to a specific page
    await page.goto("/certificates");
    await expect(page.getByRole("heading", { name: "Certificates" })).toBeVisible();

    // Refresh the page
    await page.reload();

    // Should still be on the same page
    await expect(page).toHaveURL("/certificates");
    await expect(page.getByRole("heading", { name: "Certificates" })).toBeVisible();
  });

  test("should handle direct URL navigation", async ({ page }) => {
    // Navigate directly to each page
    const pages = [
      { url: "/", heading: "Dashboard" },
      { url: "/domains", heading: "Domains" },
      { url: "/certificates", heading: "Certificates" },
      { url: "/dns-providers", heading: "DNS Providers" },
      { url: "/error-pages", heading: "Error Pages" },
      { url: "/maintenance-pages", heading: /Maintenance Pages/i },
      { url: "/maintenance", heading: /Maintenance/i },
      { url: "/settings", heading: "Settings" },
    ];

    for (const p of pages) {
      await page.goto(p.url);
      await expect(page.getByRole("heading", { name: p.heading })).toBeVisible();
    }
  });
});

test.describe("Responsive Design", () => {
  test("should display mobile layout on small screens", async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Dashboard should still be visible
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("should display tablet layout on medium screens", async ({ page }) => {
    // Set viewport to tablet size
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");

    // Dashboard should be visible
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
