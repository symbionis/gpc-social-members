import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Auth accounts for the e2e projects. Configurable via env so a developer can
// point the suite at their own seeded accounts without editing this file:
//   E2E_ADMIN_EMAIL  → admin project session (must be in admin_users)
//   E2E_MEMBER_EMAIL → member project session (must be in members, active)
// Both default to test@syks.co (the legacy single-account behaviour).
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "test@syks.co";
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "test@syks.co";

/**
 * Exchanges a Supabase magic-link token (generated via the Admin API, no email
 * sent) for a session cookie, then saves the storage state. /auth/member-confirm
 * routes a member to /dashboard and an admin-only account to /admin/dashboard;
 * either satisfies the wait below.
 */
setup("authenticate e2e accounts", async ({ page, baseURL }) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  async function authAs(email: string, statePath: string) {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error || !data?.properties?.hashed_token) {
      throw new Error(`Failed to generate magic link for ${email}: ${error?.message || "no token"}`);
    }
    await page.goto(
      `${baseURL}/auth/member-confirm?token_hash=${data.properties.hashed_token}&type=magiclink`
    );
    await page.waitForURL(/(dashboard|admin\/dashboard)/, { timeout: 15000 });
    await page.context().storageState({ path: statePath });
  }

  // Admin first, then member — the second confirm replaces the session cookie,
  // so admin.json is captured before the member login overwrites it.
  await authAs(ADMIN_EMAIL, "e2e/.auth/admin.json");
  if (MEMBER_EMAIL !== ADMIN_EMAIL) {
    await authAs(MEMBER_EMAIL, "e2e/.auth/member.json");
  } else {
    await page.context().storageState({ path: "e2e/.auth/member.json" });
  }
});
