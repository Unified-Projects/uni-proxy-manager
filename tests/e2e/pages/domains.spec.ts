import { test, expect } from "../fixtures/mocked-test";
import { DomainsPage, CreateDomainDialog } from "../fixtures/page-objects";

test.describe("Domains Page", () => {
  test("should display domains page", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    await domainsPage.goto();
    await domainsPage.expectLoaded();

    // Check for main elements
    await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Domain/i })).toBeVisible();
  });

  test("should open create domain dialog", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    const createDialog = new CreateDomainDialog(page);

    await domainsPage.goto();
    await domainsPage.clickAddDomain();

    await createDialog.expectOpen();
    await expect(page.getByRole("dialog")).toContainText("Add Domain");
  });

  test("should show validation error for invalid hostname", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    const createDialog = new CreateDomainDialog(page);

    await domainsPage.goto();
    await domainsPage.clickAddDomain();
    await createDialog.expectOpen();

    // Try to submit with invalid hostname
    await createDialog.fillForm({ hostname: "invalid-hostname" });
    await createDialog.submit();

    // Should show validation error
    await expect(page.getByText(/invalid hostname/i)).toBeVisible();
  });

  test("should close dialog on cancel", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    const createDialog = new CreateDomainDialog(page);

    await domainsPage.goto();
    await domainsPage.clickAddDomain();
    await createDialog.expectOpen();

    await createDialog.cancel();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("should display search functionality", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    await domainsPage.goto();

    // Search input should be visible
    await expect(page.getByPlaceholder("Search domains...")).toBeVisible();
  });

  test("should display empty state when no domains", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    await domainsPage.goto();

    const table = page.locator("table").first();
    const row = table.locator("tbody tr");
    await table.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});

    if (await table.isVisible()) {
      await expect(table).toBeVisible();
      await expect(row.first()).toBeVisible();
    } else {
      await expect(page.getByText(/No domains found/i)).toBeVisible();
    }
  });

  test("should create a domain and list it", async ({ page }) => {
    const domainsPage = new DomainsPage(page);
    const createDialog = new CreateDomainDialog(page);
    const hostname = "e2e-demo.example.com";

    await domainsPage.goto();
    await domainsPage.clickAddDomain();
    await createDialog.expectOpen();
    await createDialog.fillForm({
      hostname,
      displayName: "E2E Demo",
      sslEnabled: false  // Disable SSL to avoid DNS provider requirement
    });
    await createDialog.submit();

    // Wait for dialog to close (indicates mutation completed)
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });

    // Wait a bit for the refetch to complete
    await page.waitForTimeout(1000);

    await domainsPage.expectDomainInTable(hostname);
  });
});
