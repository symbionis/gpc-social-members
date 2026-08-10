import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { ticketRefundValueChf } from "@/lib/events/refunds";

// Admin action: refund one holder-cancelled ticket.
//
// This route USED to be a flag-flip — the admin issued the refund by hand in the Stripe
// dashboard and then came back to mark the ticket refunded. Two systems, one human in
// between, and the human step is optional: on Pilates & Polo 3.0 that seam lost CHF 320 of
// refunds from the books (one PaymentIntent refunded in full but marked for a single ticket,
// another refunded with no app record at all). The route now issues the refund itself, so the
// money movement and the record are one action.
//
// Ordering is refund-then-write, deliberately. A ticket must never read 'refunded' when Stripe
// declined — the reverse (Stripe refunded, our write failed) is recoverable and self-heals:
// the idempotency key means retrying the same ticket returns the SAME refund object rather
// than sending money twice, and the retry then completes the write. The failure response names
// the refund id so it can also be reconciled by hand.
//
// Seat release already happened when the holder cancelled, so this changes no seat count.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

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
function stripeErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function stripeErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Stripe rejected the refund.";
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
  // route — the same guard the flag-flip version carried, and it matters more now that the
  // route moves money.
  const { data: ticket, error: ticketErr } = await adminClient
    .from("tickets")
    .select("id, registration_id, ticket_type_id, is_comp, cancellation_status")
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
    // Idempotent no-op: the money is already back and recorded.
    return NextResponse.json({ ok: true, alreadyRefunded: true });
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
    console.error("[ticket-refund] registration lookup failed", {
      eventId,
      ticketId,
      err: regErr,
    });
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

  // A comped seat, a free booking, or a booking with no Stripe payment has nothing to send
  // back. Settle it at CHF 0 rather than refusing: the seat is cancelled either way, and
  // refusing would strand the ticket in 'requested' with no way for an admin to close it.
  // Finance subtracts 0, which is correct — it never contributed revenue to subtract.
  const nothingToRefund = amountChf <= 0 || !registration.stripe_payment_intent_id;

  // CHF is a 2-decimal currency, so minor units are centimes — same conversion the checkout
  // routes use when they build line items.
  const amountMinor = Math.round(amountChf * 100);

  let refundId: string | null = null;
  let reconciledOutOfBand = false;
  if (!nothingToRefund) {
    try {
      const refund = await getStripe().refunds.create(
        {
          payment_intent: registration.stripe_payment_intent_id as string,
          amount: amountMinor,
          metadata: { event_id: eventId, ticket_id: ticketId, registration_id: registration.id },
        },
        // Keyed on the ticket, so a double-click — or a retry after our own write failed —
        // returns the original refund instead of sending the money a second time.
        { idempotencyKey: `evt-ticket-refund-${ticketId}` }
      );
      refundId = refund.id;
    } catch (err) {
      // The charge was already fully refunded in the Stripe dashboard. Nothing more to send,
      // but the app's record is what's wrong here — so record it rather than erroring. This is
      // the precise state the Pilates & Polo 3.0 bookings were left in.
      if (stripeErrorCode(err) === "charge_already_refunded") {
        reconciledOutOfBand = true;
      } else {
        console.error("[ticket-refund] stripe refund failed", {
          eventId,
          ticketId,
          paymentIntent: registration.stripe_payment_intent_id,
          amountMinor,
          err,
        });
        return bad(stripeErrorMessage(err), 502);
      }
    }
  }

  const { data: updated, error: updErr } = await adminClient
    .from("tickets")
    .update({
      cancellation_status: "refunded",
      cancellation_refunded_at: new Date().toISOString(),
      refund_amount_chf: amountChf,
      stripe_refund_id: refundId,
    })
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .eq("cancellation_status", "requested")
    .select("id")
    .maybeSingle();

  if (updErr || !updated) {
    // Money may have moved. FAIL LOUD and name the refund so it can be reconciled — never
    // report success for a refund we failed to record, which is how the books drifted before.
    console.error(
      "[ticket-refund] REFUND ISSUED BUT NOT RECORDED — reconcile manually",
      { eventId, ticketId, refundId, amountChf, err: updErr }
    );
    return NextResponse.json(
      {
        error: refundId
          ? `The refund went through in Stripe (${refundId}) but could not be saved here. Retry — it will not refund twice.`
          : "Could not update the ticket. Please try again.",
        refundId,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    amountChf,
    refundId,
    // The caller surfaces a different confirmation for this: no money moved just now, the app
    // simply caught up with a refund that had been issued in the Stripe dashboard.
    reconciledOutOfBand,
    // A comped/free seat closed at CHF 0 — the cancellation is settled, but nothing was sent.
    nothingToRefund,
  });
}
