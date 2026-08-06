"use client";

import Link from "next/link";
import { FINANCE_TABS, type FinanceTab } from "./tabs";

interface Props {
  active: FinanceTab;
  from: string; // YYYY-MM-DD — carried forward so switching tabs keeps the range
  to: string;
  /** The tab whose navigation is in flight, if any. */
  pending: FinanceTab | null;
  onSelect: (tab: FinanceTab) => void;
}

export default function FinanceTabs({ active, from, to, pending, onSelect }: Props) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-border">
      {FINANCE_TABS.map((tab) => {
        const isActive = tab.id === active;
        const isPending = tab.id === pending;
        return (
          <Link
            key={tab.id}
            href={`/admin/finance?from=${from}&to=${to}&tab=${tab.id}`}
            aria-current={isActive ? "page" : undefined}
            data-pending={isPending ? "true" : undefined}
            onClick={() => {
              if (!isActive) onSelect(tab.id);
            }}
            className={`px-4 py-2 -mb-px border-b-2 text-sm font-body font-medium transition-colors ${
              isActive
                ? "border-marine text-marine"
                : "border-transparent text-muted-foreground hover:text-marine"
            }`}
          >
            <span className={isPending ? "animate-pulse" : undefined}>{tab.label}</span>
            {isPending && <span className="sr-only"> (loading)</span>}
          </Link>
        );
      })}
    </div>
  );
}
