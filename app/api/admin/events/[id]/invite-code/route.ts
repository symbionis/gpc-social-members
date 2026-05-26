import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteCode } from "@/lib/events/registration";

// Sole writer of events.invite_code and events.invite_price (single-writer
// ownership — see docs/solutions/architecture-patterns/single-writer-field-
// ownership-across-routes.md). The bulk update route and the settings PATCH
// route must never write these columns.
//
//   POST  → generate/regenerate the invite code (regenerate = revoke; the old
//           code stops validating immediately since it is overwritten).
//   PATCH → set or clear the guest invite_price.
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
    !["super_admin", "team_admin", "events_admin"].includes(admins[0].role)
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  let body: { invite_price?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!("invite_price" in body)) {
    return NextResponse.json({ error: "invite_price is required" }, { status: 400 });
  }

  let invite_price: number | null;
  const raw = body.invite_price;
  if (raw === null || raw === "") {
    invite_price = null; // clear the guest price
  } else {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "Guest price must be 0 or a positive amount, or blank to clear" },
        { status: 400 }
      );
    }
    invite_price = Number(parsed.toFixed(2));
  }

  const { error } = await adminClient
    .from("events")
    .update({ invite_price })
    .eq("id", eventId);

  if (error) {
    console.error("[admin/events/invite-code] set price failed", { eventId, error });
    return NextResponse.json({ error: "Could not save guest price" }, { status: 500 });
  }

  return NextResponse.json({ invite_price });
}
