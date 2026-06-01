// Pure helpers for the admin members "paid" and "payment month" filters.
//
// Source of truth is the `payments` table: a member is "paid" iff they have a
// `payment_status = 'paid'` row (any season). Each such row contributes a month
// bucketed in Europe/Zurich from `paid_at`, falling back to `created_at` when
// `paid_at` is null — the standard checkout.session.completed webhook path
// writes 'paid' without populating paid_at, so requiring a non-null paid_at
// would misclassify most paying members as "Not paid".
//
// Kept dependency-free and SSR-safe (no toLocale*; formatToParts assembled by
// hand, mirroring lib/format.ts) so it can be unit-tested in isolation and
// imported into both the server page and the client MemberList component.

const ZURICH_MONTH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
});

// Bucket an ISO timestamp to "YYYY-MM" in Europe/Zurich. Assembled from
// formatToParts (same approach as nowInZurich in lib/format.ts) so month
// boundaries match every other Geneva-time date on the page rather than UTC —
// a payment captured just after midnight UTC on the 1st belongs to the prior
// month in Geneva.
export function zurichMonthKey(iso: string): string {
  const parts = ZURICH_MONTH_FMT.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

export interface PaidPaymentRow {
  member_id: string;
  paid_at: string | null;
  created_at: string;
}

// Map each member to the unique set of "YYYY-MM" months in which they recorded
// a paid payment, sorted newest-first. paid_at when set, else created_at.
export function buildPaidMonthsByMember(
  rows: PaidPaymentRow[],
): Record<string, string[]> {
  const byMember: Record<string, Set<string>> = {};
  for (const row of rows) {
    const key = zurichMonthKey(row.paid_at ?? row.created_at);
    (byMember[row.member_id] ??= new Set()).add(key);
  }
  const out: Record<string, string[]> = {};
  for (const [memberId, months] of Object.entries(byMember)) {
    // "YYYY-MM" sorts chronologically as plain strings; reverse for newest-first.
    out[memberId] = [...months].sort().reverse();
  }
  return out;
}

// Union of every member's months, newest-first, deduped. Drives the month
// <select> options.
export function availablePaymentMonths(
  map: Record<string, string[]>,
): string[] {
  const all = new Set<string>();
  for (const months of Object.values(map)) {
    for (const m of months) all.add(m);
  }
  return [...all].sort().reverse();
}

export type PaidFilter = "all" | "paid" | "unpaid";

// Whether a member passes the paid-status filter. `months` is that member's
// entry from the paid-months map (undefined when they have no paid payment).
export function matchesPaidFilter(
  months: string[] | undefined,
  filter: PaidFilter,
): boolean {
  if (filter === "all") return true;
  const hasPaid = (months?.length ?? 0) > 0;
  return filter === "paid" ? hasPaid : !hasPaid;
}

// Whether a member passes the payment-month filter. "all" matches everyone;
// a specific "YYYY-MM" matches only members with a paid payment that month.
export function matchesMonthFilter(
  months: string[] | undefined,
  month: "all" | string,
): boolean {
  if (month === "all") return true;
  return months?.includes(month) ?? false;
}
