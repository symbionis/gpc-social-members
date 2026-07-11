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

/** The comp registration a guest-list write targets, once it is proven to be on the event. */
export interface GuestListRegistration {
  id: string;
}

/**
 * The IDOR guard both guest-list writes share, run BEFORE any RPC.
 *
 * Neither add_comp_guests nor remove_comp_guest knows about the path event: each takes the
 * registration id on trust and resolves everything (ticket types, tickets) against the
 * REGISTRATION's own event. So a regId belonging to another event would otherwise write to
 * that other event's list while the route reported the path event's seat count — and the
 * ticket-type error path, which checks the PATH event, would name valid types as unknown.
 *
 * All three must hold before a write: the registration exists, it is on THIS event, and it
 * is a comp guest list. Anything else is a 404 (never a leak of which of the three failed).
 */
export async function assertGuestListOnEvent(
  adminClient: ReturnType<typeof createAdminClient>,
  eventId: string,
  regId: string
): Promise<{ registration: GuestListRegistration } | { error: string; status: number }> {
  const { data, error } = await adminClient
    .from("event_registrations")
    .select("id")
    .eq("id", regId)
    .eq("event_id", eventId)
    .eq("is_guest_list", true)
    .maybeSingle();

  if (error) {
    console.error("[guest-list] registration lookup failed", { eventId, regId, err: error });
    return { error: "Service temporarily unavailable", status: 503 };
  }
  if (!data) return { error: "Guest list not found", status: 404 };
  return { registration: { id: data.id as string } };
}
