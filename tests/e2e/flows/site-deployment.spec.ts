import { test, expect } from "../fixtures/mocked-test";
import {
  SiteDetailPage,
  TriggerDeploymentDialog,
  DeploymentDetailPage,
} from "../fixtures/sites-page-objects";

test.describe("Site Deployment Flow", () => {
  test.describe("Trigger Deployment", () => {
    test("should open trigger deployment dialog", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const triggerDialog = new TriggerDeploymentDialog(page);

      await siteDetail.goto("site-1");
      await siteDetail.clickDeploy();

      await triggerDialog.expectOpen();
    });

    test("should trigger manual deployment", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const triggerDialog = new TriggerDeploymentDialog(page);

      await siteDetail.goto("site-1");
      await siteDetail.clickDeploy();
      await triggerDialog.selectGitHubMethod();
      await triggerDialog.submit();

      await siteDetail.switchToTab("deployments");
      await expect(page.getByText("#4")).toBeVisible();
    });

    test("should close deploy dialog on cancel", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const triggerDialog = new TriggerDeploymentDialog(page);

      await siteDetail.goto("site-1");
      await siteDetail.clickDeploy();
      await triggerDialog.cancel();

      await expect(triggerDialog.dialog).not.toBeVisible();
    });
  });

  test.describe("Deployment Detail", () => {
    test("should view deployment details", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await deploymentDetail.expectLoaded();
    });

    test("should display deployment status", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await deploymentDetail.expectStatus("live");
    });

    test("should show deployment logs", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await deploymentDetail.expectLogs("Starting build");
    });

    test("should navigate to deployment from site detail", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");
      await siteDetail.clickDeployment(3);

      // Should navigate to deployment detail page
      await expect(page).toHaveURL(/\/sites\/site-1\/deployments\/deploy-1/);
    });
  });

  test.describe("Cancel Deployment", () => {
    test("should show cancel button for non-live deployments", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      // deploy-3 is building, not live
      await deploymentDetail.goto("site-2", "deploy-3");
      await expect(deploymentDetail.cancelButton).toBeVisible();
    });

    test("should cancel a building deployment", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-2", "deploy-3");
      await deploymentDetail.clickCancel();

      // Status should update to cancelled
      await deploymentDetail.expectStatus("cancelled");
    });
  });

  test.describe("Promote Deployment", () => {
    test("should show promote button for live deployments", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      // deploy-2 is live but not active
      await deploymentDetail.goto("site-1", "deploy-2");
      await expect(deploymentDetail.promoteButton).toBeVisible();
    });

    test("should promote deployment to active", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-2");
      await deploymentDetail.clickPromote();

      // Should show as active now
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
    });
  });

  test.describe("Rollback", () => {
    test("should rollback to previous deployment", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await page.getByRole("button", { name: "Rollback", exact: true }).click();
      const targetDeployment = page.getByRole("button", { name: /Deployment #/ }).first();
      await expect(targetDeployment).toBeVisible();
      await targetDeployment.click();
      await page.getByRole("button", { name: "Rollback", exact: true }).last().click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });
  });

  test.describe("Deployment Logs", () => {
    test("should display build logs", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await expect(deploymentDetail.logsViewer).toBeVisible();
      await deploymentDetail.expectLogs("Build complete");
    });

    test("should have auto-scroll toggle", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await expect(deploymentDetail.autoScrollToggle).toBeVisible();
    });

    test("should toggle auto-scroll", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await expect(deploymentDetail.autoScrollToggle).toContainText("On");
      await deploymentDetail.toggleAutoScroll();
      await expect(deploymentDetail.autoScrollToggle).toContainText("Off");
    });
  });

  test.describe("Deployment List", () => {
    test("should show deployments for a site", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");
      await expect(page.getByText("#3")).toBeVisible();
      await expect(page.getByText("#2")).toBeVisible();
    });

    test("should show deployment versions", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");

      await expect(page.getByText("#3")).toBeVisible();
      await expect(page.getByText("#2")).toBeVisible();
    });
  });
});
