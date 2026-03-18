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

      await triggerDialog.fillForm({
        branch: "main",
        commitMessage: "Test deployment",
      });
      await triggerDialog.submit();

      // Should show new deployment in list
      await siteDetail.switchToTab("deployments");
      await expect(page.getByText(/v4/)).toBeVisible();
    });

    test("should trigger deployment with custom commit SHA", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const triggerDialog = new TriggerDeploymentDialog(page);

      await siteDetail.goto("site-1");
      await siteDetail.clickDeploy();

      await triggerDialog.fillForm({
        branch: "main",
        commitSha: "abc123def456",
        commitMessage: "Deploy specific commit",
      });
      await triggerDialog.submit();

      // Dialog should close after triggering
      await expect(triggerDialog.dialog).not.toBeVisible();
    });

    test("should cancel deployment trigger", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const triggerDialog = new TriggerDeploymentDialog(page);

      await siteDetail.goto("site-1");
      await siteDetail.clickDeploy();

      await triggerDialog.fillForm({
        branch: "develop",
      });
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

      // Confirm cancellation if dialog appears
      const confirmButton = page.getByRole("button", { name: /Confirm|Yes/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

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

      // Confirm promotion if dialog appears
      const confirmButton = page.getByRole("button", { name: /Confirm|Promote/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Should show as active now
      await expect(page.getByText(/active/i)).toBeVisible();
    });
  });

  test.describe("Rollback", () => {
    test("should rollback to previous deployment", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");

      // Click rollback on v2 deployment
      await page.getByRole("button", { name: /Rollback/i }).first().click();

      // Confirm rollback if dialog appears
      const confirmButton = page.getByRole("button", { name: /Confirm|Rollback/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Should show success message
      await expect(page.getByText(/rolled back|success/i)).toBeVisible();
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

      const initialState = await deploymentDetail.autoScrollToggle.isChecked();
      await deploymentDetail.toggleAutoScroll();

      const newState = await deploymentDetail.autoScrollToggle.isChecked();
      expect(newState).not.toBe(initialState);
    });

    test("should show download logs button", async ({ page }) => {
      const deploymentDetail = new DeploymentDetailPage(page);

      await deploymentDetail.goto("site-1", "deploy-1");
      await expect(deploymentDetail.downloadLogsButton).toBeVisible();
    });
  });

  test.describe("Deployment List", () => {
    test("should show all deployments for a site", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");

      // Site 1 has 2 deployments
      await siteDetail.expectDeploymentCount(2);
    });

    test("should filter deployments by status", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");

      // Filter by live status
      await page.getByRole("combobox", { name: /Status/i }).click();
      await page.getByRole("option", { name: /Live/i }).click();

      // Should show only live deployments
      await expect(page.getByText("live")).toBeVisible();
    });

    test("should show deployment version and slot", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("deployments");

      // v3 is on blue slot
      await expect(page.getByText(/blue/i)).toBeVisible();
      // v2 is on green slot
      await expect(page.getByText(/green/i)).toBeVisible();
    });
  });
});
