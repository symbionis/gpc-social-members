import type { EventSummary } from "@/lib/admin/finance";
import { formatCurrency } from "@/lib/format";
import { Table } from "./MembershipRevenuePanel";

interface Props {
  events: EventSummary;
}

// Headline event totals plus the per-event breakdown for the whole range. The
// month and ticket-type views are their own panels.
export default function EventRevenuePanel({ events }: Props) {
  const { gross, refunds, net, pendingRefunds, paidRegistrations, freeRegistrations, byEvent } =
    events;

  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-xl font-bold text-marine">Event sales</h2>
        <span className="text-xs text-marine/40 font-body">money kept, after refunds</span>
      </div>

      {/* Net leads: it is the money the club actually kept, and the figure to report. Gross and
          refunds sit beside it so the arithmetic is visible rather than asserted. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Net" value={formatCurrency(net)} strong />
        <Stat label="Gross" value={formatCurrency(gross)} />
        <Stat label="Refunded" value={refunds > 0 ? `−${formatCurrency(refunds)}` : "—"} />
        <Stat label="Paid registrations" value={String(paidRegistrations)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Free / comp" value={String(freeRegistrations)} />
      </div>

      {/* An open liability, not revenue: the club is holding this money while the cancellation
          is undecided. Shown only when there is a backlog, so a clean period stays clean. */}
      {pendingRefunds > 0 && (
        <p className="text-xs font-body text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {formatCurrency(pendingRefunds)} of cancellations are still waiting to be refunded.
          That money is counted in Net above until it goes back — process them on the
          event&rsquo;s Attendees tab.
        </p>
      )}

      <div>
        <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
          By event
        </h3>
        <Table
          head={["Event", "Paid", "Gross", "Refunded", "Net"]}
          rows={byEvent.map((e) => [
            e.title,
            String(e.paidRegistrations),
            formatCurrency(e.gross),
            e.refunds > 0 ? `−${formatCurrency(e.refunds)}` : "—",
            formatCurrency(e.net),
          ])}
          empty="No event sales in this period."
        />
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
