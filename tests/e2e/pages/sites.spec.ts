import { test, expect } from "../fixtures/mocked-test";
import {
  SitesPage,
  CreateSiteDialog,
  SiteDetailPage,
  DeleteSiteDialog,
  SitesSidebar,
} from "../fixtures/sites-page-objects";

test.describe("Sites Page", () => {
  test("should display sites page when extension is enabled", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    await sitesPage.goto();
    await sitesPage.expectLoaded();
  });

  test("should show Sites link in sidebar when extension is enabled", async ({ page }) => {
    const sidebar = new SitesSidebar(page);
    await page.goto("/");
    await sidebar.expectSitesLinkVisible();
  });

  test("should list all sites", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    await sitesPage.goto();

    // Mock data includes 2 sites
    await sitesPage.expectSiteCard("My Next.js App");
    await sitesPage.expectSiteCard("SvelteKit Blog");
  });

  test("should search sites by name", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    await sitesPage.goto();

    await sitesPage.searchSites("Next");
    // Should only show matching site
    await expect(page.getByText("My Next.js App")).toBeVisible();
  });

  test("should open create site dialog", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    const createDialog = new CreateSiteDialog(page);

    await sitesPage.goto();
    await sitesPage.clickCreateSite();
    await createDialog.expectOpen();
  });

  test("should navigate to site detail page when clicking a site", async ({ page }) => {
    const sitesPage = new SitesPage(page);

    await sitesPage.goto();
    await sitesPage.clickSiteCard("My Next.js App");

    // Should navigate to site detail page
    await expect(page).toHaveURL(/\/sites\/site-1/);
  });
});

test.describe("Create Site", () => {
  test("should create a new site with minimal data", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    const createDialog = new CreateSiteDialog(page);

    await sitesPage.goto();
    await sitesPage.clickCreateSite();

    await createDialog.fillForm({
      name: "New Test Site",
      slug: "new-test-site",
    });
    await createDialog.submit();

    // Dialog should close after successful creation
    await createDialog.expectClosed();

    // New site should appear in the list
    await sitesPage.expectSiteCard("New Test Site");
  });

  test("should create a site with all options", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    const createDialog = new CreateSiteDialog(page);

    await sitesPage.goto();
    await sitesPage.clickCreateSite();

    await createDialog.fillForm({
      name: "Full Options Site",
      slug: "full-options",
      framework: "sveltekit",
      renderMode: "ssg",
      buildCommand: "pnpm build",
      outputDirectory: "build",
      nodeVersion: "20",
    });
    await createDialog.submit();

    await createDialog.expectClosed();
    await sitesPage.expectSiteCard("Full Options Site");
  });

  test("should cancel site creation", async ({ page }) => {
    const sitesPage = new SitesPage(page);
    const createDialog = new CreateSiteDialog(page);

    await sitesPage.goto();
    await sitesPage.clickCreateSite();

    await createDialog.fillForm({
      name: "Cancelled Site",
      slug: "cancelled",
    });
    await createDialog.cancel();

    await createDialog.expectClosed();
    // Site should not appear in the list
    await expect(page.getByText("Cancelled Site")).not.toBeVisible();
  });
});

test.describe("Site Detail Page", () => {
  test("should display site details", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);

    await siteDetail.goto("site-1");
    await siteDetail.expectLoaded();

    // Should show site name
    await expect(page.getByText("My Next.js App")).toBeVisible();
  });

  test("should show site status", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);

    await siteDetail.goto("site-1");
    await siteDetail.expectStatus("active");
  });

  test("should list deployments", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("deployments");

    // Site 1 has 2 deployments in mock data
    await expect(page.getByText("v3")).toBeVisible();
    await expect(page.getByText("v2")).toBeVisible();
  });

  test("should display deploy button", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);

    await siteDetail.goto("site-1");
    await expect(siteDetail.deployButton).toBeVisible();
  });

  test("should have tabs for different sections", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);

    await siteDetail.goto("site-1");

    await expect(siteDetail.deploymentsTab).toBeVisible();
    await expect(siteDetail.analyticsTab).toBeVisible();
    await expect(siteDetail.githubTab).toBeVisible();
    await expect(siteDetail.settingsTab).toBeVisible();
  });

  test("should return 404 for non-existent site", async ({ page }) => {
    await page.goto("/sites/non-existent-id");
    // Should show error or not found state
    await expect(page.getByText(/not found/i)).toBeVisible();
  });
});

test.describe("Delete Site", () => {
  test("should show delete confirmation dialog", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const deleteDialog = new DeleteSiteDialog(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");
    await page.getByRole("button", { name: /Delete Site/i }).click();

    await deleteDialog.expectOpen();
    await expect(deleteDialog.warningText).toBeVisible();
  });

  test("should require confirmation to delete", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const deleteDialog = new DeleteSiteDialog(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");
    await page.getByRole("button", { name: /Delete Site/i }).click();

    await deleteDialog.expectOpen();
    await deleteDialog.confirmDeletion("My Next.js App");
    await deleteDialog.submit();

    // Should redirect to sites list after deletion
    await expect(page).toHaveURL("/sites");
  });

  test("should cancel site deletion", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const deleteDialog = new DeleteSiteDialog(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("settings");
    await page.getByRole("button", { name: /Delete Site/i }).click();

    await deleteDialog.expectOpen();
    await deleteDialog.cancel();

    // Should still be on site detail page
    await expect(page).toHaveURL(/\/sites\/site-1/);
  });
});
