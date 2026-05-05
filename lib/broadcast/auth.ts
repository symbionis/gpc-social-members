import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type RequireSuperAdminResult =
  | { ok: true; admin: { id: string; role: string } }
  | { ok: false; status: 401 | 403 };

/**
 * Resolve the current Supabase session and confirm the user is a
 * super_admin in the `admin_users` table. Used by every broadcast admin
 * route (send, preview, drafts) so the check lives in one place.
 */
export async function requireSuperAdmin(): Promise<RequireSuperAdminResult> {
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
  if (!admin || admin.role !== "super_admin") {
    return { ok: false, status: 403 };
  }
  return { ok: true, admin };
}
