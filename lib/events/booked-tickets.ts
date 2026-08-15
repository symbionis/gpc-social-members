// How an event's booked tickets split by how they were acquired — paid, free, or comped on
// a guest list — for the admin overview.
//
// Extracted from the attendees page because the page is a server component the repo does not
// unit-test, and this is the derivation behind the figure that was wrong: the old "Sold" panel
// summed `registration.quantity` across paid AND free registrations, so comp guest-list seats
// were reported as sold. A mutation that swept comps back into `paid` passed the entire suite.
//
// The split must agree with `seats_used` (lib/events/seat-usage.ts), because the overview
// subtracts one from the other to show cancellations:
//
//   paid + free + guest list = booked
//   booked − active          = cancelled
//
// so any disagreement between the two derivations surfaces to an admin as a phantom refund.
// That is why the fallback below mirrors the RPC's branch condition exactly rather than
// approximating it.
//
// U9 (docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md): the guest-list bucket
// used to come from `registrations.is_guest_list` — true for a comp registration under the old
// model. Comp registrations are retired (U7, KD7): every registration is now a real paid or
// free booking, so `is_guest_list` is permanently false and the bucket silently read zero even
// on an event with an active guest list. A guest-list guest is a TICKET with no registration
// behind it (U5, KD10) — `tickets.guest_list_id` non-null, `tickets.registration_id` null — so
// the bucket is now a plain count of THAT, supplied by the caller rather than re-derived from
// registrations. `guestListTicketCount` defaults to 0 so a call site that has not been updated
// to supply it keeps compiling — and keeps under-counting, visibly, rather than throwing.

import { ticketIdentityKey } from "@/lib/events/order";

/** A booking, as far as the split is concerned. */
export interface BookedRegistration {
  id: string;
  quantity: number;
  status: string;
  /**
   * Vestigial (U9): comp registrations are retired (U7), so this is always false on a live
   * registration and is no longer read by `splitBookedTickets`. Kept on the interface only
   * because the attendees page still selects and passes the column; drop it there first if you
   * want it gone from here too.
   */
  is_guest_list: boolean | null;
}

/** One purchased line of a booking. */
export interface BookedItem {
  registration_id: string;
  ticket_type_id: string | null;
  quantity: number | null;
}

export interface BookedTicketSplit {
  paid: number;
  free: number;
  guestList: number;
  /** paid + free + guestList. */
  booked: number;
}

/**
 * Split booked tickets into paid / free / guest-list, counting only seat-consuming types.
 *
 * `countsAsSeat` resolves a ticket type id to whether it takes a seat; an id it cannot
 * resolve counts as NOT a seat, matching the RPC's inner join.
 *
 * The legacy fallback fires only for a booking with NO items at all — a pre-baskets
 * registration. A booking whose items are all non-seat types (merch only) contributes 0,
 * exactly as `seats_used` does. Falling back on "no seat items found" instead would count a
 * merch-only booking's full quantity as seats, inflating `booked` and manufacturing a
 * cancellation the admin would then hunt for in Stripe.
 *
 * `guestListTicketCount` (U9) is a plain count of `tickets` rows with a non-null
 * `guest_list_id` for this event — see the header for why this replaced deriving the bucket
 * from `registrations.is_guest_list`. It defaults to 0 so an unmigrated call site still
 * compiles.
 */
export function splitBookedTickets(
  registrations: BookedRegistration[],
  items: BookedItem[],
  countsAsSeat: (ticketTypeId: string) => boolean,
  guestListTicketCount = 0
): BookedTicketSplit {
  const seatQuantityByRegistration = new Map<string, number>();
  // Every booking that has ANY item — the RPC's `EXISTS (SELECT 1 FROM items …)` branch.
  const hasAnyItem = new Set<string>();

  for (const item of items) {
    hasAnyItem.add(item.registration_id);
    if (!item.ticket_type_id || !countsAsSeat(item.ticket_type_id)) continue;
    seatQuantityByRegistration.set(
      item.registration_id,
      (seatQuantityByRegistration.get(item.registration_id) ?? 0) + (item.quantity ?? 0)
    );
  }

  let paid = 0;
  let free = 0;

  for (const r of registrations) {
    const seats = hasAnyItem.has(r.id)
      ? seatQuantityByRegistration.get(r.id) ?? 0
      : r.quantity;
    // `is_guest_list` is never read here (see BookedRegistration's doc) — every registration
    // reaching this loop is a real paid or free booking now that comp is retired (U7).
    if (r.status === "paid") paid += seats;
    else free += seats;
  }

  const guestList = guestListTicketCount;

  return { paid, free, guestList, booked: paid + free + guestList };
}

// --- Guest-list / purchased overlap (U9) --------------------------------------------------
//
// A person can legitimately hold a purchased ticket AND appear on a guest list — the overview
// must not let that inflate a ticket type's headline count as though two distinct people
// showed up. It also must not falsely flag a genuine double-booking: the same person buying
// Friday and being comped Saturday by a sponsor is two real admissions, not one person twice.
//
// Scoped to (name, email, ticket type) via `ticketIdentityKey` — the R4 identity key
// (docs/solutions/database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md)
// — rather than name+email alone, for exactly the reason that file documents: two people can
// share a mailbox (a household), so contact-only, or even (name, email) alone, both over- and
// under-match here. Including the ticket type is what lets "same person, different day" and
// "same person, same day, comped twice" resolve differently, which a person-only key cannot do.

/** A purchased ticket holder, as far as the overlap check is concerned. */
export interface PurchasedTicketHolder {
  name: string | null;
  email: string | null;
  ticketTypeId: string | null;
}

/** A guest-list ticket holder, as far as the overlap check is concerned. */
export interface GuestListTicketHolder {
  ticketId: string;
  name: string | null;
  email: string | null;
  ticketTypeId: string | null;
}

export interface GuestListOverlap {
  /**
   * Guest-list ticket ids whose (name, email, ticket type) already matches a purchased ticket —
   * the person already has a ticket of this type. Surface this as a flag next to the guest's
   * entry ("already has a ticket"); do not drop the row — the guest-list ticket is still a real
   * ticket and still needs a name on the door sheet.
   */
  overlappingTicketIds: Set<string>;
  /**
   * Guest-list guests to add on top of the purchased count per ticket type, net of the overlap
   * above — so a person holding both is counted once, as purchased, in a union total.
   */
  netNewByTicketType: Map<string, number>;
}

/**
 * A guest-list holder with no resolvable ticket type never overlaps (there is nothing to
 * compare it against) and is never net-new to a type total either — callers that need a total
 * across guest-list guests regardless of type should count these separately.
 */
export function findGuestListOverlap(
  purchased: PurchasedTicketHolder[],
  guestList: GuestListTicketHolder[]
): GuestListOverlap {
  const purchasedKeys = new Set(
    purchased
      .filter((p): p is PurchasedTicketHolder & { ticketTypeId: string } => p.ticketTypeId !== null)
      .map((p) => ticketIdentityKey(p.name ?? "", p.email ?? "", p.ticketTypeId))
  );

  const overlappingTicketIds = new Set<string>();
  const netNewByTicketType = new Map<string, number>();

  for (const g of guestList) {
    if (!g.ticketTypeId) continue;
    const key = ticketIdentityKey(g.name ?? "", g.email ?? "", g.ticketTypeId);
    if (purchasedKeys.has(key)) {
      overlappingTicketIds.add(g.ticketId);
      continue;
    }
    netNewByTicketType.set(g.ticketTypeId, (netNewByTicketType.get(g.ticketTypeId) ?? 0) + 1);
  }

  return { overlappingTicketIds, netNewByTicketType };
}
