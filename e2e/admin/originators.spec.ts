import { test, expect } from "@playwright/test";

test.describe("Admin Originators", () => {
  test("loads originators page", async ({ page }) => {
    await page.goto("/admin/originators");
    await expect(page).toHaveURL(/\/admin\/originators/);
  });
});
