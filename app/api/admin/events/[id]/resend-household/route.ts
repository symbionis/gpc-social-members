import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resendHouseholdForAddress } from "@/lib/email/household-tickets";

// Admin action (U15): resend the grouped ticket email to ONE address on the on-screen
// roster. The interactive roster groups every sold ticket by lowercased email; each address
// card's Resend posts that address here, and the household QR email (all the QRs at that
// address, buyer's own included) goes out again. This is per-ADDRESS, unlike the per-BOOKING
// resend-confirmation route (which re-sends the buyer's receipt + confirmation).

const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

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

  const admin = admins?.[0];
  if (!admin || !admin.id || !ALLOWED_ROLES.includes(admin.role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return bad("email is required");

  // Scope the event to a real row so the resend can't be aimed at an arbitrary id (the
  // resend helper is event-scoped, but a 404 here is a clearer signal than an empty group).
  const { data: event, error: eventErr } = await adminClient
    .from("events")
    .select("id")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  if (eventErr) {
    console.error("[resend-household] event lookup failed", { eventId, err: eventErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!event) return bad("Event not found", 404);

  let result: { found: boolean; sent: boolean };
  try {
    result = await resendHouseholdForAddress(eventId, email);
  } catch (err) {
    console.error("[resend-household] resend threw", { eventId, err });
    return bad("Could not send the email. Please try again.", 502);
  }

  if (!result.found) {
    return bad("No tickets found at that address for this event", 404);
  }
  if (!result.sent) {
    return bad("Could not send the email. Please try again.", 502);
  }

  return NextResponse.json({ success: true, email });
}
