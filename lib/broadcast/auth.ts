import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type RequireSuperAdminResult =
  | { ok: true; admin: { id: string; role: string } }
  | { ok: false; status: 401 | 403 };

/**
 * Resolve the current Supabase session and confirm the user holds one of the
 * allowed roles in the `admin_users` table. Shared by the strict super-admin
 * guard and the broadcast guard so the session lookup lives in one place.
 */
async function requireAdminRole(
  allowedRoles: readonly string[]
): Promise<RequireSuperAdminResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, status: 401 };

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || !allowedRoles.includes(admin.role)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, admin };
}

/**
 * Confirm the current user is a super_admin. Reserved for the most sensitive
 * settings (email settings, email templates) that team admins must not touch.
 */
export async function requireSuperAdmin(): Promise<RequireSuperAdminResult> {
  return requireAdminRole(["super_admin"]);
}

/**
 * Confirm the current user may manage member broadcasts. Allows super_admin
 * and team_admin. Used by every broadcast admin route (send, preview, drafts).
 */
export async function requireBroadcastAdmin(): Promise<RequireSuperAdminResult> {
  return requireAdminRole(["super_admin", "team_admin"]);
}
