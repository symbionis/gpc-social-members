import { describe, it, expect } from "vitest";
import {
  splitBookedTickets,
  findGuestListOverlap,
  type PurchasedTicketHolder,
  type GuestListTicketHolder,
} from "@/lib/events/booked-tickets";

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
  // Characterizes the bug this unit (U9) fixes. Comp registrations are retired (U7), so no
  // registration ever carries is_guest_list: true anymore — a guest-list guest is a TICKET
  // with no registration behind it (U5, KD10), invisible to a derivation that only reads
  // registrations. Before the fix this silently read zero on an event with a real, populated
  // guest list; this pins that exact shape against the current (fixed) signature, which
  // requires the caller to opt in to the ticket count.
  it("reads zero for the guest-list bucket when no ticket count is supplied — the bug this unit fixes", () => {
    const split = splitBookedTickets(
      [
        reg({ id: "r-paid", quantity: 2, status: "paid" }),
        reg({ id: "r-free", quantity: 1, status: "free" }),
      ],
      [
        { registration_id: "r-paid", ticket_type_id: SEAT, quantity: 2 },
        { registration_id: "r-free", ticket_type_id: SEAT, quantity: 1 },
      ],
      countsAsSeat
      // guestListTicketCount omitted — the shape of a call site that has not been updated yet.
    );

    expect(split.guestList).toBe(0);
  });

  // The fix: the guest-list bucket is now a plain count of tickets with a non-null
  // guest_list_id, supplied by the caller — independent of registrations entirely.
  it("sources the guest-list bucket from a ticket count, not registrations", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-paid", quantity: 2, status: "paid" })],
      [{ registration_id: "r-paid", ticket_type_id: SEAT, quantity: 2 }],
      countsAsSeat,
      3 // 3 tickets with a non-null guest_list_id
    );

    expect(split).toEqual({ paid: 2, free: 0, guestList: 3, booked: 5 });
  });

  // is_guest_list is vestigial now (see BookedRegistration's doc) — a registration flagged
  // with it no longer routes to the guestList bucket; it is split by status like any other
  // registration, because every registration reaching this function is a real booking (U7).
  it("is never driven by is_guest_list on a registration, even when set", () => {
    const split = splitBookedTickets(
      [reg({ id: "r-1", quantity: 3, status: "free", is_guest_list: true })],
      [{ registration_id: "r-1", ticket_type_id: SEAT, quantity: 3 }],
      countsAsSeat
    );

    expect(split).toEqual({ paid: 0, free: 3, guestList: 0, booked: 3 });
  });

  it("separates free bookings from paid ones", () => {
    const split = splitBookedTickets(
      [
        reg({ id: "r-paid", quantity: 1, status: "paid" }),
        reg({ id: "r-free", quantity: 4, status: "free" }),
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

  // paid + free + guest list = booked, holding with a guest list present.
  it("keeps the booked identity intact with a guest list present", () => {
    const split = splitBookedTickets(
      [
        reg({ id: "r-paid", quantity: 5, status: "paid" }),
        reg({ id: "r-free", quantity: 2, status: "free" }),
      ],
      [
        { registration_id: "r-paid", ticket_type_id: SEAT, quantity: 5 },
        { registration_id: "r-free", ticket_type_id: SEAT, quantity: 2 },
      ],
      countsAsSeat,
      4
    );

    expect(split).toEqual({ paid: 5, free: 2, guestList: 4, booked: 11 });
    expect(split.booked).toBe(split.paid + split.free + split.guestList);
  });
});

describe("findGuestListOverlap", () => {
  const purchased = (over: Partial<PurchasedTicketHolder> = {}): PurchasedTicketHolder => ({
    name: "Alice Smith",
    email: "alice@example.com",
    ticketTypeId: SEAT,
    ...over,
  });
  const guest = (over: Partial<GuestListTicketHolder> = {}): GuestListTicketHolder => ({
    ticketId: "gt-1",
    name: "Alice Smith",
    email: "alice@example.com",
    ticketTypeId: SEAT,
    ...over,
  });

  it("flags and excludes a guest-list ticket held by someone who already bought that type", () => {
    const result = findGuestListOverlap([purchased()], [guest()]);

    expect(result.overlappingTicketIds.has("gt-1")).toBe(true);
    expect(result.netNewByTicketType.get(SEAT) ?? 0).toBe(0);
  });

  // The same person buying Friday and being comped Saturday is two real admissions, not a
  // double-booking — scoping the key to ticket type is what keeps this from being flagged.
  it("does not flag the same person holding a DIFFERENT ticket type", () => {
    const result = findGuestListOverlap(
      [purchased({ ticketTypeId: "tt-friday" })],
      [guest({ ticketTypeId: "tt-saturday" })]
    );

    expect(result.overlappingTicketIds.size).toBe(0);
    expect(result.netNewByTicketType.get("tt-saturday")).toBe(1);
  });

  it("counts a genuinely new guest-list guest as net-new", () => {
    const result = findGuestListOverlap(
      [purchased({ name: "Bob Jones", email: "bob@example.com" })],
      [guest({ name: "Carol Diaz", email: "carol@example.com" })]
    );

    expect(result.overlappingTicketIds.size).toBe(0);
    expect(result.netNewByTicketType.get(SEAT)).toBe(1);
  });

  // R4 identity key: docs/solutions/database-issues/
  // contact-only-replay-guard-swallows-people-sharing-an-email.md documents a real incident
  // where deduping on contact alone silently merged two different people sharing a mailbox
  // (a household). Name must be part of the key.
  it("does not merge two differently-named people who share an email", () => {
    const result = findGuestListOverlap(
      [purchased({ name: "Alice Smith", email: "family@example.com" })],
      [guest({ name: "Bob Smith", email: "family@example.com" })]
    );

    expect(result.overlappingTicketIds.size).toBe(0);
    expect(result.netNewByTicketType.get(SEAT)).toBe(1);
  });

  it("case-folds and whitespace-normalizes the name, and lowercases the email", () => {
    const result = findGuestListOverlap(
      [purchased({ name: "alice   smith", email: "ALICE@EXAMPLE.COM" })],
      [guest({ name: "Alice Smith", email: "alice@example.com" })]
    );

    expect(result.overlappingTicketIds.has("gt-1")).toBe(true);
  });

  it("never overlaps, and is never net-new to a type total, for a guest with no resolvable ticket type", () => {
    const result = findGuestListOverlap([purchased()], [guest({ ticketTypeId: null })]);

    expect(result.overlappingTicketIds.size).toBe(0);
    expect(result.netNewByTicketType.size).toBe(0);
  });

  it("returns empty results when there are no guest-list guests", () => {
    const result = findGuestListOverlap([purchased()], []);

    expect(result.overlappingTicketIds.size).toBe(0);
    expect(result.netNewByTicketType.size).toBe(0);
  });
});
