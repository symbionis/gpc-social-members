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
  seedLeadAttendee,
  mintRegistrationTickets,
  fillRegistrationRoster,
  type RosterFillAttendee,
} from "@/lib/events/roster";
import { isFullName } from "@/lib/names";
import { parseAttendeeInput, collidesWithClaimed, EMAIL_RE } from "@/lib/events/attendee-input";
import { findRedeemingRegistration } from "@/lib/events/waitlist-offer";
import { captureServerException } from "@/lib/analytics/server-errors";
import { ABSOLUTE_MAX_TICKETS, resolveBookingLimit } from "@/lib/events/booking-limits";

const MAX_TICKETS = ABSOLUTE_MAX_TICKETS;
// Bounds for the nominative roster fields — this endpoint is unauthenticated, so
// reject oversized name/email rather than storing multi-megabyte junk (R10).

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
    items?: unknown;
    leadTicketTypeId?: unknown;
    attendees?: unknown;
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
  // (duplicate guard, the registration RPC, and Stripe's customer_email).
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

  // The purchaser's own ticket (their meal). Validated below to be one of the basket
  // types; recorded on the registration so the seeded lead carries a ticket type.
  const leadTicketTypeId =
    typeof body.leadTicketTypeId === "string" ? body.leadTicketTypeId.trim() : "";

  if (!name) return bad("name is required");
  // A first AND a last name. The roster files people by surname, so a one-word name
  // leaves that person with nothing to be filed under on the printed door sheet.
  // Enforced here as well as in the form: this route is unauthenticated.
  if (!isFullName(name)) return bad("Please enter both a first and last name");
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");

  // Parse the basket: one { ticket_type_id, quantity } per chosen type.
  // Reject negatives / non-integers (closes any arithmetic-abuse path); drop
  // zero-quantity rows (a type the buyer didn't select). At least one positive
  // line is required and the total is capped at MAX_TICKETS.
  const rawItems = Array.isArray(body.items) ? body.items : null;
  if (!rawItems) return bad("items must be provided");

  const parsed: { ticket_type_id: string; quantity: number }[] = [];
  for (const it of rawItems) {
    const rec = (it ?? {}) as { ticket_type_id?: unknown; quantity?: unknown };
    const ticketTypeId = typeof rec.ticket_type_id === "string" ? rec.ticket_type_id : "";
    const q =
      typeof rec.quantity === "number"
        ? rec.quantity
        : Number.parseInt(String(rec.quantity ?? ""), 10);
    if (!Number.isInteger(q) || q < 0) {
      return bad("Each ticket quantity must be a whole number of 0 or more");
    }
    if (q === 0) continue; // not selected
    if (!ticketTypeId) return bad("Each selected ticket must reference a ticket type");
    parsed.push({ ticket_type_id: ticketTypeId, quantity: q });
  }

  if (parsed.length === 0) return bad("Select at least one ticket");
  const totalQuantity = parsed.reduce((sum, p) => sum + p.quantity, 0);
  if (totalQuantity > MAX_TICKETS) {
    return bad(`A maximum of ${MAX_TICKETS} tickets can be booked at once`);
  }

  const supabase = createAdminClient();

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, is_published, registration_enabled, visibility, seat_cap, invite_code, max_tickets_member, max_tickets_invite, max_tickets_non_member"
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

  // One rate class for the whole basket, decided by session + code (never by the
  // client): member → price_member; invited guest on a members-only event →
  // invite_price; everyone else on a public event → price_non_member.
  const rateClass: "member" | "invite" | "non_member" = isMember
    ? "member"
    : isMembersOnly
      ? "invite"
      : "non_member";

  // Per-booking ticket limit (R4), one per rate class. Skipped entirely for an offer
  // redemption — an offer's own entry.quantity (checked above) is its only bound; an offer
  // was never scoped by the rate-class limit (R10), and the two must not stack.
  if (!offerEntry) {
    const bookingLimit = resolveBookingLimit(event, rateClass);
    if (totalQuantity > bookingLimit) {
      return bad(`A maximum of ${bookingLimit} tickets can be booked at once`, 400);
    }
  }

  // Load the submitted types, SCOPED to this event (IDOR guard) and rejecting
  // archived types. A foreign or unknown id shrinks the returned set → 400.
  const ids = [...new Set(parsed.map((p) => p.ticket_type_id))];
  // A type may appear at most once in the basket — the client always sends one line
  // per type. Two positive lines for the same type would let the naming-capacity
  // check (keyed on a per-type Map, last-write-wins) under-count the required names
  // while the line-items and minted tickets sum across both lines — a crafted
  // `items:[{t,19},{t,1}]` would buy 20 tickets while requiring 0 to be named,
  // silently defeating mandatory naming (R1) on this unauthenticated route.
  if (ids.length !== parsed.length) {
    return bad("Each ticket type may appear only once in your order", 400);
  }
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

  // The lead's own ticket must be one of the basket's types. Every ticket type is
  // equally eligible for the buyer's own slot (R6).
  let leadType: string | null = leadTicketTypeId || null;
  if (leadType && !ids.includes(leadType)) {
    return bad("Your ticket must be one of the selected tickets", 400);
  }
  // Resolve the lead's ticket type from the basket when the client didn't send one:
  // a single selected type implies it; 2+ selected types are genuinely ambiguous and
  // must be chosen (mirrors the client "You"-row gate) rather than seeding an untyped
  // lead.
  if (!leadType && ids.length === 1) {
    leadType = ids[0];
  }
  if (!leadType && ids.length >= 2) {
    return bad("Please choose which ticket is yours", 400);
  }

  // Every purchased guest slot needs a name and an email before checkout can
  // complete (R1) — no path may create an unnamed ticket, and a former child type
  // is no longer exempt (R6, R8). Any number of tickets may share one address (R2)
  // — only the booker-level registration guard below (KTD7) still rejects a
  // duplicate. Bounds close abuse paths on this unauthenticated route.
  // Mandatory naming (R1), enforced by the shared parser so the top-up path cannot drift from
  // this one. The lead's own slot is seeded from the booker fields, so their type needs one
  // fewer name than it sold.
  const purchasedPerType = new Map(parsed.map((p) => [p.ticket_type_id, p.quantity]));
  const requiredPerType = new Map(
    [...purchasedPerType].map(([ttId, qty]) => [ttId, qty - (leadType === ttId ? 1 : 0)]),
  );
  const parsedAttendees = parseAttendeeInput(
    body.attendees,
    requiredPerType,
    (ttId) => typeById.has(ttId),
    MAX_TICKETS,
  );
  if (!parsedAttendees.ok) return bad(parsedAttendees.error, 400);
  const normalizedAttendees: RosterFillAttendee[] = parsedAttendees.attendees;

  // ...and the booker cannot name themselves onto a SECOND seat of their own ticket type.
  // parseAttendeeInput only sees the guest rows; the buyer's own seat is not among them, it is
  // seeded from the booker fields moments from now. So the one collision it cannot see is the
  // one that actually happens: a booker buying two of a type and typing their own name and
  // email into the guest row. claim_ticket reads that as a replay of the lead's claim, returns
  // already=true, claims nothing — and the second seat is minted, credentialled, and
  // permanently unnamed. That is how four bookings lost a guest before this check existed.
  //
  // Compared against the PENDING lead identity rather than the tickets table: no seat exists
  // yet at this point in the request. Same type only — the buyer holding Friday and Saturday
  // is not a collision, and telling them to "name your guest" for their own second day would
  // strand them with no way to complete the order.
  if (leadType) {
    const leadClash = collidesWithClaimed(normalizedAttendees, [
      { name, email, ticket_type_id: leadType },
    ]);
    if (leadClash) {
      return bad(
        "You already have a seat under that name — please name your guest (same email allowed).",
        400,
      );
    }
  }

  // Resolve per-line prices. STRICT null check before any coercion — Number(null)
  // === 0 would silently make a line free, so an unset price for the resolved
  // class fails loud rather than under-charging.
  const lineItems: {
    ticket_type_id: string;
    title_snapshot: string;
    quantity: number;
    unit_amount_chf: number;
    line_total_chf: number;
  }[] = [];
  let total = 0;
  let seatQuantity = 0;

  for (const p of parsed) {
    const t = typeById.get(p.ticket_type_id)!;
    const unit = priceForRateClass(t, rateClass);
    if (!isUsablePrice(unit)) {
      return bad("Event pricing is misconfigured", 500);
    }
    const unitAmount = Number(unit);
    const lineTotal = Number((unitAmount * p.quantity).toFixed(2));
    total += lineTotal;
    if (t.counts_as_seat) seatQuantity += p.quantity;
    lineItems.push({
      ticket_type_id: t.id,
      title_snapshot: t.title,
      quantity: p.quantity,
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

  // Persist the captured phone and the registration's manage token. The phone is matched
  // at the door; the manage_token scopes the party's lead "My Booking" link (sent in the
  // confirmation email). Best-effort and non-blocking — a failure here never fails an
  // already-created registration, it only leaves that party without phone / a manage link.
  // Self-registration is retired (U16); its token and column have since been dropped (R28).
  const regPatch: {
    phone_e164?: string;
    manage_token: string;
    lead_ticket_type_id?: string;
  } = {
    // Path-secret for the lead "My Booking" page (U4). Sent in the confirmation email as
    // manage_url. generateSelfRegToken is kept for its CSPRNG shape (name is historical).
    manage_token: generateSelfRegToken(),
  };
  if (phone) regPatch.phone_e164 = phone;
  if (leadType) regPatch.lead_ticket_type_id = leadType;
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

  // Free basket: confirm immediately.
  if (isFree) {
    // Confirmed now → seed the purchaser onto the roster (paid registrations seed
    // in the Stripe webhook after promotion to 'paid'). Pass the phone in-hand so a
    // failed phone UPDATE above doesn't leave the lead unmatchable by phone.
    await seedLeadAttendee(registrationId, phone || null);
    // Mint a credentialled (QR) ticket for every remaining purchased slot (U2).
    await mintRegistrationTickets(registrationId);
    // Name the guest tickets the booker filled in at checkout. The collision check above
    // removes the one cause of a silent no-op we know of, so anything still unnamed here is
    // unexpected — fillRegistrationRoster logs it loudly with the guest details. The seats are
    // already sold and the registration already succeeded, so there is nothing to roll back;
    // an un-filled slot stays issued and can be named later from the lead's manage page or at
    // the door, and the log line is what tells anyone to go do that.
    const fill = await fillRegistrationRoster(registrationId, normalizedAttendees);
    if (fill.unnamed.length > 0) {
      console.error("[event-register] registration completed with unnamed seats", {
        registrationId,
        eventId,
        referenceCode,
        unnamed: fill.unnamed.length,
      });
    }
    sendEventRegistrationConfirmation(registrationId).catch((err) =>
      console.error("[event-register] confirmation email failed", err)
    );
    return NextResponse.json({ success: true, reference_code: referenceCode });
  }

  // Paid basket: stash the booker-entered guest roster so the Stripe webhook can
  // apply it after payment (the tickets don't exist yet — mint runs post-payment).
  // FAIL-LOUD: if this write fails we must NOT send the buyer to Stripe, or they'd
  // pay for a roster that was never stored. (The regPatch above stays best-effort.)
  if (normalizedAttendees.length > 0) {
    const { error: rosterErr } = await supabase
      .from("event_registrations")
      .update({ pending_roster: normalizedAttendees })
      .eq("id", registrationId);
    if (rosterErr) {
      console.error("[event-register] pending_roster persist failed — blocking checkout", {
        registrationId,
        err: rosterErr,
      });
      return bad("Could not save your guest details. Please try again.", 500);
    }
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
