import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteCode } from "@/lib/events/registration";

// Sole writer of events.invite_code (single-writer ownership — see
// docs/solutions/architecture-patterns/single-writer-field-ownership-across-routes.md).
// Per-type guest prices (event_ticket_types.invite_price) are owned by the
// ticket-types route, NOT here.
//
//   POST → generate/regenerate the invite code (regenerate = revoke; the old
//          code stops validating immediately since it is overwritten).
//
// assertAdmin mirrors the settings route.
async function assertAdmin() {
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

  if (
    !admins?.[0] ||
    !["super_admin", "team_admin", "events_admin", "finance"].includes(admins[0].role)
  ) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  // Server-generated only — never accept a client-supplied code.
  const invite_code = generateInviteCode();

  const { error } = await adminClient
    .from("events")
    .update({ invite_code })
    .eq("id", eventId);

  if (error) {
    console.error("[admin/events/invite-code] regenerate failed", { eventId, error });
    return NextResponse.json({ error: "Could not regenerate link" }, { status: 500 });
  }

  return NextResponse.json({ invite_code });
}
