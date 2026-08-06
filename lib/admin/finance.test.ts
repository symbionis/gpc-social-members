import { describe, it, expect } from "vitest";
import {
  rangeFromDates,
  aggregateMembership,
  aggregateEvents,
  aggregateOriginators,
  aggregateMemberHealth,
  getFinanceSummary,
  getFinanceTransactions,
  buildMembershipTransactions,
  buildOriginatorTransactions,
  resolveStripeRef,
  UNATTRIBUTED_ORIGINATOR,
  type MembershipPaymentRow,
  type EventRegistrationRow,
  type EventItemRow,
  type MemberRow,
  type ReferralRow,
} from "@/lib/admin/finance";

const YEAR_2026 = rangeFromDates("2026-01-01", "2026-12-31");

let paymentSeq = 0;

function payment(over: Partial<MembershipPaymentRow>): MembershipPaymentRow {
  paymentSeq += 1;
  return {
    id: `p${paymentSeq}`,
    member_id: "m1",
    tier_id: "t1",
    amount_eur: 100,
    payment_status: "paid",
    paid_at: "2026-03-01T10:00:00Z",
    created_at: "2026-03-01T10:00:00Z",
    stripe_payment_intent_id: null,
    stripe_checkout_session_id: null,
    ...over,
  };
}

describe("rangeFromDates", () => {
  it("is inclusive of the `to` calendar day (exclusive upper at to+1day)", () => {
    const r = rangeFromDates("2026-01-01", "2026-01-31");
    expect(Date.parse("2026-01-31T23:59:59Z")).toBeLessThan(r.toMs);
    expect(Date.parse("2026-02-01T00:00:00Z")).toBe(r.toMs);
    expect(Date.parse("2026-01-01T00:00:00Z")).toBe(r.fromMs);
  });
});

describe("aggregateMembership", () => {
  const tierNames = new Map([
    ["t1", "Individual"],
    ["t2", "Corporate"],
  ]);

  it("computes gross, refunds, and net; excludes free/pending", () => {
    const rows = [
      payment({ member_id: "a", amount_eur: 100, payment_status: "paid" }),
      payment({ member_id: "b", amount_eur: 200, payment_status: "paid" }),
      payment({ member_id: "c", amount_eur: 50, payment_status: "refunded" }),
      payment({ member_id: "d", amount_eur: 999, payment_status: "free" }),
      payment({ member_id: "e", amount_eur: 999, payment_status: "pending" }),
    ];
    const s = aggregateMembership(rows, tierNames, YEAR_2026);
    expect(s.gross).toBe(300);
    expect(s.refunds).toBe(50);
    expect(s.net).toBe(250);
    expect(s.paidCount).toBe(2);
  });

  it("classifies a member's earliest paid as new and later ones as renewal", () => {
    const rows = [
      payment({ member_id: "a", amount_eur: 100, paid_at: "2026-02-01T00:00:00Z" }),
      payment({ member_id: "a", amount_eur: 120, paid_at: "2026-09-01T00:00:00Z" }),
      payment({ member_id: "b", amount_eur: 100, paid_at: "2026-05-01T00:00:00Z" }),
    ];
    const s = aggregateMembership(rows, tierNames, YEAR_2026);
    expect(s.newCount).toBe(2); // a's Feb + b's May
    expect(s.newRevenue).toBe(200);
    expect(s.renewalCount).toBe(1); // a's Sep
    expect(s.renewalRevenue).toBe(120);
  });

  it("treats an in-period payment as renewal when an earlier paid exists outside the period", () => {
    // Member paid last year (outside range) then again this year → renewal.
    const rows = [
      payment({ member_id: "a", amount_eur: 90, paid_at: "2025-06-01T00:00:00Z" }),
      payment({ member_id: "a", amount_eur: 100, paid_at: "2026-06-01T00:00:00Z" }),
    ];
    const s = aggregateMembership(rows, tierNames, YEAR_2026);
    expect(s.newCount).toBe(0);
    expect(s.renewalCount).toBe(1);
    expect(s.gross).toBe(100); // only the in-period payment counts toward revenue
  });

  it("nets refunds within by-tier and by-month breakdowns", () => {
    const rows = [
      payment({ tier_id: "t1", amount_eur: 100, payment_status: "paid", paid_at: "2026-03-10T00:00:00Z" }),
      payment({ tier_id: "t1", amount_eur: 40, payment_status: "refunded", paid_at: "2026-03-20T00:00:00Z" }),
    ];
    const s = aggregateMembership(rows, tierNames, YEAR_2026);
    const t1 = s.byTier.find((t) => t.tierId === "t1")!;
    expect(t1.gross).toBe(100);
    expect(t1.net).toBe(60);
    const march = s.byMonth.find((m) => m.monthKey === "2026-03")!;
    expect(march.gross).toBe(100);
    expect(march.net).toBe(60);
  });

  it("computes ARPU as net / distinct paying members (not all active members)", () => {
    const rows = [
      payment({ member_id: "a", amount_eur: 300, payment_status: "paid" }),
      payment({ member_id: "a", amount_eur: 100, payment_status: "paid" }), // same member
      payment({ member_id: "b", amount_eur: 200, payment_status: "paid" }),
    ];
    const s = aggregateMembership(rows, tierNames, YEAR_2026);
    expect(s.payingMembers).toBe(2); // a and b, deduped
    expect(s.net).toBe(600);
    expect(s.arpu).toBe(300); // 600 / 2 paying members
    const none = aggregateMembership([], tierNames, YEAR_2026);
    expect(none.arpu).toBe(0);
    expect(none.payingMembers).toBe(0);
  });

  it("excludes payments outside the range (exclusive upper bound)", () => {
    const rows = [
      payment({ amount_eur: 100, paid_at: "2026-01-01T00:00:00Z" }), // in
      payment({ amount_eur: 200, paid_at: "2027-01-01T00:00:00Z" }), // out (== toMs)
    ];
    const s = aggregateMembership(rows, tierNames, YEAR_2026);
    expect(s.gross).toBe(100);
  });

  it("reads amounts from amount_eur and treats them as CHF (no conversion)", () => {
    const s = aggregateMembership([payment({ amount_eur: 1500 })], tierNames, YEAR_2026);
    expect(s.gross).toBe(1500);
  });
});

describe("buildMembershipTransactions", () => {
  const names = new Map([
    ["a", "Ann Adams"],
    ["b", "Bob Brown"],
  ]);

  it("includes paid/refunded in range with signed amounts that reconcile per tier/month", () => {
    const rows = [
      payment({ member_id: "a", tier_id: "t1", amount_eur: 100, payment_status: "paid", paid_at: "2026-03-01T00:00:00Z" }),
      payment({ member_id: "b", tier_id: "t1", amount_eur: 40, payment_status: "refunded", paid_at: "2026-03-10T00:00:00Z" }),
      payment({ member_id: "a", tier_id: "t2", amount_eur: 200, payment_status: "paid", paid_at: "2026-05-01T00:00:00Z" }),
      payment({ member_id: "a", tier_id: "t1", amount_eur: 999, payment_status: "pending", paid_at: "2026-03-02T00:00:00Z" }),
      payment({ member_id: "a", tier_id: "t1", amount_eur: 50, payment_status: "paid", paid_at: "2027-01-01T00:00:00Z" }), // out of range
    ];
    const txns = buildMembershipTransactions(rows, names, YEAR_2026);
    expect(txns).toHaveLength(3); // pending + out-of-range excluded
    // Tier t1 subset nets 100 - 40 = 60 (matches aggregateMembership byTier)
    const t1 = txns.filter((t) => t.tierId === "t1");
    expect(t1.reduce((s, t) => s + t.amountChf, 0)).toBe(60);
    // March subset nets 60 too
    const march = txns.filter((t) => t.monthKey === "2026-03");
    expect(march.reduce((s, t) => s + t.amountChf, 0)).toBe(60);
    expect(txns.find((t) => t.status === "refunded")!.amountChf).toBe(-40);
    expect(txns[0].memberName).toBe("Ann Adams");
  });
});

describe("aggregateEvents", () => {
  const titles = new Map([["e1", "Summer Gala"]]);

  function reg(over: Partial<EventRegistrationRow>): EventRegistrationRow {
    return {
      id: "r1",
      event_id: "e1",
      total_amount_chf: 50,
      status: "paid",
      paid_at: "2026-06-01T00:00:00Z",
      created_at: "2026-06-01T00:00:00Z",
      ...over,
    };
  }

  it("sums paid registration totals (top-ups already folded into total), free = 0", () => {
    const regs = [
      reg({ id: "r1", total_amount_chf: 50, status: "paid" }),
      reg({ id: "r2", total_amount_chf: 150, status: "paid" }), // includes a top-up
      reg({ id: "r3", total_amount_chf: 0, status: "free" }),
    ];
    const s = aggregateEvents(regs, [], titles, YEAR_2026);
    expect(s.gross).toBe(200);
    expect(s.paidRegistrations).toBe(2);
    expect(s.freeRegistrations).toBe(1);
    expect(s.byEvent[0]).toMatchObject({ eventId: "e1", gross: 200, paidRegistrations: 2 });
  });

  it("rolls up ticket-type revenue only for in-period paid registrations", () => {
    const regs = [
      reg({ id: "r1", status: "paid" }),
      reg({ id: "r2", status: "free" }),
    ];
    const items: EventItemRow[] = [
      { registration_id: "r1", title_snapshot: "Standard", quantity: 2, line_total_chf: 100 },
      { registration_id: "r2", title_snapshot: "Standard", quantity: 1, line_total_chf: 0 },
    ];
    const s = aggregateEvents(regs, items, titles, YEAR_2026);
    const standard = s.byTicketType.find((t) => t.title === "Standard")!;
    expect(standard.gross).toBe(100); // r2 (free) excluded
    expect(standard.quantity).toBe(2);
  });
});

describe("aggregateOriginators", () => {
  const members: MemberRow[] = [
    { id: "m1", status: "active", tier_id: "t1", originator_id: "o1", created_at: "2026-01-02T00:00:00Z", end_date: null },
    { id: "m2", status: "active", tier_id: "t1", originator_id: null, created_at: "2026-01-02T00:00:00Z", end_date: null },
  ];
  const names = new Map([["o1", "Alice Agent"]]);

  it("attributes net revenue to originators and groups unattributed as Direct", () => {
    const payments = [
      payment({ member_id: "m1", amount_eur: 100, payment_status: "paid" }),
      payment({ member_id: "m1", amount_eur: 30, payment_status: "refunded" }),
      payment({ member_id: "m2", amount_eur: 200, payment_status: "paid" }),
    ];
    const rows = aggregateOriginators(payments, members, [], names, YEAR_2026);
    const alice = rows.find((r) => r.originatorId === "o1")!;
    const direct = rows.find((r) => r.originatorId === UNATTRIBUTED_ORIGINATOR)!;
    expect(alice.net).toBe(70); // 100 - 30
    expect(alice.name).toBe("Alice Agent");
    expect(direct.net).toBe(200);
  });

  it("counts converted referrals within the period", () => {
    const referrals: ReferralRow[] = [
      { originator_id: "o1", converted_at: "2026-04-01T00:00:00Z" }, // in
      { originator_id: "o1", converted_at: "2025-04-01T00:00:00Z" }, // out
      { originator_id: "o1", converted_at: null }, // never
    ];
    const rows = aggregateOriginators([], members, referrals, names, YEAR_2026);
    const alice = rows.find((r) => r.originatorId === "o1")!;
    expect(alice.convertedReferrals).toBe(1);
  });

  it("breaks each originator down by Geneva calendar month, ascending", () => {
    const payments = [
      payment({ member_id: "m1", amount_eur: 900, paid_at: "2026-03-15T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 1200, paid_at: "2026-04-15T00:00:00Z" }),
    ];
    const alice = aggregateOriginators(payments, members, [], names, YEAR_2026).find(
      (r) => r.originatorId === "o1",
    )!;
    expect(alice.byMonth.map((m) => m.monthKey)).toEqual(["2026-03", "2026-04"]);
    expect(alice.byMonth.map((m) => m.net)).toEqual([900, 1200]);
    expect(alice.byMonth.map((m) => m.paidCount)).toEqual([1, 1]);
    expect(alice.net).toBe(2100); // AE2
  });

  it("buckets a payment just after UTC midnight into the Geneva month", () => {
    // 2026-02-28T23:30Z is 00:30 on 1 March in Geneva. AE1.
    const payments = [payment({ member_id: "m1", paid_at: "2026-02-28T23:30:00Z" })];
    const alice = aggregateOriginators(payments, members, [], names, YEAR_2026).find(
      (r) => r.originatorId === "o1",
    )!;
    expect(alice.byMonth.map((m) => m.monthKey)).toEqual(["2026-03"]);
  });

  it("keeps the month nets summing to each originator's total net", () => {
    const payments = [
      payment({ member_id: "m1", amount_eur: 900, paid_at: "2026-03-15T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 250, payment_status: "refunded", paid_at: "2026-03-20T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 1200, paid_at: "2026-04-15T00:00:00Z" }),
      payment({ member_id: "m2", amount_eur: 400, paid_at: "2026-05-15T00:00:00Z" }),
    ];
    const rows = aggregateOriginators(payments, members, [], names, YEAR_2026);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.byMonth.reduce((s, m) => s + m.net, 0)).toBe(r.net);
    }
    // Refunds net down their own month rather than landing elsewhere.
    const march = rows
      .find((r) => r.originatorId === "o1")!
      .byMonth.find((m) => m.monthKey === "2026-03")!;
    expect(march.net).toBe(650);
    expect(march.paidCount).toBe(1); // the refund is not a paid payment
  });

  it("gives members with no originator their own Direct monthly breakdown", () => {
    // AE5.
    const payments = [
      payment({ member_id: "m2", amount_eur: 300, paid_at: "2026-03-15T00:00:00Z" }),
      payment({ member_id: "m2", amount_eur: 500, paid_at: "2026-06-15T00:00:00Z" }),
    ];
    const direct = aggregateOriginators(payments, members, [], names, YEAR_2026).find(
      (r) => r.originatorId === UNATTRIBUTED_ORIGINATOR,
    )!;
    expect(direct.name).toBe("Direct (no originator)");
    expect(direct.byMonth.map((m) => m.monthKey)).toEqual(["2026-03", "2026-06"]);
    expect(direct.byMonth.reduce((s, m) => s + m.net, 0)).toBe(direct.net);
  });

  it("leaves byMonth empty for an originator with referrals but no attributed payments", () => {
    // AE6 — the panel renders a no-payments line rather than blank space.
    const referrals: ReferralRow[] = [{ originator_id: "o1", converted_at: "2026-04-01T00:00:00Z" }];
    const alice = aggregateOriginators([], members, referrals, names, YEAR_2026).find(
      (r) => r.originatorId === "o1",
    )!;
    expect(alice.convertedReferrals).toBe(1);
    expect(alice.byMonth).toEqual([]);
  });

  it("sorts originators with identical net deterministically across repeated calls", () => {
    const tied: MemberRow[] = [
      { id: "m1", status: "active", tier_id: "t1", originator_id: "o1", created_at: "2026-01-02T00:00:00Z", end_date: null },
      { id: "m3", status: "active", tier_id: "t1", originator_id: "o2", created_at: "2026-01-02T00:00:00Z", end_date: null },
    ];
    const tiedNames = new Map([
      ["o1", "Zoe Zenith"],
      ["o2", "Alice Agent"],
    ]);
    const payments = [
      payment({ member_id: "m1", amount_eur: 500 }),
      payment({ member_id: "m3", amount_eur: 500 }),
    ];
    const order = () =>
      aggregateOriginators(payments, tied, [], tiedNames, YEAR_2026).map((r) => r.originatorId);
    // Equal net → name ascending, so the tie never depends on Array.sort stability.
    expect(order()).toEqual(["o2", "o1"]);
    expect(order()).toEqual(order());
  });

  it("excludes payments outside the range from byMonth", () => {
    const payments = [
      payment({ member_id: "m1", amount_eur: 100, paid_at: "2026-03-01T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 999, paid_at: "2027-03-01T00:00:00Z" }),
    ];
    const alice = aggregateOriginators(payments, members, [], names, YEAR_2026).find(
      (r) => r.originatorId === "o1",
    )!;
    expect(alice.byMonth.map((m) => m.monthKey)).toEqual(["2026-03"]);
    expect(alice.net).toBe(100);
  });
});

describe("resolveStripeRef", () => {
  it("prefers the PaymentIntent over the Checkout Session", () => {
    expect(
      resolveStripeRef({
        stripe_payment_intent_id: "pi_1",
        stripe_checkout_session_id: "cs_1",
      }),
    ).toEqual({ kind: "payment_intent", id: "pi_1" });
  });

  it("falls back to the Checkout Session when there is no PaymentIntent", () => {
    expect(
      resolveStripeRef({
        stripe_payment_intent_id: null,
        stripe_checkout_session_id: "cs_1",
      }),
    ).toEqual({ kind: "checkout_session", id: "cs_1" });
  });

  it("returns null when neither identifier is on record", () => {
    expect(
      resolveStripeRef({
        stripe_payment_intent_id: null,
        stripe_checkout_session_id: null,
      }),
    ).toBeNull();
  });
});

describe("buildOriginatorTransactions", () => {
  const members: MemberRow[] = [
    { id: "m1", status: "active", tier_id: "t1", originator_id: "o1", created_at: "2026-01-02T00:00:00Z", end_date: null },
    { id: "m2", status: "active", tier_id: "t1", originator_id: null, created_at: "2026-01-02T00:00:00Z", end_date: null },
  ];
  const memberNames = new Map([
    ["m1", "Ann Adams"],
    ["m2", "Bob Brown"],
  ]);
  const tierNames = new Map([["t1", "Individual"]]);
  const originatorNames = new Map([["o1", "Alice Agent"]]);

  it("includes paid and refunded rows only, and excludes out-of-range rows", () => {
    const payments = [
      payment({ member_id: "m1", payment_status: "paid", amount_eur: 100 }),
      payment({ member_id: "m1", payment_status: "refunded", amount_eur: 40 }),
      payment({ member_id: "m1", payment_status: "pending", amount_eur: 999 }),
      payment({ member_id: "m1", payment_status: "overdue", amount_eur: 999 }),
      payment({ member_id: "m1", payment_status: "free", amount_eur: 999 }),
      payment({ member_id: "m1", payment_status: "paid", amount_eur: 999, paid_at: "2027-03-01T00:00:00Z" }),
    ];
    const rows = buildOriginatorTransactions(payments, members, memberNames, tierNames, YEAR_2026);
    expect(rows.map((r) => r.status)).toEqual(["paid", "refunded"]);
    expect(rows.map((r) => r.amountChf)).toEqual([100, -40]);
  });

  it("carries member, tier, month, and Stripe reference on each row", () => {
    const payments = [
      payment({
        id: "pay-1",
        member_id: "m1",
        amount_eur: 2400,
        paid_at: "2026-04-12T09:00:00Z",
        stripe_payment_intent_id: "pi_123",
      }),
      payment({
        id: "pay-2",
        member_id: "m2",
        amount_eur: 1500,
        paid_at: "2026-04-28T09:00:00Z",
        stripe_checkout_session_id: "cs_456",
      }),
    ];
    const rows = buildOriginatorTransactions(payments, members, memberNames, tierNames, YEAR_2026);
    expect(rows[0]).toMatchObject({
      id: "pay-1",
      originatorId: "o1",
      monthKey: "2026-04",
      memberName: "Ann Adams",
      tierName: "Individual",
      date: "2026-04-12",
      status: "paid",
      amountChf: 2400,
      stripeRef: { kind: "payment_intent", id: "pi_123" },
    });
    expect(rows[1]).toMatchObject({
      originatorId: UNATTRIBUTED_ORIGINATOR,
      memberName: "Bob Brown",
      stripeRef: { kind: "checkout_session", id: "cs_456" },
    });
  });

  it("sorts by date then payment id so repeated calls agree", () => {
    const payments = [
      payment({ id: "b", paid_at: "2026-05-01T00:00:00Z" }),
      payment({ id: "a", paid_at: "2026-05-01T00:00:00Z" }),
      payment({ id: "c", paid_at: "2026-04-01T00:00:00Z" }),
    ];
    const rows = buildOriginatorTransactions(payments, members, memberNames, tierNames, YEAR_2026);
    expect(rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("reconciles with aggregateOriginators for every originator and month", () => {
    // The check that catches the two functions' independently written range,
    // sign, and month-key logic drifting apart.
    const payments = [
      payment({ member_id: "m1", amount_eur: 900, paid_at: "2026-03-15T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 250, payment_status: "refunded", paid_at: "2026-03-20T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 1200, paid_at: "2026-04-15T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 300, paid_at: "2026-02-28T23:30:00Z" }), // Geneva March
      payment({ member_id: "m2", amount_eur: 400, paid_at: "2026-05-15T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 777, payment_status: "pending", paid_at: "2026-05-02T00:00:00Z" }),
      payment({ member_id: "m1", amount_eur: 888, paid_at: "2027-01-01T00:00:00Z" }), // out of range
    ];
    const originators = aggregateOriginators(payments, members, [], originatorNames, YEAR_2026);
    const txns = buildOriginatorTransactions(payments, members, memberNames, tierNames, YEAR_2026);

    for (const o of originators) {
      for (const m of o.byMonth) {
        const summed = txns
          .filter((t) => t.originatorId === o.originatorId && t.monthKey === m.monthKey)
          .reduce((s, t) => s + t.amountChf, 0);
        expect(summed).toBe(m.net);
      }
      // …and no transaction rows exist for a month the aggregator never emitted.
      const monthKeys = new Set(o.byMonth.map((m) => m.monthKey));
      const orphan = txns.filter(
        (t) => t.originatorId === o.originatorId && !monthKeys.has(t.monthKey),
      );
      expect(orphan).toEqual([]);
    }
  });
});

describe("aggregateMemberHealth", () => {
  const members: MemberRow[] = [
    { id: "1", status: "active", tier_id: "t1", originator_id: null, created_at: "2026-02-01T00:00:00Z", end_date: "2026-12-31" },
    { id: "2", status: "expired", tier_id: "t1", originator_id: null, created_at: "2025-01-01T00:00:00Z", end_date: "2026-06-30" },
    { id: "3", status: "pending", tier_id: null, originator_id: null, created_at: "2026-03-01T00:00:00Z", end_date: null },
    { id: "4", status: "active", tier_id: "t1", originator_id: null, created_at: "2024-01-01T00:00:00Z", end_date: "2026-01-15" },
  ];

  it("counts statuses, new members in period, and a pragmatic renewal rate", () => {
    const h = aggregateMemberHealth(members, YEAR_2026);
    expect(h.active).toBe(2);
    expect(h.expired).toBe(1);
    expect(h.pending).toBe(1);
    expect(h.total).toBe(4);
    expect(h.newMembers).toBe(2); // ids 1 and 3 created in 2026
    // ended in period: ids 1,2,4 (end_date in 2026). active among them: ids 1,4 → 2/3
    expect(h.renewalRate).toBe(0.67);
  });
});

// --- getFinanceSummary pagination (fake client, >1000 rows) ---

describe("getFinanceSummary pagination", () => {
  function makeClient(tables: Record<string, Record<string, unknown>[]>) {
    return {
      from(table: string) {
        return {
          select() {
            const rows = tables[table] ?? [];
            const builder = {
              order() {
                return builder;
              },
              range(from: number, to: number) {
                return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
              },
            };
            return builder;
          },
        };
      },
    };
  }

  it("pages past the 1000-row cap without truncating", async () => {
    // 1500 paid payments of 10 CHF each = 15000 gross.
    const payments = Array.from({ length: 1500 }, (_, i) => ({
      id: `p${i}`,
      member_id: `m${i}`,
      tier_id: "t1",
      amount_eur: 10,
      payment_status: "paid",
      paid_at: "2026-05-01T00:00:00Z",
      created_at: "2026-05-01T00:00:00Z",
      stripe_payment_intent_id: null,
      stripe_checkout_session_id: null,
    }));
    const client = makeClient({
      payments,
      event_registrations: [],
      event_registration_items: [],
      members: [],
      membership_tiers: [{ id: "t1", name: "Individual" }],
      admin_users: [],
      referrals: [],
      events: [],
    });
    const summary = await getFinanceSummary(client, "2026-01-01", "2026-12-31");
    expect(summary.membership.paidCount).toBe(1500);
    expect(summary.membership.gross).toBe(15000);
    expect(summary.complete).toBe(true);
    expect(summary.totals.totalRevenue).toBe(15000);
  });

  it("reports complete:false when a read errors", async () => {
    const client = {
      from() {
        return {
          select() {
            const builder = {
              order() {
                return builder;
              },
              range() {
                return Promise.resolve({ data: null, error: { message: "boom" } });
              },
            };
            return builder;
          },
        };
      },
    };
    const summary = await getFinanceSummary(client, "2026-01-01", "2026-12-31");
    expect(summary.complete).toBe(false);
  });

  it("surfaces originator transactions with their Stripe reference end to end", async () => {
    // The makeClient fake ignores the column list, so the new fields have to be
    // on the fixture ROWS — widening the select string alone proves nothing.
    const client = makeClient({
      payments: [
        {
          id: "pay-1",
          member_id: "m1",
          tier_id: "t1",
          amount_eur: 1400,
          payment_status: "paid",
          paid_at: "2026-03-04T00:00:00Z",
          created_at: "2026-03-04T00:00:00Z",
          stripe_payment_intent_id: "pi_live_1",
          stripe_checkout_session_id: "cs_live_1",
        },
        {
          id: "pay-2",
          member_id: "m1",
          tier_id: "t1",
          amount_eur: 600,
          payment_status: "paid",
          paid_at: "2026-04-04T00:00:00Z",
          created_at: "2026-04-04T00:00:00Z",
          stripe_payment_intent_id: null,
          stripe_checkout_session_id: null,
        },
      ],
      event_registrations: [],
      event_registration_items: [],
      members: [
        {
          id: "m1",
          status: "active",
          tier_id: "t1",
          originator_id: "o1",
          created_at: "2026-01-01T00:00:00Z",
          end_date: null,
          first_name: "Ann",
          last_name: "Adams",
          email: "ann@x.com",
        },
      ],
      membership_tiers: [{ id: "t1", name: "Individual" }],
      admin_users: [{ id: "o1", first_name: "Alice", last_name: "Agent" }],
      referrals: [],
      events: [],
    });

    const summary = await getFinanceSummary(client, "2026-01-01", "2026-12-31");
    expect(summary.originatorTransactions).toHaveLength(2);
    const [first, second] = summary.originatorTransactions;
    expect(first).toMatchObject({
      originatorId: "o1",
      monthKey: "2026-03",
      memberName: "Ann Adams",
      tierName: "Individual",
      stripeRef: { kind: "payment_intent", id: "pi_live_1" },
    });
    expect(second.stripeRef).toBeNull();

    // Reconciles with the aggregator the panel renders one level up.
    const alice = summary.originators.find((o) => o.originatorId === "o1")!;
    expect(alice.byMonth.map((m) => m.monthKey)).toEqual(["2026-03", "2026-04"]);
    expect(alice.byMonth.reduce((s, m) => s + m.net, 0)).toBe(alice.net);
    expect(alice.net).toBe(2000);
  });
});

describe("getFinanceTransactions", () => {
  function makeClient(tables: Record<string, Record<string, unknown>[]>) {
    return {
      from(table: string) {
        return {
          select() {
            const rows = tables[table] ?? [];
            const builder = {
              order() {
                return builder;
              },
              range(from: number, to: number) {
                return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
              },
            };
            return builder;
          },
        };
      },
    };
  }

  const base = {
    members: [{ id: "m1", first_name: "Pat", last_name: "Payer", email: "pat@x.com" }],
    membership_tiers: [{ id: "t1", name: "Individual" }],
    events: [{ id: "e1", title: "Gala" }],
  };

  it("signs amounts so the column reconciles with net + event gross; comp/free are 0; pending excluded", async () => {
    const client = makeClient({
      ...base,
      payments: [
        { member_id: "m1", tier_id: "t1", amount_eur: 100, payment_status: "paid", paid_at: "2026-03-01T00:00:00Z", created_at: "2026-03-01T00:00:00Z" },
        { member_id: "m1", tier_id: "t1", amount_eur: 40, payment_status: "refunded", paid_at: "2026-03-05T00:00:00Z", created_at: "2026-03-05T00:00:00Z" },
        { member_id: "m1", tier_id: "t1", amount_eur: 0, payment_status: "free", paid_at: "2026-03-06T00:00:00Z", created_at: "2026-03-06T00:00:00Z" },
        { member_id: "m1", tier_id: "t1", amount_eur: 999, payment_status: "pending", paid_at: null, created_at: "2026-03-07T00:00:00Z" },
      ],
      event_registrations: [
        { id: "r1", event_id: "e1", total_amount_chf: 50, status: "paid", paid_at: "2026-04-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z", name: "Guest", email: "g@x.com" },
        { id: "r2", event_id: "e1", total_amount_chf: 0, status: "free", paid_at: "2026-04-02T00:00:00Z", created_at: "2026-04-02T00:00:00Z", name: "Comp", email: "c@x.com" },
      ],
      event_registration_items: [],
    });
    const rows = await getFinanceTransactions(client, "2026-01-01", "2026-12-31");
    // pending excluded → 3 membership (paid, refunded, free) + 2 event = 5
    expect(rows).toHaveLength(5);
    const total = rows.reduce((s, r) => s + r.amountChf, 0);
    // membership net (100 - 40 + 0) + event gross (50 + 0) = 60 + 50 = 110
    expect(total).toBe(110);
    const refundRow = rows.find((r) => r.status === "refunded")!;
    expect(refundRow.amountChf).toBe(-40);
    const freeRows = rows.filter((r) => r.status === "free");
    expect(freeRows.every((r) => r.amountChf === 0)).toBe(true);
    expect(rows.some((r) => r.status === "pending")).toBe(false);
  });

  it("returns no rows for an empty range (CSV would be headers only)", async () => {
    const client = makeClient({
      ...base,
      payments: [
        { member_id: "m1", tier_id: "t1", amount_eur: 100, payment_status: "paid", paid_at: "2020-01-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z" },
      ],
      event_registrations: [],
      event_registration_items: [],
    });
    const rows = await getFinanceTransactions(client, "2026-01-01", "2026-12-31");
    expect(rows).toHaveLength(0);
  });
});
