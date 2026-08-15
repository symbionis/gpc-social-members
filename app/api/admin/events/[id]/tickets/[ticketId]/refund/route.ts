import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { captureServerException } from "@/lib/analytics/server-errors";
import { ticketRefundValueChf } from "@/lib/events/refunds";
import {
  findRefundForTicket,
  mergePaymentIntentIds,
  planRefundDraws,
  readRefundableBalances,
} from "@/lib/events/refund-pool";

// Admin action: refund one holder-cancelled seat.
//
// This route USED to be a flag-flip — the admin issued the refund by hand in the Stripe
// dashboard and then came back to mark the ticket refunded. Two systems with an optional human
// step between them, and the human step was missed: on Pilates & Polo 3.0 that seam lost
// CHF 560 from the books. The route now issues the refund itself.
//
// Three rules hold this together, each answering a way the previous design lost money:
//
//   1. NEVER RECORD MONEY THAT DID NOT MOVE. Every write of `refund_amount_chf` is either a
//      real Stripe refund's own amount, or a deliberate zero for a seat that cost nothing.
//      Deriving an amount and recording it because Stripe said something adjacent (the old
//      `charge_already_refunded` path) is how the books drift.
//   2. THE BOOKING IS THE UNIT OF MONEY. A booking can hold several charges — the original
//      checkout plus a PaymentIntent per top-up and per priced conversion. Refunds draw from
//      that pool (lib/events/refund-pool.ts) rather than assuming the registration's own
//      PaymentIntent holds every seat's money, which it does not.
//   3. REFUSE RATHER THAN GUESS. If the pool cannot be confirmed, or cannot cover the seat, the
//      route stops and says so. A seat left in 'requested' is a visible queue item; a seat
//      wrongly marked 'refunded' is silent and permanent.
//
// Ordering is refund-then-write. A ticket must never read 'refunded' when Stripe declined. The
// reverse — Stripe refunded, our write failed — is recoverable: retrying finds the existing
// refund by its `metadata.ticket_id` and completes the write without sending money again. That
// lookup, not the idempotency key, is what makes the guarantee durable; Stripe v1 idempotency
// keys expire after 24 hours, so a retry the next morning would otherwise refund twice.
//
// Seat release already happened when the holder cancelled, so this changes no seat count.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

/** The refund route's response shape, so callers read the SERVER's amount, not their own. */
export interface RefundTicketResponse {
  ok: true;
  /** CHF actually returned to the payer. 0 for a seat that cost nothing. */
  refundedChf: number;
  /** Stripe refund ids, comma-joined when a seat drew on more than one charge. */
  refundId: string | null;
  /** True when this seat cost nothing, so no money moved and none was owed. */
  nothingToRefund?: boolean;
  /** True when Stripe already held a refund for this seat and the record simply caught up. */
  reconciled?: boolean;
  /** True when the seat was already settled before this request. */
  alreadyRefunded?: boolean;
}

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Unauthorized", status: 401 as const };

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || !admin.id || !ALLOWED_ROLES.includes(admin.role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Stripe's SDK throws plain objects in tests and StripeError instances at runtime; read the
// fields structurally rather than instanceof-ing across that boundary.
function stripeErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  // Deliberately not "Stripe rejected the refund" — a connection error or timeout is exactly
  // the case where money MAY have moved, and asserting a rejection there would be false.
  return "The refund could not be completed. Check Stripe before retrying.";
}

function chf(minor: number): number {
  return Math.round(minor) / 100;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, ticketId } = await params;
  if (!UUID_RE.test(ticketId)) return bad("Invalid ticket", 400);

  // Scoped to the path event so an admin can't refund another event's ticket through this
  // route — the guard matters more now that the route moves money.
  const { data: ticket, error: ticketErr } = await adminClient
    .from("tickets")
    .select("id, registration_id, ticket_type_id, cancellation_status")
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();

  if (ticketErr) {
    console.error("[ticket-refund] ticket lookup failed", { eventId, ticketId, err: ticketErr });
    return bad("Could not load the ticket. Please try again.", 503);
  }
  if (!ticket) return bad("Ticket not found", 404);
  if (ticket.cancellation_status === "refunded") {
    return NextResponse.json({ ok: true, refundedChf: 0, refundId: null, alreadyRefunded: true });
  }
  if (ticket.cancellation_status !== "requested") {
    return bad("Only a cancelled ticket can be refunded", 409);
  }
  if (!ticket.registration_id) {
    return bad("This ticket has no booking to refund against", 409);
  }

  const { data: registration, error: regErr } = await adminClient
    .from("event_registrations")
    .select("id, status, quantity, total_amount_chf, stripe_payment_intent_id")
    .eq("id", ticket.registration_id)
    .limit(1)
    .maybeSingle();

  if (regErr) {
    console.error("[ticket-refund] registration lookup failed", { eventId, ticketId, err: regErr });
    return bad("Could not load the booking. Please try again.", 503);
  }
  if (!registration) return bad("Booking not found", 404);

  const { data: items, error: itemsErr } = await adminClient
    .from("event_registration_items")
    .select("registration_id, ticket_type_id, unit_amount_chf")
    .eq("registration_id", registration.id);

  if (itemsErr) {
    console.error("[ticket-refund] item lookup failed", { eventId, ticketId, err: itemsErr });
    return bad("Could not load the booking's ticket lines. Please try again.", 503);
  }

  const amountChf = ticketRefundValueChf(ticket, registration, items ?? []);

  // Settle the ticket, shared by every success path below. `refundedChf` is always what
  // actually moved — never a derived figure standing in for one.
  const settle = async (refundedChf: number, refundId: string | null) =>
    adminClient
      .from("tickets")
      .update({
        cancellation_status: "refunded",
        cancellation_refunded_at: new Date().toISOString(),
        refund_amount_chf: refundedChf,
        stripe_refund_id: refundId,
      })
      .eq("id", ticketId)
      .eq("event_id", eventId)
      .eq("cancellation_status", "requested")
      .select("id")
      .maybeSingle();

  // Distinguishes "someone else settled this a moment ago" from "our write failed" — the two
  // used to be conflated, so a second admin clicking Refund on an already-settled seat was
  // told the money had moved but could not be saved.
  const settledByAnother = async () => {
    const { data } = await adminClient
      .from("tickets")
      .select("cancellation_status")
      .eq("id", ticketId)
      .eq("event_id", eventId)
      .limit(1)
      .maybeSingle();
    return data?.cancellation_status === "refunded";
  };

  // ---------------------------------------------------------------------------
  // A seat that cost nothing: a comp, or any seat on a free booking. No money was taken, so
  // none is owed and none moves. Closing it at zero is honest AND necessary — refusing would
  // strand the cancellation in 'requested' with no way for an admin to clear it.
  // ---------------------------------------------------------------------------
  if (amountChf <= 0) {
    const { data: updated, error: updErr } = await settle(0, null);
    if (updErr || !updated) {
      if (!updErr && (await settledByAnother())) {
        return NextResponse.json({ ok: true, refundedChf: 0, refundId: null, alreadyRefunded: true });
      }
      console.error("[ticket-refund] zero-value settle failed", { eventId, ticketId, err: updErr });
      return bad("Could not update the ticket. Please try again.", 500);
    }
    return NextResponse.json({
      ok: true,
      refundedChf: 0,
      refundId: null,
      nothingToRefund: true,
    } satisfies RefundTicketResponse);
  }

  // ---------------------------------------------------------------------------
  // A paid seat. From here every path either moves real money or refuses — nothing in between
  // writes a refund record.
  // ---------------------------------------------------------------------------
  // The booking's other charges: one PaymentIntent per applied top-up and per priced
  // conversion. A `pending` row was never paid, so it holds no money and is excluded.
  const [topups, conversions] = await Promise.all([
    adminClient
      .from("event_registration_topups")
      .select("stripe_payment_intent_id")
      .eq("registration_id", registration.id)
      .not("applied_at", "is", null),
    adminClient
      .from("event_ticket_type_conversions")
      .select("stripe_payment_intent_id")
      .eq("registration_id", registration.id)
      .not("applied_at", "is", null),
  ]);

  if (topups.error || conversions.error) {
    // We could not enumerate the booking's charges, so we cannot know what is refundable.
    // Refusing beats refunding against a pool we can't vouch for.
    console.error("[ticket-refund] extra charge lookup failed", {
      eventId,
      ticketId,
      topupErr: topups.error,
      conversionErr: conversions.error,
    });
    return bad("Could not confirm this booking's payments. Please try again.", 503);
  }

  const pool = {
    ids: mergePaymentIntentIds(registration.stripe_payment_intent_id, [
      ...(topups.data ?? []).map((r) => r.stripe_payment_intent_id as string | null),
      ...(conversions.data ?? []).map((r) => r.stripe_payment_intent_id as string | null),
    ]),
  };

  if (pool.ids.length === 0) {
    // A priced seat with no Stripe payment on record: paid by transfer, imported, or a webhook
    // that never captured the PaymentIntent. Do NOT close it at zero — that would tell the
    // admin nothing was owed while the guest is still waiting for CHF <amountChf>.
    return bad(
      "This booking has no Stripe payment on record, so it can't be refunded here. Refund it in Stripe and record it against the booking.",
      409
    );
  }

  const stripe = getStripe();

  // Has this exact seat already been refunded? Answered from Stripe's own records via the
  // ticket id we stamp on every refund, so it stays true long after the idempotency key
  // expires — and it also catches a refund issued by hand in the dashboard.
  try {
    const existing = await findRefundForTicket(stripe, pool.ids, ticketId);
    if (existing) {
      const refundedChf = chf(existing.amount);
      const { data: updated, error: updErr } = await settle(refundedChf, existing.id);
      if (updErr || !updated) {
        if (!updErr && (await settledByAnother())) {
          return NextResponse.json({
            ok: true,
            refundedChf,
            refundId: existing.id,
            alreadyRefunded: true,
          });
        }
        console.error("[ticket-refund] reconcile write failed", { eventId, ticketId, err: updErr });
        return bad("Could not update the ticket. Please try again.", 500);
      }
      return NextResponse.json({
        ok: true,
        refundedChf,
        refundId: existing.id,
        reconciled: true,
      } satisfies RefundTicketResponse);
    }
  } catch (err) {
    console.error("[ticket-refund] existing-refund lookup failed", { eventId, ticketId, err });
    return bad("Could not check this booking's refunds in Stripe. Please try again.", 502);
  }

  // CHF is a 2-decimal currency, so minor units are centimes — same conversion the checkout
  // routes use when they build line items.
  const amountMinor = Math.round(amountChf * 100);

  let plan;
  try {
    const slots = await readRefundableBalances(stripe, pool.ids);
    plan = planRefundDraws(slots, amountMinor);
  } catch (err) {
    console.error("[ticket-refund] balance read failed", { eventId, ticketId, err });
    return bad("Could not read this booking's payments from Stripe. Please try again.", 502);
  }

  if (plan.shortfallMinor > 0) {
    // The booking's charges can't cover this seat — already refunded elsewhere, or partially
    // refunded by hand. Refusing is the whole point: the old code refunded what it could and
    // recorded the full amount anyway.
    const coverable = chf(amountMinor - plan.shortfallMinor);
    return bad(
      `This booking only has CHF ${coverable.toFixed(2)} left to refund, but the seat is worth CHF ${amountChf.toFixed(2)}. It may already have been refunded in Stripe — check there and settle it manually.`,
      409
    );
  }

  const refundIds: string[] = [];
  let refundedMinor = 0;
  try {
    for (const draw of plan.draws) {
      const refund = await stripe.refunds.create(
        {
          payment_intent: draw.paymentIntentId,
          amount: draw.amountMinor,
          metadata: { event_id: eventId, ticket_id: ticketId, registration_id: registration.id },
        },
        // Keyed per charge as well as per ticket, so a seat drawing on two charges doesn't
        // reuse one key with different parameters (which Stripe rejects).
        { idempotencyKey: `evt-ticket-refund-${ticketId}-${draw.paymentIntentId}` }
      );
      refundIds.push(refund.id);
      refundedMinor += refund.amount;
    }
  } catch (err) {
    if (refundedMinor > 0) {
      // Part of the seat's money left the account. Loudest possible failure: this cannot be
      // reconstructed from the response alone once the admin closes the tab.
      const detail = `partial refund: ticket=${ticketId} refunded=${chf(refundedMinor)} of ${amountChf} refunds=${refundIds.join(",")}`;
      console.error("[ticket-refund] PARTIAL REFUND — reconcile manually", { eventId, detail, err });
      captureServerException(new Error(`[ticket-refund] PARTIAL REFUND — ${detail}`), {
        route_kind: "ticket-refund",
        status: 500,
      });
      return NextResponse.json(
        {
          error: `Part of this refund went through (CHF ${chf(refundedMinor).toFixed(2)} of ${amountChf.toFixed(2)}, ${refundIds.join(", ")}) and the rest failed. Check Stripe before retrying.`,
          refundId: refundIds.join(","),
        },
        { status: 500 }
      );
    }
    console.error("[ticket-refund] stripe refund failed", { eventId, ticketId, amountMinor, err });
    return bad(stripeErrorMessage(err), 502);
  }

  const refundedChf = chf(refundedMinor);
  const refundId = refundIds.join(",");
  const { data: updated, error: updErr } = await settle(refundedChf, refundId);

  if (updErr || !updated) {
    if (!updErr && (await settledByAnother())) {
      // A concurrent request settled it. The idempotency key means both saw the same refund,
      // so nothing is wrong — reporting a money-moved-but-unsaved alarm here would be a lie.
      return NextResponse.json({ ok: true, refundedChf, refundId, alreadyRefunded: true });
    }
    // Money moved and we failed to record it. This is the alarm the whole design rests on, so
    // it goes to error tracking, not just to a log that rotates.
    const detail = `ticket=${ticketId} refunded=${refundedChf} refunds=${refundId}`;
    console.error("[ticket-refund] REFUND ISSUED BUT NOT RECORDED — reconcile manually", {
      eventId,
      detail,
      err: updErr,
    });
    captureServerException(
      new Error(`[ticket-refund] REFUND ISSUED BUT NOT RECORDED — ${detail}`),
      { route_kind: "ticket-refund", status: 500 }
    );
    return NextResponse.json(
      {
        error: `The refund went through in Stripe (${refundId}) but could not be saved here. Retry — it will find the existing refund rather than sending money again.`,
        refundId,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    refundedChf,
    refundId,
  } satisfies RefundTicketResponse);
}
