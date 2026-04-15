import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const TEST_EMAIL = "test@syks.co";

/**
 * Auth setup for test@syks.co:
 *
 * Uses Supabase Admin API to generate a magic link token (no email sent),
 * then visits the token URL to exchange it for a session cookie.
 *
 * The middleware only checks for a valid Supabase user — role checks happen
 * at page/API level. So we authenticate once and save two copies of the
 * storage state (admin + member) from the same session.
 *
 * Prerequisites:
 * - test@syks.co must exist in admin_users (for admin routes)
 * - test@syks.co must exist in members with status=active (for member routes)
 */
setup("authenticate test@syks.co", async ({ page, baseURL }) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
  });

  if (error || !data?.properties?.hashed_token) {
    throw new Error(`Failed to generate magic link: ${error?.message || "no token"}`);
  }

  // Use /auth/member-confirm to exchange token for session
  const confirmUrl =
    `${baseURL}/auth/member-confirm?token_hash=${data.properties.hashed_token}&type=magiclink`;

  await page.goto(confirmUrl);

  // Wait for redirect to complete (either /dashboard or /admin/dashboard)
  await page.waitForURL(/(dashboard|admin\/dashboard)/, { timeout: 15000 });

  // Save the same authenticated session for both admin and member test projects
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
  await page.context().storageState({ path: "e2e/.auth/member.json" });
});
