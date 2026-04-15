import { test, expect } from "@playwright/test";

test.describe("Admin Dashboard", () => {
  test("loads dashboard with stats", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.locator("text=Dashboard").first()).toBeVisible();
  });
});
