import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getSeatsUsed } from "@/lib/events/seat-usage";

// Convert-ticket-type from the lead booking page. A lead changes ONE of their tickets
// to a same-or-higher priced ticket type, paying the difference. Mirrors the top-up
// flow: record a pending conversion (snapshotting the agreed prices), then either apply
// inline (delta 0, no checkout) or send the lead to Stripe with a `conversion_id`
// metadata discriminator; the webhook applies it idempotently BEFORE its paid
// short-circuit. Upgrade-only — downgrades (delta < 0) are rejected.

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

  let body: { ticketId?: unknown; toTicketTypeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const ticketId =
    typeof body.ticketId === "string" && UUID_RE.test(body.ticketId) ? body.ticketId : "";
  const toTicketTypeId =
    typeof body.toTicketTypeId === "string" && UUID_RE.test(body.toTicketTypeId)
      ? body.toTicketTypeId
      : "";
  if (!ticketId || !toTicketTypeId) return bad("Invalid conversion request");

  const supabase = createAdminClient();

  const { data: reg } = await supabase
    .from("event_registrations")
    .select("id, event_id, is_member, status, email")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();
  if (!reg) return bad("Booking not found", 404);
  if (reg.status !== "paid" && reg.status !== "free") {
    return bad("This booking isn’t confirmed yet", 409);
  }

  // The ticket must belong to THIS booking and be eligible (R6): issued/claimed, not
  // checked-in, not released, not forwarded. Its current type is the `from` side.
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, ticket_type_id, slot_status, checked_in_at, released_at, batch_token")
    .eq("id", ticketId)
    .eq("registration_id", reg.id as string)
    .is("released_at", null)
    .is("checked_in_at", null)
    .is("batch_token", null)
    .in("slot_status", ["issued", "claimed"])
    .limit(1)
    .maybeSingle();
  if (!ticket || !ticket.ticket_type_id) return bad("This ticket can’t be changed", 409);
  const fromTypeId = ticket.ticket_type_id as string;
  if (fromTypeId === toTicketTypeId) return bad("This ticket is already that type");

  // Load both types (scoped to the event). `to` must be active. Child↔adult conversion
  // is allowed now (R9) — every ticket carries a name, email, and waiver regardless of
  // type, so the invariants that made the boundary matter are gone.
  const { data: types } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, archived_at, counts_as_seat")
    .eq("event_id", reg.event_id as string)
    .in("id", [fromTypeId, toTicketTypeId]);
  const from = (types ?? []).find((t) => t.id === fromTypeId);
  const to = (types ?? []).find((t) => t.id === toTicketTypeId);
  if (!from || !to) return bad("Ticket type not available", 400);
  if (to.archived_at) return bad("That ticket type is no longer available", 400);

  // Re-derive both prices server-side from the booking's rate class (R3) — never trust
  // client input. Non-members fall back to invite_price when price_non_member is unset
  // (members-only events), matching the top-up route.
  const priceAt = (t: { price_member: number | null; price_non_member: number | null; invite_price: number | null }) =>
    reg.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
  const fromRaw = priceAt(from);
  const toRaw = priceAt(to);
  if (
    fromRaw === null || !Number.isFinite(Number(fromRaw)) || Number(fromRaw) < 0 ||
    toRaw === null || !Number.isFinite(Number(toRaw)) || Number(toRaw) < 0
  ) {
    return bad("Event pricing is misconfigured", 500);
  }
  const fromUnit = Number(fromRaw);
  const toUnit = Number(toRaw);
  const delta = Number((toUnit - fromUnit).toFixed(2));
  if (delta < 0) return bad("Downgrades aren’t supported", 400);

  // Seat cap (R8): only when the target consumes a seat and the source did not — the
  // conversion then adds one seat. A seat-neutral change skips the check.
  if (to.counts_as_seat && !from.counts_as_seat) {
    const { data: ev } = await supabase
      .from("events")
      .select("seat_cap")
      .eq("id", reg.event_id as string)
      .limit(1)
      .maybeSingle();
    const seatCap = (ev?.seat_cap as number | null) ?? null;
    if (seatCap !== null) {
      let seatsUsed: number;
      try {
        seatsUsed = await getSeatsUsed(supabase, reg.event_id as string);
      } catch (err) {
        console.error("[booking-convert] seat usage lookup failed", { eventId: reg.event_id, err });
        return bad("Could not verify availability", 500);
      }
      if (seatsUsed + 1 > seatCap) {
        return bad("Not enough tickets remaining for this event", 409);
      }
    }
  }

  // Record the pending conversion with snapshotted prices (KTD2) — the RPC consumes this
  // snapshot, so an admin editing type prices later can't change what the lead agreed to.
  const { data: conversion, error: convErr } = await supabase
    .from("event_ticket_type_conversions")
    .insert({
      registration_id: reg.id as string,
      ticket_id: ticketId,
      from_type_id: fromTypeId,
      to_type_id: toTicketTypeId,
      from_unit_chf: fromUnit,
      to_unit_chf: toUnit,
      delta_chf: delta,
    })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (convErr || !conversion) {
    console.error("[booking-convert] could not create conversion", { err: convErr });
    return bad("Could not start the change", 500);
  }
  const conversionId = conversion.id as string;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const successUrl = `${appUrl}/public/bookings/${token}?converted=1`;

  // Free upgrade (delta 0): apply immediately — no checkout. Nothing to mint (quantity
  // is unchanged), so this is just the type swap + line-item reconciliation.
  if (delta === 0) {
    const { data: applied, error: applyErr } = await supabase.rpc(
      "apply_ticket_type_conversion",
      { p_conversion_id: conversionId }
    );
    const status = (applied as { status?: string } | null)?.status;
    if (applyErr || status !== "applied") {
      console.error("[booking-convert] free apply failed", { conversionId, status, err: applyErr });
      return bad("Could not change the ticket type", 500);
    }
    return NextResponse.json({ ok: true, applied: true, redirectUrl: successUrl });
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "chf",
            unit_amount: Math.round(delta * 100),
            product_data: { name: `Upgrade to ${to.title as string}` },
          },
          quantity: 1,
        },
      ],
      customer_email: (reg.email as string) ?? undefined,
      // Data-driven discriminator (KTD3): the webhook branches on conversion_id presence,
      // not a boolean flag that can be present at creation and missing at delivery.
      metadata: {
        event_registration_id: reg.id as string,
        event_id: reg.event_id as string,
        conversion_id: conversionId,
      },
      success_url: successUrl,
      cancel_url: `${appUrl}/public/bookings/${token}?convert=cancelled`,
    });
  } catch (err) {
    console.error("[booking-convert] Stripe session create failed", { conversionId, err });
    return bad("Could not start checkout", 500);
  }

  return NextResponse.json({ ok: true, checkoutUrl: session.url });
}
