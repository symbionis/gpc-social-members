"use client";

import { useEffect, useState } from "react";
import type { FinanceSummary } from "@/lib/admin/finance";
import FinanceHeader from "./FinanceHeader";
import DateRangeFilter from "./DateRangeFilter";
import FinanceTabs from "./FinanceTabs";
import type { FinanceTab } from "./tabs";
import MembershipRevenuePanel from "./MembershipRevenuePanel";
import EventRevenuePanel from "./EventRevenuePanel";
import EventMonthlyPanel from "./EventMonthlyPanel";
import EventTicketTypePanel from "./EventTicketTypePanel";
import OriginatorBreakdownPanel from "./OriginatorBreakdownPanel";
import MemberHealthPanel from "./MemberHealthPanel";

interface Props {
  summary: FinanceSummary;
  tab: FinanceTab;
  /** STRIPE_SECRET_KEY is server-only, so dashboard mode is derived in page.tsx. */
  stripeTestMode: boolean;
}

// Client orchestrator for the finance dashboard. The header, range filter, and
// incomplete-data banner sit ABOVE the tab bar and the caveats below it, so all
// four stay visible whichever tab is open — only the revenue panels switch.
export default function FinanceDashboard({ summary, tab, stripeTestMode }: Props) {
  // A tab is a server navigation to the same route, so every click re-reads the
  // whole summary. Hold the clicked tab until the navigation lands so the wait
  // is visible rather than silent. A route-level loading.tsx would blank the
  // header, filter, and banner that have to stay on screen.
  const [pendingTab, setPendingTab] = useState<FinanceTab | null>(null);
  useEffect(() => setPendingTab(null), [tab]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl font-bold text-marine">Finance</h1>
        <a
          href={`/admin/finance/export?from=${summary.range.from}&to=${summary.range.to}`}
          className="rounded-lg border border-marine/20 px-4 py-2 text-sm font-body text-marine/70 hover:bg-marine/5"
        >
          Export all transactions (CSV)
        </a>
      </div>

      <DateRangeFilter from={summary.range.from} to={summary.range.to} />

      {!summary.complete && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 font-body">
          Some financial records could not be loaded, so the figures below may be
          incomplete. Refresh to try again.
        </div>
      )}

      <FinanceHeader totals={summary.totals} />

      <FinanceTabs
        active={tab}
        from={summary.range.from}
        to={summary.range.to}
        pending={pendingTab}
        onSelect={setPendingTab}
      />

      <div
        aria-busy={pendingTab !== null}
        className={`space-y-8 transition-opacity ${pendingTab !== null ? "opacity-50" : ""}`}
      >
        {tab === "membership" && (
          <>
            <MembershipRevenuePanel
              membership={summary.membership}
              transactions={summary.membershipTransactions}
            />
            <MemberHealthPanel health={summary.memberHealth} />
          </>
        )}
        {tab === "events" && (
          <>
            <EventRevenuePanel events={summary.events} />
            <EventMonthlyPanel events={summary.events} />
            <EventTicketTypePanel events={summary.events} />
          </>
        )}
        {tab === "originator" && (
          <OriginatorBreakdownPanel
            originators={summary.originators}
            transactions={summary.originatorTransactions}
            stripeTestMode={stripeTestMode}
          />
        )}
      </div>

      <p className="text-xs text-marine/40 font-body">
        Figures are gross of Stripe fees. Membership and event revenue are both net of
        refunds. A cancellation still awaiting a refund decision is counted as revenue —
        the club is holding the money — and flagged separately in Event sales.
        Complimentary and free records are counted but excluded from revenue.
        Date ranges are selected in whole UTC days while months are bucketed in
        Geneva time, so the first and last month of a range can be partial.
      </p>
    </div>
  );
}
