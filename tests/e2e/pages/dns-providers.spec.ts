import { test, expect } from "../fixtures/mocked-test";
import { DnsProvidersPage } from "../fixtures/page-objects";

test.describe("DNS Providers Page", () => {
  test("should display dns providers page", async ({ page }) => {
    const dnsProvidersPage = new DnsProvidersPage(page);
    await dnsProvidersPage.goto();
    await dnsProvidersPage.expectLoaded();

    await expect(page.getByRole("heading", { name: "DNS Providers" })).toBeVisible();
  });

  test("should have add provider button", async ({ page }) => {
    const dnsProvidersPage = new DnsProvidersPage(page);
    await dnsProvidersPage.goto();

    await expect(page.getByRole("button", { name: /Add Provider/i })).toBeVisible();
  });

  test("should open add provider dialog", async ({ page }) => {
    const dnsProvidersPage = new DnsProvidersPage(page);
    await dnsProvidersPage.goto();

    await page.getByRole("button", { name: /Add Provider/i }).click();

    // Dialog should open
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Add DNS Provider");
  });

  test("should show provider type selection", async ({ page }) => {
    const dnsProvidersPage = new DnsProvidersPage(page);
    await dnsProvidersPage.goto();

    await page.getByRole("button", { name: /Add Provider/i }).click();

    // Should have provider type select
    await expect(page.getByLabel("Provider Type")).toBeVisible();
  });

  test("should show cloudflare fields when cloudflare selected", async ({ page }) => {
    const dnsProvidersPage = new DnsProvidersPage(page);
    await dnsProvidersPage.goto();

    await page.getByRole("button", { name: /Add Provider/i }).click();

    // Select Cloudflare
    await page.getByLabel("Provider Type").click();
    await page.getByRole("option", { name: "Cloudflare" }).click();

    // Should show Cloudflare-specific fields
    await expect(page.getByText(/API Token/i)).toBeVisible();
  });
});
