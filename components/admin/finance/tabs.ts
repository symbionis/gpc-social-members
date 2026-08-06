// Finance tab vocabulary, shared by the server page and the client tab bar.
//
// This module deliberately carries NO "use client" directive. `page.tsx` is a
// server component and CALLS `tabFrom` to normalize `?tab=`; every export of a
// "use client" module is a client reference, which the server may render as a
// component but may never invoke as a function. Putting the normalizer in
// FinanceTabs.tsx compiles cleanly and then throws on every request:
//   "Attempted to call tabFrom() from the server but tabFrom is on the client."
// It also has to stay out of page.tsx itself, which pulls in the Supabase
// server client and request headers at import time and so cannot be reached
// from a unit test.

export type FinanceTab = "membership" | "events" | "originator";

export const FINANCE_TABS: { id: FinanceTab; label: string }[] = [
  { id: "membership", label: "Membership" },
  { id: "events", label: "Events" },
  { id: "originator", label: "Originator" },
];

const TAB_IDS = new Set<string>(FINANCE_TABS.map((t) => t.id));

// Normalize a raw `?tab=` search param. Anything unrecognized — a hand-edited
// URL, a repeated param arriving as an array — falls back to Membership rather
// than rendering nothing.
export function tabFrom(value: string | string[] | undefined): FinanceTab {
  return typeof value === "string" && TAB_IDS.has(value) ? (value as FinanceTab) : "membership";
}
