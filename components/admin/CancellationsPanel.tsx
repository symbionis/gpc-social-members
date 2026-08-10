"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { stripeDashboardUrl } from "@/lib/stripe/dashboard";
import type { RefundTicketResponse } from "@/app/api/admin/events/[id]/tickets/[ticketId]/refund/route";

/**
 * One cancelled seat, awaiting a refund decision or already settled.
 *
 * Lives in its own tab rather than on the roster: the roster is a door document, read to find
 * who is arriving, and cancellations are back-office money work. Mixing them meant the refund
 * button sat on a list nobody opens for that purpose, and the roster carried columns that only
 * mattered to a handful of rows.
 */
export interface CancellationRow {
  ticketId: string;
  /** Ticket holder. "" when the seat was never named. */
  name: string;
  email: string;
  ticketTypeTitle: string;
  /** Booking this seat belongs to — who actually paid, and gets the money back. */
  referenceCode: string | null;
  payerName: string;
  payerEmail: string;
  requestedAt: string | null;
  status: "requested" | "refunded";
  /** What refunding this seat would send, from the price snapshotted at checkout. */
  refundValueChf: number;
  /** What was actually refunded. Only meaningful once settled. */
  refundedChf: number | null;
  refundedAt: string | null;
  stripeRefundId: string | null;
  /**
   * Every charge on the booking — the original checkout plus one per top-up and priced
   * conversion. Shown so the admin can see WHERE the money comes back from before clicking,
   * and so a booking paid across several cards is visibly that.
   */
  paymentIntentIds: string[];
}

interface Props {
  rows: CancellationRow[];
  eventId: string;
  stripeTestMode: boolean;
}

export default function CancellationsPanel({ rows, eventId, stripeTestMode }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pending = rows.filter((r) => r.status === "requested");
  const settled = rows.filter((r) => r.status === "refunded");

  // What the club still owes. The figure finance reports as `pendingRefunds` — money counted
  // as revenue only because nobody has sent it back yet.
  const owed = pending.reduce((t, r) => t + r.refundValueChf, 0);
  const returned = settled.reduce((t, r) => t + (r.refundedChf ?? 0), 0);

  async function refund(row: CancellationRow) {
    const prompt =
      row.refundValueChf > 0
        ? `Refund ${formatCurrency(row.refundValueChf, { decimals: 2 })} to ${row.payerName || row.payerEmail || "the payer"}? This sends the money back through Stripe now.`
        : `Close ${row.name || "this"} cancellation? Nothing was paid for that seat, so no money moves.`;
    if (!window.confirm(prompt)) return;

    setError(null);
    setNotice(null);
    setBusy((prev) => new Set(prev).add(row.ticketId));
    try {
      const res = await fetch(`/api/admin/events/${eventId}/tickets/${row.ticketId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data: Partial<RefundTicketResponse> & { error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not refund this seat.");
        return;
      }
      // Always the server's figure — a stale tab must not be told the wrong amount moved.
      const moved = formatCurrency(data.refundedChf ?? row.refundValueChf, { decimals: 2 });
      setNotice(
        data.nothingToRefund
          ? `Closed ${row.name || "the seat"} — nothing was paid for it.`
          : data.reconciled
            ? `${row.name || "This seat"} was already refunded in Stripe (${moved}) — the record now matches.`
            : data.alreadyRefunded
              ? `${row.name || "This seat"} was already settled.`
              : `Refunded ${moved} to ${row.payerName || "the payer"}.`
      );
      router.refresh();
    } catch {
      setError("Could not refund this seat.");
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(row.ticketId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-marine">Cancellations & refunds</h2>
          <p className="mt-1 text-sm font-body text-muted-foreground">
            Seats the holder cancelled. Refunding here sends the money back through Stripe and
            records it, so event revenue reflects what the club actually kept.
          </p>
        </div>
        <div className="flex gap-6 shrink-0">
          <Stat
            label="Awaiting refund"
            value={formatCurrency(owed, { decimals: 2 })}
            sub={seatCount(pending.length)}
            amber={owed > 0}
          />
          <Stat
            label="Refunded"
            value={formatCurrency(returned, { decimals: 2 })}
            sub={seatCount(settled.length)}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-body text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-body text-emerald-800">
          {notice}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-marine/10 bg-white px-4 py-8 text-center text-sm font-body text-muted-foreground">
          No cancellations for this event.
        </p>
      ) : (
        <>
          <Section
            title="Awaiting refund"
            empty="Nothing waiting — every cancellation has been settled."
            groups={groupByBooking(pending, "pending")}
            total={owed}
            seats={pending.length}
            stripeTestMode={stripeTestMode}
            renderAction={(row) => (
              <button
                type="button"
                onClick={() => refund(row)}
                disabled={busy.has(row.ticketId)}
                title={
                  row.refundValueChf > 0
                    ? "Send this seat's payment back through Stripe now"
                    : "Nothing was paid for this seat — close the cancellation"
                }
                className="px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-body font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {busy.has(row.ticketId)
                  ? "…"
                  : row.refundValueChf > 0
                    ? `Refund ${formatCurrency(row.refundValueChf, { decimals: 2 })}`
                    : "Close"}
              </button>
            )}
          />

          <Section
            title="Refunded"
            empty="No refunds issued yet."
            groups={groupByBooking(settled, "settled")}
            total={returned}
            seats={settled.length}
            stripeTestMode={stripeTestMode}
          />
        </>
      )}
    </div>
  );
}

function seatCount(n: number): string {
  return `${n} seat${n === 1 ? "" : "s"}`;
}

/**
 * A booking's refunded (or awaiting) seats, collapsed into one card.
 *
 * The money moves per BOOKING, not per seat: one Stripe refund covered three of Charlotte's
 * seats, and listing them separately repeated her name, her reference and that single refund id
 * three times — reading as three refunds when there was one. Grouping states the payer, the
 * reference and the Stripe objects once, subtotals what actually left the account, and leaves
 * the seat lines to say only what differs between them.
 */
interface BookingGroup {
  key: string;
  referenceCode: string | null;
  payerName: string;
  payerEmail: string;
  paymentIntentIds: string[];
  refundIds: string[];
  /** Latest settlement time in the group; null while any seat is still awaiting. */
  settledAt: string | null;
  subtotal: number;
  rows: CancellationRow[];
}

export function groupByBooking(
  rows: CancellationRow[],
  mode: "pending" | "settled",
): BookingGroup[] {
  const byKey = new Map<string, BookingGroup>();

  for (const row of rows) {
    // Reference first; a booking without one groups by payer, and a seat with neither stands
    // alone rather than collapsing into a shared empty-string bucket with unrelated seats.
    const key = row.referenceCode || (row.payerEmail && `payer:${row.payerEmail}`) || row.ticketId;
    const group = byKey.get(key) ?? {
      key,
      referenceCode: row.referenceCode,
      payerName: row.payerName,
      payerEmail: row.payerEmail,
      paymentIntentIds: [],
      refundIds: [],
      settledAt: null,
      subtotal: 0,
      rows: [],
    };

    group.rows.push(row);
    group.subtotal += mode === "settled" ? row.refundedChf ?? 0 : row.refundValueChf;
    for (const pi of row.paymentIntentIds) {
      if (!group.paymentIntentIds.includes(pi)) group.paymentIntentIds.push(pi);
    }
    // One refund can cover several seats, so the ids are deduped — three seats sharing a
    // refund should show that refund once, not three times.
    for (const id of (row.stripeRefundId ?? "").split(",").filter(Boolean)) {
      if (!group.refundIds.includes(id)) group.refundIds.push(id);
    }
    if (row.refundedAt && (!group.settledAt || row.refundedAt > group.settledAt)) {
      group.settledAt = row.refundedAt;
    }

    byKey.set(key, group);
  }

  // Largest first: the biggest refund is the one worth looking at.
  return [...byKey.values()].sort((a, b) => b.subtotal - a.subtotal || a.key.localeCompare(b.key));
}

function Stat({
  label,
  value,
  sub,
  amber = false,
}: {
  label: string;
  value: string;
  sub?: string;
  amber?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-marine/50 font-body">{label}</div>
      <div
        className={`mt-1 font-heading text-lg font-bold ${amber ? "text-amber-700" : "text-marine"}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs font-body text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  empty,
  groups,
  total,
  seats,
  renderAction,
  stripeTestMode,
}: {
  title: string;
  empty: string;
  groups: BookingGroup[];
  total: number;
  seats: number;
  renderAction?: (row: CancellationRow) => React.ReactNode;
  stripeTestMode: boolean;
}) {
  return (
    <section>
      <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
        {title}{" "}
        <span className="text-marine/40">
          ({seats === 0 ? "0" : `${seatCount(seats)} · ${formatCurrency(total, { decimals: 2 })}`})
        </span>
      </h3>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-marine/10 bg-white px-4 py-4 text-sm font-body text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li
              key={group.key}
              data-testid="cancellation-booking"
              className="rounded-xl border border-marine/10 bg-white overflow-hidden"
            >
              {/* Stated once per booking: who gets the money, against which charges. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-marine/10 bg-cream/40 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="font-body text-marine">
                    {group.payerName || group.payerEmail || "Unknown payer"}
                  </span>
                  {group.referenceCode && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {group.referenceCode}
                    </span>
                  )}
                  {group.payerEmail && group.payerName && (
                    <span className="block text-xs font-body text-muted-foreground truncate">
                      {group.payerEmail}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="font-heading font-bold text-marine">
                    {formatCurrency(group.subtotal, { decimals: 2 })}
                  </span>
                  <span className="block text-xs font-body text-muted-foreground">
                    {seatCount(group.rows.length)}
                    {group.settledAt && ` · ${formatDateTime(group.settledAt)}`}
                  </span>
                </div>
              </div>

              <ul className="divide-y divide-marine/5">
                {group.rows.map((row) => (
                  <li
                    key={row.ticketId}
                    data-testid="cancellation-row"
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
                  >
                    <div className="min-w-0">
                      <span className="font-body text-sm text-marine">
                        {row.name || (
                          <span className="italic text-muted-foreground">Unnamed seat</span>
                        )}
                      </span>
                      {row.ticketTypeTitle && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.ticketTypeTitle}
                        </span>
                      )}
                      {row.requestedAt && !group.settledAt && (
                        <span className="block text-xs font-body text-muted-foreground">
                          Cancelled {formatDateTime(row.requestedAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-body tabular-nums text-marine/70">
                        {row.refundedChf !== null
                          ? formatCurrency(row.refundedChf, { decimals: 2 })
                          : renderAction
                            ? formatCurrency(row.refundValueChf, { decimals: 2 })
                            : "amount not recorded"}
                      </span>
                      {renderAction?.(row)}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Where the money came from, and the Stripe objects proving it went back. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-marine/5 px-4 py-2 text-xs font-body text-muted-foreground">
                {group.paymentIntentIds.length === 0 ? (
                  <span className="text-amber-700">No Stripe payment on record</span>
                ) : (
                  group.paymentIntentIds.map((pi, i) => (
                    <a
                      key={pi}
                      href={stripeDashboardUrl({ kind: "payment_intent", id: pi }, stripeTestMode) ?? ""}
                      target="_blank"
                      rel="noopener noreferrer"
                      // ph-no-capture: the href carries a Stripe PaymentIntent id.
                      className="ph-no-capture underline hover:text-marine"
                    >
                      {i === 0 ? "Payment" : `Top-up ${i}`} ↗
                    </a>
                  ))
                )}
                {group.refundIds.map((id) => (
                  <span key={id} className="font-mono text-marine/40">
                    {id}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
