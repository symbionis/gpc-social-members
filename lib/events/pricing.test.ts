import { describe, it, expect } from "vitest";
import { priceForRateClass, resolvePrice, isUsablePrice } from "@/lib/events/pricing";

const T = { price_member: 20, price_non_member: 40, invite_price: 30 };

describe("priceForRateClass (register checkout)", () => {
  it("member → price_member", () => {
    expect(priceForRateClass(T, "member")).toBe(20);
  });
  it("invite → invite_price", () => {
    expect(priceForRateClass(T, "invite")).toBe(30);
  });
  it("non_member → price_non_member", () => {
    expect(priceForRateClass(T, "non_member")).toBe(40);
  });
  it("returns the raw null for an unset column (caller guards)", () => {
    expect(priceForRateClass({ price_member: null, price_non_member: null, invite_price: null }, "invite")).toBeNull();
  });
});

describe("resolvePrice (top-up / upgrade / display)", () => {
  it("member → price_member", () => {
    expect(resolvePrice(T, { is_member: true })).toBe(20);
  });
  it("non-member with a non-member price → price_non_member", () => {
    expect(resolvePrice(T, { is_member: false })).toBe(40);
  });
  it("non-member on a members-only event (no non-member price) → invite_price fallback", () => {
    expect(resolvePrice({ price_member: 20, price_non_member: null, invite_price: 30 }, { is_member: false })).toBe(30);
  });
  it("non-member with neither price → null (caller guards)", () => {
    expect(resolvePrice({ price_member: 20, price_non_member: null, invite_price: null }, { is_member: false })).toBeNull();
  });
  it("a zero non-member price is kept, not coalesced to invite_price", () => {
    // 0 ?? x === 0 — a free public tier must stay free, not fall through to the invite rate.
    expect(resolvePrice({ price_member: 20, price_non_member: 0, invite_price: 30 }, { is_member: false })).toBe(0);
  });
});

describe("isUsablePrice", () => {
  it("accepts a non-negative finite number (incl. 0)", () => {
    expect(isUsablePrice(0)).toBe(true);
    expect(isUsablePrice(25)).toBe(true);
  });
  it("rejects null, negative, and non-finite", () => {
    expect(isUsablePrice(null)).toBe(false);
    expect(isUsablePrice(-1)).toBe(false);
    expect(isUsablePrice(Number.NaN)).toBe(false);
  });
});
