import { test, expect } from "../fixtures/mocked-test";
import { SiteDetailPage, GitHubConnectionSection } from "../fixtures/sites-page-objects";

test.describe("Site GitHub Connection Flow", () => {
  test.describe("View GitHub Status", () => {
    test("should show connected status for connected site", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      // Site 1 is connected to GitHub
      await githubSection.expectConnected();
    });

    test("should show not connected status for unconnected site", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-2");
      await siteDetail.switchToTab("github");

      // Site 2 is not connected
      await githubSection.expectNotConnected();
    });

    test("should display repository name when connected", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await expect(page.getByText("my-org/my-nextjs-app")).toBeVisible();
    });

    test("should display production branch", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await expect(page.getByText(/main/i)).toBeVisible();
    });

    test("should show auto-deploy status", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await expect(githubSection.autoDeployToggle).toBeVisible();
    });
  });

  test.describe("Connect Repository", () => {
    test("should show connect button for unconnected site", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-2");
      await siteDetail.switchToTab("github");

      await expect(githubSection.connectButton).toBeVisible();
    });

    test("should initiate GitHub App installation", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-2");
      await siteDetail.switchToTab("github");

      await githubSection.clickConnect();

      // Should show repository selection or redirect to GitHub
      // In mocked tests, we expect a dialog or selection UI
      await expect(
        page.getByRole("dialog").or(page.getByText(/Select.*Repository/i))
      ).toBeVisible();
    });
  });

  test.describe("Disconnect Repository", () => {
    test("should show disconnect button when connected", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await expect(githubSection.disconnectButton).toBeVisible();
    });

    test("should confirm before disconnecting", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await githubSection.clickDisconnect();

      // Should show confirmation dialog
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/Are you sure|Disconnect/i)).toBeVisible();
    });

    test("should disconnect repository after confirmation", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await githubSection.clickDisconnect();

      // Confirm disconnection
      await page.getByRole("button", { name: /Confirm|Disconnect/i }).click();

      // Should show not connected state
      await githubSection.expectNotConnected();
    });
  });

  test.describe("Update Connection Settings", () => {
    test("should toggle auto-deploy setting", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      const initialState = await githubSection.autoDeployToggle.isChecked();
      await githubSection.toggleAutoDeploy();

      const newState = await githubSection.autoDeployToggle.isChecked();
      expect(newState).not.toBe(initialState);
    });

    test("should change production branch", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await githubSection.setProductionBranch("production");

      // Should show updated branch
      await expect(page.getByText("production")).toBeVisible();
    });
  });

  test.describe("Sync Repository", () => {
    test("should show sync button when connected", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await expect(githubSection.syncButton).toBeVisible();
    });

    test("should trigger repository sync", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await githubSection.clickSync();

      // Should show syncing indicator or success message
      await expect(
        page.getByText(/Syncing|Synced|Success/i).or(page.locator("[data-testid=sync-spinner]"))
      ).toBeVisible();
    });

    test("should display last sync time", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      await expect(githubSection.lastSyncLabel).toBeVisible();
    });

    test("should display latest commit SHA", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const githubSection = new GitHubConnectionSection(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      // Should show commit SHA (at least first 7 characters)
      await expect(page.getByText(/abc123/i)).toBeVisible();
    });
  });

  test.describe("Preview Branches", () => {
    test("should display preview branches configuration", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      // Should show preview branches setting
      await expect(page.getByText(/Preview Branches|Preview Deployments/i)).toBeVisible();
    });

    test("should show wildcard for all branches", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      // Mock data has ["*"] for preview branches
      await expect(page.getByText("*").or(page.getByText(/All branches/i))).toBeVisible();
    });
  });

  test.describe("Repository Link", () => {
    test("should have link to GitHub repository", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("github");

      const repoLink = page.getByRole("link", { name: /my-org\/my-nextjs-app|View on GitHub/i });
      await expect(repoLink).toBeVisible();
      await expect(repoLink).toHaveAttribute("href", /github\.com\/my-org\/my-nextjs-app/);
    });
  });
});
