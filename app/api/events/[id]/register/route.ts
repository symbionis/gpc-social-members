import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { generateReferenceCode } from "@/lib/events/registration";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: { name?: unknown; email?: unknown; quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const quantity =
    typeof body.quantity === "number"
      ? body.quantity
      : Number.parseInt(String(body.quantity ?? ""), 10);

  if (!name) return bad("name is required");
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
    return bad("quantity must be an integer between 1 and 6");
  }

  const supabase = createAdminClient();

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, title, is_published, registration_enabled, price_member, price_non_member, visibility, seat_cap"
    )
    .eq("id", eventId)
    .limit(1)
    .single();

  if (eventErr || !event) return bad("Event not found", 404);
  if (!event.is_published) return bad("Event is not published");
  if (!event.registration_enabled) {
    return bad("Registration is not open for this event");
  }

  // Member detection: only trust an authenticated session, never the form email.
  // The cookie-bound session establishes identity; we then look up the linked
  // active member. The form email is used only for the registration record /
  // Stripe customer email and never affects pricing.
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

  // Members-only events require an authenticated active member.
  if (event.visibility === "members_only" && !isMember) {
    return bad("This event is for members only", 403);
  }

  const unitAmount = isMember
    ? Number(event.price_member)
    : Number(event.price_non_member);

  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
    return bad("Event pricing is misconfigured", 500);
  }

  const totalAmount = Number((unitAmount * quantity).toFixed(2));
  const isFree = totalAmount === 0;
  const referenceCode = generateReferenceCode();

  // Duplicate guard: prevent the same email registering for the same event
  // more than once in a paid/free/confirmed state. Open `pending` rows are
  // allowed since the user may have abandoned a checkout.
  const { data: existingReg } = await supabase
    .from("event_registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("email", email)
    .in("status", ["paid", "free"])
    .limit(1);

  if (existingReg && existingReg.length > 0) {
    return bad("This email is already registered for this event", 409);
  }

  // Capacity check: recount paid+free seats immediately before insert.
  // Pending checkouts don't count, so two final checkouts on the last seat
  // can both succeed (documented oversell-by-one trade-off).
  if (event.seat_cap !== null && event.seat_cap !== undefined) {
    let seatsUsed: number;
    try {
      seatsUsed = await getSeatsUsed(supabase, eventId);
    } catch (err) {
      console.error("[event-register] seat usage lookup failed", { eventId, err });
      return bad("Could not verify availability", 500);
    }

    if (seatsUsed + quantity > event.seat_cap) {
      return bad("Not enough seats remaining", 409);
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("event_registrations")
    .insert({
      event_id: eventId,
      name,
      email,
      quantity,
      is_member: isMember,
      member_id: memberId,
      unit_amount_chf: unitAmount,
      total_amount_chf: totalAmount,
      status: isFree ? "free" : "pending",
      reference_code: referenceCode,
      paid_at: isFree ? new Date().toISOString() : null,
    })
    .select("id")
    .limit(1)
    .single();

  if (insertErr || !inserted) {
    // Race with the partial unique index (event_id, lower(email)) WHERE
    // status IN ('paid','free'): a concurrent duplicate raises 23505 — surface
    // it as the same "already registered" 409 the pre-check returns. (Fires for
    // free registrations; paid rows insert as 'pending' and are deduped at the
    // pending→paid promotion in the Stripe webhook.)
    if (insertErr && (insertErr as { code?: string }).code === "23505") {
      return bad("This email is already registered for this event", 409);
    }
    console.error("[event-register] insert failed", {
      eventId,
      email,
      quantity,
      err: insertErr,
    });
    return bad("Could not create registration", 500);
  }

  // Free path: send confirmation immediately
  if (isFree) {
    sendEventRegistrationConfirmation(inserted.id).catch((err) =>
      console.error("[event-register] confirmation email failed", err)
    );
    return NextResponse.json({
      success: true,
      reference_code: referenceCode,
    });
  }

  // Paid path: create Stripe Checkout Session
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "chf",
            unit_amount: Math.round(unitAmount * 100),
            product_data: { name: event.title },
          },
          quantity,
        },
      ],
      customer_email: email,
      metadata: {
        event_registration_id: inserted.id,
        event_id: eventId,
      },
      success_url: `${appUrl}/public/events/${eventId}?registered=1`,
      cancel_url: `${appUrl}/public/events/${eventId}?cancelled=1`,
    });
  } catch (err) {
    console.error("[event-register] Stripe session create failed", {
      eventId,
      email,
      registrationId: inserted.id,
      err,
    });
    return bad("Could not start checkout", 500);
  }

  // Persist session id; webhook idempotency uses it for confirmation, but
  // primary lookup is by metadata.event_registration_id so we still recover
  // if this update fails. We surface the error rather than silently dropping.
  const { error: sessionUpdateErr } = await supabase
    .from("event_registrations")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", inserted.id);

  if (sessionUpdateErr) {
    console.error(
      "[event-register] failed to persist stripe_checkout_session_id",
      { eventId, registrationId: inserted.id, sessionId: session.id, err: sessionUpdateErr }
    );
    // Continue: webhook will still find the row by event_registration_id.
  }

  return NextResponse.json({ checkout_url: session.url });
}
