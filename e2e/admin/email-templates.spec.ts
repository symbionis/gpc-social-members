import { test, expect } from "@playwright/test";

test.describe("Admin Email Templates", () => {
  test("loads email templates page", async ({ page }) => {
    await page.goto("/admin/email-templates");
    await expect(page).toHaveURL(/\/admin\/email-templates/);
  });
});
