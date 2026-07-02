"use client";

import type { FinanceSummary } from "@/lib/admin/finance";
import { formatCurrency } from "@/lib/format";

interface Props {
  summary: FinanceSummary;
}

// Client orchestrator for the finance dashboard. Panels are composed here as
// they are built (KPI header + filter, revenue panels, originator/health).
export default function FinanceDashboard({ summary }: Props) {
  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-heading text-3xl font-bold text-marine">Finance</h1>
        <span className="text-sm text-marine/50 font-body">
          {summary.range.from} → {summary.range.to}
        </span>
      </div>

      {!summary.complete && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 font-body">
          Some financial records could not be loaded, so the figures below may be
          incomplete. Refresh to try again.
        </div>
      )}

      {/* Provisional KPI readout — replaced by FinanceHeader in U4. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total revenue" value={formatCurrency(summary.totals.totalRevenue)} />
        <Kpi label="Membership (net)" value={formatCurrency(summary.totals.membershipNet)} />
        <Kpi label="Event sales" value={formatCurrency(summary.totals.eventGross)} />
        <Kpi label="Active members" value={String(summary.totals.activeMembers)} />
      </div>

      <p className="text-xs text-marine/40 font-body">
        Figures are gross of Stripe fees. Event revenue is gross of refunds.
        Complimentary and free records are counted but excluded from revenue.
      </p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-marine/10 p-5">
      <div className="text-xs uppercase tracking-wide text-marine/50 font-body">
        {label}
      </div>
      <div className="mt-1 font-heading text-2xl font-bold text-marine">{value}</div>
    </div>
  );
}
