// Who can walk through the door — the one rule three surfaces have to agree on.
//
// The admin attendee roster, the printed door sheet (lib/events/door-roster.ts) and the
// door console (lib/events/door-access.ts) all answer the same question: which tickets
// represent a person who can be admitted. They assemble and present that answer very
// differently — only the sheet pads a booking up to its ticket count, only the console turns
// unnamed rows into fillable slots — but the admissibility rule underneath is identical, and
// it lived in three hand-maintained copies, each of which had to be kept in step with a
// count derived somewhere else. (The admin roster shares only the filter: it pads nothing,
// and never had the bug.)
//
// The drift was always the same mistake: listing PEOPLE from ticket rows while counting
// SEATS from `registration.quantity`. Filtering cancelled tickets out of the query is not
// enough, because the quantity still counts them — so the sheet padded refunded seats back
// on as blank tickable lines, a fully refunded booking printed as an arrivable party, and
// the console reported a party as "1 / 2 named" with a seat nobody could fill.
//
// Keep the assembly in each surface. Keep the rule here.

/**
 * The slot statuses a door surface may show.
 *
 * An allowlist, NOT a negation of 'claimed': tickets_slot_status_check still permits the
 * legacy 'unclaimed' value, and on a surface that governs admission an unrecognized status
 * must fall OFF the roster rather than onto it as an anonymous tickable line.
 *
 * `issued` belongs here — it is a minted ticket nobody has named yet, which is exactly the
 * blank line door staff need, not a row to hide.
 */
export const ADMISSIBLE_SLOT_STATUSES = ["issued", "claimed"] as const;

/** The fields the admissibility rule reads. Each surface selects its own wider projection. */
export interface AdmissibilityFields {
  registration_id: string | null;
  /** Required, not optional: a projection that forgets to select this column should fail to
   * compile rather than fail open at a door. The runtime coalesce below is belt-and-braces
   * for rows that reach here untyped. */
  cancellation_status: string | null;
}

/** A booking, as far as ticket counting is concerned. */
export interface TicketCountable {
  id: string;
  quantity: number | null;
}

export interface CancellationSplit<T> {
  /** Tickets that can still be admitted. */
  live: T[];
  /**
   * The cancelled rows themselves, in input order. Kept — not reduced to the count below —
   * because WHICH row was cancelled can matter: a surface that rebuilds a missing lead from
   * the purchaser has to know the lead was cancelled rather than never minted, or it prints
   * a refunded person as an admissible line.
   */
  cancelled: T[];
  /** How many cancelled tickets each booking holds, keyed by registration id. */
  cancelledByRegistration: Map<string, number>;
}

/**
 * Split a ticket read into what can be admitted and what each booking has had cancelled.
 *
 * Done in code rather than SQL on purpose: the door surfaces need more than the live rows.
 * Dropping cancelled rows in the query leaves the cancelled COUNT unavailable, and a caller
 * without it falls back to `registration.quantity`, which still includes them. (The admin
 * roster is the exception — it wants the filter alone, and takes `.live`.)
 *
 * A null (or absent) `cancellation_status` counts as not-cancelled. These surfaces govern
 * door admission, so an unreadable value must fail toward showing a real ticket-holder,
 * never toward silently emptying the roster. Note the deliberate asymmetry: an UNKNOWN
 * non-null status fails closed (treated as cancelled), a MISSING one fails open.
 */
export function partitionByCancellation<T extends AdmissibilityFields>(
  rows: T[]
): CancellationSplit<T> {
  const live: T[] = [];
  const cancelled: T[] = [];
  const cancelledByRegistration = new Map<string, number>();

  for (const row of rows) {
    if ((row.cancellation_status ?? null) === null) {
      live.push(row);
      continue;
    }
    cancelled.push(row);
    // A cancelled ticket belonging to no booking (an ops import) has no seat to subtract, so
    // it contributes to `cancelled` but not to the per-booking tally.
    if (!row.registration_id) continue;
    cancelledByRegistration.set(
      row.registration_id,
      (cancelledByRegistration.get(row.registration_id) ?? 0) + 1
    );
  }

  return { live, cancelled, cancelledByRegistration };
}

/**
 * Tickets a booking can still bring through the door: what it bought, less what has been
 * cancelled. Never negative — a booking with more cancellations than tickets is broken data,
 * and a negative would propagate into padding and headcounts.
 *
 * TICKETS, not seats. `registration.quantity` counts every line of the basket, including
 * types that mint a ticket without consuming a seat, and the cancelled tally counts ticket
 * rows the same way — so both sides are in the same unit and the subtraction is sound. The
 * door surfaces want exactly this: they print and admit people, one line per ticket. Anything
 * reasoning about CAPACITY must go through seats_used instead (lib/events/seat-usage.ts).
 */
export function admissibleTicketsForRegistration(
  registration: TicketCountable,
  cancelledByRegistration: Map<string, number>
): number {
  const cancelled = cancelledByRegistration.get(registration.id) ?? 0;
  return Math.max(0, (registration.quantity ?? 0) - cancelled);
}
