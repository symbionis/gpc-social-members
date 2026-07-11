import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { getSeatsUsed } from "@/lib/events/seat-usage";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TICKETS = 20;
// Bounds for the nominative roster fields — this endpoint is unauthenticated, so
// reject oversized name/email rather than storing multi-megabyte junk (R10).
const MAX_ATTENDEE_NAME = 120;
const MAX_ATTENDEE_EMAIL = 254;

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
  };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
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
    .select("id, is_published, registration_enabled, visibility, seat_cap, invite_code")
    .eq("id", eventId)
    .limit(1)
    .single();

  if (eventErr || !event) return bad("Event not found", 404);
  if (!event.is_published) return bad("Event is not published");
  if (!event.registration_enabled) {
    return bad("Registration is not open for this event");
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
  // ONLY this block — it never confers pricing.
  const isMembersOnly = event.visibility === "members_only";
  const hasValidInvite = isValidInviteCode(event.invite_code, code);
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

  // Load the submitted types, SCOPED to this event (IDOR guard) and rejecting
  // archived types. A foreign or unknown id shrinks the returned set → 400.
  const ids = [...new Set(parsed.map((p) => p.ticket_type_id))];
  const { data: types, error: typesErr } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, counts_as_seat, is_child, archived_at")
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
  const typeById = new Map(types.map((t) => [t.id, t]));

  // The lead's own ticket must be one of the basket's non-child types.
  let leadType: string | null = leadTicketTypeId || null;
  if (leadType && !ids.includes(leadType)) {
    return bad("Your ticket must be one of the selected tickets", 400);
  }
  // The buyer's own ticket can't be a children's ticket.
  if (leadType && typeById.get(leadType)?.is_child) {
    return bad("Your ticket can't be a children's ticket", 400);
  }
  // Resolve the lead's ticket type from the basket when the client didn't send one:
  // a single adult type implies it; 2+ adult types are genuinely ambiguous and must
  // be chosen (mirrors the client "You"-row gate) rather than seeding an untyped lead.
  const adultTypeIds = ids.filter((id) => !typeById.get(id)?.is_child);
  if (!leadType && adultTypeIds.length === 1) {
    leadType = adultTypeIds[0];
  }
  if (!leadType && adultTypeIds.length >= 2) {
    return bad("Please choose which ticket is yours", 400);
  }

  // Parse the OPTIONAL nominative roster: booker-entered names for GUEST tickets
  // (the lead is seeded separately from leadType). Never trust a client is_child —
  // derive it from the ticket type. Adults need a valid distinct email; children are
  // name-only. Bounds + distinctness close abuse paths on this unauthenticated route.
  const rawAttendees = Array.isArray(body.attendees) ? body.attendees : [];
  if (rawAttendees.length > MAX_TICKETS) {
    return bad("Too many attendees for one order", 400);
  }
  const normalizedAttendees: RosterFillAttendee[] = [];
  const seenEmails = new Set<string>();
  if (email) seenEmails.add(email); // the lead's email — guests must differ (R9)
  const namedPerType = new Map<string, number>();
  for (const raw of rawAttendees) {
    const rec = (raw ?? {}) as { ticket_type_id?: unknown; name?: unknown; email?: unknown };
    const ttId = typeof rec.ticket_type_id === "string" ? rec.ticket_type_id : "";
    const t = typeById.get(ttId);
    if (!t) return bad("An attendee references a ticket not in your order", 400);
    const nm = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!nm) return bad("Each named ticket needs a name", 400);
    if (nm.length > MAX_ATTENDEE_NAME) return bad("An attendee name is too long", 400);
    // Adults need a surname to be filed under; a child is named by an adult and is
    // often mononymous ("Emma"), so children keep the single-name path.
    if (!t.is_child && !isFullName(nm)) {
      return bad("Each named guest needs a first and last name", 400);
    }
    let attEmail: string | null = null;
    if (!t.is_child) {
      const e = typeof rec.email === "string" ? rec.email.trim().toLowerCase() : "";
      if (!e || !EMAIL_RE.test(e)) return bad("Each named adult needs a valid email", 400);
      if (e.length > MAX_ATTENDEE_EMAIL) return bad("An attendee email is too long", 400);
      if (seenEmails.has(e)) {
        return bad("Each attendee needs a different email address", 400);
      }
      seenEmails.add(e);
      attEmail = e;
    }
    namedPerType.set(ttId, (namedPerType.get(ttId) ?? 0) + 1);
    normalizedAttendees.push({ ticket_type_id: ttId, name: nm, email: attEmail });
  }
  // A type's named guests can't exceed the purchased quantity minus the lead's own
  // slot of that type (the lead is seeded, not in this list).
  const purchasedPerType = new Map(parsed.map((p) => [p.ticket_type_id, p.quantity]));
  for (const [ttId, named] of namedPerType) {
    const capacity = (purchasedPerType.get(ttId) ?? 0) - (leadType === ttId ? 1 : 0);
    if (named > capacity) {
      return bad("More named guests than tickets for a ticket type", 400);
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
    const unit =
      rateClass === "member"
        ? t.price_member
        : rateClass === "invite"
          ? t.invite_price
          : t.price_non_member;
    if (unit === null || !Number.isFinite(Number(unit)) || Number(unit) < 0) {
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

  // Persist the captured phone (U12) and a self-registration token (U9) on the
  // registration. The phone is matched at the door; the token scopes the party's
  // self-registration link (sent in the confirmation email, U10). Best-effort:
  // both are non-blocking — a failure here never fails an already-created
  // registration, it only leaves that party without phone / a shareable link.
  const regPatch: {
    phone_e164?: string;
    self_reg_token: string;
    manage_token: string;
    lead_ticket_type_id?: string;
  } = {
    self_reg_token: generateSelfRegToken(),
    // Path-secret for the lead "My Booking" page (U4). Same CSPRNG shape as the
    // self-reg token; sent in the confirmation email (U9) as manage_url.
    manage_token: generateSelfRegToken(),
  };
  if (phone) regPatch.phone_e164 = phone;
  if (leadType) regPatch.lead_ticket_type_id = leadType;
  const { error: patchErr } = await supabase
    .from("event_registrations")
    .update(regPatch)
    .eq("id", registrationId);
  if (patchErr) {
    console.error("[event-register] failed to persist phone/self_reg_token", {
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
    // Name the guest tickets the booker filled in at checkout (best-effort; any
    // un-filled slot stays issued and is reachable via the self-registration link).
    await fillRegistrationRoster(registrationId, normalizedAttendees);
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
      success_url: `${appUrl}/public/events/${eventId}?registered=1${codeParam}`,
      cancel_url: `${appUrl}/public/events/${eventId}?cancelled=1${codeParam}`,
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
