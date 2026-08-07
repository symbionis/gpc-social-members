import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildConvertedReferral } from "@/lib/members/referrals";
import { aggregateOriginators, rangeFromDates, type MemberRow } from "@/lib/admin/finance";

describe("buildConvertedReferral", () => {
  it("stamps the conversion so the row is visible to reporting", () => {
    const row = buildConvertedReferral("o1", "m1", new Date("2026-08-07T09:30:00Z"));
    expect(row).toEqual({
      originator_id: "o1",
      member_id: "m1",
      status: "converted",
      converted_at: "2026-08-07T09:30:00.000Z",
    });
  });

  it("never leaves converted_at unset — the defect this replaced", () => {
    // The original insert passed only originator_id and member_id, leaving
    // converted_at null and status at its 'pending' default, which made every
    // referral invisible to the finance dashboard's conversion count.
    const row = buildConvertedReferral("o1", "m1");
    expect(row.converted_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(row.converted_at))).toBe(false);
    expect(row.status).toBe("converted");
  });

  it("produces a row the originator aggregator actually counts", () => {
    // End-to-end on the contract that broke: build a row the way the approve
    // route now does, feed it to the aggregator the dashboard renders, and
    // require a non-zero count. A row missing converted_at scores 0 here.
    const members: MemberRow[] = [
      {
        id: "m1",
        status: "active",
        tier_id: "t1",
        originator_id: "o1",
        created_at: "2026-03-01T00:00:00Z",
        end_date: null,
      },
    ];
    const row = buildConvertedReferral("o1", "m1", new Date("2026-03-15T10:00:00Z"));

    const rows = aggregateOriginators(
      [],
      members,
      [{ originator_id: row.originator_id, converted_at: row.converted_at }],
      new Map([["o1", "Alice Agent"]]),
      rangeFromDates("2026-01-01", "2026-12-31"),
    );
    expect(rows.find((r) => r.originatorId === "o1")!.convertedReferrals).toBe(1);
  });
});

describe("approve route wiring", () => {
  // The helper being correct is worthless if the route stopped calling it. No
  // type or unit test catches a hand-rolled insert reappearing at the call site,
  // so assert the source directly — the same cheap guard used for the finance
  // tabs module's missing "use client" directive.
  it("writes referrals through the helper, not a bare insert", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/admin/applications/approve/route.ts"),
      "utf8",
    );
    const referralInsert = source.match(/from\("referrals"\)\s*\.insert\(([\s\S]*?)\)/);
    expect(referralInsert, "expected a referrals insert in the approve route").toBeTruthy();
    expect(referralInsert![1]).toContain("buildConvertedReferral");
  });
});
