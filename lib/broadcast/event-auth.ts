import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Roles allowed to send event messages. Broader than member broadcasts
 *  (super_admin only) because event admins run the Manage Event page. */
const ALLOWED_ROLES = ["events_admin", "super_admin"];

export type RequireEventsAdminResult =
  | { ok: true; admin: { id: string; role: string } }
  | { ok: false; status: 401 | 403 | 404 };

/**
 * Gate for the event message routes: resolve the session, confirm the caller is
 * an events_admin or super_admin, and verify the target event exists.
 *
 * The existence check bounds the cross-event blast radius — an events_admin
 * cannot resolve-and-send against an arbitrary or non-existent event id; an
 * unknown id 404s before any audience is resolved. Per-admin event ownership is
 * intentionally not modeled (see plan Open Questions).
 */
export async function requireEventsAdmin(
  eventId: string
): Promise<RequireEventsAdminResult> {
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
  if (!admin || !ALLOWED_ROLES.includes(admin.role)) {
    return { ok: false, status: 403 };
  }

  const { data: event } = await adminClient
    .from("events")
    .select("id")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  if (!event) return { ok: false, status: 404 };

  return { ok: true, admin };
}
