import { describe, it, expect } from "vitest";
import {
  ticketRefundValueChf,
  refundedAmountChf,
  resolveTicketLine,
  type RefundItemLine,
  type RefundRegistration,
} from "@/lib/events/refunds";

const PAID: RefundRegistration = {
  id: "r1",
  status: "paid",
  quantity: 2,
  total_amount_chf: 160,
};

describe("ticketRefundValueChf", () => {
  it("takes the snapshotted unit price of the line matching the ticket's type", () => {
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt-adult", unit_amount_chf: 80 },
      { registration_id: "r1", ticket_type_id: "tt-child", unit_amount_chf: 30 },
    ];
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt-child" }, PAID, items))
      .toBe(30);
  });

  it("reads numerics that arrive from Supabase as strings", () => {
    // `numeric` columns come back as "80.00"; a naive read would produce NaN and send a
    // malformed amount to Stripe.
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: "80.00" },
    ];
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBe(80);
  });

  it("uses the sole line when the ticket's type no longer resolves", () => {
    // An archived or hard-deleted type leaves the ticket pointing nowhere. With one line
    // there is no ambiguity about which price applied.
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt-old", unit_amount_chf: 80 },
    ];
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: null }, PAID, items))
      .toBe(80);
  });

  it("no longer falls back to the booking average when no line resolves (U7/KTD6)", () => {
    // The booking-average fallback was removed alongside the comp-flag read it used to sit
    // behind: an unresolved line now settles at zero rather than an averaged guess, so a comp
    // seat whose type no longer matches any line can never silently refund real money. Every
    // live paid/pending registration carries item lines that resolve cleanly (verified against
    // the shared database on 2026-08-15), so this drops no real coverage today.
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: null }, PAID, []))
      .toBe(0);
  });

  it("is 0 for any ticket on a free booking, with no reference to a comp flag", () => {
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 },
    ];
    expect(
      ticketRefundValueChf(
        { registration_id: "r1", ticket_type_id: "tt1" },
        { ...PAID, status: "free", total_amount_chf: 0 },
        items
      )
    ).toBe(0);
  });

  it("is 0 for a resolved line priced at zero — a zero-price ticket refunds zero with no comp flag", () => {
    // Scenario 1: a zero-price ticket (comp-shaped or otherwise) still refunds zero purely from
    // its own resolved line price.
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 0 },
    ];
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBe(0);
  });

  it("a comp ticket that resolves to no priced line refunds zero rather than falling through to the booking average", () => {
    // Scenario 2: even on a hypothetically non-free registration (comp registrations are
    // always `free` in this codebase, but the function can no longer assume that from a flag),
    // a ticket whose type resolves no line must not fall through to the booking average — that
    // fallback is exactly how a comp seat with no matching line would silently refund real
    // money (KTD6). Two lines, neither matching the ticket's type, so resolveTicketLine's
    // single-line fallback (for an archived/deleted type) does not apply either — this is a
    // genuine "no line resolves" case.
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt-other-a", unit_amount_chf: 80 },
      { registration_id: "r1", ticket_type_id: "tt-other-b", unit_amount_chf: 30 },
    ];
    expect(
      ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt-comp-type" }, PAID, items)
    ).toBe(0);
  });

  // Characterization: every historical comp ticket in the shared database (27 rows, read-only
  // query on 2026-08-15) is a `free`-status registration whose ticket resolves to exactly one
  // CHF 0 line. The three real registrations below reproduce that shape (repeated ticket types
  // collapsed to their distinct (registration, type) pairs, since resolveTicketLine only needs
  // one line per pair to resolve). Asserts the replacement condition still zeroes every one of
  // them now that the comp flag is no longer read.
  describe("all 27 historical comp tickets refund zero under the replacement condition", () => {
    const COMP_REGISTRATIONS: RefundRegistration[] = [
      { id: "6f8d6069-32d6-4e3e-bcb1-3b51bbc36b65", status: "free", quantity: 19, total_amount_chf: 0 },
      { id: "b3ddf36f-6929-42d6-9994-1711c971a04d", status: "free", quantity: 5, total_amount_chf: 0 },
      { id: "dddddddd-0000-4000-8000-000000000203", status: "free", quantity: 3, total_amount_chf: 0 },
    ];
    const COMP_ITEMS: RefundItemLine[] = [
      { registration_id: "6f8d6069-32d6-4e3e-bcb1-3b51bbc36b65", ticket_type_id: "57ab080d-27b6-4208-bf2a-e395ea3445c6", unit_amount_chf: 0 },
      { registration_id: "6f8d6069-32d6-4e3e-bcb1-3b51bbc36b65", ticket_type_id: "152b6fbb-e77b-47a7-a648-27309ca4efea", unit_amount_chf: 0 },
      { registration_id: "b3ddf36f-6929-42d6-9994-1711c971a04d", ticket_type_id: "83cbe85e-4b70-4d78-8db3-028c55973be2", unit_amount_chf: 0 },
      { registration_id: "dddddddd-0000-4000-8000-000000000203", ticket_type_id: "dddddddd-0000-4000-8000-000000000101", unit_amount_chf: 0 },
    ];
    // The 27 (ticket_id, registration_id, ticket_type_id) triples read from `tickets` where the
    // (now-retired) comp flag was true, ordered by created_at — the real historical rows.
    const COMP_TICKETS: { id: string; registration_id: string; ticket_type_id: string }[] = [
      ...Array(19).fill(null).map((_, i) => ({
        id: `comp-a-${i}`,
        registration_id: "6f8d6069-32d6-4e3e-bcb1-3b51bbc36b65",
        // Two distinct types appear across this party's 19 comp tickets in the real data.
        ticket_type_id: i < 17 ? "57ab080d-27b6-4208-bf2a-e395ea3445c6" : "152b6fbb-e77b-47a7-a648-27309ca4efea",
      })),
      ...Array(5).fill(null).map((_, i) => ({
        id: `comp-b-${i}`,
        registration_id: "b3ddf36f-6929-42d6-9994-1711c971a04d",
        ticket_type_id: "83cbe85e-4b70-4d78-8db3-028c55973be2",
      })),
      ...Array(3).fill(null).map((_, i) => ({
        id: `comp-c-${i}`,
        registration_id: "dddddddd-0000-4000-8000-000000000203",
        ticket_type_id: "dddddddd-0000-4000-8000-000000000101",
      })),
    ];

    it("has exactly 27 rows in the fixture", () => {
      expect(COMP_TICKETS.length).toBe(27);
    });

    it.each(COMP_TICKETS.map((t) => [t.id, t]))("%s refunds zero", (_id, t) => {
      const registration = COMP_REGISTRATIONS.find((r) => r.id === t.registration_id) ?? null;
      const value = ticketRefundValueChf(
        { registration_id: t.registration_id, ticket_type_id: t.ticket_type_id },
        registration,
        COMP_ITEMS
      );
      expect(value).toBe(0);
    });
  });

  it("never returns a negative amount, so a malformed row under-refunds rather than inventing money", () => {
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: -50 },
    ];
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBe(0);
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: null }, null, [])).toBe(0);
  });

  it("returns 0 when the seat belongs to a different booking", () => {
    // Every caller pairs these correctly today, but the output goes straight to Stripe as real
    // money — a mispairing must be a hard zero, not a plausible wrong amount.
    const value = ticketRefundValueChf(
      { registration_id: "rA", ticket_type_id: "ttX" },
      { id: "rB", status: "paid", quantity: 1, total_amount_chf: 500 },
      [{ registration_id: "rB", ticket_type_id: "ttOther", unit_amount_chf: 500 }]
    );
    expect(value).toBe(0);
  });

  it("still prices a seat whose registration_id is absent", () => {
    // Legacy rows carry no back-reference; the caller has already paired them.
    expect(
      ticketRefundValueChf({ registration_id: null, ticket_type_id: "tt1" }, PAID, [
        { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 },
      ])
    ).toBe(80);
  });

  it("ignores lines belonging to a different booking", () => {
    const items: RefundItemLine[] = [
      { registration_id: "OTHER", ticket_type_id: "tt1", unit_amount_chf: 999 },
    ];
    // No line resolves against this booking, so this settles at zero rather than borrowing
    // another party's price or falling through to the booking average (U7/KTD6).
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBe(0);
  });
});

describe("resolveTicketLine", () => {
  it("returns the caller's own row type so amount and ticket-type attribution share one path", () => {
    const items = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80, title_snapshot: "Standard" },
    ];
    expect(resolveTicketLine({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toMatchObject({ title_snapshot: "Standard" });
  });

  it("resolves a repeated ticket type when every line agrees on price", () => {
    // The real shape in production: a top-up appends a second line of the same type at the
    // same price. There is no ambiguity worth refusing over.
    const items = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 40 },
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 40 },
    ];
    expect(resolveTicketLine({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toMatchObject({ unit_amount_chf: 40 });
  });

  it("refuses to pick a line when a repeated type disagrees on price", () => {
    // A repricing between top-ups. Tickets carry no link to the line that minted them, so
    // taking the first would refund a CHF 100 seat at CHF 80 — plausibly and silently.
    const items = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 },
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 100 },
    ];
    expect(resolveTicketLine({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBeNull();
  });

  it("returns null for a multi-line booking whose ticket names no line", () => {
    const items = [
      { registration_id: "r1", ticket_type_id: "tt-a", unit_amount_chf: 80 },
      { registration_id: "r1", ticket_type_id: "tt-b", unit_amount_chf: 30 },
    ];
    expect(resolveTicketLine({ registration_id: "r1", ticket_type_id: "tt-z" }, PAID, items))
      .toBeNull();
  });
});

describe("refundedAmountChf", () => {
  const items: RefundItemLine[] = [
    { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 },
  ];

  it("prefers the amount recorded at refund time over the derived seat price", () => {
    // A partial refund, or a price change since the sale, makes the stored figure the truth.
    expect(
      refundedAmountChf(
        { registration_id: "r1", ticket_type_id: "tt1", refund_amount_chf: 45 },
        PAID,
        items
      )
    ).toBe(45);
  });

  it("derives the seat price when no amount was recorded", () => {
    // Rows refunded before refund accounting existed. Without this fallback they would count
    // as full revenue forever — the exact defect this module was written for.
    expect(
      refundedAmountChf(
        { registration_id: "r1", ticket_type_id: "tt1", refund_amount_chf: null },
        PAID,
        items
      )
    ).toBe(80);
  });

  it("treats a recorded zero as a real zero, not as missing", () => {
    expect(
      refundedAmountChf(
        { registration_id: "r1", ticket_type_id: "tt1", refund_amount_chf: 0 },
        PAID,
        items
      )
    ).toBe(0);
  });
});
