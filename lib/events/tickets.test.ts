import { describe, it, expect } from "vitest";
import { rollupTicketItems, formatTicketBreakdown } from "@/lib/events/tickets";

describe("rollupTicketItems", () => {
  it("returns lines in purchase order", () => {
    expect(
      rollupTicketItems([
        { title_snapshot: "Asado Standard", quantity: 9 },
        { title_snapshot: "Asado Vegetarian", quantity: 1 },
      ])
    ).toEqual([
      { title: "Asado Standard", qty: 9 },
      { title: "Asado Vegetarian", qty: 1 },
    ]);
  });

  it("sums repeated ticket-type titles into one line", () => {
    expect(
      rollupTicketItems([
        { title_snapshot: "Asado Standard", quantity: 2 },
        { title_snapshot: "Asado Standard", quantity: 3 },
      ])
    ).toEqual([{ title: "Asado Standard", qty: 5 }]);
  });

  it("falls back to 'Ticket' for a blank snapshot and 0 for a missing quantity", () => {
    expect(
      rollupTicketItems([{ title_snapshot: "  ", quantity: null }])
    ).toEqual([{ title: "Ticket", qty: 0 }]);
  });

  it("returns an empty array for no items", () => {
    expect(rollupTicketItems([])).toEqual([]);
  });
});

describe("formatTicketBreakdown", () => {
  it("joins lines as 'qty × title'", () => {
    expect(
      formatTicketBreakdown([
        { title: "Asado Standard", qty: 9 },
        { title: "Asado Vegetarian", qty: 1 },
      ])
    ).toBe("9 × Asado Standard, 1 × Asado Vegetarian");
  });

  it("is empty for no lines", () => {
    expect(formatTicketBreakdown([])).toBe("");
  });
});
