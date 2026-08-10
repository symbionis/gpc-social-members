// What one ticket is worth when it is refunded.
//
// Money on an event booking lives on `event_registration_items` — one line per ticket TYPE,
// carrying the price snapshotted at checkout (`unit_amount_chf`). Tickets themselves carry no
// value. So refunding a single ticket, or netting a refunded ticket out of finance, both need
// the same question answered: what did this seat cost?
//
// Deliberately reads the SNAPSHOT rather than the ticket type's current price. A type repriced
// after the sale must not change what an old booking refunds, and `unit_amount_chf` already
// encodes which side of member/non-member pricing the buyer landed on.
//
// Shared by the refund route (the amount sent to Stripe), the admin attendees list (the amount
// shown on the button) and finance (the amount subtracted from gross) so those three can never
// disagree about the same seat.

/**
 * The per-ticket cancellation outcome, mirroring the `tickets_cancellation_status_check`
 * constraint. Declared once and imported everywhere because this union has to agree with the
 * database across the admin roster, the holder's manage page and the household reader — three
 * hand-maintained copies is how a new state gets added to the DB and silently mis-typed in the
 * UI. NULL (live) is expressed by the call sites as `| null`, since "not cancelled" is the
 * absence of this value rather than a member of it.
 *
 * Two outcomes, not three: a cancelling guest is refunded, and a seat with nothing to refund
 * (a comp, a free booking) settles as 'refunded' at CHF 0 rather than earning a state of its
 * own. See the refund-accounting migration for why a "cancelled, payment kept" state was
 * rejected.
 */
export type TicketCancellationStatus = "requested" | "refunded";

/** A `event_registration_items` row, as read from Supabase (numerics arrive as strings). */
export interface RefundItemLine {
  registration_id: string;
  ticket_type_id: string | null;
  unit_amount_chf: number | string | null;
}

/** The parent booking. `status` distinguishes a comped party from a purchased one. */
export interface RefundRegistration {
  id: string;
  status: string | null;
  quantity: number | null;
  total_amount_chf: number | string | null;
}

/** The ticket being valued. */
export interface RefundTicket {
  registration_id: string | null;
  ticket_type_id: string | null;
  is_comp?: boolean | null;
}

// Supabase returns `numeric` columns as strings ("80.00"). Anything unparseable is 0 rather
// than NaN — a NaN would propagate into a Stripe amount or a revenue total unnoticed.
function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The booking line this ticket was sold on, or null when none can be identified.
 *
 * Resolution order:
 *   1. The registration's line matching this ticket's type.
 *   2. A single-line registration whose one line doesn't name this ticket's type — an archived
 *      or hard-deleted type leaves the ticket pointing nowhere. With one line there is no
 *      ambiguity about which price applies.
 *   3. Nothing: a multi-line booking whose ticket names no line. The caller falls back to the
 *      booking average.
 *
 * Generic in the row type so callers get their own extra columns back (finance reads
 * `title_snapshot` off the result). Amount and ticket-type attribution therefore resolve
 * through ONE code path — the alternative, re-deriving the type in finance, is how the two
 * would drift apart.
 */
export function resolveTicketLine<T extends RefundItemLine>(
  ticket: RefundTicket,
  registration: RefundRegistration | null | undefined,
  items: readonly T[],
): T | null {
  if (!registration) return null;
  const lines = items.filter((i) => i.registration_id === registration.id);

  if (ticket.ticket_type_id) {
    const matched = lines.find((i) => i.ticket_type_id === ticket.ticket_type_id);
    if (matched) return matched;
  }
  return lines.length === 1 ? lines[0] : null;
}

/**
 * The CHF this ticket is worth, for refund and revenue purposes.
 *
 * A comped ticket, or any ticket on a `free` booking, is worth 0 — no money was taken, so
 * there is nothing to give back and nothing to subtract. Otherwise it is the resolved line's
 * snapshotted unit price, falling back to the booking average (`total_amount_chf / quantity`)
 * for legacy rows that predate the items table, where the parent total is the only record of
 * what was paid.
 *
 * Never returns a negative number: a malformed row yields 0, which under-refunds rather than
 * inventing money to send back.
 */
export function ticketRefundValueChf(
  ticket: RefundTicket,
  registration: RefundRegistration | null | undefined,
  items: readonly RefundItemLine[],
): number {
  if (!registration) return 0;
  if (ticket.is_comp) return 0;
  if (registration.status === "free") return 0;

  const line = resolveTicketLine(ticket, registration, items);
  if (line) return Math.max(0, round2(toNumber(line.unit_amount_chf)));

  const quantity = registration.quantity ?? 0;
  if (quantity > 0) {
    return Math.max(0, round2(toNumber(registration.total_amount_chf) / quantity));
  }

  return 0;
}

/**
 * The CHF to subtract from an event's gross for one settled-refunded ticket.
 *
 * Prefers the amount actually recorded at refund time; falls back to the derived seat price
 * when it is NULL. That fallback is what makes tickets refunded before refund accounting
 * existed net out correctly — without it they would count as full revenue forever, which is
 * the exact defect this module was written for.
 */
export function refundedAmountChf(
  ticket: RefundTicket & { refund_amount_chf?: number | string | null },
  registration: RefundRegistration | null | undefined,
  items: readonly RefundItemLine[],
): number {
  if (ticket.refund_amount_chf !== null && ticket.refund_amount_chf !== undefined) {
    return Math.max(0, round2(toNumber(ticket.refund_amount_chf)));
  }
  return ticketRefundValueChf(ticket, registration, items);
}
