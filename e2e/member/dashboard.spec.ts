import { test, expect } from "@playwright/test";

test.describe("Member Dashboard", () => {
  test("loads member dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
