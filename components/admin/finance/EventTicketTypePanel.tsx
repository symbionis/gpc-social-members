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
        Scoped to the same completed checkouts and the same ticket line ledger as
        the other event panels. A refund is attributed to the type its seat was
        sold as, so these rows sum to the same net as the panels above.
      </p>
      <Table
        head={["Ticket type", "Qty", "Gross", "Refunded", "Net"]}
        rows={events.byTicketType.map((t) => [
          t.title,
          String(t.quantity),
          formatCurrency(t.gross),
          t.refunds > 0 ? `−${formatCurrency(t.refunds)}` : "—",
          formatCurrency(t.net),
        ])}
        empty="No event sales in this period."
      />
    </section>
  );
}
