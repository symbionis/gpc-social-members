import { test, expect } from "@playwright/test";

test.describe("Admin Applications", () => {
  test("loads applications page with tabs", async ({ page }) => {
    await page.goto("/admin/applications");
    await expect(page).toHaveURL(/\/admin\/applications/);
    // Should have status filter tabs
    await expect(page.locator("text=Pending").first()).toBeVisible();
  });
});
