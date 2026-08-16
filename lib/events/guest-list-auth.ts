// The generic admin gate (`assertAdmin`) and error helper (`bad`) shared by three route
// files: the guest-lists route (app/api/admin/events/[id]/guest-lists/route.ts, U5) and the
// two waitlist routes — none guest-list-specific despite the filename, which predates the
// comp-era feature this module originally served exclusively (its own guest-list IDOR guard,
// `assertGuestListOnEvent`, was retired with comp — see lib/events/guest-lists.ts's own
// `resolveGuestListOnEvent` for the new model's equivalent).
//
// Cannot live in any one caller's route.ts: a Next.js App Router route file may export only
// its HTTP handlers, and a stray helper export passes `tsc --noEmit` while failing the
// PRODUCTION build. See
// docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

export async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Unauthorized", status: 401 as const };

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || !admin.id || !ALLOWED_ROLES.includes(admin.role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient, adminId: admin.id as string };
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
