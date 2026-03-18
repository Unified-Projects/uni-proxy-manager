import { type Page, type Locator, expect } from "./mocked-test";

/**
 * Base page object with common functionality
 */
export class BasePage {
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
 * Dashboard page object
 */
export class DashboardPage extends BasePage {
  readonly heading: Locator;
  readonly domainCard: Locator;
  readonly certificatesCard: Locator;
  readonly backendsCard: Locator;
  readonly maintenanceCard: Locator;
  readonly haproxyStatus: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Dashboard" });
    this.domainCard = page.getByRole("heading", { name: "Domains" }).locator("..");
    this.certificatesCard = page.getByRole("heading", { name: "Certificates" }).locator("..");
    this.backendsCard = page.getByRole("heading", { name: "Backends" }).locator("..");
    this.maintenanceCard = page.getByRole("heading", { name: "Maintenance" }).locator("..");
    this.haproxyStatus = page.getByRole("heading", { name: "HAProxy Status" }).locator("..");
  }

  async goto() {
    await this.page.goto("/");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }
}

/**
 * Domains page object
 */
export class DomainsPage extends BasePage {
  readonly heading: Locator;
  readonly addDomainButton: Locator;
  readonly domainsTable: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Domains" });
    this.addDomainButton = page.getByRole("button", { name: /Add Domain/i });
    this.domainsTable = page.locator("table");
    this.searchInput = page.getByPlaceholder("Search domains...");
  }

  async goto() {
    await this.page.goto("/domains");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
    await expect(this.addDomainButton).toBeVisible();
  }

  async clickAddDomain() {
    await this.addDomainButton.click();
  }

  async searchDomains(query: string) {
    await this.searchInput.fill(query);
  }

  async expectDomainInTable(hostname: string) {
    await expect(this.domainsTable.getByText(hostname)).toBeVisible();
  }
}

/**
 * Create Domain Dialog
 */
export class CreateDomainDialog extends BasePage {
  readonly dialog: Locator;
  readonly hostnameInput: Locator;
  readonly displayNameInput: Locator;
  readonly sslEnabledSwitch: Locator;
  readonly forceHttpsSwitch: Locator;
  readonly createButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole("dialog");
    this.hostnameInput = page.getByLabel("Hostname");
    this.displayNameInput = page.getByLabel("Display Name");
    this.sslEnabledSwitch = page.getByLabel("Enable SSL");
    this.forceHttpsSwitch = page.getByLabel("Force HTTPS");
    this.createButton = page.getByRole("button", { name: /Create Domain/i });
    this.cancelButton = page.getByRole("button", { name: "Cancel" });
  }

  async expectOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async fillForm(data: { hostname: string; displayName?: string; sslEnabled?: boolean; forceHttps?: boolean }) {
    await this.hostnameInput.fill(data.hostname);
    if (data.displayName) {
      await this.displayNameInput.fill(data.displayName);
    }
    // Toggle switches if needed
    if (data.sslEnabled !== undefined) {
      const isChecked = await this.sslEnabledSwitch.isChecked();
      if (isChecked !== data.sslEnabled) {
        await this.sslEnabledSwitch.click();
      }
    }
    if (data.forceHttps !== undefined) {
      const isChecked = await this.forceHttpsSwitch.isChecked();
      if (isChecked !== data.forceHttps) {
        await this.forceHttpsSwitch.click();
      }
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
 * Certificates page object
 */
export class CertificatesPage extends BasePage {
  readonly heading: Locator;
  readonly requestCertButton: Locator;
  readonly certificatesTable: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Certificates" });
    this.requestCertButton = page.getByRole("button", { name: /Request Certificate/i });
    this.certificatesTable = page.locator("table");
  }

  async goto() {
    await this.page.goto("/certificates");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }
}

/**
 * DNS Providers page object
 */
export class DnsProvidersPage extends BasePage {
  readonly heading: Locator;
  readonly addProviderButton: Locator;
  readonly providersTable: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "DNS Providers" });
    this.addProviderButton = page.getByRole("button", { name: /Add Provider/i });
    this.providersTable = page.locator("table");
  }

  async goto() {
    await this.page.goto("/dns-providers");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }
}

/**
 * Error Pages page object
 */
export class ErrorPagesPage extends BasePage {
  readonly heading: Locator;
  readonly createErrorPageButton: Locator;
  readonly errorPagesGrid: Locator;
  readonly errorPageCards: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Error Pages" });
    this.createErrorPageButton = page.getByRole("button", { name: /Create Error Page/i });
    this.errorPagesGrid = page.locator('[data-testid="error-pages-grid"]').or(page.locator(".error-pages-grid"));
    this.errorPageCards = page.locator('[data-testid="error-page-card"]').or(page.locator(".error-page-card"));
  }

  async goto() {
    await this.page.goto("/error-pages");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async clickCreateErrorPage() {
    await this.createErrorPageButton.click();
  }

  async expectErrorPageCard(name: string) {
    await expect(this.page.getByText(name)).toBeVisible();
  }
}

/**
 * Maintenance Pages page object
 */
export class MaintenancePagesPage extends BasePage {
  readonly heading: Locator;
  readonly createMaintenancePageButton: Locator;
  readonly maintenancePagesGrid: Locator;
  readonly maintenancePageCards: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: /Maintenance Pages/i });
    this.createMaintenancePageButton = page.getByRole("button", { name: /Create Maintenance Page/i });
    this.maintenancePagesGrid = page.locator('[data-testid="maintenance-pages-grid"]').or(page.locator(".maintenance-pages-grid"));
    this.maintenancePageCards = page.locator('[data-testid="maintenance-page-card"]').or(page.locator(".maintenance-page-card"));
  }

  async goto() {
    await this.page.goto("/maintenance-pages");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async clickCreateMaintenancePage() {
    await this.createMaintenancePageButton.click();
  }

  async expectMaintenancePageCard(name: string) {
    await expect(this.page.getByText(name)).toBeVisible();
  }
}

/**
 * Maintenance page object
 */
export class MaintenancePage extends BasePage {
  readonly heading: Locator;
  readonly scheduleButton: Locator;
  readonly domainsTable: Locator;
  readonly windowsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Maintenance" });
    this.scheduleButton = page.getByRole("button", { name: /Schedule Maintenance/i });
    this.domainsTable = page.locator("table").first();
    this.windowsTable = page.locator("table").last();
  }

  async goto() {
    await this.page.goto("/maintenance");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }
}

/**
 * Settings page object
 */
export class SettingsPage extends BasePage {
  readonly heading: Locator;
  readonly haproxyTab: Locator;
  readonly systemTab: Locator;
  readonly exportImportTab: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Settings" });
    this.haproxyTab = page.getByRole("tab", { name: "HAProxy" });
    this.systemTab = page.getByRole("tab", { name: "System" });
    this.exportImportTab = page.getByRole("tab", { name: "Export / Import" });
  }

  async goto() {
    await this.page.goto("/settings");
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async switchToTab(tab: "haproxy" | "system" | "export-import") {
    switch (tab) {
      case "haproxy":
        await this.haproxyTab.click();
        break;
      case "system":
        await this.systemTab.click();
        break;
      case "export-import":
        await this.exportImportTab.click();
        break;
    }
  }
}

/**
 * Sidebar navigation
 */
export class Sidebar extends BasePage {
  readonly dashboardLink: Locator;
  readonly domainsLink: Locator;
  readonly certificatesLink: Locator;
  readonly dnsProvidersLink: Locator;
  readonly errorPagesLink: Locator;
  readonly maintenancePagesLink: Locator;
  readonly maintenanceModeLink: Locator;
  readonly settingsLink: Locator;

  constructor(page: Page) {
    super(page);
    this.dashboardLink = page.getByRole("link", { name: "Dashboard" });
    this.domainsLink = page.getByRole("link", { name: "Domains" });
    this.certificatesLink = page.getByRole("link", { name: "Certificates" });
    this.dnsProvidersLink = page.getByRole("link", { name: "DNS Providers" });
    this.errorPagesLink = page.getByRole("link", { name: "Error Pages" });
    this.maintenancePagesLink = page.getByRole("link", { name: "Maintenance Pages" });
    this.maintenanceModeLink = page.getByRole("link", { name: "Maintenance Mode" });
    this.settingsLink = page.getByRole("link", { name: "Settings" });
  }

  async navigateToDashboard() {
    await this.dashboardLink.click();
  }

  async navigateToDomains() {
    await this.domainsLink.click();
  }

  async navigateToCertificates() {
    await this.certificatesLink.click();
  }

  async navigateToDnsProviders() {
    await this.dnsProvidersLink.click();
  }

  async navigateToErrorPages() {
    await this.errorPagesLink.click();
  }

  async navigateToMaintenancePages() {
    await this.maintenancePagesLink.click();
  }

  async navigateToMaintenanceMode() {
    await this.maintenanceModeLink.click();
  }

  async navigateToSettings() {
    await this.settingsLink.click();
  }
}
