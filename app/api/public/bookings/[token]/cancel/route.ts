import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Holder-requested ticket cancellation (U14). From the manage page a holder may request
// cancellation of any ticket at their address. The request is FINAL on the holder side
// (R22) and frees the seat IMMEDIATELY — seats_used subtracts cancelled seat-counting
// tickets (KTD6), so nothing else has to run here. An admin later marks the refund done.
//
// Auth mirrors the convert route's dual-token model: the path token is EITHER the booking's
// registration manage_token (the lead) OR a per-ticket manage_token (a household member,
// restricted to tickets sharing their email — the set the manage page shows them).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { ticketId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const ticketId =
    typeof body.ticketId === "string" && UUID_RE.test(body.ticketId) ? body.ticketId : "";
  if (!ticketId) return bad("Invalid cancellation request");

  const supabase = createAdminClient();

  // Dual-token resolution (mirrors convert): registration manage_token ⇒ lead (no email
  // restriction); per-ticket manage_token ⇒ household member restricted to their own email.
  interface RegRow {
    id: string;
    status: string;
  }
  let reg: RegRow;
  let householdEmail: string | null = null;
  let selfTicketId: string | null = null;

  const { data: regByToken } = await supabase
    .from("event_registrations")
    .select("id, status")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();
  if (regByToken) {
    reg = regByToken as RegRow;
  } else {
    const { data: self } = await supabase
      .from("tickets")
      .select("id, registration_id, email")
      .eq("manage_token", token)
      .is("released_at", null)
      .limit(1)
      .maybeSingle();
    if (!self || !self.registration_id) return bad("Booking not found", 404);
    selfTicketId = self.id as string;
    const { data: r } = await supabase
      .from("event_registrations")
      .select("id, status")
      .eq("id", self.registration_id as string)
      .limit(1)
      .maybeSingle();
    if (!r) return bad("Booking not found", 404);
    reg = r as RegRow;
    householdEmail = ((self.email as string | null) ?? "").trim().toLowerCase();
  }
  if (reg.status !== "paid" && reg.status !== "free") {
    return bad("This booking isn’t confirmed yet", 409);
  }

  // The ticket must belong to THIS booking and be live. (checked-in and already-cancelled
  // are handled below so the holder gets a specific message rather than a generic 409.)
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, email, slot_status, checked_in_at, released_at, cancellation_status")
    .eq("id", ticketId)
    .eq("registration_id", reg.id)
    .is("released_at", null)
    .in("slot_status", ["issued", "claimed"])
    .limit(1)
    .maybeSingle();
  if (!ticket) return bad("This ticket can’t be cancelled", 409);

  // A household member may only cancel tickets on their own email — the set the manage page
  // shows them. A blank-email household is SOLO (matches only the caller's own ticket).
  if (householdEmail !== null) {
    const targetEmail = ((ticket.email as string | null) ?? "").trim().toLowerCase();
    const sameHousehold =
      householdEmail !== "" ? targetEmail === householdEmail : ticket.id === selfTicketId;
    if (!sameHousehold) return bad("This ticket can’t be cancelled", 409);
  }

  // A checked-in ticket is spent — it can't be cancelled (the seat was consumed).
  if (ticket.checked_in_at !== null) {
    return bad("A checked-in ticket can’t be cancelled", 409);
  }
  // Already cancelled: final and idempotent (R22) — a repeat request is a no-op success and
  // must not free a second seat.
  if (ticket.cancellation_status !== null) {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // Guarded flip: the WHERE re-asserts every precondition atomically, so a check-in landing
  // between the read above and this write can't produce a cancelled+checked-in ticket, and a
  // concurrent double-request frees exactly one seat.
  const { data: updated, error: updErr } = await supabase
    .from("tickets")
    .update({
      cancellation_status: "requested",
      cancellation_requested_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .is("cancellation_status", null)
    .is("checked_in_at", null)
    .is("released_at", null)
    .select("id")
    .maybeSingle();
  if (updErr) {
    console.error("[booking-cancel] cancellation update failed", { ticketId, err: updErr });
    return bad("Could not cancel the ticket. Please try again.", 500);
  }
  if (!updated) {
    // Lost the race to a concurrent check-in or cancel — treat as a no-op success rather than
    // an error (the holder's intent, cancel, is either done or moot).
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  return NextResponse.json({ ok: true });
}
