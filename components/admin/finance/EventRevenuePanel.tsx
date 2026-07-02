import type { EventSummary } from "@/lib/admin/finance";
import { formatCurrency } from "@/lib/format";
import { Table } from "./MembershipRevenuePanel";

interface Props {
  events: EventSummary;
}

export default function EventRevenuePanel({ events }: Props) {
  const { gross, paidRegistrations, freeRegistrations, byEvent, byTicketType } = events;

  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-xl font-bold text-marine">Event sales</h2>
        <span className="text-xs text-marine/40 font-body">gross of refunds</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Gross" value={formatCurrency(gross)} strong />
        <Stat label="Paid registrations" value={String(paidRegistrations)} />
        <Stat label="Free / comp" value={String(freeRegistrations)} />
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
            By event
          </h3>
          <Table
            head={["Event", "Paid", "Gross"]}
            rows={byEvent.map((e) => [
              e.title,
              String(e.paidRegistrations),
              formatCurrency(e.gross),
            ])}
            empty="No event sales in this period."
          />
        </div>
        <div>
          <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
            By ticket type
          </h3>
          <Table
            head={["Ticket type", "Qty", "Gross"]}
            rows={byTicketType.map((t) => [
              t.title,
              String(t.quantity),
              formatCurrency(t.gross),
            ])}
            empty="No event sales in this period."
          />
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-marine/50 font-body">
        {label}
      </div>
      <div
        className={
          strong
            ? "mt-1 font-heading text-xl font-bold text-marine"
            : "mt-1 font-heading text-lg text-marine"
        }
      >
        {value}
      </div>
    </div>
  );
}
