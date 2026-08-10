// A booking's Stripe charges, treated as one pool of refundable money.
//
// A booking is not one payment. The original checkout is one PaymentIntent; every top-up
// (app/api/public/bookings/[token]/topup) and every priced ticket-type conversion
// (…/convert) is ANOTHER one. `event_registrations.stripe_payment_intent_id` only ever holds
// the first — the webhook writes it on the pending→paid transition and the top-up and
// conversion branches return before that write — so a seat bought in a top-up has its money
// on a charge the registration row does not name.
//
// The naive fix is to link each seat to the charge that paid for it. That linkage does not
// exist (tickets carry no reference to the item line or top-up that minted them) and would be
// guesswork to reconstruct. It is also the wrong model: the booking is the unit of money. One
// payer, one card, one booking — CHF 40 returned off the original charge is the same CHF 40 to
// the same person as CHF 40 off the top-up charge. What actually matters is the invariant that
// total refunded never exceeds total captured.
//
// So: gather every charge on the booking, ask Stripe what each still has left, and draw the
// seat's amount across them. Refuse when the pool cannot cover it, rather than refunding a
// charge that has no room (which raises `charge_already_refunded`, previously swallowed as
// success) or inventing a record for money that never moved.

import type Stripe from "stripe";

/** One of a booking's charges and what it can still return, in centimes. */
export interface ChargeSlot {
  paymentIntentId: string;
  remainingMinor: number;
}

/** An instruction to refund `amountMinor` centimes against one PaymentIntent. */
export interface RefundDraw {
  paymentIntentId: string;
  amountMinor: number;
}

export interface RefundPlan {
  draws: RefundDraw[];
  /** Centimes the pool could not cover. Non-zero means: do not refund, tell a human. */
  shortfallMinor: number;
}

/**
 * Split `amountMinor` across the pool, in the order given.
 *
 * Pure and total: it never returns draws summing to more than `amountMinor`, never emits a
 * zero or negative draw, and reports any uncovered remainder rather than silently
 * under-refunding. Callers MUST check `shortfallMinor` before acting on `draws` — a partial
 * plan applied blind is how a guest gets half their money and the books say they got all of it.
 *
 * Order matters only for which charge shows the refund in Stripe; the payer is the same either
 * way. Callers pass the original charge first so the common single-charge booking behaves
 * exactly as it did before top-ups existed.
 */
export function planRefundDraws(pool: readonly ChargeSlot[], amountMinor: number): RefundPlan {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return { draws: [], shortfallMinor: 0 };
  }

  const draws: RefundDraw[] = [];
  let outstanding = amountMinor;

  for (const slot of pool) {
    if (outstanding <= 0) break;
    const available = Math.max(0, Math.floor(slot.remainingMinor));
    if (available <= 0) continue;
    const take = Math.min(available, outstanding);
    draws.push({ paymentIntentId: slot.paymentIntentId, amountMinor: take });
    outstanding -= take;
  }

  return { draws, shortfallMinor: outstanding };
}

/**
 * Every PaymentIntent that paid for part of this booking, original first, deduped.
 *
 * Pure: the caller reads the rows (it already holds a typed Supabase client) and hands the ids
 * here. Original first so the ordinary single-charge booking behaves exactly as it did before
 * top-ups existed.
 *
 * Extras that are null are dropped rather than treated as an error — a zero-value top-up never
 * reaches Stripe, and rows predating the column simply have nothing to contribute. The pool
 * then degrades to the charges we do know, which is the pre-existing behaviour, not a new
 * break. Whether the READ succeeded is the caller's business to check; a pool assembled from a
 * failed query is not one to refund against.
 */
export function mergePaymentIntentIds(
  registrationPaymentIntentId: string | null,
  extraIds: readonly (string | null)[],
): string[] {
  const ids: string[] = [];
  if (registrationPaymentIntentId) ids.push(registrationPaymentIntentId);
  for (const id of extraIds) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * What each charge can still return, in centimes.
 *
 * `amount_captured − amount_refunded` on the PaymentIntent's latest charge. A PI whose charge
 * is missing, uncaptured or fully refunded contributes a zero slot rather than being dropped,
 * so the caller can still report the pool it inspected.
 */
export async function readRefundableBalances(
  stripe: Pick<Stripe, "paymentIntents">,
  paymentIntentIds: readonly string[],
): Promise<ChargeSlot[]> {
  const slots: ChargeSlot[] = [];
  for (const id of paymentIntentIds) {
    const intent = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === "string") {
      slots.push({ paymentIntentId: id, remainingMinor: 0 });
      continue;
    }
    const captured = charge.amount_captured ?? 0;
    const refunded = charge.amount_refunded ?? 0;
    slots.push({ paymentIntentId: id, remainingMinor: Math.max(0, captured - refunded) });
  }
  return slots;
}

/**
 * A refund already issued for this exact ticket, if one exists.
 *
 * The route stamps `metadata.ticket_id` on every refund it creates, which makes "have we
 * already refunded this seat?" answerable from Stripe itself. That matters because the
 * idempotency key is NOT a durable answer: Stripe v1 keys expire after 24 hours, so an admin
 * retrying a failed write the next morning would otherwise create a second real refund. This
 * check has no expiry.
 */
export async function findRefundForTicket(
  stripe: Pick<Stripe, "refunds">,
  paymentIntentIds: readonly string[],
  ticketId: string,
): Promise<Stripe.Refund | null> {
  for (const id of paymentIntentIds) {
    const refunds = await stripe.refunds.list({ payment_intent: id, limit: 100 });
    const match = refunds.data.find((r) => r.metadata?.ticket_id === ticketId);
    if (match) return match;
  }
  return null;
}
