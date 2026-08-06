"use client";

import { useState } from "react";
import type { OriginatorRevenue, OriginatorTxn } from "@/lib/admin/finance";
import { formatCurrency, formatDate, formatMonth } from "@/lib/format";
import { stripeDashboardUrl, stripeRefLabel } from "@/lib/stripe/dashboard";

interface Props {
  originators: OriginatorRevenue[];
  transactions: OriginatorTxn[];
  stripeTestMode: boolean;
}

// Two-level accordion: originator → Geneva calendar month → the individual
// membership payments behind that month. Inline rather than the modal drill-down
// the Membership panel uses, because comparing several originators on screen at
// once is the point of this view and a modal cannot do that.
//
// The markup is hand-rolled instead of reusing the shared `Table` from
// MembershipRevenuePanel: that primitive takes `string[][]`, so it cannot carry
// a Stripe anchor or nested disclosure rows.
export default function OriginatorBreakdownPanel({
  originators,
  transactions,
  stripeTestMode,
}: Props) {
  // Two independent sets: collapsing an originator preserves which of its months
  // were open, so re-expanding returns you where you were.
  const [openOriginators, setOpenOriginators] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());

  const anythingOpen = openOriginators.size > 0 || openMonths.size > 0;

  const collapseAll = () => {
    setOpenOriginators(new Set());
    setOpenMonths(new Set());
  };

  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-heading text-xl font-bold text-marine">
          Originator breakdown
        </h2>
        {anythingOpen && (
          <button
            onClick={collapseAll}
            className="shrink-0 rounded-lg border border-marine/20 px-3 py-1.5 text-xs font-body text-marine/70 hover:bg-marine/5"
          >
            Collapse all
          </button>
        )}
      </div>

      <p data-testid="originator-caveats" className="text-xs text-marine/40 font-body">
        Membership revenue is credited to each member&rsquo;s <strong>sign-up</strong>{" "}
        originator, so this is not renewal performance — a renewal is credited to
        whoever signed the member up. Reassigning a member&rsquo;s originator moves
        their whole payment history with them. Attribution only — commission rates
        and payouts are not modelled.
      </p>

      {originators.length === 0 ? (
        <p className="text-sm text-marine/40 font-body">
          No attributed revenue in this period.
        </p>
      ) : (
        // Six columns indented two disclosure levels wrap mid-word on a narrow
        // window without a scroll container and a width floor.
        <div className="overflow-x-auto">
          <div className="min-w-[44rem] text-sm font-body">
            {originators.map((o) => {
              const open = openOriginators.has(o.originatorId);
              return (
                <div key={o.originatorId} className="border-b border-marine/5">
                  <DisclosureRow
                    open={open}
                    onToggle={() => setOpenOriginators((s) => toggled(s, o.originatorId))}
                    label={o.name}
                    middle={`${o.convertedReferrals} referrals`}
                    amount={formatCurrency(o.net)}
                  />

                  {open &&
                    (o.byMonth.length === 0 ? (
                      // A converted referral in range whose first payment clears
                      // outside it lands here — stated, never blank space.
                      <p className="pl-10 pr-2 py-2 text-marine/40">
                        No attributed payments in this range.
                      </p>
                    ) : (
                      o.byMonth.map((m) => {
                        const key = `${o.originatorId}:${m.monthKey}`;
                        const monthOpen = openMonths.has(key);
                        return (
                          <div key={key}>
                            <DisclosureRow
                              open={monthOpen}
                              onToggle={() => setOpenMonths((s) => toggled(s, key))}
                              label={formatMonth(m.monthKey)}
                              middle={`${m.paidCount} paid`}
                              amount={formatCurrency(m.net)}
                              indent
                            />
                            {monthOpen && (
                              <PaymentRows
                                rows={transactions.filter(
                                  (t) =>
                                    t.originatorId === o.originatorId &&
                                    t.monthKey === m.monthKey,
                                )}
                                stripeTestMode={stripeTestMode}
                              />
                            )}
                          </div>
                        );
                      })
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// The whole row is the control — same hit area and hover treatment as the
// clickable rows in the shared `Table`, so the two panels feel alike. A native
// <button> gives Enter and Space for free.
function DisclosureRow({
  open,
  onToggle,
  label,
  middle,
  amount,
  indent = false,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  middle: string;
  amount: string;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full flex items-center gap-4 py-2 pr-2 text-left cursor-pointer hover:bg-marine/5 ${
        indent ? "pl-8 text-marine/80" : "pl-2 text-marine"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block w-3 shrink-0 text-marine/40 transition-transform ${
          open ? "rotate-90" : ""
        }`}
      >
        ▸
      </span>
      <span className="flex-1 truncate">{label}</span>
      <span className="w-28 shrink-0 text-right tabular-nums text-marine/60">{middle}</span>
      <span className="w-28 shrink-0 text-right tabular-nums">{amount}</span>
    </button>
  );
}

function PaymentRows({
  rows,
  stripeTestMode,
}: {
  rows: OriginatorTxn[];
  stripeTestMode: boolean;
}) {
  if (rows.length === 0) {
    return <p className="pl-16 pr-2 py-2 text-marine/40">No payments in this month.</p>;
  }
  return (
    <table className="w-full text-sm font-body">
      <thead>
        <tr className="text-left text-marine/50 border-b border-marine/10">
          <th className="py-2 pl-16 font-medium">Member</th>
          <th className="py-2 font-medium text-right">Tier</th>
          <th className="py-2 font-medium text-right">Date</th>
          <th className="py-2 font-medium text-right">Status</th>
          <th className="py-2 font-medium text-right">Amount</th>
          <th className="py-2 pr-2 font-medium text-right">Stripe</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-b border-marine/5">
            <td className="py-2 pl-16 text-marine">{t.memberName}</td>
            <td className="py-2 text-right text-marine/70">{t.tierName}</td>
            <td className="py-2 text-right text-marine/70">{formatDate(t.date)}</td>
            <td className="py-2 text-right text-marine/70">{t.status}</td>
            <td className="py-2 text-right text-marine tabular-nums">
              {formatCurrency(t.amountChf)}
            </td>
            <td className="py-2 pr-2 text-right">
              <StripeCell txn={t} stripeTestMode={stripeTestMode} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Never an empty cell: a missing reference is stated in words. It is not stated
// WHY — comps and honorary records carry a `free` status and never reach this
// view, so the rows that surface a null are legacy, imported, or hand-edited,
// and their origin is not knowable from the row.
function StripeCell({
  txn,
  stripeTestMode,
}: {
  txn: OriginatorTxn;
  stripeTestMode: boolean;
}) {
  const url = stripeDashboardUrl(txn.stripeRef, stripeTestMode);
  if (!url || !txn.stripeRef) {
    return <span className="text-marine/40">No Stripe reference on record</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // Keeps the Stripe identifier out of analytics payloads on click.
      className="ph-no-capture text-marine underline decoration-marine/30 hover:decoration-marine"
      aria-label={`Open the Stripe ${stripeRefLabel(txn.stripeRef)} for ${txn.memberName} on ${formatDate(txn.date)}`}
    >
      Stripe <span aria-hidden="true">↗</span>
    </a>
  );
}
