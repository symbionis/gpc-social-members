"use client";

import Link from "next/link";

// The finance page's three revenue views. Held in the URL as `?tab=` so a tab
// is bookmarkable, survives a refresh, and stays coupled to the range filter
// and the export link — all of which a client-only tab state would decouple.
export type FinanceTab = "membership" | "events" | "originator";

const TABS: { id: FinanceTab; label: string }[] = [
  { id: "membership", label: "Membership" },
  { id: "events", label: "Events" },
  { id: "originator", label: "Originator" },
];

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

// Normalize a raw `?tab=` search param. Anything unrecognized — a hand-edited
// URL, a repeated param arriving as an array — falls back to Membership rather
// than rendering nothing.
//
// This lives here rather than in page.tsx because that module pulls in the
// Supabase server client and request headers at import time, so a unit test
// cannot reach a normalizer defined there.
export function tabFrom(value: string | string[] | undefined): FinanceTab {
  return typeof value === "string" && TAB_IDS.has(value) ? (value as FinanceTab) : "membership";
}

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
      {TABS.map((tab) => {
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
