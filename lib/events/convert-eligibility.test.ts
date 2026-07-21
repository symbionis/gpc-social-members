import { describe, it, expect } from "vitest";
import { eligibleConvertTargets, type ConvertType } from "@/lib/events/convert-eligibility";

const TYPES: ConvertType[] = [
  { id: "std", title: "Standard", price: 0 },
  { id: "food", title: "With food", price: 25 },
  { id: "vip", title: "VIP", price: 80 },
  { id: "kid", title: "Child", price: 10 },
];

describe("eligibleConvertTargets", () => {
  it("offers every same-or-higher priced type, cheapest-first (child/adult boundary removed, R9)", () => {
    // From Standard (0): kid (10), food (25), vip (80) — the former child type is now
    // a valid target, price-gated like any other.
    const targets = eligibleConvertTargets("std", TYPES);
    expect(targets.map((t) => t.id)).toEqual(["kid", "food", "vip"]);
  });

  it("includes an equal-priced target (delta 0 is allowed)", () => {
    const types: ConvertType[] = [
      { id: "a", title: "A", price: 25 },
      { id: "b", title: "B", price: 25 },
    ];
    expect(eligibleConvertTargets("a", types).map((t) => t.id)).toEqual(["b"]);
  });

  it("excludes cheaper (downgrade) targets", () => {
    // From VIP (80): nothing is more expensive → no targets.
    expect(eligibleConvertTargets("vip", TYPES)).toEqual([]);
  });

  it("covers R9: a former child type can convert up to a pricier adult type", () => {
    // Child ticket (10) now sees the pricier adult types (food 25, vip 80); std (0) is
    // cheaper so it stays excluded by the price gate, not by a child/adult rule.
    expect(eligibleConvertTargets("kid", TYPES).map((t) => t.id)).toEqual(["food", "vip"]);
  });

  it("excludes the current type itself", () => {
    expect(eligibleConvertTargets("food", TYPES).some((t) => t.id === "food")).toBe(false);
  });

  it("returns nothing when the current type is unknown", () => {
    expect(eligibleConvertTargets("archived-type", TYPES)).toEqual([]);
  });
});
