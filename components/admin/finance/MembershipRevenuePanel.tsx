"use client";

import { useState } from "react";
import type { MembershipSummary, MembershipTxn } from "@/lib/admin/finance";
import { formatCurrency, formatMonth } from "@/lib/format";
import FinanceDetailModal from "./FinanceDetailModal";

interface Props {
  membership: MembershipSummary;
  transactions: MembershipTxn[];
}

type Drill =
  | { kind: "tier"; key: string; label: string }
  | { kind: "month"; key: string; label: string };

export default function MembershipRevenuePanel({
  membership,
  transactions,
}: Props) {
  const {
    gross,
    refunds,
    net,
    newRevenue,
    renewalRevenue,
    newCount,
    renewalCount,
    arpu,
    byTier,
    byMonth,
  } = membership;

  const [drill, setDrill] = useState<Drill | null>(null);

  const drillRows =
    drill == null
      ? []
      : transactions.filter((t) =>
          drill.kind === "tier" ? t.tierId === drill.key : t.monthKey === drill.key,
        );

  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-6">
      <h2 className="font-heading text-xl font-bold text-marine">
        Membership revenue
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Gross" value={formatCurrency(gross)} />
        <Stat label="Refunds" value={`− ${formatCurrency(refunds)}`} />
        <Stat label="Net" value={formatCurrency(net)} strong />
        <Stat label="ARPU (net / active)" value={formatCurrency(arpu)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat
          label={`New members (${newCount})`}
          value={formatCurrency(newRevenue)}
        />
        <Stat
          label={`Renewals (${renewalCount})`}
          value={formatCurrency(renewalRevenue)}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
            By tier
          </h3>
          <Table
            head={["Tier", "Paid", "Net"]}
            rows={byTier.map((t) => [
              t.tierName,
              String(t.paidCount),
              formatCurrency(t.net),
            ])}
            empty="No membership revenue in this period."
            onRowClick={(i) =>
              setDrill({ kind: "tier", key: byTier[i].tierId, label: byTier[i].tierName })
            }
          />
        </div>
        <div>
          <h3 className="text-sm font-body font-semibold text-marine/70 mb-2">
            By month
          </h3>
          <Table
            head={["Month", "Gross", "Net"]}
            rows={byMonth.map((m) => [
              formatMonth(m.monthKey),
              formatCurrency(m.gross),
              formatCurrency(m.net),
            ])}
            empty="No membership revenue in this period."
            onRowClick={(i) =>
              setDrill({
                kind: "month",
                key: byMonth[i].monthKey,
                label: formatMonth(byMonth[i].monthKey),
              })
            }
          />
        </div>
      </div>

      {drill && (
        <FinanceDetailModal
          title={`${drill.label} — membership payments`}
          rows={drillRows}
          onClose={() => setDrill(null)}
        />
      )}
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

export function Table({
  head,
  rows,
  empty,
  onRowClick,
}: {
  head: string[];
  rows: string[][];
  empty: string;
  // When provided, rows become clickable (used for the tier/month drill-down).
  onRowClick?: (index: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-marine/40 font-body">{empty}</p>;
  }
  const clickable = Boolean(onRowClick);
  return (
    <table className="w-full text-sm font-body">
      <thead>
        <tr className="text-left text-marine/50 border-b border-marine/10">
          {head.map((h, i) => (
            <th
              key={h}
              className={i === 0 ? "py-2 font-medium" : "py-2 font-medium text-right"}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr
            key={ri}
            className={
              clickable
                ? "border-b border-marine/5 cursor-pointer hover:bg-marine/5"
                : "border-b border-marine/5"
            }
            onClick={onRowClick ? () => onRowClick(ri) : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(ri);
                    }
                  }
                : undefined
            }
          >
            {r.map((cell, ci) => (
              <td
                key={ci}
                className={
                  ci === 0
                    ? "py-2 text-marine"
                    : "py-2 text-right text-marine tabular-nums"
                }
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
