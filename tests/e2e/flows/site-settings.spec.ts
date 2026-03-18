import { test, expect } from "../fixtures/mocked-test";
import { SiteDetailPage, SiteSettingsPage } from "../fixtures/sites-page-objects";

test.describe("Site Settings Flow", () => {
  test.describe("Settings Tab", () => {
    test("should display settings tab", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await expect(siteDetail.settingsTab).toBeVisible();
    });

    test("should switch to settings tab", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await settingsPage.expectLoaded();
    });
  });

  test.describe("General Settings", () => {
    test("should display site name input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.nameInput).toBeVisible();
      await expect(settingsPage.nameInput).toHaveValue("My Next.js App");
    });

    test("should display site slug input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.slugInput).toBeVisible();
      await expect(settingsPage.slugInput).toHaveValue("my-nextjs-app");
    });

    test("should update site name", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await settingsPage.nameInput.clear();
      await settingsPage.nameInput.fill("Updated App Name");
      await settingsPage.save();

      // Should show success message
      await expect(page.getByText(/saved|updated|success/i)).toBeVisible();
    });
  });

  test.describe("Build Settings", () => {
    test("should display build command input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.buildCommandInput).toBeVisible();
      await expect(settingsPage.buildCommandInput).toHaveValue("npm run build");
    });

    test("should display install command input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.installCommandInput).toBeVisible();
    });

    test("should display output directory input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.outputDirectoryInput).toBeVisible();
      await expect(settingsPage.outputDirectoryInput).toHaveValue(".next");
    });

    test("should display node version selector", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.nodeVersionSelect).toBeVisible();
    });

    test("should update build settings", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await settingsPage.updateBuildSettings({
        buildCommand: "pnpm build",
        installCommand: "pnpm install",
        outputDirectory: "dist",
      });
      await settingsPage.save();

      await expect(page.getByText(/saved|updated|success/i)).toBeVisible();
    });
  });

  test.describe("Runtime Settings", () => {
    test("should display memory input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.memoryInput).toBeVisible();
    });

    test("should display CPU input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.cpuInput).toBeVisible();
    });

    test("should display timeout input", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.timeoutInput).toBeVisible();
    });

    test("should display cold start toggle", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.coldStartToggle).toBeVisible();
    });

    test("should update runtime settings", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await settingsPage.updateRuntimeSettings({
        memoryMb: 512,
        cpu: "1.0",
        timeoutSeconds: 60,
      });
      await settingsPage.save();

      await expect(page.getByText(/saved|updated|success/i)).toBeVisible();
    });

    test("should toggle cold start setting", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      const initialState = await settingsPage.coldStartToggle.isChecked();
      await settingsPage.updateRuntimeSettings({ coldStartEnabled: !initialState });
      await settingsPage.save();

      await expect(page.getByText(/saved|updated|success/i)).toBeVisible();
    });
  });

  test.describe("Environment Variables", () => {
    test("should display environment variables section", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.envVarsSection).toBeVisible();
    });

    test("should show existing environment variables", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      // Mock data has NODE_ENV=production
      await expect(page.getByText("NODE_ENV")).toBeVisible();
    });

    test("should add new environment variable", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await settingsPage.addEnvironmentVariable("API_KEY", "secret-key-123");
      await settingsPage.save();

      await expect(page.getByText(/saved|updated|success/i)).toBeVisible();
    });

    test("should show add variable button", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.addEnvVarButton).toBeVisible();
    });
  });

  test.describe("Danger Zone", () => {
    test("should display delete site button", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.deleteButton).toBeVisible();
    });

    test("should display disable site button", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.disableButton).toBeVisible();
    });

    test("should show confirmation when clicking delete", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await settingsPage.clickDelete();

      // Should show confirmation dialog
      await expect(page.getByRole("dialog")).toBeVisible();
    });
  });

  test.describe("Save Changes", () => {
    test("should display save button", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(settingsPage.saveButton).toBeVisible();
    });

    test("should save all settings at once", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);
      const settingsPage = new SiteSettingsPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      // Update multiple settings
      await settingsPage.nameInput.clear();
      await settingsPage.nameInput.fill("Completely Updated Site");
      await settingsPage.updateBuildSettings({ buildCommand: "yarn build" });
      await settingsPage.updateRuntimeSettings({ memoryMb: 1024 });

      await settingsPage.save();

      await expect(page.getByText(/saved|updated|success/i)).toBeVisible();
    });
  });

  test.describe("Framework-Specific Settings", () => {
    test("should show Next.js specific options for Next.js sites", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      // site-1 is a Next.js site
      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      // Should show .next as default output directory
      await expect(page.getByText(".next")).toBeVisible();
    });

    test("should show SvelteKit specific options for SvelteKit sites", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      // site-2 is a SvelteKit site
      await siteDetail.goto("site-2");
      await siteDetail.switchToTab("settings");

      // Should show build as output directory
      await expect(page.getByDisplayValue("build")).toBeVisible();
    });
  });

  test.describe("Settings Navigation", () => {
    test("should navigate to settings from site detail", async ({ page }) => {
      const siteDetail = new SiteDetailPage(page);

      await siteDetail.goto("site-1");
      await siteDetail.switchToTab("settings");

      await expect(page.getByText(/Build Settings|Build Command/i)).toBeVisible();
    });

    test("should have direct URL access to settings", async ({ page }) => {
      const settingsPage = new SiteSettingsPage(page);

      await settingsPage.goto("site-1");
      await settingsPage.expectLoaded();
    });
  });
});
