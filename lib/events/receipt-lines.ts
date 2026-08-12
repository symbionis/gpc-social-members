// Shared receipt-line rendering (R23). Turns a booking's item-lines table into displayable
// receipt lines — type title, quantity, unit total and line total — for reuse by BOTH the
// receipt email (U4) and the receipt page (U6). Pure and DB-agnostic: callers fetch the rows,
// this module only formats/scopes them.
//
// KTD3: `event_registration_items` accumulates rows across the original checkout AND every
// later buy-more, so rendering "the whole table" per receipt would merge multiple payments
// into one list (or double-count). A buy-more's receipt renders its own contributed rows
// directly (the top-up's own `items` snapshot — see lib/email/event-registration.ts). The
// ORIGINAL payment's receipt is what's left after every later buy-more's contribution is
// subtracted back out, grouped by ticket type — that's what subtractReceiptItems is for.

export interface ReceiptItemRow {
  /** Ticket-type identity — the aggregation/subtraction key. */
  ticketTypeId: string;
  title: string;
  quantity: number;
  unitAmountChf: number;
  lineTotalChf: number;
}

export interface ReceiptLine {
  title: string;
  quantity: number;
  /** Formatted per-unit price, e.g. "CHF 30.00" or "Free". */
  unitLabel: string;
  /** Formatted line total, e.g. "CHF 60.00" or "Free". */
  lineLabel: string;
}

function priceLabel(chf: number): string {
  return chf === 0 ? "Free" : `CHF ${chf.toFixed(2)}`;
}

/** Shape of a raw `event_registration_items`/topup `items` row, as read by both the receipt
 *  email (U4) and the receipt page (U6) — kept here so both share one mapping. */
export interface RawReceiptItem {
  ticket_type_id: string | null;
  title_snapshot: string;
  quantity: number;
  unit_amount_chf: number | string;
  line_total_chf: number | string;
}

/** Map a raw item row into a ReceiptItemRow. Legacy/itemless rows can lack a type id; fall
 *  back to a key derived from the title so same-titled legacy rows still aggregate together
 *  rather than each standing alone. */
export function toReceiptItemRow(item: RawReceiptItem, fallbackKey: string): ReceiptItemRow {
  return {
    ticketTypeId: item.ticket_type_id ?? `${fallbackKey}:${item.title_snapshot}`,
    title: item.title_snapshot,
    quantity: item.quantity,
    unitAmountChf: Number(item.unit_amount_chf),
    lineTotalChf: Number(item.line_total_chf),
  };
}

/** Format item rows into displayable receipt lines (no scoping — callers pass already-scoped rows). */
export function buildReceiptLines(items: ReceiptItemRow[]): ReceiptLine[] {
  return items.map((item) => ({
    title: item.title,
    quantity: item.quantity,
    unitLabel: priceLabel(item.unitAmountChf),
    lineLabel: priceLabel(item.lineTotalChf),
  }));
}

/**
 * Scope a booking's full item-lines table down to ONE payment's contribution (KTD3): the
 * ORIGINAL payment's rows are `all` minus every later buy-more's `contributed` rows, matched
 * and summed per ticket type. A type whose contributed quantity fully covers (or exceeds) its
 * row in `all` is dropped entirely from the result — never emitted with a negative or zero
 * quantity.
 */
export function subtractReceiptItems(
  all: ReceiptItemRow[],
  contributed: ReceiptItemRow[][]
): ReceiptItemRow[] {
  const totals = new Map<string, ReceiptItemRow>();
  for (const row of all) {
    const existing = totals.get(row.ticketTypeId);
    if (existing) {
      existing.quantity += row.quantity;
      existing.lineTotalChf = Number((existing.lineTotalChf + row.lineTotalChf).toFixed(2));
    } else {
      totals.set(row.ticketTypeId, { ...row });
    }
  }

  const subtract = new Map<string, number>();
  for (const group of contributed) {
    for (const row of group) {
      subtract.set(row.ticketTypeId, (subtract.get(row.ticketTypeId) ?? 0) + row.quantity);
    }
  }

  const result: ReceiptItemRow[] = [];
  for (const row of totals.values()) {
    const remaining = row.quantity - (subtract.get(row.ticketTypeId) ?? 0);
    if (remaining <= 0) continue;
    result.push({
      ticketTypeId: row.ticketTypeId,
      title: row.title,
      quantity: remaining,
      unitAmountChf: row.unitAmountChf,
      lineTotalChf: Number((row.unitAmountChf * remaining).toFixed(2)),
    });
  }
  return result;
}
