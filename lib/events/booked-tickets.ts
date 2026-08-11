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

/** A booking, as far as the split is concerned. */
export interface BookedRegistration {
  id: string;
  quantity: number;
  status: string;
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
 */
export function splitBookedTickets(
  registrations: BookedRegistration[],
  items: BookedItem[],
  countsAsSeat: (ticketTypeId: string) => boolean
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
  let guestList = 0;

  for (const r of registrations) {
    const seats = hasAnyItem.has(r.id)
      ? seatQuantityByRegistration.get(r.id) ?? 0
      : r.quantity;
    if (r.is_guest_list) guestList += seats;
    else if (r.status === "paid") paid += seats;
    else free += seats;
  }

  return { paid, free, guestList, booked: paid + free + guestList };
}
