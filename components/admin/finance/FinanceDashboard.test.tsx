// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

// DateRangeFilter (rendered above the tabs on every tab) reaches for the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/finance",
  useSearchParams: () => new URLSearchParams("from=2026-01-01&to=2026-06-30"),
}));

import FinanceDashboard from "@/components/admin/finance/FinanceDashboard";
import type { FinanceSummary } from "@/lib/admin/finance";

const SUMMARY: FinanceSummary = {
  range: { from: "2026-01-01", to: "2026-06-30" },
  totals: {
    totalRevenue: 5000,
    membershipNet: 4000,
    eventGross: 1000,
    activeMembers: 12,
    newMembers: 3,
  },
  membership: {
    gross: 4000,
    refunds: 0,
    net: 4000,
    paidCount: 2,
    payingMembers: 2,
    newRevenue: 4000,
    renewalRevenue: 0,
    newCount: 2,
    renewalCount: 0,
    arpu: 2000,
    byTier: [{ tierId: "t1", tierName: "Individual", gross: 4000, net: 4000, paidCount: 2 }],
    byMonth: [{ monthKey: "2026-03", gross: 4000, net: 4000 }],
  },
  membershipTransactions: [
    {
      memberName: "Ann Adams",
      tierId: "t1",
      monthKey: "2026-03",
      date: "2026-03-01",
      status: "paid",
      amountChf: 4000,
    },
  ],
  events: {
    gross: 1000,
    paidRegistrations: 1,
    freeRegistrations: 0,
    byEvent: [{ eventId: "e1", title: "Summer Gala", gross: 1000, paidRegistrations: 1 }],
    byTicketType: [{ title: "Standard", gross: 1000, quantity: 1 }],
  },
  originators: [
    {
      originatorId: "o1",
      name: "Sophie Dubois",
      net: 4000,
      convertedReferrals: 2,
      byMonth: [{ monthKey: "2026-03", net: 4000, paidCount: 2 }],
    },
  ],
  originatorTransactions: [
    {
      id: "pay-1",
      originatorId: "o1",
      monthKey: "2026-03",
      memberName: "Ann Adams",
      tierName: "Individual",
      when: "2026-03-01T09:00:00Z",
      status: "paid",
      amountChf: 4000,
      stripeRef: { kind: "payment_intent", id: "pi_123" },
    },
  ],
  memberHealth: {
    active: 12,
    expired: 1,
    pending: 0,
    suspended: 0,
    total: 13,
    newMembers: 3,
    renewalRate: 0.9,
  },
  complete: true,
};

function renderDashboard(over: Partial<React.ComponentProps<typeof FinanceDashboard>> = {}) {
  return render(
    <FinanceDashboard summary={SUMMARY} tab="membership" stripeTestMode={false} {...over} />,
  );
}

const panelRegion = () => document.querySelector("[aria-busy]") as HTMLElement;

describe("FinanceDashboard", () => {
  it("shows only the Membership panels on the membership tab", () => {
    renderDashboard({ tab: "membership" });
    expect(screen.getByRole("heading", { name: "Membership revenue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Member health" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Event sales" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Originator breakdown" })).not.toBeInTheDocument();
  });

  it("shows only the Event panel on the events tab", () => {
    renderDashboard({ tab: "events" });
    expect(screen.getByRole("heading", { name: "Event sales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Membership revenue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Originator breakdown" })).not.toBeInTheDocument();
  });

  it("shows only the Originator panel on the originator tab", () => {
    renderDashboard({ tab: "originator" });
    expect(screen.getByRole("heading", { name: "Originator breakdown" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Membership revenue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Event sales" })).not.toBeInTheDocument();
  });

  it("forwards the transactions and Stripe mode the originator drill-down needs", async () => {
    const user = userEvent.setup();
    renderDashboard({ tab: "originator", stripeTestMode: true });
    // Months render open, so the payment rows are one click away.
    await user.click(screen.getByRole("button", { name: /March 2026/ }));
    // A live-mode href here would mean stripeTestMode was dropped in the middle.
    expect(screen.getByRole("link", { name: /Ann Adams/ })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/test/payments/pi_123",
    );
  });

  it("keeps the header, filter, and caveats outside the tab switch", () => {
    for (const tab of ["membership", "events", "originator"] as const) {
      cleanup();
      renderDashboard({ tab });
      expect(screen.getByRole("heading", { name: "Finance" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
      expect(screen.getByText(/Figures are gross of Stripe fees/)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Export all transactions (CSV)" }),
      ).toHaveAttribute("href", "/admin/finance/export?from=2026-01-01&to=2026-06-30");
    }
  });

  it("shows the incomplete-data banner above the tabs only when a read failed", () => {
    renderDashboard({ summary: { ...SUMMARY, complete: false } });
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    cleanup();
    renderDashboard();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });

  it("marks the panel region busy while a tab navigation is in flight", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDashboard({ tab: "membership" });
    expect(panelRegion()).toHaveAttribute("aria-busy", "false");

    await user.click(screen.getByRole("link", { name: "Originator" }));
    expect(panelRegion()).toHaveAttribute("aria-busy", "true");

    // The server navigation landing is what clears it.
    rerender(
      <FinanceDashboard summary={SUMMARY} tab="originator" stripeTestMode={false} />,
    );
    expect(panelRegion()).toHaveAttribute("aria-busy", "false");
  });

  it("does not mark the region busy when the active tab is clicked again", async () => {
    const user = userEvent.setup();
    renderDashboard({ tab: "membership" });
    await user.click(screen.getByRole("link", { name: "Membership" }));
    expect(panelRegion()).toHaveAttribute("aria-busy", "false");
  });
});
