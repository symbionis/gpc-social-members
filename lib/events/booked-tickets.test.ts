import { describe, it, expect } from "vitest";
import { splitBookedTickets } from "@/lib/events/booked-tickets";

const SEAT = "tt-dinner";
const MERCH = "tt-merch";
const countsAsSeat = (id: string) => id === SEAT;

const reg = (over: Partial<Parameters<typeof splitBookedTickets>[0][number]> = {}) => ({
  id: "reg-1",
  quantity: 2,
  status: "paid",
  is_guest_list: false,
  ...over,
});

describe("splitBookedTickets", () => {
  // The bug this exists to prevent: a guest list IS a `free` registration, so summing
  // quantity across paid+free reported comped seats as sold.
  it("keeps comped guest-list tickets out of paid", () => {
    const split = splitBookedTickets(
      [
        reg({ id: "r-paid", quantity: 2, status: "paid" }),
        reg({ id: "r-comp", quantity: 3, status: "free", is_guest_list: true }),
      ],
      [
        { registration_id: "r-paid", ticket_type_id: SEAT, quantity: 2 },
        { registration_id: "r-comp", ticket_type_id: SEAT, quantity: 3 },
      ],
      countsAsSeat
    );

    expect(split).toEqual({ paid: 2, free: 0, guestList: 3, booked: 5 });
  });

  it("separates free non-guest-list bookings from paid ones", () => {
    const split = splitBookedTickets(
      [
        reg({ id: "r-paid", quantity: 1, status: "paid" }),
        reg({ id: "r-free", quantity: 4, status: "free", is_guest_list: false }),
      ],
      [
        { registration_id: "r-paid", ticket_type_id: SEAT, quantity: 1 },
        { registration_id: "r-free", ticket_type_id: SEAT, quantity: 4 },
      ],
      countsAsSeat
    );

    expect(split).toMatchObject({ paid: 1, free: 4, guestList: 0, booked: 5 });
  });

  it("counts only seat-consuming items", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-1", quantity: 3 })],
      [
        { registration_id: "r-1", ticket_type_id: SEAT, quantity: 2 },
        { registration_id: "r-1", ticket_type_id: MERCH, quantity: 1 },
      ],
      countsAsSeat
    );

    expect(split.paid).toBe(2);
  });

  // The divergence that manufactures phantom refunds: `seats_used` returns 0 for a
  // merch-only booking, so counting its full quantity here inflates `booked`, and the
  // overview renders the difference as "Cancelled tickets — see Refunds".
  it("contributes zero for a booking whose items are all non-seat types", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-merch", quantity: 5 })],
      [{ registration_id: "r-merch", ticket_type_id: MERCH, quantity: 5 }],
      countsAsSeat
    );

    expect(split).toEqual({ paid: 0, free: 0, guestList: 0, booked: 0 });
  });

  // The legacy fallback is for a booking with NO items at all — pre-baskets. It must not
  // fire merely because no SEAT item was found, which is the merch case above.
  it("falls back to quantity only when a booking has no items at all", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-legacy", quantity: 4 })],
      [],
      countsAsSeat
    );

    expect(split.paid).toBe(4);
  });

  it("treats an unresolvable ticket type as not a seat", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-1", quantity: 2 })],
      [{ registration_id: "r-1", ticket_type_id: "tt-deleted", quantity: 2 }],
      countsAsSeat
    );

    // The booking has items, so no legacy fallback; the unresolvable type counts as no seat.
    expect(split.booked).toBe(0);
  });

  it("treats a null ticket_type_id as not a seat, without triggering the fallback", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-1", quantity: 2 })],
      [{ registration_id: "r-1", ticket_type_id: null, quantity: 2 }],
      countsAsSeat
    );

    expect(split.booked).toBe(0);
  });

  it("sums several seat items on one booking", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-1", quantity: 3 })],
      [
        { registration_id: "r-1", ticket_type_id: SEAT, quantity: 1 },
        { registration_id: "r-1", ticket_type_id: SEAT, quantity: 2 },
      ],
      countsAsSeat
    );

    expect(split.paid).toBe(3);
  });

  it("returns zeroes for an event with no bookings", () => {
    expect(splitBookedTickets([], [], countsAsSeat)).toEqual({
      paid: 0,
      free: 0,
      guestList: 0,
      booked: 0,
    });
  });
});
