// The admin gate shared by both comp guest-list routes (U2 of
// docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md).
//
// It cannot live in either route.ts: a Next.js App Router route file may export only its
// HTTP handlers, and a stray helper export passes `tsc --noEmit` while failing the
// PRODUCTION build. See
// docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md
//
// It cannot live in lib/events/guest-list.ts either, even though that module houses the
// rest of this feature's shared helpers: guest-list.ts is imported by
// components/admin/GuestList.tsx (a "use client" component, for parseGuestNames), and
// assertAdmin reaches for @/lib/supabase/server — which imports next/headers. Putting the
// two in one module would drag next/headers into the client bundle. Hence this sibling.

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
