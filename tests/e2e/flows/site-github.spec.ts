import { test, expect } from "../fixtures/mocked-test";
import { SiteDetailPage, GitHubConnectionSection } from "../fixtures/sites-page-objects";

test.describe("Site GitHub Connection Flow", () => {
  test("should show connected state and repository details", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("github");

    await githubSection.expectConnected();
    await expect(page.getByText("my-org/my-nextjs-app").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /View on GitHub/i })).toHaveAttribute("href", /github\.com\/my-org\/my-nextjs-app/);
  });

  test("should show not connected state for unconnected site", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-2");
    await siteDetail.switchToTab("github");

    await githubSection.expectNotConnected();
  });

  test("should open connect repository dialog", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-2");
    await siteDetail.switchToTab("github");
    await githubSection.clickConnect();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/Connect GitHub Repository/i)).toBeVisible();
  });

  test("should toggle auto deploy", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("github");

    const toggle = githubSection.autoDeployToggle;
    const before = await toggle.getAttribute("aria-checked");

    const updateResponse = page.waitForResponse((response) =>
      response.url().includes("/api/github/sites/site-1") && response.request().method() === "PUT"
    );
    await githubSection.toggleAutoDeploy();
    const update = await updateResponse;
    expect(update.ok()).toBeTruthy();
    const requestData = update.request().postDataJSON() as { autoDeploy?: boolean };
    expect(requestData.autoDeploy).toBe(before !== "true");
  });

  test("should update production branch", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("github");
    const updateResponse = page.waitForResponse((response) =>
      response.url().includes("/api/github/sites/site-1") && response.request().method() === "PUT"
    );
    await githubSection.setProductionBranch("production");
    const update = await updateResponse;
    expect(update.ok()).toBeTruthy();
    await expect(githubSection.productionBranch).toContainText("production");
  });

  test("should sync repository", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("github");
    const syncResponse = page.waitForResponse((response) =>
      response.url().includes("/api/github/sites/site-1/sync") && response.request().method() === "POST"
    );
    await githubSection.clickSync();
    const sync = await syncResponse;
    expect(sync.ok()).toBeTruthy();
    await expect(githubSection.lastSyncLabel).toBeVisible();
  });

  test("should disconnect repository", async ({ page }) => {
    const siteDetail = new SiteDetailPage(page);
    const githubSection = new GitHubConnectionSection(page);

    await siteDetail.goto("site-1");
    await siteDetail.switchToTab("github");
    await githubSection.clickDisconnect();

    await githubSection.expectNotConnected();
  });
});
