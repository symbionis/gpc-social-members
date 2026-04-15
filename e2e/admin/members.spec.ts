import { test, expect } from "@playwright/test";

test.describe("Admin Members", () => {
  test("loads members directory", async ({ page }) => {
    await page.goto("/admin/members");
    await expect(page).toHaveURL(/\/admin\/members/);
    await expect(page.locator("text=Members").first()).toBeVisible();
  });
});
