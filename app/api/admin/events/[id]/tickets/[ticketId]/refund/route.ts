import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin action (U14): mark a holder-cancelled ticket as refunded. The refund itself is done
// by hand in Stripe (the roster links out to the PaymentIntent); this only advances the
// per-ticket status 'requested' -> 'refunded' so the roster reflects that the money is back.
// Seat release already happened at request time, so this changes no seat count.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, ticketId } = await params;
  if (!UUID_RE.test(ticketId)) return bad("Invalid ticket", 400);

  // Advance only a 'requested' ticket, scoped to the path event so an admin can't refund
  // another event's ticket through this route. A ticket that is already 'refunded' or was
  // never cancelled updates nothing → handled as a specific status below.
  const { data: updated, error: updErr } = await adminClient
    .from("tickets")
    .update({
      cancellation_status: "refunded",
      cancellation_refunded_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .eq("cancellation_status", "requested")
    .select("id")
    .maybeSingle();
  if (updErr) {
    console.error("[ticket-refund] update failed", { eventId, ticketId, err: updErr });
    return bad("Could not update the ticket. Please try again.", 500);
  }
  if (!updated) {
    // Either already refunded (idempotent no-op) or not a cancelled ticket / wrong event.
    const { data: current } = await adminClient
      .from("tickets")
      .select("cancellation_status")
      .eq("id", ticketId)
      .eq("event_id", eventId)
      .limit(1)
      .maybeSingle();
    if (!current) return bad("Ticket not found", 404);
    if (current.cancellation_status === "refunded") {
      return NextResponse.json({ ok: true, alreadyRefunded: true });
    }
    return bad("Only a cancelled ticket can be marked refunded", 409);
  }

  return NextResponse.json({ ok: true });
}
