"use client";

import { useState } from "react";
import type { EventSummary } from "@/lib/admin/finance";
import { formatCurrency, formatMonth } from "@/lib/format";

interface Props {
  events: EventSummary;
}

// Event ticket revenue per Geneva calendar month, each month expanding to the
// events that took money in it. Mirrors the disclosure shape of the originator
// panel, one level shallower — there is no per-registration ledger to drill into.
export default function EventMonthlyPanel({ events }: Props) {
  const { byMonth } = events;

  // Months are tracked as COLLAPSED rather than open, so "no state" means
  // "everything open" and a month that first appears after a date-range change
  // is not silently closed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const anythingOpen = collapsed.size < byMonth.length;

  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-heading text-xl font-bold text-marine">
          Event sales by month
        </h2>
        {byMonth.length > 0 && (
          <button
            onClick={() =>
              setCollapsed(
                anythingOpen ? new Set(byMonth.map((m) => m.monthKey)) : new Set(),
              )
            }
            className="shrink-0 rounded-lg border border-marine/20 px-3 py-1.5 text-xs font-body text-marine/70 hover:bg-marine/5"
          >
            {anythingOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      <p className="text-xs text-marine/40 font-body">
        Money received, gross of refunds. Only completed checkouts count — a
        started-but-abandoned checkout never reaches this table. Months bucket by
        payment date in Geneva time.
      </p>

      {byMonth.length === 0 ? (
        <p className="text-sm text-marine/40 font-body">
          No event sales in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[34rem] text-sm font-body">
            {byMonth.map((m) => {
              const open = !collapsed.has(m.monthKey);
              return (
                <div key={m.monthKey} className="border-b border-marine/5">
                  <button
                    onClick={() =>
                      setCollapsed((s) => {
                        const next = new Set(s);
                        if (next.has(m.monthKey)) next.delete(m.monthKey);
                        else next.add(m.monthKey);
                        return next;
                      })
                    }
                    aria-expanded={open}
                    className="w-full flex items-center gap-4 py-2 px-2 text-left text-marine cursor-pointer hover:bg-marine/5"
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block w-3 shrink-0 text-marine/40 transition-transform ${
                        open ? "rotate-90" : ""
                      }`}
                    >
                      ▸
                    </span>
                    <span className="flex-1 truncate">{formatMonth(m.monthKey)}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums text-marine/60">
                      {m.paidRegistrations} paid
                    </span>
                    <span className="w-28 shrink-0 text-right tabular-nums">
                      {formatCurrency(m.gross)}
                    </span>
                  </button>

                  {open && (
                    <table className="w-full text-sm font-body">
                      <thead>
                        <tr className="text-left text-marine/50 border-b border-marine/10">
                          <th className="py-2 pl-10 font-medium">Event</th>
                          <th className="py-2 font-medium text-right">Paid</th>
                          <th className="py-2 pr-2 font-medium text-right">Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.byEvent.map((e) => (
                          <tr key={e.eventId} className="border-b border-marine/5">
                            <td className="py-2 pl-10 text-marine">{e.title}</td>
                            <td className="py-2 text-right text-marine/70 tabular-nums">
                              {e.paidRegistrations}
                            </td>
                            <td className="py-2 pr-2 text-right text-marine tabular-nums">
                              {formatCurrency(e.gross)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
