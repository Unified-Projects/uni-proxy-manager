import { type Page, type Locator, expect } from "./mocked-test";

/**
 * Base page object with common functionality for Sites
 */
class SitesBasePage {
  readonly page: Page;
  readonly toastContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.toastContainer = page.locator('[role="region"][aria-label*="Notifications"]');
  }

  async waitForToast(text: string) {
    await expect(this.toastContainer.getByText(text)).toBeVisible({ timeout: 10000 });
  }

  async expectToastSuccess(message: string) {
    await this.waitForToast(message);
  }

  async expectToastError(message: string) {
    await this.waitForToast(message);
  }

  async navigateTo(path: string) {
    await this.page.goto(path);
  }
}

/**
 * Sites list page object
 */
export class SitesPage extends SitesBasePage {
  readonly heading: Locator;
  readonly createSiteButton: Locator;
  readonly sitesGrid: Locator;
  readonly siteCards: Locator;
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly frameworkFilter: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Sites" });
    this.createSiteButton = page.getByRole("button", { name: /Create Site|New Site/i });
    this.sitesGrid = page.locator('[data-testid="sites-grid"]').or(page.locator(".sites-grid"));
    this.siteCards = page.locator('[data-testid="site-card"]').or(page.locator(".site-card"));
    this.searchInput = page.getByPlaceholder(/Search sites/i);
    this.statusFilter = page.getByRole("combobox", { name: /Status/i });
    this.frameworkFilter = page.getByRole("combobox", { name: /Framework/i });
    this.emptyState = page.getByText(/No sites found|Create your first site/i);
  }

  async goto() {
    await this.page.goto("/sites");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async clickCreateSite() {
    await this.createSiteButton.click();
  }

  async searchSites(query: string) {
    await this.searchInput.fill(query);
  }

  async filterByStatus(status: string) {
    await this.statusFilter.click();
    await this.page.getByRole("option", { name: status }).click();
  }

  async filterByFramework(framework: string) {
    await this.frameworkFilter.click();
    await this.page.getByRole("option", { name: framework }).click();
  }

  async expectSiteCard(name: string) {
    await expect(this.page.getByText(name)).toBeVisible();
  }

  async clickSiteCard(name: string) {
    await this.page.getByText(name).click();
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible();
  }
}

/**
 * Create Site Dialog
 */
export class CreateSiteDialog extends SitesBasePage {
  readonly dialog: Locator;
  readonly nameInput: Locator;
  readonly slugInput: Locator;
  readonly frameworkSelect: Locator;
  readonly renderModeSelect: Locator;
  readonly buildCommandInput: Locator;
  readonly outputDirectoryInput: Locator;
  readonly nodeVersionSelect: Locator;
  readonly createButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole("dialog");
    this.nameInput = page.getByLabel("Name");
    this.slugInput = page.getByLabel("Slug");
    this.frameworkSelect = page.getByRole("combobox", { name: /Framework/i });
    this.renderModeSelect = page.getByRole("combobox", { name: /Render Mode/i });
    this.buildCommandInput = page.getByLabel(/Build Command/i);
    this.outputDirectoryInput = page.getByLabel(/Output Directory/i);
    this.nodeVersionSelect = page.getByRole("combobox", { name: /Node Version/i });
    this.createButton = page.getByRole("button", { name: /Create Site/i });
    this.cancelButton = page.getByRole("button", { name: "Cancel" });
  }

  async expectOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async expectClosed() {
    await expect(this.dialog).not.toBeVisible();
  }

  async fillForm(data: {
    name: string;
    slug?: string;
    framework?: "nextjs" | "sveltekit" | "static" | "custom";
    renderMode?: "ssr" | "ssg" | "hybrid";
    buildCommand?: string;
    outputDirectory?: string;
    nodeVersion?: string;
  }) {
    await this.nameInput.fill(data.name);
    if (data.slug) {
      await this.slugInput.fill(data.slug);
    }
    if (data.framework) {
      await this.frameworkSelect.click();
      await this.page.getByRole("option", { name: new RegExp(data.framework, "i") }).click();
    }
    if (data.renderMode) {
      await this.renderModeSelect.click();
      await this.page.getByRole("option", { name: new RegExp(data.renderMode, "i") }).click();
    }
    if (data.buildCommand) {
      await this.buildCommandInput.fill(data.buildCommand);
    }
    if (data.outputDirectory) {
      await this.outputDirectoryInput.fill(data.outputDirectory);
    }
    if (data.nodeVersion) {
      await this.nodeVersionSelect.click();
      await this.page.getByRole("option", { name: data.nodeVersion }).click();
    }
  }

  async submit() {
    await this.createButton.scrollIntoViewIfNeeded();
    await this.createButton.click();
  }

  async cancel() {
    await this.cancelButton.scrollIntoViewIfNeeded();
    await this.cancelButton.click();
  }
}

/**
 * Site Detail Page
 */
export class SiteDetailPage extends SitesBasePage {
  readonly heading: Locator;
  readonly statusBadge: Locator;
  readonly deployButton: Locator;
  readonly settingsButton: Locator;
  readonly deleteButton: Locator;

  // Tabs
  readonly deploymentsTab: Locator;
  readonly analyticsTab: Locator;
  readonly githubTab: Locator;
  readonly settingsTab: Locator;
  readonly logsTab: Locator;

  // Deployment list
  readonly deploymentsList: Locator;
  readonly deploymentCards: Locator;

  // Quick stats
  readonly pageViewsStat: Locator;
  readonly visitorsStat: Locator;
  readonly uptimeStat: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator("h1");
    this.statusBadge = page.locator('[data-testid="site-status"]').or(page.locator(".site-status-badge"));
    this.deployButton = page.getByRole("button", { name: /Deploy|Trigger Deploy/i });
    this.settingsButton = page.getByRole("button", { name: /Settings/i });
    this.deleteButton = page.getByRole("button", { name: /Delete Site/i });

    this.deploymentsTab = page.getByRole("tab", { name: /Deployments/i });
    this.analyticsTab = page.getByRole("tab", { name: /Analytics/i });
    this.githubTab = page.getByRole("tab", { name: /GitHub/i });
    this.settingsTab = page.getByRole("tab", { name: /Settings/i });
    this.logsTab = page.getByRole("tab", { name: /Logs/i });

    this.deploymentsList = page.locator('[data-testid="deployments-list"]').or(page.locator(".deployments-list"));
    this.deploymentCards = page.locator('[data-testid="deployment-card"]').or(page.locator(".deployment-card"));

    this.pageViewsStat = page.getByText(/Page Views/i).locator("..");
    this.visitorsStat = page.getByText(/Visitors/i).locator("..");
    this.uptimeStat = page.getByText(/Uptime/i).locator("..");
  }

  async goto(siteId: string) {
    await this.page.goto(`/sites/${siteId}`);
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async clickDeploy() {
    await this.deployButton.click();
  }

  async switchToTab(tab: "deployments" | "analytics" | "github" | "settings" | "logs") {
    switch (tab) {
      case "deployments":
        await this.deploymentsTab.click();
        break;
      case "analytics":
        await this.analyticsTab.click();
        break;
      case "github":
        await this.githubTab.click();
        break;
      case "settings":
        await this.settingsTab.click();
        break;
      case "logs":
        await this.logsTab.click();
        break;
    }
  }

  async expectStatus(status: string) {
    await expect(this.statusBadge).toContainText(status, { ignoreCase: true });
  }

  async expectDeploymentCount(count: number) {
    await expect(this.deploymentCards).toHaveCount(count);
  }

  async clickDeployment(version: number | string) {
    await this.page.getByText(`v${version}`).or(this.page.getByText(`Version ${version}`)).click();
  }
}

/**
 * Trigger Deployment Dialog
 */
export class TriggerDeploymentDialog extends SitesBasePage {
  readonly dialog: Locator;
  readonly branchInput: Locator;
  readonly branchSelect: Locator;
  readonly commitShaInput: Locator;
  readonly commitMessageInput: Locator;
  readonly deployButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole("dialog");
    this.branchInput = page.getByLabel(/Branch/i);
    this.branchSelect = page.getByRole("combobox", { name: /Branch/i });
    this.commitShaInput = page.getByLabel(/Commit SHA/i);
    this.commitMessageInput = page.getByLabel(/Commit Message/i);
    this.deployButton = page.getByRole("button", { name: /Deploy|Start Deployment/i });
    this.cancelButton = page.getByRole("button", { name: "Cancel" });
  }

  async expectOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async fillForm(data: { branch?: string; commitSha?: string; commitMessage?: string }) {
    if (data.branch) {
      if (await this.branchSelect.isVisible()) {
        await this.branchSelect.click();
        await this.page.getByRole("option", { name: data.branch }).click();
      } else {
        await this.branchInput.fill(data.branch);
      }
    }
    if (data.commitSha) {
      await this.commitShaInput.fill(data.commitSha);
    }
    if (data.commitMessage) {
      await this.commitMessageInput.fill(data.commitMessage);
    }
  }

  async submit() {
    await this.deployButton.scrollIntoViewIfNeeded();
    await this.deployButton.click();
  }

  async cancel() {
    await this.cancelButton.scrollIntoViewIfNeeded();
    await this.cancelButton.click();
  }
}

/**
 * Deployment Detail Page
 */
export class DeploymentDetailPage extends SitesBasePage {
  readonly heading: Locator;
  readonly statusBadge: Locator;
  readonly logsViewer: Locator;
  readonly cancelButton: Locator;
  readonly promoteButton: Locator;
  readonly rollbackButton: Locator;

  // Deployment info
  readonly versionLabel: Locator;
  readonly branchLabel: Locator;
  readonly commitShaLabel: Locator;
  readonly slotLabel: Locator;
  readonly durationLabel: Locator;

  // Log controls
  readonly autoScrollToggle: Locator;
  readonly downloadLogsButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator("h1");
    this.statusBadge = page.locator('[data-testid="deployment-status"]').or(page.locator(".deployment-status-badge"));
    this.logsViewer = page.locator('[data-testid="logs-viewer"]').or(page.locator(".logs-viewer"));
    this.cancelButton = page.getByRole("button", { name: /Cancel Deployment/i });
    this.promoteButton = page.getByRole("button", { name: /Promote/i });
    this.rollbackButton = page.getByRole("button", { name: /Rollback/i });

    this.versionLabel = page.getByText(/Version/i).locator("..");
    this.branchLabel = page.getByText(/Branch/i).locator("..");
    this.commitShaLabel = page.getByText(/Commit/i).locator("..");
    this.slotLabel = page.getByText(/Slot/i).locator("..");
    this.durationLabel = page.getByText(/Duration/i).locator("..");

    this.autoScrollToggle = page.getByRole("checkbox", { name: /Auto.?scroll/i });
    this.downloadLogsButton = page.getByRole("button", { name: /Download Logs/i });
  }

  async goto(siteId: string, deploymentId: string) {
    await this.page.goto(`/sites/${siteId}/deployments/${deploymentId}`);
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async expectStatus(status: string) {
    await expect(this.statusBadge).toContainText(status, { ignoreCase: true });
  }

  async expectLogs(text: string) {
    await expect(this.logsViewer).toContainText(text);
  }

  async clickCancel() {
    await this.cancelButton.click();
  }

  async clickPromote() {
    await this.promoteButton.click();
  }

  async clickRollback() {
    await this.rollbackButton.click();
  }

  async toggleAutoScroll() {
    await this.autoScrollToggle.click();
  }
}

/**
 * Site Settings Page / Tab
 */
export class SiteSettingsPage extends SitesBasePage {
  readonly heading: Locator;

  // General settings
  readonly nameInput: Locator;
  readonly slugInput: Locator;
  readonly statusSelect: Locator;

  // Build settings
  readonly buildCommandInput: Locator;
  readonly installCommandInput: Locator;
  readonly outputDirectoryInput: Locator;
  readonly nodeVersionSelect: Locator;
  readonly buildFlagsInput: Locator;

  // Runtime settings
  readonly memoryInput: Locator;
  readonly cpuInput: Locator;
  readonly timeoutInput: Locator;
  readonly concurrencyInput: Locator;
  readonly coldStartToggle: Locator;

  // Environment variables
  readonly envVarsSection: Locator;
  readonly addEnvVarButton: Locator;
  readonly envKeyInputs: Locator;
  readonly envValueInputs: Locator;

  // Danger zone
  readonly deleteButton: Locator;
  readonly disableButton: Locator;

  // Save button
  readonly saveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: /Site Settings|Settings/i });

    this.nameInput = page.getByLabel(/^Name$/i);
    this.slugInput = page.getByLabel(/Slug/i);
    this.statusSelect = page.getByRole("combobox", { name: /Status/i });

    this.buildCommandInput = page.getByLabel(/Build Command/i);
    this.installCommandInput = page.getByLabel(/Install Command/i);
    this.outputDirectoryInput = page.getByLabel(/Output Directory/i);
    this.nodeVersionSelect = page.getByRole("combobox", { name: /Node Version/i });
    this.buildFlagsInput = page.getByLabel(/Build Flags/i);

    this.memoryInput = page.getByLabel(/Memory/i);
    this.cpuInput = page.getByLabel(/CPU/i);
    this.timeoutInput = page.getByLabel(/Timeout/i);
    this.concurrencyInput = page.getByLabel(/Concurrency/i);
    this.coldStartToggle = page.getByRole("switch", { name: /Cold Start/i });

    this.envVarsSection = page.getByText(/Environment Variables/i).locator("..");
    this.addEnvVarButton = page.getByRole("button", { name: /Add.*Variable/i });
    this.envKeyInputs = page.locator('[data-testid="env-key"]').or(page.locator("input[name*='key']"));
    this.envValueInputs = page.locator('[data-testid="env-value"]').or(page.locator("input[name*='value']"));

    this.deleteButton = page.getByRole("button", { name: /Delete Site/i });
    this.disableButton = page.getByRole("button", { name: /Disable Site/i });

    this.saveButton = page.getByRole("button", { name: /Save|Update/i });
  }

  async goto(siteId: string) {
    await this.page.goto(`/sites/${siteId}/settings`);
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async updateBuildSettings(settings: {
    buildCommand?: string;
    installCommand?: string;
    outputDirectory?: string;
    nodeVersion?: string;
  }) {
    if (settings.buildCommand) {
      await this.buildCommandInput.clear();
      await this.buildCommandInput.fill(settings.buildCommand);
    }
    if (settings.installCommand) {
      await this.installCommandInput.clear();
      await this.installCommandInput.fill(settings.installCommand);
    }
    if (settings.outputDirectory) {
      await this.outputDirectoryInput.clear();
      await this.outputDirectoryInput.fill(settings.outputDirectory);
    }
    if (settings.nodeVersion) {
      await this.nodeVersionSelect.click();
      await this.page.getByRole("option", { name: settings.nodeVersion }).click();
    }
  }

  async updateRuntimeSettings(settings: {
    memoryMb?: number;
    cpu?: string;
    timeoutSeconds?: number;
    maxConcurrency?: number;
    coldStartEnabled?: boolean;
  }) {
    if (settings.memoryMb) {
      await this.memoryInput.clear();
      await this.memoryInput.fill(settings.memoryMb.toString());
    }
    if (settings.cpu) {
      await this.cpuInput.clear();
      await this.cpuInput.fill(settings.cpu);
    }
    if (settings.timeoutSeconds) {
      await this.timeoutInput.clear();
      await this.timeoutInput.fill(settings.timeoutSeconds.toString());
    }
    if (settings.maxConcurrency) {
      await this.concurrencyInput.clear();
      await this.concurrencyInput.fill(settings.maxConcurrency.toString());
    }
    if (settings.coldStartEnabled !== undefined) {
      const isChecked = await this.coldStartToggle.isChecked();
      if (isChecked !== settings.coldStartEnabled) {
        await this.coldStartToggle.click();
      }
    }
  }

  async addEnvironmentVariable(key: string, value: string) {
    await this.addEnvVarButton.click();
    const lastKeyInput = this.envKeyInputs.last();
    const lastValueInput = this.envValueInputs.last();
    await lastKeyInput.fill(key);
    await lastValueInput.fill(value);
  }

  async save() {
    await this.saveButton.click();
  }

  async clickDelete() {
    await this.deleteButton.click();
  }
}

/**
 * GitHub Connection Tab/Section
 */
export class GitHubConnectionSection extends SitesBasePage {
  readonly section: Locator;
  readonly connectButton: Locator;
  readonly disconnectButton: Locator;
  readonly syncButton: Locator;

  // Connection info
  readonly repoName: Locator;
  readonly productionBranch: Locator;
  readonly autoDeployToggle: Locator;
  readonly previewBranchesInput: Locator;

  // Branch selector
  readonly branchSelector: Locator;

  // Last sync info
  readonly lastSyncLabel: Locator;
  readonly lastCommitLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.section = page.locator('[data-testid="github-section"]').or(page.getByText(/GitHub Integration/i).locator(".."));
    this.connectButton = page.getByRole("button", { name: /Connect.*GitHub|Install GitHub App/i });
    this.disconnectButton = page.getByRole("button", { name: /Disconnect/i });
    this.syncButton = page.getByRole("button", { name: /Sync|Refresh/i });

    this.repoName = page.locator('[data-testid="repo-name"]').or(page.getByText(/Repository/i).locator(".."));
    this.productionBranch = page.getByRole("combobox", { name: /Production Branch/i });
    this.autoDeployToggle = page.getByRole("switch", { name: /Auto.?Deploy/i });
    this.previewBranchesInput = page.getByLabel(/Preview Branches/i);

    this.branchSelector = page.getByRole("combobox", { name: /Branch/i });

    this.lastSyncLabel = page.getByText(/Last Sync/i).locator("..");
    this.lastCommitLabel = page.getByText(/Latest Commit/i).locator("..");
  }

  async expectConnected() {
    await expect(this.disconnectButton).toBeVisible();
  }

  async expectNotConnected() {
    await expect(this.connectButton).toBeVisible();
  }

  async clickConnect() {
    await this.connectButton.click();
  }

  async clickDisconnect() {
    await this.disconnectButton.click();
  }

  async clickSync() {
    await this.syncButton.click();
  }

  async setProductionBranch(branch: string) {
    await this.productionBranch.click();
    await this.page.getByRole("option", { name: branch }).click();
  }

  async toggleAutoDeploy() {
    await this.autoDeployToggle.click();
  }
}

/**
 * Site Analytics Tab/Page
 */
export class SiteAnalyticsSection extends SitesBasePage {
  readonly section: Locator;

  // Summary stats
  readonly pageViewsCard: Locator;
  readonly visitorsCard: Locator;
  readonly avgResponseTimeCard: Locator;
  readonly errorRateCard: Locator;

  // Charts
  readonly visitorsChart: Locator;
  readonly performanceChart: Locator;

  // Breakdowns
  readonly geographySection: Locator;
  readonly referrersSection: Locator;
  readonly topPagesSection: Locator;
  readonly devicesSection: Locator;
  readonly browsersSection: Locator;

  // Date range
  readonly dateRangeSelector: Locator;
  readonly startDateInput: Locator;
  readonly endDateInput: Locator;

  // Interval
  readonly intervalSelector: Locator;

  constructor(page: Page) {
    super(page);
    this.section = page.locator('[data-testid="analytics-section"]').or(page.getByText(/Analytics/i).locator(".."));

    this.pageViewsCard = page.getByText(/Page Views/i).locator("..");
    this.visitorsCard = page.getByText(/Unique Visitors/i).locator("..");
    this.avgResponseTimeCard = page.getByText(/Avg Response Time/i).locator("..");
    this.errorRateCard = page.getByText(/Error Rate/i).locator("..");

    this.visitorsChart = page.locator('[data-testid="visitors-chart"]').or(page.locator(".visitors-chart"));
    this.performanceChart = page.locator('[data-testid="performance-chart"]').or(page.locator(".performance-chart"));

    this.geographySection = page.getByText(/Geography|Countries/i).locator("..");
    this.referrersSection = page.getByText(/Referrers|Traffic Sources/i).locator("..");
    this.topPagesSection = page.getByText(/Top Pages/i).locator("..");
    this.devicesSection = page.getByText(/Devices/i).locator("..");
    this.browsersSection = page.getByText(/Browsers/i).locator("..");

    this.dateRangeSelector = page.getByRole("combobox", { name: /Date Range|Period/i });
    this.startDateInput = page.getByLabel(/Start Date/i);
    this.endDateInput = page.getByLabel(/End Date/i);

    this.intervalSelector = page.getByRole("combobox", { name: /Interval/i });
  }

  async selectDateRange(range: "24h" | "7d" | "30d" | "custom") {
    await this.dateRangeSelector.click();
    const rangeName = {
      "24h": /24 Hours|Last Day/i,
      "7d": /7 Days|Last Week/i,
      "30d": /30 Days|Last Month/i,
      "custom": /Custom/i,
    }[range];
    await this.page.getByRole("option", { name: rangeName }).click();
  }

  async selectInterval(interval: "1m" | "5m" | "1h" | "1d") {
    await this.intervalSelector.click();
    await this.page.getByRole("option", { name: interval }).click();
  }

  async expectPageViews(count: number | string) {
    await expect(this.pageViewsCard).toContainText(count.toString());
  }

  async expectVisitors(count: number | string) {
    await expect(this.visitorsCard).toContainText(count.toString());
  }
}

/**
 * Delete Site Confirmation Dialog
 */
export class DeleteSiteDialog extends SitesBasePage {
  readonly dialog: Locator;
  readonly confirmInput: Locator;
  readonly deleteButton: Locator;
  readonly cancelButton: Locator;
  readonly warningText: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole("dialog");
    this.confirmInput = page.getByPlaceholder(/Type.*to confirm/i);
    this.deleteButton = page.getByRole("button", { name: /Delete|Confirm Delete/i });
    this.cancelButton = page.getByRole("button", { name: "Cancel" });
    this.warningText = page.getByText(/This action cannot be undone|permanently delete/i);
  }

  async expectOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async confirmDeletion(siteName: string) {
    await this.confirmInput.fill(siteName);
  }

  async submit() {
    await this.deleteButton.click();
  }

  async cancel() {
    await this.cancelButton.click();
  }
}

/**
 * Sidebar with Sites link
 */
export class SitesSidebar extends SitesBasePage {
  readonly sitesLink: Locator;

  constructor(page: Page) {
    super(page);
    this.sitesLink = page.getByRole("link", { name: "Sites" });
  }

  async navigateToSites() {
    await this.sitesLink.click();
  }

  async expectSitesLinkVisible() {
    await expect(this.sitesLink).toBeVisible();
  }

  async expectSitesLinkNotVisible() {
    await expect(this.sitesLink).not.toBeVisible();
  }
}
