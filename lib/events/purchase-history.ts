import { createAdminClient } from "@/lib/supabase/admin";
import { buildReceiptLines, subtractReceiptItems, type ReceiptItemRow, type ReceiptLine } from "@/lib/events/receipt-lines";
import { refundedAmountChf, type RefundItemLine } from "@/lib/events/refunds";

// The payer's full purchase history (U6, R22-R25). A manage_token opens a single ticket's
// manage page; this module resolves that token to the PAYER behind it and lists every
// booking they've paid for across every event, newest first.
//
// KTD4 (the access-control decision, load-bearing): the token's own ticket must carry
// `is_lead` — the flag seeded once at checkout for the purchaser's own attendee row (see
// supabase/migrations/20260603121000_event_registrations_phone_and_lead_seed.sql) — and is
// writable by neither the holder's own-ticket edit route nor the door. Gating on the
// registration's `email` field instead would be unsafe: R1 lets ANY holder rewrite their own
// ticket's name/email, so a non-payer could edit their address to match the payer's and read
// the payer's spend. `is_lead` cannot be forged that way, so it — and only it — is the gate.
//
// Same case-fold convention as lib/email/cancellation-notice.ts and lib/events/household.ts:
// trim + lowercase.
function normalize(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

interface RawItem {
  ticket_type_id: string | null;
  title_snapshot: string;
  quantity: number;
  unit_amount_chf: number;
  line_total_chf: number;
}

function toRow(item: RawItem, fallbackKey: string): ReceiptItemRow {
  return {
    // Legacy/itemless rows can lack a type id; fall back to a key derived from the title so
    // same-titled legacy rows still aggregate together rather than each standing alone.
    ticketTypeId: item.ticket_type_id ?? `${fallbackKey}:${item.title_snapshot}`,
    title: item.title_snapshot,
    quantity: item.quantity,
    unitAmountChf: Number(item.unit_amount_chf),
    lineTotalChf: Number(item.line_total_chf),
  };
}

export interface ReceiptPayment {
  /** "original" or the topup's own id — stable React key, not shown to the user. */
  id: string;
  paidAtIso: string | null;
  /** Stripe PaymentIntent id (KTD3's per-payment scoping key), or null for a comp/free row. */
  chargeReference: string | null;
  lines: ReceiptLine[];
  totalChf: number;
  refunded: boolean;
  /** CHF actually returned against this booking. Only ever attached to the ORIGINAL payment
   *  row — see the comment above `refundedForBooking` for why a topup can't carry its own. */
  refundedChf: number;
}

export interface ReceiptBooking {
  registrationId: string;
  eventId: string;
  eventTitle: string;
  eventStartDate: string;
  referenceCode: string;
  payments: ReceiptPayment[];
}

export interface PurchaseHistory {
  bookings: ReceiptBooking[];
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Total CHF refunded against a registration's cancelled seats.
 *
 * Refunds are recorded per TICKET (tickets.cancellation_status/refund_amount_chf), not per
 * payment: lib/events/refund-pool.ts draws a refund across a booking's whole pool of charges
 * (the original checkout plus every top-up), because tickets carry no reference to which
 * charge minted them — "the booking is the unit of money" is the explicit design already in
 * this codebase (see refund-pool.ts's own header comment). So a per-payment "was THIS charge
 * refunded" question has no true answer; this mirrors that same booking-level treatment and
 * attaches the booking's total settled refund to the ORIGINAL payment entry only, rather than
 * guessing which charge it came off. Same accepted-limitation shape as U4's conversion gap.
 */
async function refundedForBooking(
  supabase: AdminClient,
  registrationId: string,
  registration: { id: string; status: string | null; quantity: number | null; total_amount_chf: number | string | null },
  items: readonly RefundItemLine[]
): Promise<number> {
  const { data: refundedTickets, error } = await supabase
    .from("tickets")
    .select("registration_id, ticket_type_id, is_comp, refund_amount_chf")
    .eq("registration_id", registrationId)
    .eq("cancellation_status", "refunded");
  if (error) {
    console.error("[purchase-history] refunded-tickets lookup failed", { registrationId, err: error });
    return 0;
  }
  let total = 0;
  for (const t of refundedTickets ?? []) {
    total += refundedAmountChf(
      t as { registration_id: string | null; ticket_type_id: string | null; is_comp?: boolean | null; refund_amount_chf?: number | string | null },
      registration,
      items
    );
  }
  return Number(total.toFixed(2));
}

/**
 * Build one registration's payment entries: the original checkout (scoped to what IT bought,
 * KTD3 via subtractReceiptItems) plus each applied top-up, chronological (original first).
 */
async function buildPayments(
  supabase: AdminClient,
  registration: {
    id: string;
    status: string | null;
    quantity: number | null;
    total_amount_chf: number | string | null;
    paid_at: string | null;
    created_at: string;
    stripe_payment_intent_id: string | null;
  }
): Promise<ReceiptPayment[]> {
  const { data: items, error: itemsErr } = await supabase
    .from("event_registration_items")
    .select("ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf")
    .eq("registration_id", registration.id)
    .order("created_at", { ascending: true });
  if (itemsErr) {
    console.error("[purchase-history] items lookup failed", { registrationId: registration.id, err: itemsErr });
  }

  const { data: topups, error: topupsErr } = await supabase
    .from("event_registration_topups")
    .select("id, items, applied_at, stripe_payment_intent_id, status")
    .eq("registration_id", registration.id)
    .eq("status", "applied");
  if (topupsErr) {
    console.error("[purchase-history] topups lookup failed", { registrationId: registration.id, err: topupsErr });
  }

  const allRows: ReceiptItemRow[] = (items ?? []).map((i) => toRow(i as RawItem, "orig"));
  const appliedTopups = (topups ?? []) as {
    id: string;
    items: RawItem[] | null;
    applied_at: string | null;
    stripe_payment_intent_id: string | null;
  }[];
  const contributed: ReceiptItemRow[][] = appliedTopups.map((t) => (t.items ?? []).map((i) => toRow(i, "orig")));

  let originalItems = allRows.length > 0 ? subtractReceiptItems(allRows, contributed) : [];
  let originalTotal: number;
  if (originalItems.length > 0) {
    originalTotal = Number(originalItems.reduce((s, r) => s + r.lineTotalChf, 0).toFixed(2));
  } else {
    // Itemless fallback (legacy rows, or a comp/free booking with nothing in the items
    // table): synthesize one line so the receipt is never blank, same as U4's email sender.
    originalTotal = Number(registration.total_amount_chf ?? 0);
    const qty = registration.quantity ?? 0;
    originalItems =
      originalTotal > 0 || qty > 0
        ? [
            {
              ticketTypeId: "fallback",
              title: "Registration",
              quantity: qty,
              unitAmountChf: qty ? originalTotal / qty : originalTotal,
              lineTotalChf: originalTotal,
            },
          ]
        : [];
  }

  const refundLines: RefundItemLine[] = (items ?? []).map((i) => ({
    registration_id: registration.id,
    ticket_type_id: (i as RawItem).ticket_type_id,
    unit_amount_chf: (i as RawItem).unit_amount_chf,
  }));
  const refundedChf = await refundedForBooking(supabase, registration.id, registration, refundLines);

  const payments: ReceiptPayment[] = [
    {
      id: "original",
      paidAtIso: registration.paid_at ?? registration.created_at,
      chargeReference: registration.stripe_payment_intent_id ?? null,
      lines: buildReceiptLines(originalItems),
      totalChf: originalTotal,
      refunded: refundedChf > 0,
      refundedChf,
    },
  ];

  for (const topup of appliedTopups) {
    const rows = (topup.items ?? []).map((i) => toRow(i, topup.id));
    const total = Number(rows.reduce((s, r) => s + r.lineTotalChf, 0).toFixed(2));
    payments.push({
      id: topup.id,
      paidAtIso: topup.applied_at,
      chargeReference: topup.stripe_payment_intent_id ?? null,
      lines: buildReceiptLines(rows),
      totalChf: total,
      refunded: false,
      refundedChf: 0,
    });
  }

  return payments;
}

/**
 * Resolve the full purchase history behind a manage_token, or null when the token is
 * unknown/rotated, or its ticket is not the payer's own (KTD4 — see the module header).
 */
export async function resolvePurchaseHistory(token: string): Promise<PurchaseHistory | null> {
  if (!token) return null;
  const supabase = createAdminClient();

  // KTD4: the access-control gate. Deliberately reads `is_lead` off the token's OWN ticket
  // row — never the registration's email — so rewriting a ticket's address can't forge
  // access. See module header.
  const { data: self } = await supabase
    .from("tickets")
    .select("id, registration_id, is_lead")
    .eq("manage_token", token)
    .is("released_at", null)
    .maybeSingle();
  if (!self || !self.is_lead || !self.registration_id) return null;

  const { data: selfReg } = await supabase
    .from("event_registrations")
    .select("email")
    .eq("id", self.registration_id as string)
    .maybeSingle();
  const payerEmail = normalize(selfReg?.email as string | null | undefined);
  if (!payerEmail) return null;

  // Every settled registration (paid or free) across ALL events at this address —
  // case-folded/trimmed, same convention as lib/email/cancellation-notice.ts. Matched in JS
  // rather than a DB ilike so the case-fold rule stays the one used everywhere else in this
  // repo (mirrors household.ts's sibling match).
  const { data: regRows, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, event_id, email, status, quantity, total_amount_chf, reference_code, paid_at, created_at, stripe_payment_intent_id")
    .in("status", ["paid", "free"]);
  if (regErr) {
    console.error("[purchase-history] registrations lookup failed", { err: regErr });
    return { bookings: [] };
  }

  const matches = (regRows ?? []).filter((r) => normalize(r.email as string | null) === payerEmail);
  if (matches.length === 0) return { bookings: [] };

  const eventIds = [...new Set(matches.map((r) => r.event_id as string))];
  const { data: eventRows } = await supabase
    .from("events")
    .select("id, title, start_date")
    .in("id", eventIds);
  const eventById = new Map((eventRows ?? []).map((e) => [e.id as string, e]));

  // Newest first (AE11): by paid_at when the booking has one, else created_at — a free/comp
  // booking is never paid_at-stamped, so it would otherwise sort as if it happened at epoch.
  const ordered = matches
    .slice()
    .sort((a, b) => {
      const ta = (a.paid_at as string | null) ?? (a.created_at as string);
      const tb = (b.paid_at as string | null) ?? (b.created_at as string);
      return tb.localeCompare(ta);
    });

  const bookings: ReceiptBooking[] = [];
  for (const reg of ordered) {
    const event = eventById.get(reg.event_id as string);
    const payments = await buildPayments(supabase, {
      id: reg.id as string,
      status: reg.status as string | null,
      quantity: reg.quantity as number | null,
      total_amount_chf: reg.total_amount_chf as number | string | null,
      paid_at: reg.paid_at as string | null,
      created_at: reg.created_at as string,
      stripe_payment_intent_id: reg.stripe_payment_intent_id as string | null,
    });
    bookings.push({
      registrationId: reg.id as string,
      eventId: reg.event_id as string,
      eventTitle: (event?.title as string | null) ?? "",
      eventStartDate: (event?.start_date as string | null) ?? "",
      referenceCode: (reg.reference_code as string | null) ?? "",
      payments,
    });
  }

  return { bookings };
}
