import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { mintRegistrationTickets } from "@/lib/events/roster";
import { getSeatsUsed } from "@/lib/events/seat-usage";

// Buy-more top-up from the lead booking page (U6). Adds tickets UNDER the existing
// registration (the one-reg-per-email index blocks a second one). We record a pending
// top-up with priced items, then send the lead to Stripe with a distinct `topup`
// metadata discriminator + topup_id; the webhook applies it idempotently BEFORE its
// paid short-circuit. A free top-up (zero total) is applied immediately, no checkout.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QTY = 50;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { items?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const requested = Array.isArray(body.items)
    ? body.items
        .map((it) => {
          const o = (it ?? {}) as { ticketTypeId?: unknown; quantity?: unknown };
          const id = typeof o.ticketTypeId === "string" && UUID_RE.test(o.ticketTypeId) ? o.ticketTypeId : "";
          const qty = typeof o.quantity === "number" ? Math.floor(o.quantity) : 0;
          return { ticketTypeId: id, quantity: qty };
        })
        .filter((it) => it.ticketTypeId && it.quantity > 0)
    : [];
  if (requested.length === 0) return bad("select at least one ticket to add");
  const totalQty = requested.reduce((s, it) => s + it.quantity, 0);
  if (totalQty > MAX_QTY) return bad("too many tickets in one top-up");

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

  // Price each requested type against the booking's rate (member vs non-member).
  const ids = [...new Set(requested.map((r) => r.ticketTypeId))];
  const { data: types } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, archived_at, counts_as_seat")
    .eq("event_id", reg.event_id as string)
    .in("id", ids);
  const typeById = new Map((types ?? []).map((t) => [t.id as string, t]));
  if ((types ?? []).length < ids.length) return bad("A selected ticket type isn’t available", 400);

  const items: {
    ticket_type_id: string;
    title_snapshot: string;
    quantity: number;
    unit_amount_chf: number;
    line_total_chf: number;
  }[] = [];
  let total = 0;
  let seatQuantity = 0;
  for (const r of requested) {
    const t = typeById.get(r.ticketTypeId)!;
    if (t.archived_at) return bad("A selected ticket type is no longer available", 400);
    // Non-members fall back to invite_price when price_non_member is unset — on a
    // members-only event there is no non-member price, so an invited guest's top-up
    // must use the same invite_price they paid at booking (else unit is null → 500).
    const unit = reg.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
    if (unit === null || !Number.isFinite(Number(unit)) || Number(unit) < 0) {
      return bad("Event pricing is misconfigured", 500);
    }
    const unitAmount = Number(unit);
    const lineTotal = Number((unitAmount * r.quantity).toFixed(2));
    total += lineTotal;
    if (t.counts_as_seat) seatQuantity += r.quantity;
    items.push({
      ticket_type_id: t.id as string,
      title_snapshot: t.title as string,
      quantity: r.quantity,
      unit_amount_chf: unitAmount,
      line_total_chf: lineTotal,
    });
  }
  total = Number(total.toFixed(2));

  // A lead's buy-more must respect the event seat cap (the bump to quantity feeds
  // seats_used). The registration's current quantity is already counted in
  // getSeatsUsed, so the top-up's NEW seat tickets are what must still fit.
  const { data: ev } = await supabase
    .from("events")
    .select("seat_cap")
    .eq("id", reg.event_id as string)
    .limit(1)
    .maybeSingle();
  const seatCap = (ev?.seat_cap as number | null) ?? null;
  if (seatCap !== null && seatQuantity > 0) {
    let seatsUsed: number;
    try {
      seatsUsed = await getSeatsUsed(supabase, reg.event_id as string);
    } catch (err) {
      console.error("[booking-topup] seat usage lookup failed", { eventId: reg.event_id, err });
      return bad("Could not verify availability", 500);
    }
    if (seatsUsed + seatQuantity > seatCap) {
      return bad("Not enough tickets remaining for this event", 409);
    }
  }

  // Record the pending top-up (service-role bypasses RLS).
  const { data: topup, error: topupErr } = await supabase
    .from("event_registration_topups")
    .insert({ registration_id: reg.id as string, items })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (topupErr || !topup) {
    console.error("[booking-topup] could not create top-up", { err: topupErr });
    return bad("Could not start the top-up", 500);
  }
  const topupId = topup.id as string;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const successUrl = `${appUrl}/public/bookings/${token}?topup=1`;

  // Free top-up: apply immediately and mint — no checkout.
  if (total === 0) {
    const { error: applyErr } = await supabase.rpc("apply_registration_topup", { p_topup_id: topupId });
    if (applyErr) {
      console.error("[booking-topup] free apply failed", { topupId, err: applyErr });
      return bad("Could not add the tickets", 500);
    }
    await mintRegistrationTickets(reg.id as string);
    return NextResponse.json({ ok: true, applied: true, redirectUrl: successUrl });
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: items.map((li) => ({
        price_data: {
          currency: "chf",
          unit_amount: Math.round(li.unit_amount_chf * 100),
          product_data: { name: li.title_snapshot },
        },
        quantity: li.quantity,
      })),
      customer_email: (reg.email as string) ?? undefined,
      // Distinct discriminator so the webhook applies the top-up BEFORE its paid
      // short-circuit (the registration is already 'paid').
      metadata: {
        event_registration_id: reg.id as string,
        event_id: reg.event_id as string,
        topup: "true",
        topup_id: topupId,
      },
      success_url: successUrl,
      cancel_url: `${appUrl}/public/bookings/${token}?topup=cancelled`,
    });
  } catch (err) {
    console.error("[booking-topup] Stripe session create failed", { topupId, err });
    return bad("Could not start checkout", 500);
  }

  return NextResponse.json({ ok: true, checkoutUrl: session.url });
}
