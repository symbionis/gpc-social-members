// Who can walk through the door — the one rule three surfaces have to agree on.
//
// The admin attendee roster, the printed door sheet (lib/events/door-roster.ts) and the
// door console (lib/events/door-access.ts) all answer the same question: which tickets
// represent a person who can be admitted. They assemble and present that answer very
// differently — only the sheet pads a booking up to its seat count, only the console turns
// unnamed rows into fillable slots — but the admissibility rule underneath is identical,
// and it lived in three hand-maintained copies that drifted apart.
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
  cancellation_status?: string | null;
}

/** A booking, as far as seat counting is concerned. */
export interface SeatCountable {
  id: string;
  quantity: number | null;
}

export interface CancellationSplit<T> {
  /** Tickets that can still be admitted. */
  live: T[];
  /** How many cancelled tickets each booking holds, keyed by registration id. */
  cancelledByRegistration: Map<string, number>;
}

/**
 * Split a ticket read into what can be admitted and what each booking has had cancelled.
 *
 * Done in code rather than SQL on purpose: the caller needs BOTH halves. Dropping cancelled
 * rows in the query leaves the cancelled COUNT unavailable, and every caller then falls back
 * to `registration.quantity`, which still includes them.
 *
 * A missing `cancellation_status` counts as not-cancelled. These surfaces govern door
 * admission, so a projection that forgets the column must fail toward showing a real
 * ticket-holder, never toward silently emptying the roster.
 */
export function partitionByCancellation<T extends AdmissibilityFields>(
  rows: T[]
): CancellationSplit<T> {
  const live: T[] = [];
  const cancelledByRegistration = new Map<string, number>();

  for (const row of rows) {
    if ((row.cancellation_status ?? null) === null) {
      live.push(row);
      continue;
    }
    if (!row.registration_id) continue;
    cancelledByRegistration.set(
      row.registration_id,
      (cancelledByRegistration.get(row.registration_id) ?? 0) + 1
    );
  }

  return { live, cancelledByRegistration };
}

/**
 * Seats a booking can still bring through the door: what it bought, less what has been
 * cancelled. Never negative — a booking with more cancellations than seats is broken data,
 * and a negative would propagate into padding and headcounts.
 */
export function seatsForRegistration(
  registration: SeatCountable,
  cancelledByRegistration: Map<string, number>
): number {
  const cancelled = cancelledByRegistration.get(registration.id) ?? 0;
  return Math.max(0, (registration.quantity ?? 0) - cancelled);
}
