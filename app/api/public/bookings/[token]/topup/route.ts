import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { mintRegistrationTickets, applyTopupRoster, type RosterFillAttendee } from "@/lib/events/roster";
import { collidesWithClaimed } from "@/lib/events/attendee-input";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { resolvePrice, isUsablePrice } from "@/lib/events/pricing";
import { validateOrder, deriveTicketCounts, type OrderPerson, type OrderBounds, type OrderViolation } from "@/lib/events/order";

// Buy-more top-up (U6, widened by U2 for the holder page). Adds tickets UNDER the existing
// registration (the one-reg-per-email index blocks a second one). We record a pending
// top-up with priced items, then send the buyer to Stripe with a distinct `topup`
// metadata discriminator + topup_id; the webhook applies it idempotently BEFORE its
// paid short-circuit. A free top-up (zero total) is applied immediately, no checkout.
//
// Auth mirrors the cancel route's dual-token model: the path token is EITHER the booking's
// registration manage_token (the lead) OR a per-ticket manage_token (a household member).
// A ticket token resolves to its OWN registration via that ticket's registration_id — the
// purchase always lands on that one booking, never a different one, because there is no
// other input (body carries only `people`, never a booking id) that could steer it
// elsewhere.
//
// U3: the request is a list of people, not a quantity basket plus a separately-typed
// attendee list (KD1). Each person carries the ticket type(s) they hold, so there is
// nothing left to reconcile — `deriveTicketCounts` grouping the people IS the requested
// quantity. `validateOrder` (lib/events/order.ts) reports every naming/identity violation
// in one pass (R5); this route still layers on two things `validateOrder` deliberately does
// NOT own: ticket-type lifecycle (archived) and the collision check against seats already
// claimed on THIS booking, since neither is visible to a pure, dependency-free module.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The same numeric cap this route enforced before the people-list migration (MAX_QTY = 50).
// A top-up adds to an existing booking rather than starting one, so it keeps its own bound
// rather than inheriting public checkout's (smaller) cap.
const TOPUP_ORDER_BOUNDS: OrderBounds = { maxPeople: 50, maxTickets: 50 };

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Every violation `validateOrder` found, not just the first (R5) — `error` stays the first
 *  one so an existing caller reading a single string still gets something sane. */
function orderInvalid(violations: OrderViolation[]) {
  return NextResponse.json(
    { error: violations[0]?.message ?? "Invalid order", violations },
    { status: 400 },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { people?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  interface RawPerson {
    name?: unknown;
    email?: unknown;
    ticketTypeIds?: unknown;
  }
  const rawPeople = Array.isArray(body.people) ? (body.people as unknown[]) : [];
  const people: OrderPerson[] = rawPeople.map((entry) => {
    const o = (entry ?? {}) as RawPerson;
    return {
      name: typeof o.name === "string" ? o.name : "",
      email: typeof o.email === "string" ? o.email : "",
      ticketTypeIds: Array.isArray(o.ticketTypeIds)
        ? o.ticketTypeIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  });

  const supabase = createAdminClient();

  // Dual-token resolution (mirrors cancel): registration manage_token ⇒ the booking
  // directly; per-ticket manage_token ⇒ the booking THAT TICKET belongs to, resolved via
  // its own registration_id — never any other registration.
  interface RegRow {
    id: string;
    event_id: string;
    is_member: boolean;
    status: string;
    email: string | null;
  }
  let reg: RegRow;
  const { data: regByToken } = await supabase
    .from("event_registrations")
    .select("id, event_id, is_member, status, email")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();
  if (regByToken) {
    reg = regByToken as RegRow;
  } else {
    const { data: self } = await supabase
      .from("tickets")
      .select("id, registration_id")
      .eq("manage_token", token)
      .is("released_at", null)
      .limit(1)
      .maybeSingle();
    if (!self || !self.registration_id) return bad("Booking not found", 404);
    const { data: r } = await supabase
      .from("event_registrations")
      .select("id, event_id, is_member, status, email")
      .eq("id", self.registration_id as string)
      .limit(1)
      .maybeSingle();
    if (!r) return bad("Booking not found", 404);
    reg = r as RegRow;
  }
  if (reg.status !== "paid" && reg.status !== "free") {
    return bad("This booking isn’t confirmed yet", 409);
  }

  // Ticket types referenced anywhere in the order. Only well-formed ids are worth a round
  // trip — anything else can never be found and falls out of validateOrder below as
  // unknown_ticket_type, without ever reaching a `.in()` filter that would choke on a
  // malformed uuid.
  interface TicketTypeRow {
    id: string;
    title: string;
    price_member: number | null;
    price_non_member: number | null;
    invite_price: number | null;
    archived_at: string | null;
    counts_as_seat: boolean;
  }
  const ids = [...new Set(people.flatMap((p) => p.ticketTypeIds).filter((id) => UUID_RE.test(id)))];
  const { data: types } = ids.length
    ? await supabase
        .from("event_ticket_types")
        .select("id, title, price_member, price_non_member, invite_price, archived_at, counts_as_seat")
        .eq("event_id", reg.event_id as string)
        .in("id", ids)
    : { data: [] as TicketTypeRow[] };
  const typeById = new Map((types ?? []).map((t) => [(t as TicketTypeRow).id, t as TicketTypeRow]));

  // Mandatory naming (R1) applies here too. Same module as public checkout, so the two
  // cannot drift: this route shipped without any naming at all, which is how a paid booking
  // could still grow an unnamed, contactless seat long after checkout stopped allowing one.
  const orderResult = validateOrder(people, TOPUP_ORDER_BOUNDS, (ttId) => typeById.has(ttId));
  if (!orderResult.ok) return orderInvalid(orderResult.violations);

  // Ticket-type lifecycle is not validateOrder's concern (it only knows existence via
  // isKnownTicketType) — archived is checked here, same as before.
  const counts = deriveTicketCounts(people);
  for (const ticketTypeId of counts.keys()) {
    if (typeById.get(ticketTypeId)?.archived_at) {
      return bad("A selected ticket type is no longer available", 400);
    }
  }

  // Price each requested type against the booking's rate (member vs non-member).
  const items: {
    ticket_type_id: string;
    title_snapshot: string;
    quantity: number;
    unit_amount_chf: number;
    line_total_chf: number;
  }[] = [];
  let total = 0;
  let seatQuantity = 0;
  for (const [ticketTypeId, quantity] of counts) {
    const t = typeById.get(ticketTypeId)!;
    // Non-members fall back to invite_price when price_non_member is unset — on a
    // members-only event there is no non-member price, so an invited guest's top-up
    // must use the same invite_price they paid at booking (else unit is null → 500).
    //
    // KTD7: the invite-rate limit is deliberately NOT enforced here — it's per-checkout
    // only (Q5, session-settled 2026-08-15). A buyer can top up at the invite rate without
    // hitting the cap; this is a product decision, not a gap.
    const unit = resolvePrice(t, reg);
    if (!isUsablePrice(unit)) {
      return bad("Event pricing is misconfigured", 500);
    }
    const unitAmount = Number(unit);
    const lineTotal = Number((unitAmount * quantity).toFixed(2));
    total += lineTotal;
    if (t.counts_as_seat) seatQuantity += quantity;
    items.push({
      ticket_type_id: ticketTypeId,
      title_snapshot: t.title as string,
      quantity,
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

  // The roster entries in the same shape the old attendee parser used to hand back — one per
  // (person, ticket type), trimmed name, trimmed+lowercased email — since a person can now
  // carry more than one ticket type (KD4, the multi-day case).
  const attendees: RosterFillAttendee[] = people.flatMap((p) =>
    p.ticketTypeIds.map((ticketTypeId) => ({
      ticket_type_id: ticketTypeId,
      name: p.name.trim(),
      email: p.email.trim().toLowerCase(),
    })),
  );

  // ...and the same person cannot be named onto a SECOND seat OF THE SAME TICKET TYPE on a
  // booking they already hold one on. validateOrder only sees this order; claim_ticket
  // dedupes against every same-type seat already named on the registration, so a lead topping
  // up under their own name and email gets `already: true`, no seat claimed, and a charge for a
  // permanently unnamed ticket. Refuse before money moves, while the buyer can still fix it.
  //
  // Type-scoped, so topping up a booking with a second day of a multi-day event under the same
  // name is allowed — that seat is real and claim_ticket will now fill it.
  const { data: claimedRows, error: claimedErr } = await supabase
    .from("tickets")
    .select("name, email, ticket_type_id")
    .eq("registration_id", reg.id as string)
    .eq("slot_status", "claimed")
    .is("released_at", null);
  if (claimedErr) {
    console.error("[booking-topup] could not read existing names — blocking top-up", {
      registrationId: reg.id,
      err: claimedErr,
    });
    return bad("Could not start the top-up", 500);
  }
  const clash = collidesWithClaimed(attendees, claimedRows ?? []);
  if (clash) {
    return bad(
      `${clash.name} already has this ticket on this booking — please name your guest (same email allowed).`,
      400,
    );
  }

  // Record the pending top-up (service-role bypasses RLS), carrying the names it bought.
  //
  // The names go on the TOP-UP row, not on event_registrations.pending_roster: that column
  // is the original checkout's staging slot, and a second producer writing it lets a
  // redelivery of the original session consume this top-up's names (and lets two concurrent
  // top-ups overwrite each other), minting the unnamed seats mandatory naming exists to
  // prevent. See 20260811064034_topup_owns_its_roster.sql.
  //
  // Stashed BEFORE any money moves, and we fail loud if the write fails — a paid top-up whose
  // roster never persisted is exactly the seat we refuse to create.
  const { data: topup, error: topupErr } = await supabase
    .from("event_registration_topups")
    .insert({
      registration_id: reg.id as string,
      items,
      pending_roster: attendees,
    })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (topupErr || !topup) {
    // Context matters here: without the booking, a spike in these is untraceable. `!topup`
    // with no error is the nastier half — the insert may have committed while the client saw
    // nothing, leaving an orphan row with a staged roster (never paid, never applied).
    console.error("[booking-topup] could not create top-up", {
      registrationId: reg.id,
      eventId: reg.event_id,
      reason: topupErr ? "insert_failed" : "no_row_returned",
      err: topupErr,
    });
    return bad("Could not start the top-up", 500);
  }
  const topupId = topup.id as string;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  // Send the buyer back to whichever manage page they bought from: the lead's registration
  // token returns to the booking page, a household member's ticket token returns to the
  // ticket page — `token` is the same path segment either way.
  const returnSegment = regByToken ? "bookings" : "tickets";
  const successUrl = `${appUrl}/public/${returnSegment}/${token}?topup=1`;

  // Free top-up: apply immediately and mint — no checkout.
  if (total === 0) {
    const { error: applyErr } = await supabase.rpc("apply_registration_topup", { p_topup_id: topupId });
    if (applyErr) {
      console.error("[booking-topup] free apply failed", { topupId, err: applyErr });
      return bad("Could not add the tickets", 500);
    }
    await mintRegistrationTickets(reg.id as string);
    // Nothing was charged, so there is no webhook to do this — name the new seats here.
    // And no webhook means no retry either: this is the only attempt these names get, so a
    // failure has to be loud and has to reach the lead, who can still fix it from their
    // booking page. Silently returning success is how an unnamed seat reaches the door.
    const rosterStatus = await applyTopupRoster(topupId);
    if (rosterStatus !== "applied") {
      console.error("[booking-topup] free top-up seats added but NOT named", {
        topupId,
        registrationId: reg.id,
        eventId: reg.event_id,
        rosterStatus,
      });
      return NextResponse.json({
        ok: true,
        applied: true,
        redirectUrl: successUrl,
        warning:
          "Your tickets were added, but we couldn't attach the guest names — please add them from your booking page.",
      });
    }
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
      // `topup_id` is the discriminator: the webhook gates on its PRESENCE to apply the
      // top-up BEFORE its paid short-circuit (the registration is already 'paid'). It is
      // deliberately the id rather than a `topup: "true"` flag — the id is both the gate and
      // the thing the branch needs, so a delivery cannot arrive carrying one without the
      // other. A separate boolean previously could, and a delivery missing it captured
      // payment and minted nothing.
      // See docs/solutions/logic-errors/stripe-webhook-metadata-missing-skips-cleanup.md.
      metadata: {
        event_registration_id: reg.id as string,
        event_id: reg.event_id as string,
        topup_id: topupId,
      },
      success_url: successUrl,
      cancel_url: `${appUrl}/public/${returnSegment}/${token}?topup=cancelled`,
    });
  } catch (err) {
    console.error("[booking-topup] Stripe session create failed", { topupId, err });
    return bad("Could not start checkout", 500);
  }

  return NextResponse.json({ ok: true, checkoutUrl: session.url });
}
