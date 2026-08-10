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
          <Stat label="Awaiting refund" value={formatCurrency(owed, { decimals: 2 })} amber={owed > 0} />
          <Stat label="Refunded" value={formatCurrency(returned, { decimals: 2 })} />
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
            rows={pending}
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
                className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-body font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {busy.has(row.ticketId)
                  ? "…"
                  : row.refundValueChf > 0
                    ? `Refund ${formatCurrency(row.refundValueChf, { decimals: 2 })}`
                    : "Close cancellation"}
              </button>
            )}
            stripeTestMode={stripeTestMode}
          />

          <Section
            title="Refunded"
            empty="No refunds issued yet."
            rows={settled}
            renderAction={(row) => (
              <span className="text-xs font-body text-muted-foreground whitespace-nowrap">
                {row.refundedChf !== null
                  ? formatCurrency(row.refundedChf, { decimals: 2 })
                  : "amount not recorded"}
                {row.refundedAt && ` · ${formatDateTime(row.refundedAt)}`}
              </span>
            )}
            stripeTestMode={stripeTestMode}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, amber = false }: { label: string; value: string; amber?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-marine/50 font-body">{label}</div>
      <div
        className={`mt-1 font-heading text-lg font-bold ${amber ? "text-amber-700" : "text-marine"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  rows,
  renderAction,
  stripeTestMode,
}: {
  title: string;
  empty: string;
  rows: CancellationRow[];
  renderAction: (row: CancellationRow) => React.ReactNode;
  stripeTestMode: boolean;
}) {
  return (
    <section>
      <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
        {title} <span className="text-marine/40">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-marine/10 bg-white px-4 py-4 text-sm font-body text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.ticketId}
              data-testid="cancellation-row"
              className="rounded-xl border border-marine/10 bg-white p-4 flex flex-wrap items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="font-body text-marine">
                  {row.name || <span className="italic text-muted-foreground">Unnamed seat</span>}
                  {row.ticketTypeTitle && (
                    <span className="ml-2 text-xs text-muted-foreground">{row.ticketTypeTitle}</span>
                  )}
                </p>
                {row.email && (
                  <p className="text-xs font-body text-muted-foreground truncate">{row.email}</p>
                )}
                {row.requestedAt && (
                  <p className="mt-1 text-xs font-body text-muted-foreground">
                    Cancelled {formatDateTime(row.requestedAt)}
                  </p>
                )}
              </div>

              {/* Where the money goes back to. The payer is the booking, not necessarily the
                  seat's holder — a lead who bought three seats gets all three refunds. */}
              <div className="min-w-0 text-xs font-body text-muted-foreground">
                <p className="text-marine/70">
                  Refund to {row.payerName || row.payerEmail || "the payer"}
                </p>
                {row.payerEmail && row.payerName && <p className="truncate">{row.payerEmail}</p>}
                {row.referenceCode && <p className="font-mono">{row.referenceCode}</p>}
                <div className="mt-1 flex flex-wrap gap-2">
                  {row.paymentIntentIds.length === 0 ? (
                    <span className="text-amber-700">No Stripe payment on record</span>
                  ) : (
                    row.paymentIntentIds.map((pi, i) => (
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
                  {row.stripeRefundId &&
                    row.stripeRefundId.split(",").map((id) => (
                      <span key={id} className="font-mono text-marine/50">
                        {id}
                      </span>
                    ))}
                </div>
              </div>

              <div className="shrink-0">{renderAction(row)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
