import type { EventSummary } from "@/lib/admin/finance";
import { formatCurrency } from "@/lib/format";
import { Table } from "./MembershipRevenuePanel";

interface Props {
  events: EventSummary;
}

export default function EventTicketTypePanel({ events }: Props) {
  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-4">
      <h2 className="font-heading text-xl font-bold text-marine">
        Event sales by ticket type
      </h2>
      <p className="text-xs text-marine/40 font-body">
        Scoped to the same completed checkouts as the other event panels, counted
        from the individual ticket lines rather than the booking total.
      </p>
      <Table
        head={["Ticket type", "Qty", "Gross"]}
        rows={events.byTicketType.map((t) => [
          t.title,
          String(t.quantity),
          formatCurrency(t.gross),
        ])}
        empty="No event sales in this period."
      />
    </section>
  );
}
