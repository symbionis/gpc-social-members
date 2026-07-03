"use client";

import { useEffect } from "react";
import type { MembershipTxn } from "@/lib/admin/finance";
import { formatDate, formatCurrency } from "@/lib/format";

interface Props {
  title: string;
  rows: MembershipTxn[];
  onClose: () => void;
}

// Drill-down modal for a tier or month row: lists the underlying membership
// payments and a net total that reconciles with the clicked row. Overlay/panel
// styling mirrors the existing modal convention (WaiverConsentModal).
export default function FinanceDetailModal({ title, rows, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = rows.reduce((s, r) => s + r.amountChf, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-marine/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-marine/10 px-6 py-4">
          <h3 className="font-heading text-lg font-bold text-marine">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-marine/40 hover:text-marine text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {rows.length === 0 ? (
            <p className="text-sm text-marine/40 font-body">No payments in this group.</p>
          ) : (
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="text-left text-marine/50 border-b border-marine/10">
                  <th className="py-2 font-medium">Member</th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-marine/5">
                    <td className="py-2 text-marine">{r.memberName}</td>
                    <td className="py-2 text-marine/70">{formatDate(r.date)}</td>
                    <td
                      className={
                        r.status === "refunded"
                          ? "py-2 text-amber-700"
                          : "py-2 text-marine/70"
                      }
                    >
                      {r.status}
                    </td>
                    <td className="py-2 text-right text-marine tabular-nums">
                      {formatCurrency(r.amountChf)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-marine/10 px-6 py-4">
          <span className="text-sm font-body text-marine/60">
            {rows.length} payment{rows.length === 1 ? "" : "s"}
          </span>
          <span className="font-heading text-lg font-bold text-marine">
            Net {formatCurrency(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
