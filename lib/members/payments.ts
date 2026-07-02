// Pure helpers for the admin members "paid" and "payment month" filters.
//
// Source of truth is the `payments` table: a member is "paid" iff they have a
// `payment_status = 'paid'` row (any season). Each such row contributes a month
// bucketed in Europe/Zurich from `paid_at`, falling back to `created_at` when
// `paid_at` is null — the standard checkout.session.completed webhook path
// writes 'paid' without populating paid_at, so requiring a non-null paid_at
// would misclassify most paying members as "Not paid".
//
// Kept SSR-safe (month key assembled from Intl formatToParts rather than
// toLocale*, mirroring lib/format.ts) and side-effect-free so it can be
// unit-tested in isolation and imported into both the server page and the
// client MemberList component.

// A calendar-month key, "YYYY-MM", resolved in Europe/Zurich.
export type MonthKey = string;
// memberId -> that member's paid months, unique and sorted newest-first.
export type PaidMonthsByMember = Record<string, MonthKey[]>;

const ZURICH_MONTH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
});

// Bucket an ISO timestamp to "YYYY-MM" in Europe/Zurich. Assembled from
// formatToParts (same approach as nowInZurich in lib/format.ts) so month
// boundaries match every other Geneva-time date on the page rather than UTC —
// a payment captured just after midnight UTC on the 1st belongs to the prior
// month in Geneva. Returns "" for an unparseable timestamp so one bad row can't
// throw out of the server render; callers skip empty keys.
export function zurichMonthKey(iso: string): MonthKey {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = ZURICH_MONTH_FMT.formatToParts(d);
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
): PaidMonthsByMember {
  const byMember: Record<string, Set<MonthKey>> = {};
  for (const row of rows) {
    const key = zurichMonthKey(row.paid_at ?? row.created_at);
    if (!key) continue; // skip an unparseable timestamp rather than poisoning the map
    (byMember[row.member_id] ??= new Set()).add(key);
  }
  const out: PaidMonthsByMember = {};
  for (const [memberId, months] of Object.entries(byMember)) {
    // "YYYY-MM" sorts chronologically as plain strings; reverse for newest-first.
    out[memberId] = [...months].sort().reverse();
  }
  return out;
}

// memberId -> that member's most recent paid timestamp (ISO string), using
// paid_at when set, else created_at — the same fallback as the month buckets.
export type PaidDateByMember = Record<string, string>;

// Map each member to their latest paid timestamp, so the table can show a
// "Date paid" column. Compares the raw ISO strings (paid_at ?? created_at) and
// keeps the newest; ISO-8601 timestamps sort chronologically as plain strings.
export function buildPaidDateByMember(
  rows: PaidPaymentRow[],
): PaidDateByMember {
  const out: PaidDateByMember = {};
  for (const row of rows) {
    const ts = row.paid_at ?? row.created_at;
    if (!ts) continue;
    const existing = out[row.member_id];
    if (!existing || ts > existing) out[row.member_id] = ts;
  }
  return out;
}

// Union of every member's months, newest-first, deduped. Drives the month
// <select> options.
export function availablePaymentMonths(
  map: PaidMonthsByMember,
): MonthKey[] {
  const all = new Set<MonthKey>();
  for (const months of Object.values(map)) {
    for (const m of months) all.add(m);
  }
  return [...all].sort().reverse();
}

export type PaidFilter = "all" | "paid" | "unpaid";

// Whether a member passes the paid-status filter. `months` is that member's
// entry from the paid-months map (undefined when they have no paid payment).
export function matchesPaidFilter(
  months: MonthKey[] | undefined,
  filter: PaidFilter,
): boolean {
  if (filter === "all") return true;
  const hasPaid = (months?.length ?? 0) > 0;
  return filter === "paid" ? hasPaid : !hasPaid;
}

// Whether a member passes the payment-month filter. "all" matches everyone;
// a specific "YYYY-MM" matches only members with a paid payment that month.
export function matchesMonthFilter(
  months: MonthKey[] | undefined,
  month: "all" | MonthKey,
): boolean {
  if (month === "all") return true;
  return months?.includes(month) ?? false;
}
