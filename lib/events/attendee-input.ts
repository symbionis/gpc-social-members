// The claimed-seat collision check, shared by every path that names a guest onto a booking
// that may already have named seats (currently: top-up). Mandatory naming and per-order
// validation now live in `lib/events/order.ts` (U1) — the shared order module — which this
// file's own identity key is defined in terms of, so the two can't drift from the same SQL
// guard `claim_ticket` enforces.

import type { RosterFillAttendee } from "@/lib/events/roster";
import { personIdentityKey } from "@/lib/events/order";

/** A seat already named on a booking, as the collision check needs to see it. */
export type ClaimedIdentity = {
  name: string | null;
  email: string | null;
  /**
   * Null on a legacy seat minted before ticket types existed. `claim_ticket` lets such a seat
   * absorb a typed claim (it adopts the type on match), so an untyped claimed seat collides
   * with EVERY type here — mirroring the SQL rather than letting the TS check pass something
   * the database will then silently swallow.
   */
  ticket_type_id: string | null;
};

/**
 * Find the first submitted guest who is already a named seat on this booking, for the same
 * ticket type.
 *
 * `validateOrder` (lib/events/order.ts) catches the same person named twice *within* one
 * order. It cannot see that the booking already holds a claimed seat under that name and
 * email from an EARLIER order — a top-up adding to a booking whose seats are already named.
 * Left unchecked, that new seat is paid for, minted, and permanently unnamed: `claim_ticket`
 * reports success and consumes nothing.
 *
 * The only current caller is the top-up route. Public checkout has no claimed rows to check
 * against — it is the first order on a fresh booking, so there is nothing yet for a new
 * person to collide with.
 */
export function collidesWithClaimed(
  attendees: RosterFillAttendee[],
  claimed: ClaimedIdentity[],
): { name: string } | null {
  // identity (name+email, type-free) → the types it already holds. `null` in the set means an
  // untyped legacy seat, which matches any type.
  const takenTypes = new Map<string, Set<string | null>>();
  for (const c of claimed) {
    if (!c.name || !c.email) continue;
    const key = personIdentityKey(c.name, c.email);
    const types = takenTypes.get(key) ?? new Set<string | null>();
    // A row with no type at all is treated as the untyped legacy seat it is, and matches every
    // type — never as "no collision". Failing open here would let through exactly the write the
    // database then swallows.
    types.add(c.ticket_type_id ?? null);
    takenTypes.set(key, types);
  }
  for (const a of attendees) {
    const types = takenTypes.get(personIdentityKey(a.name, a.email ?? ""));
    if (types && (types.has(null) || types.has(a.ticket_type_id))) return { name: a.name };
  }
  return null;
}
