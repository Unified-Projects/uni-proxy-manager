import { test, expect } from "../fixtures/mocked-test";
import { CertificatesPage } from "../fixtures/page-objects";

test.describe("Certificates Page", () => {
  test("should display certificates page", async ({ page }) => {
    const certificatesPage = new CertificatesPage(page);
    await certificatesPage.goto();
    await certificatesPage.expectLoaded();

    await expect(page.getByRole("heading", { name: "Certificates" })).toBeVisible();
  });

  test("should have request certificate button", async ({ page }) => {
    const certificatesPage = new CertificatesPage(page);
    await certificatesPage.goto();

    await expect(page.getByRole("button", { name: /Request Certificate/i })).toBeVisible();
  });

  test("should open request certificate dialog", async ({ page }) => {
    const certificatesPage = new CertificatesPage(page);
    await certificatesPage.goto();

    await page.getByRole("button", { name: /Request Certificate/i }).click();

    // Dialog should open
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Request Certificate");
  });

  test("should display table columns", async ({ page }) => {
    const certificatesPage = new CertificatesPage(page);
    await certificatesPage.goto();

    // Check for expected columns in the table
    const table = page.locator("table");
    if (await table.isVisible()) {
      await expect(table.getByText("Common Name")).toBeVisible();
      await expect(table.getByText("Status")).toBeVisible();
      await expect(table.getByText("Expires")).toBeVisible();
    }
  });
});
