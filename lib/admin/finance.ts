// Finance dashboard data layer.
//
// Read-only aggregation over the two revenue streams — membership dues
// (`payments`) and event ticket sales (`event_registrations` + items) — plus
// originator attribution and member-health counts. No writes, no Stripe calls.
//
// Design: the exported aggregators are PURE functions over plain row arrays so
// they can be unit-tested against fixtures. `getFinanceSummary` is the only
// impure entry point — it paginates the reads (Supabase caps responses at 1000
// rows; see lib/members/payments.ts + app/(admin)/admin/members/page.tsx for
// the same pattern) and hands the rows to the pure aggregators.
//
// Currency: all amounts are CHF. Membership amounts live in the legacy
// `amount_eur` column, which despite its name holds CHF (the app formats it as
// CHF everywhere — see lib/format.ts formatCurrency and the payment-capture
// plan). We read the column and treat it as CHF; there is no conversion.
//
// Money accounting:
//   - Membership gross  = sum of `paid` rows.
//   - Membership refunds = sum of `refunded` rows.
//   - Membership net     = gross − refunds.
//   - Event revenue      = sum of `paid` registrations (gross; event refunds
//                          are not tracked in the DB — see the plan caveat).
//   - `free` / comp rows contribute to COUNTS but never to revenue.

import { zurichMonthKey, type MonthKey } from "@/lib/members/payments";

// ---------------------------------------------------------------------------
// Row projections (minimal columns the aggregators need)
// ---------------------------------------------------------------------------

export interface MembershipPaymentRow {
  member_id: string;
  tier_id: string;
  amount_eur: number; // CHF despite the column name
  payment_status: string; // 'free' | 'pending' | 'paid' | 'overdue' | 'refunded'
  paid_at: string | null;
  created_at: string;
}

export interface EventRegistrationRow {
  id: string;
  event_id: string;
  total_amount_chf: number;
  status: string; // 'pending' | 'paid' | 'free'
  paid_at: string | null;
  created_at: string;
}

export interface EventItemRow {
  registration_id: string;
  title_snapshot: string;
  quantity: number;
  line_total_chf: number;
}

export interface MemberRow {
  id: string;
  status: string; // member_status enum
  tier_id: string | null;
  originator_id: string | null;
  created_at: string;
  end_date: string | null;
}

export interface ReferralRow {
  originator_id: string;
  converted_at: string | null;
}

// ---------------------------------------------------------------------------
// Date range: [fromMs, toMs) — inclusive lower bound, exclusive upper bound.
// Callers build it from YYYY-MM-DD strings via `rangeFromDates`.
// ---------------------------------------------------------------------------

export interface DateRange {
  fromMs: number;
  toMs: number;
}

// Build a [from 00:00, to+1day 00:00) UTC range from inclusive YYYY-MM-DD
// dates, so `to` covers its whole calendar day. UTC day boundaries are a
// deliberate v1 simplification (Geneva midnight would drift by an hour); month
// bucketing below still uses Geneva time for label consistency.
export function rangeFromDates(from: string, to: string): DateRange {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  return { fromMs, toMs };
}

// When money was received. paid_at when set, else created_at — the
// checkout.session.completed path writes 'paid' without paid_at, so requiring
// a non-null paid_at would drop most real payments (same rationale as
// buildPaidMonthsByMember).
function effectivePaidMs(row: { paid_at: string | null; created_at: string }): number {
  return Date.parse(row.paid_at ?? row.created_at);
}

function inRange(ms: number, range: DateRange): boolean {
  return !Number.isNaN(ms) && ms >= range.fromMs && ms < range.toMs;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Membership revenue
// ---------------------------------------------------------------------------

export interface TierRevenue {
  tierId: string;
  tierName: string;
  gross: number;
  net: number;
  paidCount: number;
}

export interface MonthRevenue {
  monthKey: MonthKey;
  gross: number;
  net: number;
}

export interface MembershipSummary {
  gross: number;
  refunds: number;
  net: number;
  paidCount: number;
  newRevenue: number;
  renewalRevenue: number;
  newCount: number;
  renewalCount: number;
  arpu: number; // net / active member count
  byTier: TierRevenue[];
  byMonth: MonthRevenue[];
}

// Classify each in-period `paid` payment as a member's FIRST-ever paid (new) or
// a later one (renewal). "First-ever" is determined across ALL time, so the
// full payment set (not just the in-period slice) must be passed in.
function firstPaidMsByMember(payments: MembershipPaymentRow[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const p of payments) {
    if (p.payment_status !== "paid") continue;
    const ms = effectivePaidMs(p);
    if (Number.isNaN(ms)) continue;
    const prev = first.get(p.member_id);
    if (prev === undefined || ms < prev) first.set(p.member_id, ms);
  }
  return first;
}

export function aggregateMembership(
  payments: MembershipPaymentRow[],
  tierNameById: Map<string, string>,
  range: DateRange,
  activeMemberCount: number,
): MembershipSummary {
  const firstPaid = firstPaidMsByMember(payments);

  let gross = 0;
  let refunds = 0;
  let paidCount = 0;
  let newRevenue = 0;
  let renewalRevenue = 0;
  let newCount = 0;
  let renewalCount = 0;

  const tierAcc = new Map<string, { gross: number; net: number; paidCount: number }>();
  const monthAcc = new Map<string, { gross: number; net: number }>();

  const bumpTier = (tierId: string, dGross: number, dNet: number, dCount: number) => {
    const t = tierAcc.get(tierId) ?? { gross: 0, net: 0, paidCount: 0 };
    t.gross += dGross;
    t.net += dNet;
    t.paidCount += dCount;
    tierAcc.set(tierId, t);
  };
  const bumpMonth = (key: MonthKey, dGross: number, dNet: number) => {
    if (!key) return;
    const m = monthAcc.get(key) ?? { gross: 0, net: 0 };
    m.gross += dGross;
    m.net += dNet;
    monthAcc.set(key, m);
  };

  for (const p of payments) {
    const ms = effectivePaidMs(p);
    if (!inRange(ms, range)) continue;
    const amt = p.amount_eur ?? 0;
    const monthKey = zurichMonthKey(p.paid_at ?? p.created_at);

    if (p.payment_status === "paid") {
      gross += amt;
      paidCount += 1;
      bumpTier(p.tier_id, amt, amt, 1);
      bumpMonth(monthKey, amt, amt);
      // new vs renewal — earliest paid for this member across all time
      if (firstPaid.get(p.member_id) === ms) {
        newRevenue += amt;
        newCount += 1;
      } else {
        renewalRevenue += amt;
        renewalCount += 1;
      }
    } else if (p.payment_status === "refunded") {
      refunds += amt;
      bumpTier(p.tier_id, 0, -amt, 0);
      bumpMonth(monthKey, 0, -amt);
    }
    // free / pending / overdue: not revenue
  }

  const byTier: TierRevenue[] = [...tierAcc.entries()]
    .map(([tierId, v]) => ({
      tierId,
      tierName: tierNameById.get(tierId) ?? "Unknown tier",
      gross: round2(v.gross),
      net: round2(v.net),
      paidCount: v.paidCount,
    }))
    .sort((a, b) => b.net - a.net);

  const byMonth: MonthRevenue[] = [...monthAcc.entries()]
    .map(([monthKey, v]) => ({ monthKey, gross: round2(v.gross), net: round2(v.net) }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const net = gross - refunds;

  return {
    gross: round2(gross),
    refunds: round2(refunds),
    net: round2(net),
    paidCount,
    newRevenue: round2(newRevenue),
    renewalRevenue: round2(renewalRevenue),
    newCount,
    renewalCount,
    arpu: activeMemberCount > 0 ? round2(net / activeMemberCount) : 0,
    byTier,
    byMonth,
  };
}

// ---------------------------------------------------------------------------
// Event revenue
// ---------------------------------------------------------------------------

export interface EventRevenue {
  eventId: string;
  title: string;
  gross: number;
  paidRegistrations: number;
}

export interface TicketTypeRevenue {
  title: string;
  gross: number;
  quantity: number;
}

export interface EventSummary {
  gross: number;
  paidRegistrations: number;
  freeRegistrations: number;
  byEvent: EventRevenue[];
  byTicketType: TicketTypeRevenue[];
}

export function aggregateEvents(
  registrations: EventRegistrationRow[],
  items: EventItemRow[],
  eventTitleById: Map<string, string>,
  range: DateRange,
): EventSummary {
  let gross = 0;
  let paidRegistrations = 0;
  let freeRegistrations = 0;

  const eventAcc = new Map<string, { gross: number; count: number }>();
  // Which registrations count toward this period's revenue — used to scope the
  // per-ticket-type rollup to the same set.
  const paidRegIds = new Set<string>();

  for (const r of registrations) {
    const ms = effectivePaidMs(r);
    if (!inRange(ms, range)) continue;
    if (r.status === "paid") {
      const amt = r.total_amount_chf ?? 0;
      gross += amt;
      paidRegistrations += 1;
      paidRegIds.add(r.id);
      const e = eventAcc.get(r.event_id) ?? { gross: 0, count: 0 };
      e.gross += amt;
      e.count += 1;
      eventAcc.set(r.event_id, e);
    } else if (r.status === "free") {
      freeRegistrations += 1;
    }
  }

  const ttAcc = new Map<string, { gross: number; quantity: number }>();
  for (const it of items) {
    if (!paidRegIds.has(it.registration_id)) continue;
    const t = ttAcc.get(it.title_snapshot) ?? { gross: 0, quantity: 0 };
    t.gross += it.line_total_chf ?? 0;
    t.quantity += it.quantity ?? 0;
    ttAcc.set(it.title_snapshot, t);
  }

  const byEvent: EventRevenue[] = [...eventAcc.entries()]
    .map(([eventId, v]) => ({
      eventId,
      title: eventTitleById.get(eventId) ?? "Unknown event",
      gross: round2(v.gross),
      paidRegistrations: v.count,
    }))
    .sort((a, b) => b.gross - a.gross);

  const byTicketType: TicketTypeRevenue[] = [...ttAcc.entries()]
    .map(([title, v]) => ({ title, gross: round2(v.gross), quantity: v.quantity }))
    .sort((a, b) => b.gross - a.gross);

  return {
    gross: round2(gross),
    paidRegistrations,
    freeRegistrations,
    byEvent,
    byTicketType,
  };
}

// ---------------------------------------------------------------------------
// Originator breakdown (attribution only — no commission rate/payout)
// ---------------------------------------------------------------------------

export const UNATTRIBUTED_ORIGINATOR = "__direct__";

export interface OriginatorRevenue {
  originatorId: string; // UNATTRIBUTED_ORIGINATOR for members with no originator
  name: string;
  net: number;
  convertedReferrals: number;
}

export function aggregateOriginators(
  payments: MembershipPaymentRow[],
  members: MemberRow[],
  referrals: ReferralRow[],
  originatorNameById: Map<string, string>,
  range: DateRange,
): OriginatorRevenue[] {
  const originatorByMember = new Map<string, string | null>();
  for (const m of members) originatorByMember.set(m.id, m.originator_id);

  const acc = new Map<string, { net: number; referrals: number }>();
  const bump = (key: string, dNet: number, dRef: number) => {
    const a = acc.get(key) ?? { net: 0, referrals: 0 };
    a.net += dNet;
    a.referrals += dRef;
    acc.set(key, a);
  };

  // Net membership revenue attributed to each member's originator.
  for (const p of payments) {
    const ms = effectivePaidMs(p);
    if (!inRange(ms, range)) continue;
    const amt = p.amount_eur ?? 0;
    const signed = p.payment_status === "paid" ? amt : p.payment_status === "refunded" ? -amt : 0;
    if (signed === 0) continue;
    const originatorId = originatorByMember.get(p.member_id) ?? null;
    bump(originatorId ?? UNATTRIBUTED_ORIGINATOR, signed, 0);
  }

  // Converted referrals in period.
  for (const r of referrals) {
    if (!r.converted_at) continue;
    const ms = Date.parse(r.converted_at);
    if (!inRange(ms, range)) continue;
    bump(r.originator_id, 0, 1);
  }

  return [...acc.entries()]
    .map(([originatorId, v]) => ({
      originatorId,
      name:
        originatorId === UNATTRIBUTED_ORIGINATOR
          ? "Direct (no originator)"
          : originatorNameById.get(originatorId) ?? "Unknown originator",
      net: round2(v.net),
      convertedReferrals: v.referrals,
    }))
    .sort((a, b) => b.net - a.net);
}

// ---------------------------------------------------------------------------
// Member health
// ---------------------------------------------------------------------------

export interface MemberHealth {
  active: number;
  expired: number;
  pending: number;
  suspended: number;
  total: number;
  newMembers: number; // created_at in period
  renewalRate: number; // 0..1, pragmatic — see below
}

// renewalRate (pragmatic v1): of members whose end_date falls in the period,
// the share that are currently `active`. Refine against real data if it proves
// misleading (gaps, honorary, suspended edge cases).
export function aggregateMemberHealth(members: MemberRow[], range: DateRange): MemberHealth {
  let active = 0;
  let expired = 0;
  let pending = 0;
  let suspended = 0;
  let newMembers = 0;
  let endedInPeriod = 0;
  let endedInPeriodActive = 0;

  for (const m of members) {
    switch (m.status) {
      case "active":
        active += 1;
        break;
      case "expired":
        expired += 1;
        break;
      case "pending":
        pending += 1;
        break;
      case "suspended":
        suspended += 1;
        break;
    }
    if (inRange(Date.parse(m.created_at), range)) newMembers += 1;
    if (m.end_date) {
      const endMs = Date.parse(`${m.end_date}T00:00:00Z`);
      if (inRange(endMs, range)) {
        endedInPeriod += 1;
        if (m.status === "active") endedInPeriodActive += 1;
      }
    }
  }

  return {
    active,
    expired,
    pending,
    suspended,
    total: members.length,
    newMembers,
    renewalRate: endedInPeriod > 0 ? round2(endedInPeriodActive / endedInPeriod) : 0,
  };
}

// ---------------------------------------------------------------------------
// Top-level summary
// ---------------------------------------------------------------------------

export interface FinanceSummary {
  range: { from: string; to: string };
  totals: {
    totalRevenue: number; // membership net + event gross
    membershipNet: number;
    eventGross: number;
    activeMembers: number;
    newMembers: number;
  };
  membership: MembershipSummary;
  events: EventSummary;
  originators: OriginatorRevenue[];
  memberHealth: MemberHealth;
  complete: boolean; // false if any paginated read errored (partial data)
}

const PAGE_SIZE = 1000;

// Minimal Supabase-like client surface we depend on (createAdminClient returns
// an untyped client). Kept structural so tests can inject a fake.
interface QueryResult<T> {
  data: T[] | null;
  error: unknown;
}
interface SelectBuilder<T> {
  order(column: string, opts: { ascending: boolean }): SelectBuilder<T>;
  range(from: number, to: number): PromiseLike<QueryResult<T>>;
}
interface FinanceClient {
  from(table: string): { select(columns: string): SelectBuilder<Record<string, unknown>> };
}

// Read an entire table in 1000-row pages, ordered by a stable key so page seams
// don't skip/duplicate rows (same guard as the members page).
async function fetchAll<T>(
  client: FinanceClient,
  table: string,
  columns: string,
  orderKey: string,
): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order(orderKey, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, complete: false };
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { rows, complete: true };
}

// A single settled financial row for CSV export. `amountChf` is signed so a
// naive column sum reconciles with membership net + event gross: paid rows are
// positive, refunded membership rows negative, free/comp rows zero. Pending and
// overdue rows are omitted (not settled).
export interface FinanceTransaction {
  type: "membership" | "event";
  date: string; // YYYY-MM-DD (from paid_at, else created_at)
  party: string; // member or registrant name/email
  detail: string; // tier name or event title
  status: string;
  amountChf: number;
}

function isoDate(row: { paid_at: string | null; created_at: string }): string {
  return (row.paid_at ?? row.created_at).slice(0, 10);
}

export async function getFinanceTransactions(
  client: FinanceClient,
  from: string,
  to: string,
): Promise<FinanceTransaction[]> {
  const range = rangeFromDates(from, to);

  const [pay, members, tiers, regs, events] = await Promise.all([
    fetchAll<MembershipPaymentRow>(
      client,
      "payments",
      "member_id, tier_id, amount_eur, payment_status, paid_at, created_at",
      "id",
    ),
    fetchAll<{ id: string; first_name: string; last_name: string; email: string }>(
      client,
      "members",
      "id, first_name, last_name, email",
      "id",
    ),
    fetchAll<{ id: string; name: string }>(client, "membership_tiers", "id, name", "id"),
    fetchAll<
      EventRegistrationRow & { name: string; email: string }
    >(
      client,
      "event_registrations",
      "id, event_id, total_amount_chf, status, paid_at, created_at, name, email",
      "id",
    ),
    fetchAll<{ id: string; title: string }>(client, "events", "id, title", "id"),
  ]);

  const memberName = new Map(
    members.rows.map((m) => [m.id, `${m.first_name} ${m.last_name}`.trim() || m.email]),
  );
  const tierName = new Map(tiers.rows.map((t) => [t.id, t.name]));
  const eventTitle = new Map(events.rows.map((e) => [e.id, e.title]));

  const rows: FinanceTransaction[] = [];

  for (const p of pay.rows) {
    if (!inRange(effectivePaidMs(p), range)) continue;
    const amt = p.amount_eur ?? 0;
    let amountChf: number;
    if (p.payment_status === "paid") amountChf = amt;
    else if (p.payment_status === "refunded") amountChf = -amt;
    else if (p.payment_status === "free") amountChf = 0;
    else continue; // pending / overdue: not settled
    rows.push({
      type: "membership",
      date: isoDate(p),
      party: memberName.get(p.member_id) ?? p.member_id,
      detail: tierName.get(p.tier_id) ?? "Unknown tier",
      status: p.payment_status,
      amountChf: round2(amountChf),
    });
  }

  for (const r of regs.rows) {
    if (!inRange(effectivePaidMs(r), range)) continue;
    if (r.status !== "paid" && r.status !== "free") continue;
    rows.push({
      type: "event",
      date: isoDate(r),
      party: r.name || r.email,
      detail: eventTitle.get(r.event_id) ?? "Unknown event",
      status: r.status,
      amountChf: r.status === "paid" ? round2(r.total_amount_chf ?? 0) : 0,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export async function getFinanceSummary(
  client: FinanceClient,
  from: string,
  to: string,
): Promise<FinanceSummary> {
  const range = rangeFromDates(from, to);

  const [pay, regs, items, members, tiers, originators, referrals] = await Promise.all([
    fetchAll<MembershipPaymentRow>(
      client,
      "payments",
      "member_id, tier_id, amount_eur, payment_status, paid_at, created_at",
      "id",
    ),
    fetchAll<EventRegistrationRow>(
      client,
      "event_registrations",
      "id, event_id, total_amount_chf, status, paid_at, created_at",
      "id",
    ),
    fetchAll<EventItemRow>(
      client,
      "event_registration_items",
      "registration_id, title_snapshot, quantity, line_total_chf",
      "id",
    ),
    fetchAll<MemberRow>(
      client,
      "members",
      "id, status, tier_id, originator_id, created_at, end_date",
      "id",
    ),
    fetchAll<{ id: string; name: string }>(client, "membership_tiers", "id, name", "id"),
    fetchAll<{ id: string; first_name: string; last_name: string }>(
      client,
      "admin_users",
      "id, first_name, last_name",
      "id",
    ),
    fetchAll<ReferralRow>(client, "referrals", "originator_id, converted_at", "id"),
  ]);

  // Event titles: at club scale, reading all event titles is cheaper and
  // simpler than a lazy per-id lookup.
  const eventsRead = await fetchAll<{ id: string; title: string }>(
    client,
    "events",
    "id, title",
    "id",
  );

  const tierNameById = new Map(tiers.rows.map((t) => [t.id, t.name]));
  const eventTitleById = new Map(eventsRead.rows.map((e) => [e.id, e.title]));
  const originatorNameById = new Map(
    originators.rows.map((o) => [o.id, `${o.first_name} ${o.last_name}`.trim()]),
  );

  const activeMembers = members.rows.filter((m) => m.status === "active").length;

  const membership = aggregateMembership(pay.rows, tierNameById, range, activeMembers);
  const events = aggregateEvents(regs.rows, items.rows, eventTitleById, range);
  const originatorBreakdown = aggregateOriginators(
    pay.rows,
    members.rows,
    referrals.rows,
    originatorNameById,
    range,
  );
  const memberHealth = aggregateMemberHealth(members.rows, range);

  const complete =
    pay.complete &&
    regs.complete &&
    items.complete &&
    members.complete &&
    tiers.complete &&
    originators.complete &&
    referrals.complete &&
    eventsRead.complete;

  return {
    range: { from, to },
    totals: {
      totalRevenue: round2(membership.net + events.gross),
      membershipNet: membership.net,
      eventGross: events.gross,
      activeMembers,
      newMembers: memberHealth.newMembers,
    },
    membership,
    events,
    originators: originatorBreakdown,
    memberHealth,
    complete,
  };
}
