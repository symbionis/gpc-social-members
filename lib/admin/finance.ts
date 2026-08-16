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
//   - Event gross        = sum of the ticket LINE ITEMS of `paid` registrations.
//                          The lines, not `total_amount_chf`: a top-up appends
//                          lines without updating the booking total.
//   - Event refunds      = sum of the seats whose tickets are 'refunded'.
//   - Event net          = gross − refunds. THIS is event revenue; report it, not gross.
//   - `free` / comp rows contribute to COUNTS but never to revenue.
//
// Event refunds used to be absent from this file entirely, on the (then-true) grounds that the
// database did not record them. It does now — the admin roster issues the Stripe refund and
// writes the amount — and the gap was not academic: Pilates & Polo 3.0 reported CHF 960 of
// event revenue against CHF 400 actually collected, because CHF 560 of refunds had nowhere to
// be counted. A cancellation whose refund is still pending is NOT subtracted (the club still
// holds that money) but is reported separately as `pendingRefunds`.

import { zurichMonthKey, type MonthKey } from "@/lib/members/payments";
import { refundedAmountChf, resolveTicketLine } from "@/lib/events/refunds";
import type { StripeRef } from "@/lib/stripe/dashboard";

// ---------------------------------------------------------------------------
// Row projections (minimal columns the aggregators need)
// ---------------------------------------------------------------------------

export interface MembershipPaymentRow {
  id: string;
  member_id: string;
  tier_id: string;
  amount_eur: number; // CHF despite the column name
  payment_status: string; // 'free' | 'pending' | 'paid' | 'overdue' | 'refunded'
  paid_at: string | null;
  created_at: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
}

// The CSV export reads a narrower projection — it needs neither the payment id
// nor the Stripe identifiers, and widening its select is out of scope.
type ExportPaymentRow = Pick<
  MembershipPaymentRow,
  "member_id" | "tier_id" | "amount_eur" | "payment_status" | "paid_at" | "created_at"
>;

// Resolve a payment row's Stripe handle: PaymentIntent first, Checkout Session
// as fallback, null when neither is on record. The PaymentIntent is preferred
// because it resolves to a charge and to refund metadata, whereas a session can
// exist with no successful charge.
export function resolveStripeRef(row: {
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
}): StripeRef | null {
  if (row.stripe_payment_intent_id) {
    return { kind: "payment_intent", id: row.stripe_payment_intent_id };
  }
  if (row.stripe_checkout_session_id) {
    return { kind: "checkout_session", id: row.stripe_checkout_session_id };
  }
  return null;
}

export interface EventRegistrationRow {
  id: string;
  event_id: string;
  quantity: number;
  total_amount_chf: number;
  status: string; // 'pending' | 'paid' | 'free'
  paid_at: string | null;
  created_at: string;
}

export interface EventItemRow {
  registration_id: string;
  ticket_type_id: string | null;
  title_snapshot: string;
  quantity: number;
  unit_amount_chf: number;
  line_total_chf: number;
}

// One sold seat, read only for its refund position.
//
// `released_at` is projected so tombstones can be excluded. `release_ticket` leaves the old row
// behind with its `cancellation_status` intact and mints a replacement, so a seat cancelled and
// then freed at the door exists twice — counting both would subtract its refund twice. Every
// other ticket reader in the codebase filters these out, and so does the refund backfill
// migration; this is the projection that lets the aggregators do the same.
export interface EventTicketRow {
  registration_id: string | null;
  ticket_type_id: string | null;
  cancellation_status: string | null;
  refund_amount_chf: number | string | null;
  released_at: string | null;
}

export interface MemberRow {
  id: string;
  status: string; // member_status enum
  tier_id: string | null;
  originator_id: string | null;
  created_at: string;
  end_date: string | null;
  first_name?: string;
  last_name?: string;
  email?: string;
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

// The one settled-revenue rule: a `paid` row counts positive, a `refunded` row
// counts negative, and everything else (free, pending, overdue) is not settled
// revenue at all — null, not zero, so callers can tell "not revenue" apart from
// "revenue of zero". Shared by every originator path so the aggregate and the
// per-payment rows behind it cannot drift on which rows they include.
function settledAmountChf(row: { payment_status: string; amount_eur: number }): number | null {
  const amt = row.amount_eur ?? 0;
  if (row.payment_status === "paid") return amt;
  if (row.payment_status === "refunded") return -amt;
  return null;
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
  payingMembers: number; // distinct members with a paid payment in the period
  newRevenue: number;
  renewalRevenue: number;
  newCount: number;
  renewalCount: number;
  arpu: number; // net / paying members (not all active — many are honorary/comp)
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
): MembershipSummary {
  const firstPaid = firstPaidMsByMember(payments);

  let gross = 0;
  let refunds = 0;
  let paidCount = 0;
  let newRevenue = 0;
  let renewalRevenue = 0;
  let newCount = 0;
  let renewalCount = 0;
  // Distinct members who actually paid in-period — the honest ARPU denominator.
  // (Active-member count is a poor denominator here: most active members are
  // honorary/complimentary and never generate a payment row.)
  const payers = new Set<string>();

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
      payers.add(p.member_id);
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
    payingMembers: payers.size,
    newRevenue: round2(newRevenue),
    renewalRevenue: round2(renewalRevenue),
    newCount,
    renewalCount,
    arpu: payers.size > 0 ? round2(net / payers.size) : 0,
    byTier,
    byMonth,
  };
}

// A single membership payment row, for the tier/month drill-down modal. Signed
// `amountChf` (paid +, refunded −) so a filtered subset sums to that tier's or
// month's net. Only `paid`/`refunded` in-range rows — the same set that makes
// up byTier/byMonth — so the modal totals reconcile with the row clicked.
export interface MembershipTxn {
  memberName: string;
  tierId: string;
  monthKey: MonthKey;
  date: string; // YYYY-MM-DD
  status: string; // 'paid' | 'refunded'
  amountChf: number;
}

export function buildMembershipTransactions(
  payments: MembershipPaymentRow[],
  memberNameById: Map<string, string>,
  range: DateRange,
): MembershipTxn[] {
  const rows: MembershipTxn[] = [];
  for (const p of payments) {
    if (!inRange(effectivePaidMs(p), range)) continue;
    if (p.payment_status !== "paid" && p.payment_status !== "refunded") continue;
    const amt = p.amount_eur ?? 0;
    rows.push({
      memberName: memberNameById.get(p.member_id) ?? p.member_id,
      tierId: p.tier_id,
      monthKey: zurichMonthKey(p.paid_at ?? p.created_at),
      date: isoDate(p),
      status: p.payment_status,
      amountChf: round2(p.payment_status === "refunded" ? -amt : amt),
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Event revenue
// ---------------------------------------------------------------------------

export interface EventRevenue {
  eventId: string;
  title: string;
  gross: number;
  /** Settled refunds against this event's bookings. */
  refunds: number;
  /** gross − refunds: what the club actually kept. */
  net: number;
  paidRegistrations: number;
}

export interface TicketTypeRevenue {
  title: string;
  gross: number;
  refunds: number;
  net: number;
  quantity: number;
}

// Where a refund lands when its seat can't be tied to a ticket-type line — a multi-line
// booking whose ticket names none of them. Rare and legacy-shaped, but it must land SOMEWHERE
// visible: dropping it would make the per-type rollup quietly disagree with the event total.
export const UNATTRIBUTED_TICKET_TYPE = "Unattributed";

// One Geneva calendar month of event ticket revenue.
//
// A refund files under the month of the SALE, not the month the money went back — mirroring
// the membership breakdown, where a refunded payment row is negative in its own paid month.
// That keeps a month's event rows summing to the month total by construction, and keeps a
// closed month closed rather than having a later refund silently restate it.
export interface EventMonthRevenue {
  monthKey: MonthKey;
  gross: number;
  refunds: number;
  net: number;
  paidRegistrations: number;
  /** The events that took money in this month, highest net first. */
  byEvent: EventRevenue[];
}

export interface EventSummary {
  gross: number;
  /** Settled refunds ('refunded' tickets) — money that has gone back. */
  refunds: number;
  /** gross − refunds. The figure to report as event revenue. */
  net: number;
  /**
   * Cancellations whose outcome is still undecided ('requested'). NOT subtracted from net —
   * the club still holds this money — but surfaced so a backlog of unactioned cancellations
   * is visible rather than sitting inside the headline number looking like healthy revenue.
   */
  pendingRefunds: number;
  paidRegistrations: number;
  freeRegistrations: number;
  byEvent: EventRevenue[];
  byTicketType: TicketTypeRevenue[];
  byMonth: EventMonthRevenue[]; // ascending by monthKey
}

export function aggregateEvents(
  registrations: EventRegistrationRow[],
  items: EventItemRow[],
  tickets: EventTicketRow[],
  eventTitleById: Map<string, string>,
  range: DateRange,
): EventSummary {
  let gross = 0;
  let refunds = 0;
  let pendingRefunds = 0;
  let paidRegistrations = 0;
  let freeRegistrations = 0;

  // What a registration actually took, from the ticket line ledger.
  //
  // `event_registrations.total_amount_chf` is written at checkout and a top-up
  // never updates it — apply_registration_topup inserts item lines and bumps
  // `quantity` only. Reading the booking total therefore misses every franc of
  // top-up revenue, while the per-ticket-type rollup below (which already reads
  // the lines) includes it, so the two disagreed. The lines are the ledger:
  // top-ups append to them and ticket-type conversions adjust them in place.
  //
  // A registration with NO line rows falls back to its booking total. Legacy
  // rows predate the items table, and reporting zero for them would silently
  // lose real money.
  const itemTotalByReg = new Map<string, number>();
  for (const it of items) {
    itemTotalByReg.set(
      it.registration_id,
      (itemTotalByReg.get(it.registration_id) ?? 0) + (it.line_total_chf ?? 0),
    );
  }
  const amountOf = (r: EventRegistrationRow): number =>
    itemTotalByReg.get(r.id) ?? r.total_amount_chf ?? 0;

  // What each cancelled seat took back out, resolved through the SAME helper the refund route
  // and the admin roster use — so the amount finance subtracts is the amount Stripe sent and
  // the amount the admin saw on the button.
  //
  // `refundedAmountChf` prefers the amount recorded at refund time and derives the seat price
  // when it is NULL. That fallback is what makes tickets refunded before refund accounting
  // existed net out here rather than counting as full revenue forever.
  const itemsByReg = new Map<string, EventItemRow[]>();
  for (const it of items) {
    const list = itemsByReg.get(it.registration_id) ?? [];
    list.push(it);
    itemsByReg.set(it.registration_id, list);
  }
  const regById = new Map(registrations.map((r) => [r.id, r]));

  const settledByReg = new Map<string, number>();
  const pendingByReg = new Map<string, number>();
  // Per-ticket detail, kept so the ticket-type rollup can attribute a refund to the type it
  // was sold as without re-deriving that type (which is how the two would drift).
  const refundDetail: { regId: string; title: string; amount: number; settled: boolean }[] = [];

  for (const t of tickets) {
    if (!t.registration_id) continue;
    // A released tombstone is not a live seat; its replacement carries the booking's money.
    if (t.released_at) continue;
    const settled = t.cancellation_status === "refunded";
    const pending = t.cancellation_status === "requested";
    if (!settled && !pending) continue;

    const reg = regById.get(t.registration_id);
    if (!reg) continue;
    const lines = itemsByReg.get(t.registration_id) ?? [];
    const amount = refundedAmountChf(t, reg, lines);
    if (amount <= 0) continue;

    const target = settled ? settledByReg : pendingByReg;
    target.set(t.registration_id, (target.get(t.registration_id) ?? 0) + amount);
    refundDetail.push({
      regId: t.registration_id,
      title: resolveTicketLine(t, reg, lines)?.title_snapshot ?? UNATTRIBUTED_TICKET_TYPE,
      amount,
      settled,
    });
  }

  const eventAcc = new Map<string, { gross: number; refunds: number; count: number }>();
  const monthAcc = new Map<
    MonthKey,
    {
      gross: number;
      refunds: number;
      count: number;
      events: Map<string, { gross: number; refunds: number; count: number }>;
    }
  >();
  // Which registrations count toward this period's revenue — used to scope the
  // per-ticket-type rollup to the same set.
  const paidRegIds = new Set<string>();
  // Settled refunds per registration AFTER clamping to that booking's own gross.
  const clampedByReg = new Map<string, number>();

  for (const r of registrations) {
    const ms = effectivePaidMs(r);
    if (!inRange(ms, range)) continue;
    if (r.status === "paid") {
      const amt = amountOf(r);
      // Clamped to the booking's own gross: a refund can never take back more than this
      // booking brought in, and letting a mis-derived amount go negative would quietly
      // manufacture revenue elsewhere in the totals.
      const refunded = Math.min(settledByReg.get(r.id) ?? 0, amt);
      const pending = Math.min(pendingByReg.get(r.id) ?? 0, Math.max(0, amt - refunded));
      // The clamp has to reach the per-type rollup too, or the ticket-type panel reports more
      // refunds than the event it belongs to and the page contradicts itself.
      clampedByReg.set(r.id, refunded);

      gross += amt;
      refunds += refunded;
      pendingRefunds += pending;
      paidRegistrations += 1;
      paidRegIds.add(r.id);
      const e = eventAcc.get(r.event_id) ?? { gross: 0, refunds: 0, count: 0 };
      e.gross += amt;
      e.refunds += refunded;
      e.count += 1;
      eventAcc.set(r.event_id, e);
      // Geneva months, matching the membership breakdown and the originator
      // panel, so the same registration never files under two different months
      // depending on which table you read.
      const monthKey = zurichMonthKey(r.paid_at ?? r.created_at);
      if (monthKey) {
        const m = monthAcc.get(monthKey) ?? { gross: 0, refunds: 0, count: 0, events: new Map() };
        m.gross += amt;
        m.refunds += refunded;
        m.count += 1;
        // Same accumulation as eventAcc, scoped to the month, so a month's
        // event rows sum to the month by construction rather than by a second
        // pass that could drift.
        const me = m.events.get(r.event_id) ?? { gross: 0, refunds: 0, count: 0 };
        me.gross += amt;
        me.refunds += refunded;
        me.count += 1;
        m.events.set(r.event_id, me);
        monthAcc.set(monthKey, m);
      }
    } else if (r.status === "free") {
      freeRegistrations += 1;
    }
  }

  const ttAcc = new Map<string, { gross: number; refunds: number; quantity: number }>();
  for (const it of items) {
    if (!paidRegIds.has(it.registration_id)) continue;
    const t = ttAcc.get(it.title_snapshot) ?? { gross: 0, refunds: 0, quantity: 0 };
    t.gross += it.line_total_chf ?? 0;
    t.quantity += it.quantity ?? 0;
    ttAcc.set(it.title_snapshot, t);
  }
  // Attribute settled refunds to the type each seat was SOLD as, scoped to the same
  // registrations the gross above came from. Without this the per-type panel would keep
  // reporting gross while the headline reported net — two numbers for one question.
  const typeBudget = new Map(clampedByReg);
  for (const d of refundDetail) {
    if (!d.settled || !paidRegIds.has(d.regId)) continue;
    // Allocate against the booking's clamped total, so these rows sum to the same refunds the
    // event and month rollups report. A seat beyond the budget (over-marked data) contributes
    // nothing here rather than pushing the panel negative.
    const remaining = typeBudget.get(d.regId) ?? 0;
    if (remaining <= 0) continue;
    const take = Math.min(d.amount, remaining);
    typeBudget.set(d.regId, remaining - take);
    const t = ttAcc.get(d.title) ?? { gross: 0, refunds: 0, quantity: 0 };
    t.refunds += take;
    ttAcc.set(d.title, t);
  }

  const byEvent: EventRevenue[] = [...eventAcc.entries()]
    .map(([eventId, v]) => ({
      eventId,
      title: eventTitleById.get(eventId) ?? "Unknown event",
      gross: round2(v.gross),
      refunds: round2(v.refunds),
      net: round2(v.gross - v.refunds),
      paidRegistrations: v.count,
    }))
    .sort((a, b) => b.net - a.net);

  const byTicketType: TicketTypeRevenue[] = [...ttAcc.entries()]
    .map(([title, v]) => ({
      title,
      gross: round2(v.gross),
      refunds: round2(v.refunds),
      net: round2(v.gross - v.refunds),
      quantity: v.quantity,
    }))
    .sort((a, b) => b.net - a.net);

  const byMonth: EventMonthRevenue[] = [...monthAcc.entries()]
    .map(([monthKey, v]) => ({
      monthKey,
      gross: round2(v.gross),
      refunds: round2(v.refunds),
      net: round2(v.gross - v.refunds),
      paidRegistrations: v.count,
      byEvent: [...v.events.entries()]
        .map(([eventId, e]) => ({
          eventId,
          title: eventTitleById.get(eventId) ?? "Unknown event",
          gross: round2(e.gross),
          refunds: round2(e.refunds),
          net: round2(e.gross - e.refunds),
          paidRegistrations: e.count,
        }))
        // Total tiebreak: net, then title, then id. Array.sort is not stable
        // for comparators returning 0, so tied events would otherwise reshuffle
        // between renders.
        .sort(
          (a, b) =>
            b.net - a.net ||
            a.title.localeCompare(b.title) ||
            a.eventId.localeCompare(b.eventId),
        ),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  return {
    gross: round2(gross),
    refunds: round2(refunds),
    net: round2(gross - refunds),
    pendingRefunds: round2(pendingRefunds),
    paidRegistrations,
    freeRegistrations,
    byEvent,
    byTicketType,
    byMonth,
  };
}

// ---------------------------------------------------------------------------
// Originator breakdown (attribution only — no commission rate/payout)
// ---------------------------------------------------------------------------

export const UNATTRIBUTED_ORIGINATOR = "__direct__";

// One Geneva calendar month of an originator's attributed revenue. `net` is
// signed the same way the originator total is, so an originator's month nets
// sum to their total by construction (they are accumulated in the same pass).
export interface OriginatorMonth {
  monthKey: MonthKey;
  net: number;
  paidCount: number;
}

export interface OriginatorRevenue {
  originatorId: string; // UNATTRIBUTED_ORIGINATOR for members with no originator
  name: string;
  net: number;
  convertedReferrals: number;
  byMonth: OriginatorMonth[]; // ascending by monthKey; empty when no attributed revenue
}

// Which originator a payment is credited to: the member's CURRENT originator,
// which is their sign-up originator. Renewals are therefore credited to whoever
// signed the member up, not to the originator who drove the renewal — see the
// panel copy. Members with no originator (and payments whose member row is
// missing) fall into the Direct bucket.
function originatorByMemberId(members: MemberRow[]): Map<string, string | null> {
  return new Map(members.map((m) => [m.id, m.originator_id]));
}

function originatorOf(
  originatorByMember: Map<string, string | null>,
  memberId: string,
): string {
  return originatorByMember.get(memberId) ?? UNATTRIBUTED_ORIGINATOR;
}

function originatorNameOf(
  originatorId: string,
  originatorNameById: Map<string, string>,
): string {
  if (originatorId === UNATTRIBUTED_ORIGINATOR) return "Direct (no originator)";
  return originatorNameById.get(originatorId) || "Unknown originator";
}

export function aggregateOriginators(
  payments: MembershipPaymentRow[],
  members: MemberRow[],
  referrals: ReferralRow[],
  originatorNameById: Map<string, string>,
  range: DateRange,
): OriginatorRevenue[] {
  const originatorByMember = originatorByMemberId(members);

  interface Acc {
    net: number;
    referrals: number;
    months: Map<MonthKey, { net: number; paidCount: number }>;
  }
  const acc = new Map<string, Acc>();
  const entry = (key: string): Acc => {
    const a = acc.get(key) ?? { net: 0, referrals: 0, months: new Map() };
    acc.set(key, a);
    return a;
  };

  // Net membership revenue attributed to each member's originator, accumulated
  // in one pass so the month dimension cannot drift from the total.
  for (const p of payments) {
    const ms = effectivePaidMs(p);
    if (!inRange(ms, range)) continue;
    // Filter on status, not on amount. A CHF 0 `paid` row is still a payment:
    // skipping it here while buildOriginatorTransactions keeps it would put a
    // drill-down row under a month the aggregate never counted.
    const signed = settledAmountChf(p);
    if (signed === null) continue;

    const monthKey = zurichMonthKey(p.paid_at ?? p.created_at);
    if (!monthKey) continue; // unreachable in range (inRange rejects unparseable dates); bail before the total so net and byMonth stay reconcilable

    const a = entry(originatorOf(originatorByMember, p.member_id));
    a.net += signed;

    const m = a.months.get(monthKey) ?? { net: 0, paidCount: 0 };
    m.net += signed;
    if (p.payment_status === "paid") m.paidCount += 1;
    a.months.set(monthKey, m);
  }

  // Converted referrals in period.
  for (const r of referrals) {
    if (!r.converted_at) continue;
    const ms = Date.parse(r.converted_at);
    if (!inRange(ms, range)) continue;
    entry(r.originator_id).referrals += 1;
  }

  return [...acc.entries()]
    .map(([originatorId, v]) => ({
      originatorId,
      name: originatorNameOf(originatorId, originatorNameById),
      net: round2(v.net),
      convertedReferrals: v.referrals,
      byMonth: [...v.months.entries()]
        .map(([monthKey, m]) => ({ monthKey, net: round2(m.net), paidCount: m.paidCount }))
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
    }))
    // Total tiebreak: net, then name, then id. Array.sort is not stable for
    // comparators returning 0, so tied originators would otherwise reshuffle
    // between refreshes.
    .sort(
      (a, b) =>
        b.net - a.net ||
        a.name.localeCompare(b.name) ||
        a.originatorId.localeCompare(b.originatorId),
    );
}

// One membership payment behind an originator's month, for the accordion's
// third level. `amountChf` is signed (paid +, refunded −) so the rows filtered
// to an (originatorId, monthKey) pair sum to that month's net.
export interface OriginatorTxn {
  id: string; // payment id — sort tiebreak, and a stable React key
  originatorId: string;
  monthKey: MonthKey;
  memberName: string;
  tierName: string;
  // Full ISO timestamp, NOT a YYYY-MM-DD slice. formatDate renders it in
  // Europe/Zurich, so the day shown always agrees with the Geneva month it sits
  // under. A UTC slice would print "28 Feb" beneath a "March 2026" header for a
  // payment captured at 23:30 UTC on the 28th.
  when: string;
  status: string; // 'paid' | 'refunded'
  amountChf: number;
  stripeRef: StripeRef | null;
}

export function buildOriginatorTransactions(
  payments: MembershipPaymentRow[],
  members: MemberRow[],
  memberNameById: Map<string, string>,
  tierNameById: Map<string, string>,
  range: DateRange,
): OriginatorTxn[] {
  const originatorByMember = originatorByMemberId(members);

  const rows: OriginatorTxn[] = [];
  for (const p of payments) {
    const ms = effectivePaidMs(p);
    if (!inRange(ms, range)) continue;
    const signed = settledAmountChf(p);
    if (signed === null) continue;
    const when = p.paid_at ?? p.created_at;
    const monthKey = zurichMonthKey(when);
    if (!monthKey) continue; // same unreachable guard as aggregateOriginators, so neither side emits a row the other drops
    rows.push({
      id: p.id,
      originatorId: originatorOf(originatorByMember, p.member_id),
      monthKey,
      memberName: memberNameById.get(p.member_id) ?? p.member_id,
      tierName: tierNameById.get(p.tier_id) ?? "Unknown tier",
      when,
      status: p.payment_status,
      amountChf: round2(signed),
      stripeRef: resolveStripeRef(p),
    });
  }
  // Sort on the parsed instant, not the string: `when` comes straight from the
  // column, so its offset spelling is not guaranteed to be uniform.
  return rows.sort(
    (a, b) => Date.parse(a.when) - Date.parse(b.when) || a.id.localeCompare(b.id),
  );
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
    totalRevenue: number; // membership net + event NET (both after refunds)
    membershipNet: number;
    eventGross: number;
    /** Event gross − settled refunds. The headline event figure. */
    eventNet: number;
    activeMembers: number;
    newMembers: number;
  };
  membership: MembershipSummary;
  membershipTransactions: MembershipTxn[]; // per-row detail for the drill-down modal
  events: EventSummary;
  originators: OriginatorRevenue[];
  originatorTransactions: OriginatorTxn[]; // per-payment detail for the originator accordion
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

/**
 * Settled financial rows for the CSV export.
 *
 * Returns `complete: false` when any underlying read was truncated by an error. `fetchAll`
 * hands back the PARTIAL rows it managed to read in that case, so silently returning them
 * would emit a CSV that looks whole and understates refunds — the accountant's copy of the
 * exact defect this area was built to fix. The caller must refuse rather than serve it.
 */
export async function getFinanceTransactions(
  client: FinanceClient,
  from: string,
  to: string,
): Promise<{ rows: FinanceTransaction[]; complete: boolean }> {
  const range = rangeFromDates(from, to);

  const [pay, members, tiers, regs, events, items, evTickets] = await Promise.all([
    fetchAll<ExportPaymentRow>(
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
      "id, event_id, quantity, total_amount_chf, status, paid_at, created_at, name, email",
      "id",
    ),
    fetchAll<{ id: string; title: string }>(client, "events", "id, title", "id"),
    // The export reads the same ticket line ledger as the dashboard, so a
    // top-up cannot make the CSV disagree with the page it was exported from.
    fetchAll<EventItemRow>(
      client,
      "event_registration_items",
      "registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf",
      "id",
    ),
    // …and the same refund position, for the same reason.
    fetchAll<EventTicketRow & { name: string | null }>(
      client,
      "tickets",
      "registration_id, ticket_type_id, cancellation_status, refund_amount_chf, released_at, name",
      "id",
    ),
  ]);

  const eventItemTotalByReg = new Map<string, number>();
  for (const it of items.rows) {
    eventItemTotalByReg.set(
      it.registration_id,
      (eventItemTotalByReg.get(it.registration_id) ?? 0) + (it.line_total_chf ?? 0),
    );
  }

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

  const inRangePaidRegs = new Map<string, EventRegistrationRow & { name: string; email: string }>();
  for (const r of regs.rows) {
    if (!inRange(effectivePaidMs(r), range)) continue;
    if (r.status !== "paid" && r.status !== "free") continue;
    if (r.status === "paid") inRangePaidRegs.set(r.id, r);
    rows.push({
      type: "event",
      date: isoDate(r),
      party: r.name || r.email,
      detail: eventTitle.get(r.event_id) ?? "Unknown event",
      status: r.status,
      amountChf:
        r.status === "paid"
          ? round2(eventItemTotalByReg.get(r.id) ?? r.total_amount_chf ?? 0)
          : 0,
    });
  }

  // Refunds ride as their own negative rows rather than netting into the sale above, so the
  // CSV keeps both halves of the story — what was sold and what went back — while a naive
  // column sum still lands on event NET. Dated to the sale, matching how the dashboard files
  // a refund under the month it was earned.
  const itemsByRegForExport = new Map<string, EventItemRow[]>();
  for (const it of items.rows) {
    const list = itemsByRegForExport.get(it.registration_id) ?? [];
    list.push(it);
    itemsByRegForExport.set(it.registration_id, list);
  }
  // Clamped per booking, exactly as the dashboard does, so the promise above — that a naive
  // column sum lands on event NET — actually holds. Without it an over-marked booking makes the
  // CSV disagree with the page it was exported from, which is the failure this whole area exists
  // to prevent.
  const exportBudget = new Map<string, number>();
  for (const t of evTickets.rows) {
    if (t.cancellation_status !== "refunded" || !t.registration_id) continue;
    if (t.released_at) continue; // tombstone, not a live seat
    const reg = inRangePaidRegs.get(t.registration_id);
    if (!reg) continue;
    const lines = itemsByRegForExport.get(t.registration_id) ?? [];
    if (!exportBudget.has(reg.id)) {
      exportBudget.set(reg.id, eventItemTotalByReg.get(reg.id) ?? reg.total_amount_chf ?? 0);
    }
    const remaining = exportBudget.get(reg.id) ?? 0;
    if (remaining <= 0) continue;
    const amount = Math.min(refundedAmountChf(t, reg, lines), remaining);
    if (amount <= 0) continue;
    exportBudget.set(reg.id, remaining - amount);
    rows.push({
      type: "event",
      date: isoDate(reg),
      party: t.name || reg.name || reg.email,
      detail: eventTitle.get(reg.event_id) ?? "Unknown event",
      status: "refunded",
      amountChf: round2(-amount),
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const complete =
    pay.complete &&
    members.complete &&
    tiers.complete &&
    regs.complete &&
    events.complete &&
    items.complete &&
    evTickets.complete;
  return { rows, complete };
}

export async function getFinanceSummary(
  client: FinanceClient,
  from: string,
  to: string,
): Promise<FinanceSummary> {
  const range = rangeFromDates(from, to);

  const [pay, regs, items, evTickets, members, tiers, originators, referrals] = await Promise.all([
    fetchAll<MembershipPaymentRow>(
      client,
      "payments",
      "id, member_id, tier_id, amount_eur, payment_status, paid_at, created_at, stripe_payment_intent_id, stripe_checkout_session_id",
      "id",
    ),
    fetchAll<EventRegistrationRow>(
      client,
      "event_registrations",
      "id, event_id, quantity, total_amount_chf, status, paid_at, created_at",
      "id",
    ),
    fetchAll<EventItemRow>(
      client,
      "event_registration_items",
      "registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf",
      "id",
    ),
    // Cancelled seats, for the refund position. Read in full rather than filtered: `fetchAll`
    // is a plain paginated select, and at club scale one more table read costs less than a
    // bespoke filtered path that could drift from the aggregator's expectations.
    fetchAll<EventTicketRow>(
      client,
      "tickets",
      "registration_id, ticket_type_id, cancellation_status, refund_amount_chf, released_at",
      "id",
    ),
    fetchAll<MemberRow>(
      client,
      "members",
      "id, status, tier_id, originator_id, created_at, end_date, first_name, last_name, email",
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
  const memberNameById = new Map(
    members.rows.map((m) => [
      m.id,
      `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.email || m.id,
    ]),
  );

  const membership = aggregateMembership(pay.rows, tierNameById, range);
  const membershipTransactions = buildMembershipTransactions(
    pay.rows,
    memberNameById,
    range,
  );
  const events = aggregateEvents(regs.rows, items.rows, evTickets.rows, eventTitleById, range);
  const originatorBreakdown = aggregateOriginators(
    pay.rows,
    members.rows,
    referrals.rows,
    originatorNameById,
    range,
  );
  const originatorTransactions = buildOriginatorTransactions(
    pay.rows,
    members.rows,
    memberNameById,
    tierNameById,
    range,
  );
  const memberHealth = aggregateMemberHealth(members.rows, range);

  const complete =
    pay.complete &&
    regs.complete &&
    items.complete &&
    evTickets.complete &&
    members.complete &&
    tiers.complete &&
    originators.complete &&
    referrals.complete &&
    eventsRead.complete;

  return {
    range: { from, to },
    totals: {
      // Both streams net of refunds, so the headline is money kept rather than money touched.
      totalRevenue: round2(membership.net + events.net),
      membershipNet: membership.net,
      eventGross: events.gross,
      eventNet: events.net,
      activeMembers,
      newMembers: memberHealth.newMembers,
    },
    membership,
    membershipTransactions,
    events,
    originators: originatorBreakdown,
    originatorTransactions,
    memberHealth,
    complete,
  };
}
