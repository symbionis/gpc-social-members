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

  it("falls back to the booking average for legacy rows with no item lines", () => {
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: null }, PAID, []))
      .toBe(80); // 160 / 2
  });

  it("is 0 for a comped seat and for any ticket on a free booking", () => {
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 },
    ];
    expect(
      ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1", is_comp: true }, PAID, items)
    ).toBe(0);
    expect(
      ticketRefundValueChf(
        { registration_id: "r1", ticket_type_id: "tt1" },
        { ...PAID, status: "free", total_amount_chf: 0 },
        items
      )
    ).toBe(0);
  });

  it("never returns a negative amount, so a malformed row under-refunds rather than inventing money", () => {
    const items: RefundItemLine[] = [
      { registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: -50 },
    ];
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBe(0);
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: null }, null, [])).toBe(0);
  });

  it("ignores lines belonging to a different booking", () => {
    const items: RefundItemLine[] = [
      { registration_id: "OTHER", ticket_type_id: "tt1", unit_amount_chf: 999 },
    ];
    // Falls through to the booking average rather than borrowing another party's price.
    expect(ticketRefundValueChf({ registration_id: "r1", ticket_type_id: "tt1" }, PAID, items))
      .toBe(80);
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
