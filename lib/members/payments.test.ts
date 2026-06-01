import { describe, it, expect } from "vitest";
import {
  zurichMonthKey,
  buildPaidMonthsByMember,
  availablePaymentMonths,
  matchesPaidFilter,
  matchesMonthFilter,
} from "@/lib/members/payments";

describe("zurichMonthKey", () => {
  it("buckets a late-UTC instant into the next Geneva month (CEST, +2)", () => {
    // 23:30 UTC on 31 May is 01:30 on 1 June in Geneva.
    expect(zurichMonthKey("2026-05-31T23:30:00Z")).toBe("2026-06");
  });

  it("buckets correctly across the winter offset (CET, +1)", () => {
    // 23:30 UTC on 31 Jan is 00:30 on 1 Feb in Geneva.
    expect(zurichMonthKey("2026-01-31T23:30:00Z")).toBe("2026-02");
  });

  it("keeps a mid-day instant in its own month", () => {
    expect(zurichMonthKey("2026-05-15T12:00:00Z")).toBe("2026-05");
  });
});

describe("buildPaidMonthsByMember", () => {
  it("collapses same-month rows and sorts a member's months newest-first", () => {
    const map = buildPaidMonthsByMember([
      { member_id: "a", paid_at: "2026-05-10T10:00:00Z", created_at: "2026-05-10T10:00:00Z" },
      { member_id: "a", paid_at: "2026-05-20T10:00:00Z", created_at: "2026-05-20T10:00:00Z" },
      { member_id: "a", paid_at: "2026-03-01T10:00:00Z", created_at: "2026-03-01T10:00:00Z" },
    ]);
    expect(map).toEqual({ a: ["2026-05", "2026-03"] });
  });

  it("keeps members separate", () => {
    const map = buildPaidMonthsByMember([
      { member_id: "a", paid_at: "2026-05-10T10:00:00Z", created_at: "2026-05-10T10:00:00Z" },
      { member_id: "b", paid_at: "2026-04-10T10:00:00Z", created_at: "2026-04-10T10:00:00Z" },
    ]);
    expect(map).toEqual({ a: ["2026-05"], b: ["2026-04"] });
  });

  it("falls back to created_at when paid_at is null (checkout path)", () => {
    const map = buildPaidMonthsByMember([
      { member_id: "a", paid_at: null, created_at: "2026-04-10T10:00:00Z" },
    ]);
    expect(map).toEqual({ a: ["2026-04"] });
  });

  it("prefers paid_at over created_at when both are present", () => {
    const map = buildPaidMonthsByMember([
      { member_id: "a", paid_at: "2026-06-10T10:00:00Z", created_at: "2026-04-10T10:00:00Z" },
    ]);
    expect(map).toEqual({ a: ["2026-06"] });
  });
});

describe("availablePaymentMonths", () => {
  it("unions months across members, newest-first, deduped", () => {
    expect(
      availablePaymentMonths({ a: ["2026-05", "2026-03"], b: ["2026-05", "2026-04"] }),
    ).toEqual(["2026-05", "2026-04", "2026-03"]);
  });

  it("returns [] for an empty map", () => {
    expect(availablePaymentMonths({})).toEqual([]);
  });
});

describe("matchesPaidFilter", () => {
  it("'all' matches everyone, including members with no paid record", () => {
    expect(matchesPaidFilter(["2026-05"], "all")).toBe(true);
    expect(matchesPaidFilter(undefined, "all")).toBe(true);
  });

  it("'paid' requires at least one month", () => {
    expect(matchesPaidFilter(["2026-05"], "paid")).toBe(true);
    expect(matchesPaidFilter([], "paid")).toBe(false);
    expect(matchesPaidFilter(undefined, "paid")).toBe(false);
  });

  it("'unpaid' is the inverse of 'paid'", () => {
    expect(matchesPaidFilter(["2026-05"], "unpaid")).toBe(false);
    expect(matchesPaidFilter([], "unpaid")).toBe(true);
    expect(matchesPaidFilter(undefined, "unpaid")).toBe(true);
  });
});

describe("matchesMonthFilter", () => {
  it("'all' matches any member", () => {
    expect(matchesMonthFilter(["2026-05"], "all")).toBe(true);
    expect(matchesMonthFilter(undefined, "all")).toBe(true);
  });

  it("a specific month matches only members with a paid payment that month", () => {
    expect(matchesMonthFilter(["2026-05", "2026-03"], "2026-05")).toBe(true);
    expect(matchesMonthFilter(["2026-03"], "2026-05")).toBe(false);
    expect(matchesMonthFilter(undefined, "2026-05")).toBe(false);
  });
});
