import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // Verify user is admin
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  // Mirrors who can reach the Members pages (see app/(admin)/layout.tsx):
  // events_admin is confined to events/lounge and originator to its own referrals,
  // so neither has a members UI and neither should hold the write API. This
  // previously selected `role` and never read it, leaving the route open to any
  // admin row — including roles with no page-level members access at all.
  if (
    !admins?.[0] ||
    !["super_admin", "team_admin", "finance"].includes(admins[0].role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, status, tier_id } = await request.json();

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (tier_id) updates.tier_id = tier_id;

  const { error } = await adminClient
    .from("members")
    .update(updates)
    .eq("id", member_id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
