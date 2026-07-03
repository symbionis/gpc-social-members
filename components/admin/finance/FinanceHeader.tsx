import type { FinanceSummary } from "@/lib/admin/finance";
import { formatCurrency } from "@/lib/format";

interface Props {
  totals: FinanceSummary["totals"];
}

// Headline KPI cards. Presentational — the numbers are computed server-side in
// the finance data layer and passed down through FinanceDashboard.
export default function FinanceHeader({ totals }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Kpi label="Total revenue" value={formatCurrency(totals.totalRevenue)} accent />
      <Kpi label="Membership (net)" value={formatCurrency(totals.membershipNet)} />
      <Kpi label="Event sales" value={formatCurrency(totals.eventGross)} />
      <Kpi label="Active members" value={String(totals.activeMembers)} />
      <Kpi label="New sign-ups" value={String(totals.newMembers)} />
    </div>
  );
}

function Kpi({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl bg-marine text-white p-5"
          : "rounded-xl bg-white border border-marine/10 p-5"
      }
    >
      <div
        className={
          accent
            ? "text-xs uppercase tracking-wide text-white/60 font-body"
            : "text-xs uppercase tracking-wide text-marine/50 font-body"
        }
      >
        {label}
      </div>
      <div
        className={
          accent
            ? "mt-1 font-heading text-2xl font-bold"
            : "mt-1 font-heading text-2xl font-bold text-marine"
        }
      >
        {value}
      </div>
    </div>
  );
}
