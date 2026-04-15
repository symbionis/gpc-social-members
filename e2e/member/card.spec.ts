import { test, expect } from "@playwright/test";

test.describe("Member Card", () => {
  test("loads digital membership card", async ({ page }) => {
    await page.goto("/card");
    await expect(page).toHaveURL(/\/card/);
  });
});
