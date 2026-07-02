"use client";

import type { FinanceSummary } from "@/lib/admin/finance";
import FinanceHeader from "./FinanceHeader";
import DateRangeFilter from "./DateRangeFilter";
import MembershipRevenuePanel from "./MembershipRevenuePanel";
import EventRevenuePanel from "./EventRevenuePanel";

interface Props {
  summary: FinanceSummary;
}

// Client orchestrator for the finance dashboard. Panels are composed here as
// they are built (KPI header + filter now; revenue and originator/health next).
export default function FinanceDashboard({ summary }: Props) {
  return (
    <div className="space-y-8">
      <h1 className="font-heading text-3xl font-bold text-marine">Finance</h1>

      <DateRangeFilter from={summary.range.from} to={summary.range.to} />

      {!summary.complete && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 font-body">
          Some financial records could not be loaded, so the figures below may be
          incomplete. Refresh to try again.
        </div>
      )}

      <FinanceHeader totals={summary.totals} />

      <MembershipRevenuePanel membership={summary.membership} />
      <EventRevenuePanel events={summary.events} />

      <p className="text-xs text-marine/40 font-body">
        Figures are gross of Stripe fees. Event revenue is gross of refunds.
        Complimentary and free records are counted but excluded from revenue.
      </p>
    </div>
  );
}
