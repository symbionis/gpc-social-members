import { describe, it, expect } from "vitest";
import { planRefundDraws, mergePaymentIntentIds, type ChargeSlot } from "@/lib/events/refund-pool";

describe("mergePaymentIntentIds", () => {
  it("puts the original charge first and appends the booking's extras", () => {
    expect(mergePaymentIntentIds("pi_main", ["pi_topup", "pi_conv"])).toEqual([
      "pi_main",
      "pi_topup",
      "pi_conv",
    ]);
  });

  it("drops nulls and duplicates", () => {
    // A zero-value top-up never reaches Stripe, and rows predating the column have no id.
    expect(mergePaymentIntentIds("pi_main", [null, "pi_main", "pi_topup", null])).toEqual([
      "pi_main",
      "pi_topup",
    ]);
  });

  it("copes with a booking whose original charge is unknown", () => {
    expect(mergePaymentIntentIds(null, ["pi_topup"])).toEqual(["pi_topup"]);
    expect(mergePaymentIntentIds(null, [])).toEqual([]);
  });
});

describe("planRefundDraws", () => {
  const pool = (...slots: [string, number][]): ChargeSlot[] =>
    slots.map(([paymentIntentId, remainingMinor]) => ({ paymentIntentId, remainingMinor }));

  it("takes the whole amount from the first charge that can cover it", () => {
    const plan = planRefundDraws(pool(["pi_a", 16000]), 8000);
    expect(plan.draws).toEqual([{ paymentIntentId: "pi_a", amountMinor: 8000 }]);
    expect(plan.shortfallMinor).toBe(0);
  });

  it("spreads across charges when no single one can cover it", () => {
    // The topped-up booking: the original charge is nearly spent, the top-up holds the rest.
    const plan = planRefundDraws(pool(["pi_a", 3000], ["pi_b", 10000]), 8000);
    expect(plan.draws).toEqual([
      { paymentIntentId: "pi_a", amountMinor: 3000 },
      { paymentIntentId: "pi_b", amountMinor: 5000 },
    ]);
    expect(plan.shortfallMinor).toBe(0);
  });

  it("skips exhausted charges rather than emitting zero draws", () => {
    const plan = planRefundDraws(pool(["pi_a", 0], ["pi_b", 8000]), 8000);
    expect(plan.draws).toEqual([{ paymentIntentId: "pi_b", amountMinor: 8000 }]);
  });

  it("reports a shortfall instead of silently under-refunding", () => {
    // The caller must refuse on this. Applying the partial plan blind is how a guest gets half
    // their money while the books say they got all of it.
    const plan = planRefundDraws(pool(["pi_a", 2000]), 8000);
    expect(plan.draws).toEqual([{ paymentIntentId: "pi_a", amountMinor: 2000 }]);
    expect(plan.shortfallMinor).toBe(6000);
  });

  it("reports the whole amount as shortfall when the pool is empty", () => {
    expect(planRefundDraws([], 8000)).toEqual({ draws: [], shortfallMinor: 8000 });
  });

  it("never draws more than asked, even with plenty available", () => {
    const plan = planRefundDraws(pool(["pi_a", 99999], ["pi_b", 99999]), 8000);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws.reduce((t, d) => t + d.amountMinor, 0)).toBe(8000);
  });

  it("treats a non-positive or malformed request as nothing to do", () => {
    expect(planRefundDraws(pool(["pi_a", 8000]), 0).draws).toEqual([]);
    expect(planRefundDraws(pool(["pi_a", 8000]), -500).draws).toEqual([]);
    expect(planRefundDraws(pool(["pi_a", 8000]), Number.NaN).draws).toEqual([]);
  });

  it("ignores a negative balance rather than letting it subtract from the pool", () => {
    const plan = planRefundDraws(pool(["pi_a", -5000], ["pi_b", 8000]), 8000);
    expect(plan.draws).toEqual([{ paymentIntentId: "pi_b", amountMinor: 8000 }]);
    expect(plan.shortfallMinor).toBe(0);
  });
});
