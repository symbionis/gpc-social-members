import { describe, it, expect } from "vitest";
import { eligibleConvertTargets, type ConvertType } from "@/lib/events/convert-eligibility";

const TYPES: ConvertType[] = [
  { id: "std", title: "Standard", price: 0, isChild: false },
  { id: "food", title: "With food", price: 25, isChild: false },
  { id: "vip", title: "VIP", price: 80, isChild: false },
  { id: "kid", title: "Child", price: 10, isChild: true },
];

describe("eligibleConvertTargets", () => {
  it("offers only same-or-higher priced adult types, cheapest-first", () => {
    const targets = eligibleConvertTargets("std", TYPES);
    expect(targets.map((t) => t.id)).toEqual(["food", "vip"]);
  });

  it("includes an equal-priced target (delta 0 is allowed)", () => {
    const types: ConvertType[] = [
      { id: "a", title: "A", price: 25, isChild: false },
      { id: "b", title: "B", price: 25, isChild: false },
    ];
    expect(eligibleConvertTargets("a", types).map((t) => t.id)).toEqual(["b"]);
  });

  it("excludes cheaper (downgrade) targets", () => {
    // From VIP (80): nothing is more expensive → no targets.
    expect(eligibleConvertTargets("vip", TYPES)).toEqual([]);
  });

  it("never crosses the child/adult boundary", () => {
    // Child ticket (10) sees no adult types even though food (25) is pricier.
    expect(eligibleConvertTargets("kid", TYPES)).toEqual([]);
    // Adult standard never offers the child type.
    expect(eligibleConvertTargets("std", TYPES).some((t) => t.isChild)).toBe(false);
  });

  it("excludes the current type itself", () => {
    expect(eligibleConvertTargets("food", TYPES).some((t) => t.id === "food")).toBe(false);
  });

  it("returns nothing when the current type is unknown", () => {
    expect(eligibleConvertTargets("archived-type", TYPES)).toEqual([]);
  });
});
