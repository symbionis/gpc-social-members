import { NextResponse, type NextRequest } from "next/server";
import { assertAdmin, bad } from "@/lib/events/guest-list-auth";
import { fetchLiveRegistrationsForRedemption, isWaitlistEntryRedeemed } from "@/lib/events/waitlist-offer";

// Admin repair of a single waitlist entry (F4 of
// docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md, U2): correct a
// missing/archived ticket type or an out-of-range quantity so R14's flagged entry
// becomes offerable again, and optionally fix a mistyped email before the entry is
// ever offered.
//
// This route only edits the entry's own fields. Minting/withdrawing an offer token
// is U4's POST/DELETE .../waitlist/[waitlistId]/offer route.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; waitlistId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, waitlistId } = await params;

  let body: { ticket_type_id?: unknown; quantity?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const ticketTypeId =
    typeof body.ticket_type_id === "string" ? body.ticket_type_id : "";
  const quantity =
    typeof body.quantity === "number"
      ? body.quantity
      : Number.parseInt(String(body.quantity ?? ""), 10);
  const emailProvided = typeof body.email === "string";
  const email = emailProvided ? (body.email as string).trim().toLowerCase() : "";

  if (!ticketTypeId) return bad("Please choose a ticket type");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return bad("quantity must be an integer between 1 and 10");
  }
  if (emailProvided && (!email || !EMAIL_RE.test(email))) {
    return bad("valid email is required");
  }

  // Scoped existence check (IDOR guard): an entry belonging to another event 404s
  // rather than leaking whether the id exists at all.
  const { data: entry, error: entryErr } = await adminClient
    .from("event_waitlist")
    .select("id, email")
    .eq("id", waitlistId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (entryErr) {
    console.error("[waitlist-repair] entry lookup failed", { eventId, waitlistId, err: entryErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!entry) return bad("Waitlist entry not found", 404);

  // The ticket type must belong to THIS event and be live — the same IDOR + archive
  // guard as the ticket-types route.
  const { data: ticketType, error: ttErr } = await adminClient
    .from("event_ticket_types")
    .select("id, archived_at")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (ttErr) {
    console.error("[waitlist-repair] ticket type lookup failed", { eventId, waitlistId, err: ttErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!ticketType) return bad("Ticket type not found for this event");
  if (ticketType.archived_at) return bad("That ticket type has been archived");

  // R12/KTD3: an email correction is only safe before redemption — changing it after
  // would detach the entry from the registration it already produced.
  if (emailProvided) {
    const { data: liveRegs, error: regErr } = await fetchLiveRegistrationsForRedemption(
      adminClient,
      eventId
    );
    if (regErr) {
      console.error("[waitlist-repair] registration lookup failed", { eventId, waitlistId, err: regErr });
      return bad("Service temporarily unavailable", 503);
    }
    if (isWaitlistEntryRedeemed({ id: entry.id, email: entry.email }, liveRegs ?? [])) {
      return bad("This entry is already redeemed and its email can no longer be changed");
    }
  }

  const patch: Record<string, unknown> = {
    ticket_type_id: ticketTypeId,
    quantity,
  };
  if (emailProvided) patch.email = email;

  // Never select offer_token back — a live offer secret must not reach the browser.
  const { data: updated, error: updateErr } = await adminClient
    .from("event_waitlist")
    .update(patch)
    .eq("id", waitlistId)
    .eq("event_id", eventId)
    .select("id, name, email, ticket_type_id, quantity, offered_at, offer_sent_count")
    .maybeSingle();

  if (updateErr || !updated) {
    console.error("[waitlist-repair] update failed", { eventId, waitlistId, err: updateErr });
    return bad("Could not update waitlist entry", 500);
  }

  return NextResponse.json({ success: true, entry: updated });
}
