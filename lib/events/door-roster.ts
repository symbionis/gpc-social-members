import type { createAdminClient } from "@/lib/supabase/admin";

// The door roster: every ticket sold for an event, as one row each, in a single flat
// A–Z list by surname across the whole event — leads and named guests intermixed, so
// any named person can be found directly by their own surname. Shared by the CSV export
// (app/api/admin/events/[id]/attendees) and the printed door sheet
// (app/(print)/print/door-roster/[id]) so the two surfaces can never drift — the
// printed page and the spreadsheet must list the same people in the same order.
//
// A row exists for a ticket whether or not anyone has been named on it: tickets are
// minted `issued` (carrying their own ticket type and QR credential) and flipped to
// `claimed` when someone self-registers. An unnamed ticket still has to be a line on
// the sheet, because staff at the door cannot tick off a person who has no line. Rows
// with no surname to sort on (the unnamed/padded lines) trail at the end, grouped by
// booking ref; the printed sheet fences them off under a "To fill in" divider.

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RosterRow {
  bookingRef: string;
  last: string;
  first: string;
  ticketType: string;
  email: string;
  phone: string;
  /** "yes" | "no" | "" — blank when there is no person to make the claim about. */
  isMember: string;
  /** "lead" | "guest of <name>" | "" (an ops-imported attendee belongs to no party). */
  partyLead: string;
  /** The party's purchased quantity. Set on the lead row only. */
  tickets: string;
  /** "signed" | "unsigned" | "" */
  waiver: string;
  /** "yes" | "no" | "" */
  arrived: string;
  /** Presentation flags — the CSV ignores these; the printed sheet leans on them. */
  isLead: boolean;
  /** False when nobody has been named on this ticket: print a blank line to write on. */
  named: boolean;
  /** A holder-cancelled ticket (U14) — do not admit. Struck on the sheet, tagged in the CSV. */
  cancelled: boolean;
}

export interface RosterEvent {
  id: string;
  title: string;
  start_date: string | null;
}

export type DoorRosterResult =
  | { status: "ok"; event: RosterEvent; rows: RosterRow[] }
  | { status: "not_found" }
  | { status: "error"; scope: string; error: unknown };

// Heuristic split of a single "Full name" string for non-members: the last
// whitespace-separated token is the last name, everything before it the first
// name(s). One token → all first name. Members use their authoritative split.
export function splitFullName(name: string | null): { first: string; last: string } {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// Surname sort, case- and accent-aware (Ärnström, Öberg file where a Swiss reader
// expects them). A row with no surname to sort on goes last, rather than silently
// landing at the top of the sheet under an empty string.
//
// Within the surname-less tail, a genuinely *named* row (a one-word name like
// "Madonna": last === "", named === true) must outrank the blank unnamed lines, so it
// never sinks below the "To fill in" divider and gets read as an unfilled slot. Named
// one-word names therefore sort ahead of the true blanks; the blanks then order by
// booking ref, clustering a booking's fill-in lines together at the very end.
export function bySurname(
  a: { last: string; first: string; bookingRef: string; named?: boolean },
  b: { last: string; first: string; bookingRef: string; named?: boolean }
): number {
  if (!a.last !== !b.last) return a.last ? -1 : 1;
  if (!a.last && !b.last && a.named !== b.named) return a.named ? -1 : 1;
  const last = a.last.localeCompare(b.last, undefined, { sensitivity: "base" });
  if (last !== 0) return last;
  const first = a.first.localeCompare(b.first, undefined, { sensitivity: "base" });
  if (first !== 0) return first;
  return a.bookingRef.localeCompare(b.bookingRef);
}

interface TicketRow {
  id: string;
  registration_id: string | null;
  member_id: string | null;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  is_lead: boolean;
  slot_status: string;
  ticket_type_id: string | null;
  cancellation_status: string | null;
  waiver_accepted_at: string | null;
  checked_in_at: string | null;
  created_at: string;
}

interface RegRow {
  id: string;
  quantity: number | null;
  reference_code: string | null;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  member_id: string | null;
}

interface ItemRow {
  registration_id: string;
  ticket_type_id: string | null;
  title_snapshot: string | null;
  quantity: number | null;
}

export async function buildDoorRoster(
  adminClient: AdminClient,
  eventId: string
): Promise<DoorRosterResult> {
  const fail = (scope: string, error: unknown): DoorRosterResult => {
    console.error("[door-roster] query failed", { eventId, scope, err: error });
    return { status: "error", scope, error };
  };

  const { data: eventRow } = await adminClient
    .from("events")
    .select("id, title, start_date")
    .eq("id", eventId)
    .single();

  if (!eventRow) return { status: "not_found" };
  const event = eventRow as unknown as RosterEvent;

  // Every ticket sold, claimed or not. An `issued` row is a ticket nobody has named
  // yet — it carries its ticket type and its party, just no person — so it is exactly
  // the blank check-off line door staff need, and must NOT be filtered out.
  //
  // The filter is an allowlist, not a negation of 'claimed': tickets_slot_status_check
  // still permits the legacy 'unclaimed' value, and on a sheet that governs door
  // admission an unrecognized status must fall OFF the roster, never onto it as an
  // anonymous tickable line. `credential_token` is deliberately not selected — it is a
  // bearer QR token, and a printed sheet of them would admit anyone who photographs it.
  const { data: ticketData, error: ticketsError } = await adminClient
    .from("tickets")
    .select(
      "id, registration_id, member_id, name, email, phone_e164, is_lead, slot_status, ticket_type_id, cancellation_status, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", eventId)
    .in("slot_status", ["issued", "claimed"])
    .is("released_at", null)
    .order("created_at", { ascending: true });
  if (ticketsError) return fail("tickets", ticketsError);
  const tickets = (ticketData || []) as unknown as TicketRow[];

  const { data: typeRows, error: typeRowsError } = await adminClient
    .from("event_ticket_types")
    .select("id, title")
    .eq("event_id", eventId);
  if (typeRowsError) return fail("event_ticket_types", typeRowsError);
  const ticketTitleById = new Map<string, string>();
  for (const t of typeRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
  }

  // The purchase record. `quantity` is how many tickets the party owns — the number of
  // lines it must occupy on the sheet. `name`/`email`/`phone_e164`/`member_id` are the
  // purchaser, which is how a legacy party with no ticket rows still gets a real lead.
  const { data: regData, error: regRowsError } = await adminClient
    .from("event_registrations")
    .select("id, quantity, reference_code, name, email, phone_e164, member_id")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  if (regRowsError) return fail("event_registrations", regRowsError);
  const regs = (regData || []) as unknown as RegRow[];
  const registrationIds = regs.map((r) => r.id);

  // Per-ticket-type purchased quantities. These label the padded lines: a party that
  // bought 3 × Standard + 1 × Vegetarian and has only its Standard lead claimed pads
  // 2 × Standard and 1 × Vegetarian. That is arithmetic on the purchase record, not a
  // guess — and without it the per-type pivot that replaced the old TOTALS block would
  // undercount by exactly the padded tickets.
  const { data: itemData, error: itemRowsError } = registrationIds.length
    ? await adminClient
        .from("event_registration_items")
        .select("registration_id, ticket_type_id, title_snapshot, quantity")
        .in("registration_id", registrationIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (itemRowsError) return fail("event_registration_items", itemRowsError);

  const itemsByReg = new Map<string, ItemRow[]>();
  for (const item of (itemData ?? []) as unknown as ItemRow[]) {
    const list = itemsByReg.get(item.registration_id) ?? [];
    list.push(item);
    itemsByReg.set(item.registration_id, list);
  }

  // Authoritative first/last for members. Tickets and registrations both store only a
  // single `name` string; the members table is the real split.
  const memberIds = [
    ...new Set(
      [...tickets.map((t) => t.member_id), ...regs.map((r) => r.member_id)].filter(
        (m): m is string => !!m
      )
    ),
  ];
  const memberNameById = new Map<string, { first: string; last: string }>();
  if (memberIds.length) {
    const { data: memberRows, error: memberRowsError } = await adminClient
      .from("members")
      .select("id, first_name, last_name")
      .in("id", memberIds);
    if (memberRowsError) return fail("members", memberRowsError);
    for (const m of memberRows ?? []) {
      memberNameById.set(m.id as string, {
        first: (m.first_name as string | null) ?? "",
        last: (m.last_name as string | null) ?? "",
      });
    }
  }

  const nameOf = (memberId: string | null, name: string | null) =>
    (memberId && memberNameById.get(memberId)) || splitFullName(name);
  const typeTitle = (id: string | null) => (id ? ticketTitleById.get(id) ?? "" : "");
  const isClaimed = (t: TicketRow) => t.slot_status === "claimed";

  const liveByReg = new Map<string, TicketRow[]>();
  for (const t of tickets) {
    if (!t.registration_id) continue;
    const list = liveByReg.get(t.registration_id) ?? [];
    list.push(t);
    liveByReg.set(t.registration_id, list);
  }

  // A claimed ticket prints the person as recorded. An unclaimed one prints its ticket
  // type and its party, and leaves every person-cell blank — we do not assert "no" or
  // "unsigned" about someone who has not been named.
  const rowFromTicket = (
    t: TicketRow,
    bookingRef: string,
    partyLead: string
  ): RosterRow => {
    const base = {
      bookingRef,
      ticketType: typeTitle(t.ticket_type_id),
      partyLead,
      tickets: "",
      isLead: t.is_lead && isClaimed(t),
      cancelled: t.cancellation_status != null,
    };
    if (!isClaimed(t)) {
      return {
        ...base,
        last: "",
        first: "",
        email: "",
        phone: "",
        isMember: "",
        waiver: "",
        arrived: "",
        named: false,
      };
    }
    const { first, last } = nameOf(t.member_id, t.name);
    return {
      ...base,
      last,
      first,
      email: t.email ?? "",
      phone: t.phone_e164 ?? "",
      isMember: t.member_id ? "yes" : "no",
      waiver: t.waiver_accepted_at ? "signed" : "unsigned",
      arrived: t.checked_in_at ? "yes" : "no",
      named: true,
    };
  };

  const today = new Date().toISOString().slice(0, 10);
  const rows: RosterRow[] = [];

  for (const reg of regs) {
    const bookingRef = reg.reference_code ?? "";
    const quantity = reg.quantity ?? 0;
    const live = liveByReg.get(reg.id) ?? [];
    const leadTicket = live.find((t) => t.is_lead && isClaimed(t)) ?? null;

    // Who the guests are a `guest of`: the claimed lead when there is one, else the
    // purchaser on the registration. So this is never a dangling "guest of ", even on
    // a party with no ticket rows at all.
    const leadDisplayName = (leadTicket?.name ?? reg.name ?? "").trim();
    const guestOf = leadDisplayName ? `guest of ${leadDisplayName}` : "";

    // The type slots this party owns that no live ticket row accounts for, expanded in
    // purchase order. Drained by the reconstructed lead and the padded guests below.
    const unaccounted = new Map<string, number>();
    for (const t of live) {
      if (!t.ticket_type_id) continue;
      unaccounted.set(t.ticket_type_id, (unaccounted.get(t.ticket_type_id) ?? 0) + 1);
    }
    const typePool: string[] = [];
    for (const item of itemsByReg.get(reg.id) ?? []) {
      const id = item.ticket_type_id;
      const purchased = item.quantity ?? 0;
      const covered = id ? Math.min(unaccounted.get(id) ?? 0, purchased) : 0;
      if (id) unaccounted.set(id, (unaccounted.get(id) ?? 0) - covered);
      const title = id ? typeTitle(id) : (item.title_snapshot ?? "").trim();
      for (let i = 0; i < purchased - covered; i++) typePool.push(title);
    }
    const nextType = () => typePool.shift() ?? "";

    let leadRow: RosterRow;
    if (leadTicket) {
      leadRow = {
        ...rowFromTicket(leadTicket, bookingRef, "lead"),
        tickets: String(quantity),
      };
    } else {
      // No claimed lead ticket. Rebuild the lead from the purchaser: a legacy party,
      // minted before ticket rows existed, still knows who bought it — so the party is
      // never anonymous or unsortable. waiver/arrived stay blank: there is no ticket
      // row to read them from, and the sheet should not claim they are unsigned.
      const { first, last } = nameOf(reg.member_id, reg.name);
      leadRow = {
        bookingRef,
        last,
        first,
        ticketType: nextType(),
        email: reg.email ?? "",
        phone: reg.phone_e164 ?? "",
        isMember: reg.member_id ? "yes" : "no",
        partyLead: "lead",
        tickets: String(quantity),
        waiver: "",
        arrived: "",
        isLead: true,
        named: Boolean(last || first),
        cancelled: false,
      };
    }

    const guestTickets = live.filter((t) => t !== leadTicket);
    // No local sort: every row is sorted globally into one flat A–Z list below, so a
    // per-party sort here would only be immediately undone.
    const namedGuests = guestTickets
      .filter(isClaimed)
      .map((t) => rowFromTicket(t, bookingRef, guestOf));
    const unnamedGuests = guestTickets
      .filter((t) => !isClaimed(t))
      .map((t) => rowFromTicket(t, bookingRef, guestOf));

    // Pad up to the tickets actually sold. `live.length` already counts the claimed
    // lead when there is one; a reconstructed lead occupies one of the party's lines
    // too. A party whose live rows exceed its quantity pads by zero and is never
    // truncated — losing a real ticket is worse than an over-long party block.
    const emitted = live.length + (leadTicket ? 0 : 1);
    const padCount = Math.max(0, quantity - emitted);
    const padded: RosterRow[] = Array.from({ length: padCount }, () => ({
      bookingRef,
      last: "",
      first: "",
      ticketType: nextType(),
      email: "",
      phone: "",
      isMember: "",
      partyLead: guestOf,
      tickets: "",
      waiver: "",
      arrived: "",
      isLead: false,
      named: false,
      cancelled: false,
    }));

    // On a current-generation event, minting should have produced these rows. Padding
    // on a future event means real ticket rows are missing: the sheet stays correct,
    // but the data underneath it does not, so say so rather than paper over it.
    if (padCount > 0 && event.start_date && event.start_date >= today) {
      console.warn("[door-roster] padded a party on a future event", {
        eventId,
        registrationId: reg.id,
        quantity,
        liveRows: live.length,
        padded: padCount,
      });
    }

    rows.push(leadRow, ...namedGuests, ...unnamedGuests, ...padded);
  }

  // Ops/bulk-imported tickets belong to no registration. Each files under its own
  // surname among everyone else — not at the end.
  for (const t of tickets) {
    if (t.registration_id) continue;
    rows.push(rowFromTicket(t, "", ""));
  }

  // One global A–Z sort produces the whole flat list; the extended `bySurname` keeps
  // named one-word names ahead of the blank fill-in lines (see its comment).
  rows.sort(bySurname);

  return { status: "ok", event, rows };
}

/** Every ticket type on the sheet with its count — the catering line, in roster order. */
export function rosterTypeTotals(rows: RosterRow[]): Array<{ title: string; qty: number }> {
  const byTitle = new Map<string, number>();
  for (const r of rows) {
    // A cancelled ticket isn't attending — don't cater for it.
    if (r.cancelled) continue;
    const title = r.ticketType.trim();
    if (!title) continue;
    byTitle.set(title, (byTitle.get(title) ?? 0) + 1);
  }
  return [...byTitle.entries()]
    .map(([title, qty]) => ({ title, qty }))
    .sort((a, b) => b.qty - a.qty || a.title.localeCompare(b.title));
}
