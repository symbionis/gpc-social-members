import { test, expect } from "@playwright/test";

test.describe("Member Profile", () => {
  test("loads profile page", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/profile/);
  });
});
