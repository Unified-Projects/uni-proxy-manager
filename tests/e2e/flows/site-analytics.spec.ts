import { test, expect } from "../fixtures/mocked-test";
import { SiteDetailPage, SiteAnalyticsSection } from "../fixtures/sites-page-objects";

test.describe("Site Analytics Flow", () => {
  test.describe("Analytics Overview", () => {
    test("should display analytics tab", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await expect(siteDetail.analyticsTab).toBeVisible();
    });

    test("should switch to analytics tab", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.pageViewsCard).toBeVisible();
    });

    test("should display page views summary", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Mock data has 1500 page views
      await analyticsSection.expectPageViews(1500);
    });

    test("should display unique visitors summary", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Mock data has 850 unique visitors
      await analyticsSection.expectVisitors(850);
    });

    test("should display average response time", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.avgResponseTimeCard).toBeVisible();
      await expect(page.getByText(/145\s*ms/i)).toBeVisible();
    });
  });

  test.describe("Date Range Selection", () => {
    test("should display date range selector", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.dateRangeSelector).toBeVisible();
    });

    test("should select 7 day range", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await analyticsSection.selectDateRange("7d");

      await expect(page.getByRole("combobox").nth(1)).toContainText(/Last 7 days/i);
    });

    test("should select 30 day range", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await analyticsSection.selectDateRange("30d");

      await expect(page.getByRole("combobox").nth(1)).toContainText(/Last 30 days/i);
    });
  });

  test.describe("Geography Breakdown", () => {
    test("should display geography section", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.geographySection).toBeVisible();
    });

    test("should show top countries", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Mock data has US, GB, DE, FR
      await expect(page.getByText("US", { exact: true })).toBeVisible();
      await expect(page.getByText("GB", { exact: true })).toBeVisible();
    });
  });

  test.describe("Referrers", () => {
    test("should display referrers section", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.referrersSection).toBeVisible();
    });

    test("should show top referrers", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Mock data has google.com, twitter.com, direct
      await expect(page.getByText(/google\.com/i)).toBeVisible();
      await expect(page.getByText(/twitter\.com/i)).toBeVisible();
    });
  });

  test.describe("Top Pages", () => {
    test("should display top pages section", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.topPagesSection).toBeVisible();
    });

    test("should show most visited pages", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Mock data has /, /dashboard, /settings
      await expect(page.getByText(/\/dashboard/)).toBeVisible();
      await expect(page.getByText(/\/settings/)).toBeVisible();
    });
  });

  test.describe("Device Breakdown", () => {
    test("should display devices section", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const analyticsSection = new SiteAnalyticsSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      await expect(analyticsSection.devicesSection).toBeVisible();
    });

    test("should show device breakdown", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Should show desktop, mobile, tablet
      await expect(page.getByText(/Desktop/i)).toBeVisible();
      await expect(page.getByText(/Mobile/i)).toBeVisible();
      await expect(page.getByText(/Tablet/i)).toBeVisible();
    });

    test("should show device percentages", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("analytics");

      // Should show percentage values
      await expect(page.getByText("%", { exact: false }).first()).toBeVisible();
    });
  });

  test.describe("Empty State", () => {
    test("should show no data message for site without analytics", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      // site-2 has no analytics in mock data
      await siteDetail.goto("site-2");
      await siteDetail.switchToTab("analytics");

      await expect(page.getByText(/No data|No analytics/i).first()).toBeVisible();
    });
  });
});
