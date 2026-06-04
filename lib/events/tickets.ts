// Ticket-breakdown helpers shared by the admin roster list and the CSV export so
// the two surfaces can never drift. A party's tickets are recorded as one or more
// event_registration_items rows (one per ticket type, with a title_snapshot taken
// at purchase time); the per-lead total lives on event_registrations.quantity.

export interface TicketTypeLine {
  title: string;
  qty: number;
}

type RawTicketItem = {
  title_snapshot?: string | null;
  quantity?: number | null;
};

/**
 * Roll raw registration items up into ordered lines, summed by ticket-type title
 * (insertion order preserved, so the breakdown follows purchase order). Blank
 * snapshots fall back to "Ticket"; missing quantities count as 0.
 */
export function rollupTicketItems(items: RawTicketItem[]): TicketTypeLine[] {
  const byTitle = new Map<string, number>();
  for (const item of items) {
    const title = (item.title_snapshot ?? "").trim() || "Ticket";
    byTitle.set(title, (byTitle.get(title) ?? 0) + (item.quantity ?? 0));
  }
  return [...byTitle.entries()].map(([title, qty]) => ({ title, qty }));
}

/** "9 × Asado Standard, 1 × Asado Vegetarian" — empty string when there are no lines. */
export function formatTicketBreakdown(lines: TicketTypeLine[]): string {
  return lines.map((l) => `${l.qty} × ${l.title}`).join(", ");
}
