// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import OriginatorList, {
  groupReferralsByMonth,
  type Referral,
} from "@/components/admin/OriginatorList";

function referral(over: Partial<Referral> = {}): Referral {
  return {
    id: "m1",
    first_name: "Ann",
    last_name: "Adams",
    status: "active",
    originator_id: "o1",
    joinedAt: "2026-03-12T09:00:00Z",
    monthKey: "2026-03",
    tierName: "Individual",
    ...over,
  };
}

describe("groupReferralsByMonth", () => {
  it("groups into months, oldest first", () => {
    const groups = groupReferralsByMonth([
      referral({ id: "b", monthKey: "2026-06", joinedAt: "2026-06-02T00:00:00Z" }),
      referral({ id: "a", monthKey: "2026-03", joinedAt: "2026-03-01T00:00:00Z" }),
      referral({ id: "c", monthKey: "2026-06", joinedAt: "2026-06-20T00:00:00Z" }),
    ]);
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-03", "2026-06"]);
    expect(groups[1].members.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("loses no member — every input lands in exactly one group", () => {
    const input = [
      referral({ id: "a", monthKey: "2026-03" }),
      referral({ id: "b", monthKey: "2026-06" }),
      referral({ id: "c", monthKey: "2026-03" }),
      referral({ id: "d", monthKey: "" }),
    ];
    const groups = groupReferralsByMonth(input);
    const seen = groups.flatMap((g) => g.members.map((m) => m.id)).sort();
    expect(seen).toEqual(["a", "b", "c", "d"]);
  });

  it("puts members with an unresolvable month last rather than dropping them", () => {
    const groups = groupReferralsByMonth([
      referral({ id: "undated", monthKey: "" }),
      referral({ id: "dated", monthKey: "2026-03" }),
    ]);
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-03", ""]);
  });

  it("orders within a month deterministically across repeated calls", () => {
    // Same join instant — the name tiebreak has to decide, not Array.sort.
    const input = [
      referral({ id: "z", first_name: "Zoe", joinedAt: "2026-03-01T00:00:00Z" }),
      referral({ id: "a", first_name: "Alice", joinedAt: "2026-03-01T00:00:00Z" }),
    ];
    const order = () => groupReferralsByMonth(input)[0].members.map((m) => m.id);
    expect(order()).toEqual(["a", "z"]);
    expect(order()).toEqual(order());
  });

  it("does not mutate the caller's array", () => {
    const input = [
      referral({ id: "b", joinedAt: "2026-03-20T00:00:00Z" }),
      referral({ id: "a", joinedAt: "2026-03-01T00:00:00Z" }),
    ];
    groupReferralsByMonth(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("OriginatorList referred-members breakdown", () => {
  const originator = {
    id: "o1",
    first_name: "Frank",
    last_name: "Sykes",
    email: "frank@syks.co",
    invite_code: "GPC-2026",
    invite_link_active: true,
  };

  function renderList(referrals: Referral[]) {
    render(
      <OriginatorList
        originators={[originator]}
        referrals={referrals}
        appUrl="https://example.test"
        isSuperAdmin={false}
        availableAdmins={[]}
        honoraryCode=""
      />,
    );
  }

  it("shows a month heading with its count, then name, tier and date per member", () => {
    renderList([
      referral({
        id: "m1",
        first_name: "Ann",
        last_name: "Adams",
        tierName: "Individual",
        joinedAt: "2026-03-12T09:00:00Z",
        monthKey: "2026-03",
      }),
      referral({
        id: "m2",
        first_name: "Bob",
        last_name: "Brown",
        tierName: "Corporate",
        joinedAt: "2026-06-02T09:00:00Z",
        monthKey: "2026-06",
      }),
    ]);

    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("Ann Adams")).toBeInTheDocument();
    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText("12 Mar 2026")).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
    expect(screen.getByText("2 Jun 2026")).toBeInTheDocument();
  });

  it("renders no revenue figure anywhere on the card", () => {
    renderList([referral()]);
    // This page is visible to any originator, unlike the role-gated finance
    // dashboard, so money must not leak onto it.
    expect(document.body.textContent).not.toMatch(/CHF/);
  });

  it("labels months through formatMonth rather than a raw key", () => {
    renderList([referral({ monthKey: "2026-03" })]);
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-03")).not.toBeInTheDocument();
  });

  it("says the tier is absent rather than rendering an empty cell", () => {
    renderList([referral({ tierName: null, status: "pending" })]);
    expect(screen.getByText("No tier")).toBeInTheDocument();
  });

  it("keeps the headline referral count equal to the rows shown", () => {
    renderList([
      referral({ id: "a", monthKey: "2026-03" }),
      referral({ id: "b", monthKey: "2026-06" }),
      referral({ id: "c", monthKey: "2026-06" }),
    ]);
    expect(screen.getByText("3 referrals")).toBeInTheDocument();
    // Each month heading carries its own count; they sum to the headline.
    const counts = ["March 2026", "June 2026"].map((label) => {
      const heading = screen.getByText(label);
      return Number(heading.parentElement!.textContent!.replace(label, "").trim());
    });
    expect(counts.reduce((t, n) => t + n, 0)).toBe(3);
  });

  it("still shows a member whose join date could not be resolved", () => {
    renderList([referral({ id: "x", first_name: "Undated", monthKey: "" })]);
    expect(screen.getByText("Date unknown")).toBeInTheDocument();
    expect(screen.getByText("Undated Adams")).toBeInTheDocument();
  });
});
