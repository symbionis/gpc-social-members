import { NextResponse, type NextRequest } from "next/server";
import { assertAdmin, bad } from "@/lib/events/guest-list-auth";
import {
  deriveWaitlistOfferability,
  findRedeemingRegistration,
} from "@/lib/events/waitlist-offer";
import { generateSelfRegToken } from "@/lib/events/registration";
import { sendWaitlistOffer } from "@/lib/email/event-waitlist-offer";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Offer / resend / withdraw a waitlist entry's seat (F1, R1, R3, R5a of
// docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md, U4).
//
// POST mints a token on first offer, keeps it on resend (R3, KTD4), stamps
// offered_at/offered_by, increments offer_sent_count, then sends the email.
// DELETE (withdraw, R5a) clears offer state on an unredeemed entry so it
// returns to queued and its old link stops resolving (KTD4: resolution is
// gated on offer_token being non-null).
//
// This route mints/clears the token only. Editing the entry's own fields
// (ticket type, quantity, email) is U2's PATCH .../waitlist/[waitlistId] route.

async function loadEntry(adminClient: AdminClient, eventId: string, waitlistId: string) {
  return adminClient
    .from("event_waitlist")
    .select("id, email, ticket_type_id, quantity, offer_token, offer_sent_count")
    .eq("id", waitlistId)
    .eq("event_id", eventId)
    .maybeSingle();
}

async function checkRedeemed(
  adminClient: AdminClient,
  eventId: string,
  entry: { id: string; email: string }
): Promise<{ redeemed: boolean } | { error: string; status: number }> {
  const { data: redeeming, error: regErr } = await findRedeemingRegistration(
    adminClient,
    eventId,
    entry
  );
  if (regErr) {
    console.error("[waitlist-offer] registration lookup failed", { eventId, entryId: entry.id, err: regErr });
    return { error: "Service temporarily unavailable", status: 503 };
  }
  return { redeemed: redeeming !== null };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; waitlistId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient, adminId } = auth;
  const { id: eventId, waitlistId } = await params;

  // Independent of each other — both need only eventId/waitlistId, already in hand.
  const [{ data: entry, error: entryErr }, { data: event, error: eventErr }] = await Promise.all([
    loadEntry(adminClient, eventId, waitlistId),
    adminClient.from("events").select("id, registration_enabled").eq("id", eventId).maybeSingle(),
  ]);
  if (entryErr) {
    console.error("[waitlist-offer] entry lookup failed", { eventId, waitlistId, err: entryErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!entry) return bad("Waitlist entry not found", 404);
  if (eventErr) {
    console.error("[waitlist-offer] event lookup failed", { eventId, err: eventErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!event) return bad("Event not found", 404);
  if (!event.registration_enabled) {
    return bad("Registration is closed for this event");
  }

  let ticketType: { title: string; archived_at: string | null; counts_as_seat: boolean } | null = null;
  if (entry.ticket_type_id) {
    const { data: tt, error: ttErr } = await adminClient
      .from("event_ticket_types")
      .select("title, archived_at, counts_as_seat")
      .eq("id", entry.ticket_type_id)
      .eq("event_id", eventId)
      .maybeSingle();
    if (ttErr) {
      console.error("[waitlist-offer] ticket type lookup failed", { eventId, waitlistId, err: ttErr });
      return bad("Service temporarily unavailable", 503);
    }
    ticketType = tt ?? null;
  }

  const offerability = deriveWaitlistOfferability({
    ticket_type_id: entry.ticket_type_id,
    quantity: entry.quantity,
    ticketType,
  });
  if (!offerability.offerable) {
    return bad(offerability.reason ?? "This entry cannot be offered");
  }

  const redeemedCheck = await checkRedeemed(adminClient, eventId, { id: entry.id, email: entry.email });
  if ("error" in redeemedCheck) return bad(redeemedCheck.error, redeemedCheck.status);
  if (redeemedCheck.redeemed) {
    return bad("This entry is already registered and cannot be offered again");
  }

  // R3/KTD4: keep the existing token on a resend; only mint one on a first offer.
  const token = entry.offer_token ?? generateSelfRegToken();
  const nextCount = (entry.offer_sent_count ?? 0) + 1;
  const offeredAt = new Date().toISOString();

  const { error: updateErr } = await adminClient
    .from("event_waitlist")
    .update({
      offer_token: token,
      offered_at: offeredAt,
      offered_by: adminId,
      offer_sent_count: nextCount,
    })
    .eq("id", waitlistId)
    .eq("event_id", eventId);
  if (updateErr) {
    console.error("[waitlist-offer] update failed", { eventId, waitlistId, err: updateErr });
    return bad("Could not update waitlist entry", 500);
  }

  // Send after the offer state is persisted — a failed send must not lose the
  // token/timestamp already saved (the admin can Resend from the same state).
  let emailSent = false;
  try {
    const result = await sendWaitlistOffer(waitlistId);
    emailSent = result.success;
  } catch (err) {
    console.error("[waitlist-offer] email send threw", { waitlistId, err });
  }

  return NextResponse.json({
    success: true,
    email_sent: emailSent,
    offer_sent_count: nextCount,
    offered_at: offeredAt,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; waitlistId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, waitlistId } = await params;

  const { data: entry, error: entryErr } = await adminClient
    .from("event_waitlist")
    .select("id, email")
    .eq("id", waitlistId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (entryErr) {
    console.error("[waitlist-offer] withdraw entry lookup failed", { eventId, waitlistId, err: entryErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!entry) return bad("Waitlist entry not found", 404);

  const redeemedCheck = await checkRedeemed(adminClient, eventId, { id: entry.id, email: entry.email });
  if ("error" in redeemedCheck) return bad(redeemedCheck.error, redeemedCheck.status);
  if (redeemedCheck.redeemed) {
    return bad("This entry is already registered and its offer can no longer be withdrawn");
  }

  // R5a: clear the token so the old link stops resolving (KTD4), and reset the
  // offer state so the entry reads as queued again.
  const { error: updateErr } = await adminClient
    .from("event_waitlist")
    .update({
      offer_token: null,
      offered_at: null,
      offered_by: null,
      offer_sent_count: 0,
    })
    .eq("id", waitlistId)
    .eq("event_id", eventId);
  if (updateErr) {
    console.error("[waitlist-offer] withdraw update failed", { eventId, waitlistId, err: updateErr });
    return bad("Could not withdraw offer", 500);
  }

  return NextResponse.json({ success: true });
}
