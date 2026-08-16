import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { priceForRateClass, isUsablePrice } from "@/lib/events/pricing";
import {
  generateReferenceCode,
  generateSelfRegToken,
  isValidInviteCode,
} from "@/lib/events/registration";
import {
  mintRegistrationTickets,
  fillRegistrationRoster,
  markLeadTickets,
  type RosterFillAttendee,
} from "@/lib/events/roster";
import {
  validateOrder,
  deriveTicketCounts,
  type OrderPerson,
  type OrderViolation,
} from "@/lib/events/order";
import { findRedeemingRegistration } from "@/lib/events/waitlist-offer";
import { captureServerException } from "@/lib/analytics/server-errors";

// Bound on both people.length and the derived ticket count (lib/events/order.ts's
// OrderBounds) — this endpoint is unauthenticated, so an arbitrary payload must not
// reach a service-role write unbounded.
const MAX_TICKETS = 20;

// An order-scoped violation this route constructs itself (the invite-rate limit) —
// validateOrder doesn't know about rate classes (KD6: that policy lives in the
// caller). Same wire shape as OrderViolation; `rule` just isn't one of its frozen
// literals.
type Violation = OrderViolation | { rule: string; message: string; personIndex: null; field: null };

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** A rejection carrying `violations` (R5/R18) — the shape U4's form looks for on a
 *  non-2xx response, falling back to `.error` only when this array is absent/empty. */
function invalidOrder(violations: Violation[], status = 400) {
  const orderScoped = violations.find((v) => v.personIndex === null);
  return NextResponse.json(
    { error: orderScoped?.message ?? "Please fix the highlighted details.", violations },
    { status }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    code?: unknown;
    people?: unknown;
    offer_token?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  // Overridden below (KTD8) once an offer_token resolves to a waitlist entry — the
  // entry's own email replaces whatever the client sent, for every downstream use
  // (duplicate guard, the registration RPC, Stripe's customer_email, and person
  // zero's own identity in `people`).
  let email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const offerToken =
    typeof body.offer_token === "string" ? body.offer_token.trim() : "";
  // Optional E.164 phone (the form captures it via PhoneInput; empty is allowed —
  // email stays the required contact). Reject a malformed value rather than storing
  // junk that could never match at the door.
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  const phone = /^\+[1-9]\d{6,14}$/.test(rawPhone) ? rawPhone : "";

  if (!name) return bad("name is required");
  if (!email) return bad("valid email is required");

  // An order IS a list of people (U1/KD1) — the buyer is people[0], no separate
  // basket/attendees arrays and no `leadTicketTypeId` (KTD3). Shape the raw payload
  // defensively (this route is unauthenticated); the real rules — full names, email
  // format, known ticket types, and these SAME bounds — are validateOrder's job below.
  // The two length checks here are a cheap early exit only: this route is unauthenticated
  // and hasn't queried the DB yet at this point, so an absurdly oversized payload is
  // rejected before spending a round trip loading ticket types. validateOrder re-checks
  // the identical bound later against the real MAX_TICKETS constant — intentional
  // redundancy, not drift, since both read the same value.
  const rawPeople = Array.isArray(body.people) ? body.people : null;
  if (!rawPeople || rawPeople.length === 0) return bad("Select at least one ticket");
  if (rawPeople.length > MAX_TICKETS) {
    return bad(`A maximum of ${MAX_TICKETS} people can be on one order`);
  }
  const people: OrderPerson[] = rawPeople.map((p) => {
    const rec = (p ?? {}) as { name?: unknown; email?: unknown; ticketTypeIds?: unknown };
    return {
      name: typeof rec.name === "string" ? rec.name : "",
      email: typeof rec.email === "string" ? rec.email : "",
      ticketTypeIds: Array.isArray(rec.ticketTypeIds)
        ? rec.ticketTypeIds.filter((x): x is string => typeof x === "string")
        : [],
    };
  });

  // Raw (pre-validation) derived ticket count, for the offer quantity lock below —
  // computed the same way deriveTicketCounts would sum, without needing the ticket
  // types loaded yet.
  const totalQuantity = people.reduce((n, p) => n + p.ticketTypeIds.length, 0);
  if (totalQuantity > MAX_TICKETS) {
    return bad(`A maximum of ${MAX_TICKETS} tickets can be booked at once`);
  }

  const supabase = createAdminClient();

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, is_published, registration_enabled, visibility, seat_cap, invite_code, max_tickets_invite"
    )
    .eq("id", eventId)
    .limit(1)
    .single();

  if (eventErr || !event) return bad("Event not found", 404);
  if (!event.is_published) return bad("Event is not published");
  if (!event.registration_enabled) {
    return bad("Registration is not open for this event");
  }

  // U6: resolve an offer token to its waitlist entry, scoped to THIS event (IDOR
  // guard, mirrors the ticket-type lookup below). The token is unauthenticated and
  // long-lived, so every check here must hold even against a crafted request —
  // never trust the client's own quantity, email, or ticket-type choice (R6, R8).
  let offerEntry: { id: string; email: string; quantity: number } | null = null;
  if (offerToken) {
    const { data: entry, error: entryErr } = await supabase
      .from("event_waitlist")
      .select("id, email, quantity")
      .eq("event_id", eventId)
      .eq("offer_token", offerToken)
      .limit(1)
      .maybeSingle();
    if (entryErr) {
      console.error("[event-register] offer token lookup failed", { eventId, err: entryErr });
      return bad("Could not verify this offer link", 500);
    }
    if (!entry) return bad("This offer link is not valid", 400);

    // KTD3: redeemed once the linked registration (or, for a pre-link legacy
    // entry, a live registration sharing its email — R12) reaches paid or free.
    const { data: redeeming, error: liveRegsErr } = await findRedeemingRegistration(
      supabase,
      eventId,
      { id: entry.id, email: entry.email }
    );
    if (liveRegsErr) {
      console.error("[event-register] offer redemption check failed", { eventId, err: liveRegsErr });
      return bad("Could not verify this offer link", 500);
    }
    if (redeeming) {
      return bad("This offer has already been used, or this email is already registered", 400);
    }

    // A repaired-but-never-fixed legacy entry could in principle carry a null
    // quantity (R13) — U4's offer route should never mint a token for one, but this
    // route is unauthenticated and must not trust that invariant blindly. Fail
    // closed rather than let a null coerce away the bound.
    if (entry.quantity === null || !Number.isInteger(entry.quantity) || entry.quantity < 1) {
      return bad("This offer link is not valid", 400);
    }

    // R6: an upper bound, not exact equality — fewer seats than requested is fine.
    if (totalQuantity > entry.quantity) {
      return bad(
        `This offer is for at most ${entry.quantity} ticket${entry.quantity === 1 ? "" : "s"}`,
        400
      );
    }

    offerEntry = { id: entry.id, email: entry.email.trim().toLowerCase(), quantity: entry.quantity };
    // KTD8: pin the email server-side for every downstream use, not just the RPC.
    email = offerEntry.email;
  }

  // KTD3: the buyer is person zero, no more and no less special than that — but
  // their identity is still the booker fields above (never the client's raw
  // people[0], which KTD8's pin must survive), so pin it here once, after the
  // offer email override, for every downstream use (validation, roster, Stripe,
  // the is_lead flip).
  people[0] = { ...people[0], name, email };

  // Member detection: only trust an authenticated session, never the form email.
  const sessionClient = await createClient();
  const {
    data: { user: authUser },
  } = await sessionClient.auth.getUser();

  let isMember = false;
  let memberId: string | null = null;
  if (authUser?.id) {
    const { data: memberRow } = await supabase
      .from("members")
      .select("id, status")
      .eq("auth_user_id", authUser.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (memberRow) {
      isMember = true;
      memberId = memberRow.id;
    }
  }

  // Members-only events require an authenticated active member or a valid invite
  // code (re-validated server-side; the page gate is cosmetic). The code relaxes
  // ONLY this block — it never confers pricing. R11/KTD7: an offer token confers no
  // membership, so it must not also unlock the invite-code carve-out — an offer
  // redemption on a members-only event requires an active member session, full stop.
  const isMembersOnly = event.visibility === "members_only";
  const hasValidInvite = !offerEntry && isValidInviteCode(event.invite_code, code);
  if (isMembersOnly && !isMember && !hasValidInvite) {
    return bad("This event is for members only", 403);
  }

  // One rate class for the whole order, decided by session + code (never by the
  // client): member → price_member; invited guest on a members-only event →
  // invite_price; everyone else on a public event → price_non_member. KTD7: this
  // is also exactly when the order is "at the invite rate" for the limit below —
  // members-only AND not a member is the only way to reach "invite".
  const rateClass: "member" | "invite" | "non_member" = isMember
    ? "member"
    : isMembersOnly
      ? "invite"
      : "non_member";

  // Load the referenced types, SCOPED to this event (IDOR guard) and rejecting
  // archived types. A foreign or unknown id shrinks the returned set → 400.
  const ids = [...new Set(people.flatMap((p) => p.ticketTypeIds))];
  const { data: types, error: typesErr } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, counts_as_seat, archived_at")
    .eq("event_id", eventId)
    .in("id", ids);

  if (typesErr) {
    console.error("[event-register] ticket type lookup failed", { eventId, err: typesErr });
    return bad("Could not load ticket types", 500);
  }
  if (!types || types.length < ids.length) {
    return bad("A selected ticket type does not belong to this event", 400);
  }
  if (types.some((t) => t.archived_at)) {
    return bad("A selected ticket type is no longer available", 400);
  }
  // KTD6: an offer only redeems for a type that consumes a seat — a non-seat type
  // would let the invitee claim the offer without consuming the capacity that was
  // freed for them. R7 otherwise leaves the type free to choose, entry type or not.
  if (offerEntry && types.some((t) => !t.counts_as_seat)) {
    return bad("This offer can only be redeemed for a ticket type that counts toward capacity", 400);
  }
  const typeById = new Map(types.map((t) => [t.id, t]));
  const isKnownTicketType = (ticketTypeId: string) => typeById.has(ticketTypeId);

  // Validate the whole order in one pass (KD5/R5): names, emails, per-person ticket
  // types, and the order-scoped people/ticket bounds. Merge in the invite-rate
  // limit (KD2: distinct people, not ticket rows — `people.length` already is that,
  // since a multi-day buyer is one entry with two types, not two entries) — this
  // module doesn't know about rate classes (KD6), so it's constructed here and
  // folded into the same violations array rather than reported separately.
  const result = validateOrder(
    people,
    { maxPeople: MAX_TICKETS, maxTickets: MAX_TICKETS, maxTicketsPerPerson: 1 },
    isKnownTicketType,
  );
  const violations: Violation[] = [...result.violations];
  if (
    rateClass === "invite" &&
    event.max_tickets_invite !== null &&
    event.max_tickets_invite !== undefined &&
    people.length > event.max_tickets_invite
  ) {
    violations.push({
      rule: "invite_rate_limit",
      message: `This invite link is limited to ${event.max_tickets_invite} ${event.max_tickets_invite === 1 ? "person" : "people"} per order`,
      personIndex: null,
      field: null,
    });
  }
  if (violations.length > 0) return invalidOrder(violations);

  // Resolve per-line prices from the derived per-type counts (KTD2: quantities are
  // never submitted, only derived). STRICT null check before any coercion —
  // Number(null) === 0 would silently make a line free, so an unset price for the
  // resolved class fails loud rather than under-charging.
  const counts = deriveTicketCounts(people);
  const lineItems: {
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
    const unit = priceForRateClass(t, rateClass);
    if (!isUsablePrice(unit)) {
      return bad("Event pricing is misconfigured", 500);
    }
    const unitAmount = Number(unit);
    const lineTotal = Number((unitAmount * quantity).toFixed(2));
    total += lineTotal;
    if (t.counts_as_seat) seatQuantity += quantity;
    lineItems.push({
      ticket_type_id: t.id,
      title_snapshot: t.title,
      quantity,
      unit_amount_chf: unitAmount,
      line_total_chf: lineTotal,
    });
  }

  total = Number(total.toFixed(2));
  const isFree = total === 0;
  const referenceCode = generateReferenceCode();

  // Fast-path duplicate guard (the partial unique index is the race-safe backstop).
  const { data: existingReg } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("email", email)
    .in("status", ["paid", "free"])
    .limit(1);
  if (existingReg && existingReg.length > 0) {
    return bad("This email is already registered for this event", 409);
  }

  // Capacity: count only seat-consuming types against the cap.
  if (event.seat_cap !== null && event.seat_cap !== undefined && seatQuantity > 0) {
    let seatsUsed: number;
    try {
      seatsUsed = await getSeatsUsed(supabase, eventId);
    } catch (err) {
      console.error("[event-register] seat usage lookup failed", { eventId, err });
      return bad("Could not verify availability", 500);
    }
    if (seatsUsed + seatQuantity > event.seat_cap) {
      return bad("Not enough tickets remaining", 409);
    }
  }

  // Atomic insert of the parent registration + all line items (single RPC).
  const { data: registrationId, error: insertErr } = await supabase.rpc(
    "create_event_registration",
    {
      p_event_id: eventId,
      p_name: name,
      p_email: email,
      p_is_member: isMember,
      p_member_id: memberId,
      p_status: isFree ? "free" : "pending",
      p_reference_code: referenceCode,
      p_paid_at: isFree ? new Date().toISOString() : null,
      p_converted_by: null,
      p_items: lineItems,
    }
  );

  if (insertErr || !registrationId) {
    if (insertErr && (insertErr as { code?: string }).code === "23505") {
      return bad("This email is already registered for this event", 409);
    }
    console.error("[event-register] registration insert failed", { eventId, email, err: insertErr });
    return bad("Could not create registration", 500);
  }

  // U6/KTD3: link the registration back to the waitlist entry it redeemed, BEFORE
  // any confirmation or Stripe step. FAIL-LOUD (mirrors pending_roster below): a
  // lost write here would strand a paid/free registration next to a still-offerable
  // waitlist entry, silently breaking the redeemed-state derivation every other
  // surface relies on (R12).
  if (offerEntry) {
    const { error: waitlistLinkErr } = await supabase
      .from("event_registrations")
      .update({ waitlist_entry_id: offerEntry.id })
      .eq("id", registrationId);
    if (waitlistLinkErr) {
      console.error("[event-register] waitlist_entry_id persist failed — blocking checkout", {
        registrationId,
        waitlistEntryId: offerEntry.id,
        err: waitlistLinkErr,
      });
      // A pending registration (the paid path) is invisible to the paid/free duplicate
      // guard and to isWaitlistEntryRedeemed, so it stays safely retryable on its own.
      // A free registration is already terminal — left in place, it would make every
      // retry read as "already registered"/"already redeemed" with no ticket ever
      // minted. Delete it (cascades to its line items) so the offer stays usable.
      if (isFree) {
        const { error: rollbackErr } = await supabase
          .from("event_registrations")
          .delete()
          .eq("id", registrationId);
        if (rollbackErr) {
          // The rollback itself failed, so the terminal free registration the delete
          // was meant to remove is still there — with no tickets, no confirmation
          // email, and no waitlist link. From here the entry reads as "already
          // registered" to the duplicate guard and as redeemed to
          // findRedeemingRegistration, which also hides it from the admin waitlist.
          // Retrying cannot succeed, so do not tell them to retry: send them to a
          // human with the reference code, and raise it where someone will see it.
          console.error(
            "[event-register] free-registration rollback after link failure also failed — registration is stuck, NEEDS MANUAL RECONCILIATION",
            { registrationId, referenceCode, waitlistEntryId: offerEntry.id, err: rollbackErr }
          );
          captureServerException(
            new Error(
              `Offer redemption stuck: free registration ${registrationId} (ref ${referenceCode}) survived a failed waitlist_entry_id link for entry ${offerEntry.id}`
            ),
            { path: `/api/events/${eventId}/register`, method: "POST", status: 500 }
          );
          return bad(
            `Something went wrong confirming your offer and it needs to be sorted out by hand. Please contact the club quoting reference ${referenceCode} — retrying this link will not work.`,
            500
          );
        }
      }
      return bad("Could not confirm your offer. Please try again.", 500);
    }
  }

  // Persist the captured phone and the registration's manage token (the "My
  // Booking" link, distinct from each ticket's own manage_token). Best-effort and
  // non-blocking — a failure here never fails an already-created registration, it
  // only leaves that party without phone / a manage link.
  const regPatch: {
    phone_e164?: string;
    manage_token: string;
  } = {
    manage_token: generateSelfRegToken(),
  };
  if (phone) regPatch.phone_e164 = phone;
  const { error: patchErr } = await supabase
    .from("event_registrations")
    .update(regPatch)
    .eq("id", registrationId);
  if (patchErr) {
    console.error("[event-register] failed to persist phone/manage_token", {
      registrationId,
      err: patchErr,
    });
  }

  // Flatten the people list into one roster row per (person, ticket type) pair —
  // the buyer (people[0]) included, no more seeded separately (KTD3): under a
  // people list there is nothing that makes their seat different from a guest's.
  const allAttendees: RosterFillAttendee[] = people.flatMap((p) =>
    p.ticketTypeIds.map((ticketTypeId) => ({
      ticket_type_id: ticketTypeId,
      name: p.name.trim(),
      email: p.email.trim().toLowerCase(),
    }))
  );

  // Free basket: confirm immediately.
  if (isFree) {
    // Mint one issued, credentialled ticket per purchased slot (U2) — nothing was
    // pre-seeded, so this mints the buyer's own seat(s) too.
    await mintRegistrationTickets(registrationId);
    // Name every ticket — buyer included — from the order (R1). A claim reporting
    // it did nothing (`already: true`) is a failure, not a success:
    // fillRegistrationRoster already treats that as unnamed rather than filled, and
    // logs it loudly below. The seats are already sold and the registration already
    // succeeded, so there is nothing to roll back; an un-filled slot stays issued
    // and can be named later from the manage page or at the door, and the log line
    // is what tells anyone to go do that.
    const fill = await fillRegistrationRoster(registrationId, allAttendees);
    if (fill.unnamed.length > 0) {
      console.error("[event-register] registration completed with unnamed seats", {
        registrationId,
        eventId,
        referenceCode,
        unnamed: fill.unnamed.length,
      });
    }
    // Neither mint_registration_tickets nor claim_ticket ever sets is_lead — flip it
    // on the buyer's own now-claimed ticket(s) so the manage/receipt access gate
    // (KTD4, lib/events/purchase-history.ts) still has something to key on.
    await markLeadTickets(registrationId, name, email);
    sendEventRegistrationConfirmation(registrationId).catch((err) =>
      console.error("[event-register] confirmation email failed", err)
    );
    return NextResponse.json({ success: true, reference_code: referenceCode });
  }

  // Paid basket: stash the whole order (buyer included) so the Stripe webhook can
  // apply it after payment (the tickets don't exist yet — mint runs post-payment).
  // Always non-empty here — every person in a valid order holds at least one
  // ticket type (validateOrder's no_ticket_types rule). FAIL-LOUD: if this write
  // fails we must NOT send the buyer to Stripe, or they'd pay for a roster that was
  // never stored. (The regPatch above stays best-effort.)
  const { error: rosterErr } = await supabase
    .from("event_registrations")
    .update({ pending_roster: allAttendees })
    .eq("id", registrationId);
  if (rosterErr) {
    console.error("[event-register] pending_roster persist failed — blocking checkout", {
      registrationId,
      err: rosterErr,
    });
    return bad("Could not save your guest details. Please try again.", 500);
  }

  // Paid basket: one Stripe line item per PAID type (free lines are recorded as
  // registration items but omitted here — Stripe rejects zero-amount lines).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const codeParam = code ? `&code=${encodeURIComponent(code)}` : "";
  // U6: carry the offer token through the round trip the way `code` is carried, so
  // a cancelled (or completed) offer checkout returns to the offer landing rather
  // than the full-event page, which would offer a waitlist-full visitor a form to
  // rejoin the waitlist they are already on (KTD5).
  const successUrl = offerEntry
    ? `${appUrl}/public/offers/${encodeURIComponent(offerToken)}?registered=1`
    : `${appUrl}/public/events/${eventId}?registered=1${codeParam}`;
  const cancelUrl = offerEntry
    ? `${appUrl}/public/offers/${encodeURIComponent(offerToken)}?cancelled=1`
    : `${appUrl}/public/events/${eventId}?cancelled=1${codeParam}`;

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: lineItems
        .filter((li) => li.unit_amount_chf > 0)
        .map((li) => ({
          price_data: {
            currency: "chf",
            unit_amount: Math.round(li.unit_amount_chf * 100),
            product_data: { name: li.title_snapshot },
          },
          quantity: li.quantity,
        })),
      customer_email: email,
      metadata: { event_registration_id: registrationId, event_id: eventId },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  } catch (err) {
    console.error("[event-register] Stripe session create failed", { eventId, email, registrationId, err });
    return bad("Could not start checkout", 500);
  }

  const { error: sessionUpdateErr } = await supabase
    .from("event_registrations")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", registrationId);
  if (sessionUpdateErr) {
    console.error("[event-register] failed to persist stripe_checkout_session_id", {
      eventId,
      registrationId,
      sessionId: session.id,
      err: sessionUpdateErr,
    });
    // Continue: webhook reconciles by metadata.event_registration_id.
  }

  return NextResponse.json({ checkout_url: session.url });
}
