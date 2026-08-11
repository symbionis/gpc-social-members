import { describe, it, expect } from "vitest";
import { buildReceiptLines, subtractReceiptItems, type ReceiptItemRow } from "@/lib/events/receipt-lines";

function row(over: Partial<ReceiptItemRow>): ReceiptItemRow {
  return {
    ticketTypeId: "type-standard",
    title: "Standard",
    quantity: 1,
    unitAmountChf: 80,
    lineTotalChf: 80,
    ...over,
  };
}

describe("buildReceiptLines", () => {
  it("formats one line per row with title, quantity and CHF labels", () => {
    expect(
      buildReceiptLines([
        row({ title: "Standard", quantity: 2, unitAmountChf: 80, lineTotalChf: 160 }),
        row({ title: "Kids", quantity: 2, unitAmountChf: 40, lineTotalChf: 80, ticketTypeId: "type-kids" }),
      ])
    ).toEqual([
      { title: "Standard", quantity: 2, unitLabel: "CHF 80.00", lineLabel: "CHF 160.00" },
      { title: "Kids", quantity: 2, unitLabel: "CHF 40.00", lineLabel: "CHF 80.00" },
    ]);
  });

  it("labels a zero-amount row as Free", () => {
    expect(buildReceiptLines([row({ unitAmountChf: 0, lineTotalChf: 0 })])).toEqual([
      { title: "Standard", quantity: 1, unitLabel: "Free", lineLabel: "Free" },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(buildReceiptLines([])).toEqual([]);
  });
});

describe("subtractReceiptItems", () => {
  it("returns the full set unchanged when nothing was contributed", () => {
    const all = [row({ quantity: 2, lineTotalChf: 160 })];
    expect(subtractReceiptItems(all, [])).toEqual(all);
  });

  it("subtracts a single buy-more's contribution from the matching type", () => {
    const all = [row({ quantity: 5, unitAmountChf: 80, lineTotalChf: 400 })];
    const topup = [row({ quantity: 2, unitAmountChf: 80, lineTotalChf: 160 })];
    expect(subtractReceiptItems(all, [topup])).toEqual([
      { ticketTypeId: "type-standard", title: "Standard", quantity: 3, unitAmountChf: 80, lineTotalChf: 240 },
    ]);
  });

  it("subtracts several buy-more contributions, summed, not just the last one (Covers KTD3)", () => {
    const all = [row({ quantity: 6, unitAmountChf: 80, lineTotalChf: 480 })];
    const topup1 = [row({ quantity: 2, unitAmountChf: 80, lineTotalChf: 160 })];
    const topup2 = [row({ quantity: 1, unitAmountChf: 80, lineTotalChf: 80 })];
    expect(subtractReceiptItems(all, [topup1, topup2])).toEqual([
      { ticketTypeId: "type-standard", title: "Standard", quantity: 3, unitAmountChf: 80, lineTotalChf: 240 },
    ]);
  });

  it("drops a type entirely when its contribution fully covers (or exceeds) the total — never negative", () => {
    const all = [row({ quantity: 2, unitAmountChf: 80, lineTotalChf: 160 })];
    const topup = [row({ quantity: 5, unitAmountChf: 80, lineTotalChf: 400 })];
    expect(subtractReceiptItems(all, [topup])).toEqual([]);
  });

  it("leaves an unrelated ticket type untouched", () => {
    const all = [
      row({ ticketTypeId: "type-standard", quantity: 3, lineTotalChf: 240 }),
      row({ ticketTypeId: "type-kids", title: "Kids", quantity: 2, unitAmountChf: 40, lineTotalChf: 80 }),
    ];
    const topup = [row({ ticketTypeId: "type-standard", quantity: 1, lineTotalChf: 80 })];
    expect(subtractReceiptItems(all, [topup])).toEqual([
      { ticketTypeId: "type-standard", title: "Standard", quantity: 2, unitAmountChf: 80, lineTotalChf: 160 },
      { ticketTypeId: "type-kids", title: "Kids", quantity: 2, unitAmountChf: 40, lineTotalChf: 80 },
    ]);
  });

  it("aggregates multiple base rows of the same type before subtracting (a conversion can leave two rows)", () => {
    const all = [
      row({ quantity: 2, unitAmountChf: 80, lineTotalChf: 160 }),
      row({ quantity: 1, unitAmountChf: 80, lineTotalChf: 80 }),
    ];
    expect(subtractReceiptItems(all, [])).toEqual([
      { ticketTypeId: "type-standard", title: "Standard", quantity: 3, unitAmountChf: 80, lineTotalChf: 240 },
    ]);
  });
});
