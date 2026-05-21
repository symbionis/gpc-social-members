import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSeatsUsed } from "@/lib/events/seat-usage";

// Admin endpoint for editing a single registration. Currently the ticket count
// (quantity) only. assertAdmin mirrors the shape used by the attendees route.
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

  if (!admins?.[0] || !["super_admin", "team_admin", "events_admin"].includes(admins[0].role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Changing the ticket count is a pure seat adjustment: only `quantity` moves.
// The recorded amount (total_amount_chf / unit_amount_chf) is left untouched —
// no Stripe charge or refund — so the figure stays faithful to what was
// actually paid and any added seats are effectively comped. This mirrors the
// always-free waitlist-to-registration conversion on paid events. Charging /
// refunding the delta on paid events is deferred (Notion backlog).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; registrationId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;

  const { id: eventId, registrationId } = await params;

  let body: { quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const quantity =
    typeof body.quantity === "number"
      ? body.quantity
      : Number.parseInt(String(body.quantity ?? ""), 10);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
    return bad("quantity must be an integer between 1 and 6");
  }

  // Load the registration scoped to the event (IDOR guard) and confirm it is a
  // confirmed (paid/free) row — pending checkouts are mid-Stripe and must not
  // be hand-edited.
  const { data: registration } = await adminClient
    .from("event_registrations")
    .select("id, status")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (!registration) return bad("Registration not found", 404);
  if (!["paid", "free"].includes(registration.status)) {
    return bad("Only confirmed registrations can be edited", 409);
  }

  const { error: updateErr } = await adminClient
    .from("event_registrations")
    .update({ quantity })
    .eq("id", registrationId)
    .eq("event_id", eventId);

  if (updateErr) {
    console.error("[registration-edit] update failed", {
      eventId,
      registrationId,
      quantity,
      err: updateErr,
    });
    return bad("Could not update the ticket count", 500);
  }

  // Return the true post-edit seat usage (RPC, not a client-side sum) so the UI
  // can show the real resulting count regardless of any stale estimate.
  let seatsUsed: number | null = null;
  try {
    seatsUsed = await getSeatsUsed(adminClient, eventId);
  } catch (err) {
    console.error("[registration-edit] seat usage lookup failed", { eventId, err });
  }

  return NextResponse.json({ success: true, quantity, seats_used: seatsUsed });
}
