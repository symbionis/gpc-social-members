import { test, expect } from "@playwright/test";

test.describe("Admin Users", () => {
  test("loads admin users page", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/users/);
  });
});
