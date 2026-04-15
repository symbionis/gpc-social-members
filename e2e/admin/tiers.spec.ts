import { test, expect } from "@playwright/test";

test.describe("Admin Tiers", () => {
  test("loads tiers page", async ({ page }) => {
    await page.goto("/admin/tiers");
    await expect(page).toHaveURL(/\/admin\/tiers/);
  });
});
