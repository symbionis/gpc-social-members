"use client";

import type { FinanceSummary } from "@/lib/admin/finance";
import FinanceHeader from "./FinanceHeader";
import DateRangeFilter from "./DateRangeFilter";
import MembershipRevenuePanel from "./MembershipRevenuePanel";
import EventRevenuePanel from "./EventRevenuePanel";
import OriginatorBreakdownPanel from "./OriginatorBreakdownPanel";
import MemberHealthPanel from "./MemberHealthPanel";

interface Props {
  summary: FinanceSummary;
}

// Client orchestrator for the finance dashboard. Panels are composed here as
// they are built (KPI header + filter now; revenue and originator/health next).
export default function FinanceDashboard({ summary }: Props) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl font-bold text-marine">Finance</h1>
        <a
          href={`/admin/finance/export?from=${summary.range.from}&to=${summary.range.to}`}
          className="rounded-lg border border-marine/20 px-4 py-2 text-sm font-body text-marine/70 hover:bg-marine/5"
        >
          Export CSV
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

      <MembershipRevenuePanel
        membership={summary.membership}
        transactions={summary.membershipTransactions}
      />
      <EventRevenuePanel events={summary.events} />

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <OriginatorBreakdownPanel originators={summary.originators} />
        <MemberHealthPanel health={summary.memberHealth} />
      </div>

      <p className="text-xs text-marine/40 font-body">
        Figures are gross of Stripe fees. Event revenue is gross of refunds.
        Complimentary and free records are counted but excluded from revenue.
      </p>
    </div>
  );
}
