import type { OriginatorRevenue } from "@/lib/admin/finance";
import { formatCurrency } from "@/lib/format";
import { Table } from "./MembershipRevenuePanel";

interface Props {
  originators: OriginatorRevenue[];
}

export default function OriginatorBreakdownPanel({ originators }: Props) {
  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-4">
      <h2 className="font-heading text-xl font-bold text-marine">
        Originator breakdown
      </h2>
      <p className="text-xs text-marine/40 font-body">
        Membership revenue attributed to each member&rsquo;s originator. Attribution
        only — commission rates and payouts are not modelled.
      </p>
      <Table
        head={["Originator", "Converted referrals", "Net revenue"]}
        rows={originators.map((o) => [
          o.name,
          String(o.convertedReferrals),
          formatCurrency(o.net),
        ])}
        empty="No attributed revenue in this period."
      />
    </section>
  );
}
