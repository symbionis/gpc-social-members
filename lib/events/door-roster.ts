import type { createAdminClient } from "@/lib/supabase/admin";
import {
  ADMISSIBLE_SLOT_STATUSES,
  partitionByCancellation,
  admissibleTicketsForRegistration,
} from "@/lib/events/ticket-admissibility";
import { splitFullName, bySurname } from "@/lib/events/roster-sort";
// Re-exported so existing importers of the roster module keep working; the definitions
// now live in roster-sort.ts because the console and admin list need them client-side.
export { splitFullName, bySurname };

// The door roster: every ticket sold for an event, as one row each, in a single flat
// A–Z list by surname across the whole event — leads and named guests intermixed, so
// any named person can be found directly by their own surname. Backs the printed door sheet
// (app/(print)/print/door-roster/[id]). It once also backed an attendees CSV export, which
// no longer exists — the shape stays export-friendly, but there is only one consumer today.
//
// Which tickets count as admissible is NOT decided here — lib/events/ticket-admissibility.ts
// owns that rule, shared with the door console so the printed sheet and the live console can
// never disagree about who is arriving.
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
  /**
   * Non-null when this ticket belongs to a guest list (U5/U6): the list's id, its name and
   * its contact, carried on every row rather than looked up separately so a pure grouping
   * helper (rosterGuestListGroups below) can build sections from `rows` alone — the same
   * shape rosterTypeTotals already uses. A guest-list ticket has no registration (KD10), so
   * it always reaches the roster through the registration-less loop below, never through a
   * party.
   */
  guestListId: string | null;
  guestListName: string;
  guestListContact: string;
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

interface TicketRow {
  id: string;
  registration_id: string | null;
  guest_list_id: string | null;
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
  //
  // U6 / join-drop risk: this reads `tickets` directly with no join through
  // `registrations` or `event_registrations` at all — `registration_id` is carried as a
  // plain column and matched against `event_registrations` in memory below (see
  // `liveByReg`). A `registration_id IS NULL` row (a guest-list ticket, U5) is therefore
  // never dropped by this query; it is picked up by the "belongs to no registration" loop
  // near the bottom of this function. Confirmed by reading this clause — there is no
  // `.select("*, registrations(...)")` / foreign-table join anywhere in this file.
  const { data: ticketData, error: ticketsError } = await adminClient
    .from("tickets")
    .select(
      "id, registration_id, guest_list_id, member_id, name, email, phone_e164, is_lead, slot_status, ticket_type_id, cancellation_status, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", eventId)
    .in("slot_status", [...ADMISSIBLE_SLOT_STATUSES])
    .is("released_at", null)
    .order("created_at", { ascending: true });
  if (ticketsError) return fail("tickets", ticketsError);

  // Cancelled seats are excluded, not struck through: the door sheet and the admin roster
  // answer the same question — who is arriving — and must show the same people. A cancelled
  // seat is also rejected at the scan (lib/events/checkin.ts), so listing it only invited
  // someone to tick a line that cannot be admitted.
  //
  // Split here rather than in the query because the party loop below pads each booking up
  // to `registration.quantity`, and that quantity still counts cancelled seats. Filtering
  // in SQL alone put them straight back on the sheet as blank "to fill in" lines — and
  // re-materialised a fully refunded booking as a reconstructed lead row.
  const {
    live: tickets,
    cancelled: cancelledTickets,
    cancelledByRegistration,
  } = partitionByCancellation((ticketData || []) as unknown as TicketRow[]);

  // Bookings whose LEAD ticket was cancelled. The reconstruct-from-purchaser branch below
  // exists for a legacy party that never had ticket rows; without this it also fires when the
  // lead simply cancelled, rebuilding the refunded person from the registration as a named,
  // tickable line while their guest is still coming. That printed two lines for one seat, one
  // of them a person who had been refunded.
  const cancelledLeadRegistrations = new Set(
    cancelledTickets
      .filter((t) => t.is_lead && t.registration_id)
      .map((t) => t.registration_id as string)
  );

  const { data: typeRows, error: typeRowsError } = await adminClient
    .from("event_ticket_types")
    .select("id, title")
    .eq("event_id", eventId);
  if (typeRowsError) return fail("event_ticket_types", typeRowsError);
  const ticketTitleById = new Map<string, string>();
  for (const t of typeRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
  }

  // Guest-list names + contacts (U6). A lean, dedicated query rather than reusing
  // lib/events/guest-lists.ts's fetchGuestLists: that function re-reads `tickets` itself,
  // with no admissibility or cancellation filter, so a cancelled guest-list ticket would
  // ride back onto the door sheet through it. Only the list's own row (name, contact) is
  // needed here — the ticket data this function already has stays authoritative.
  const guestListIds = [
    ...new Set(tickets.map((t) => t.guest_list_id).filter((id): id is string => !!id)),
  ];
  const guestListById = new Map<string, { name: string; contact: string }>();
  if (guestListIds.length) {
    const { data: guestListRows, error: guestListsError } = await adminClient
      .from("event_guest_lists")
      .select("id, list_name, contact_name")
      .in("id", guestListIds);
    if (guestListsError) return fail("event_guest_lists", guestListsError);
    for (const l of guestListRows ?? []) {
      guestListById.set(l.id as string, {
        name: (l.list_name as string | null) ?? "",
        contact: (l.contact_name as string | null) ?? "",
      });
    }
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
  // A guest-list ticket is named by the admin at creation (lib/events/guest-lists.ts's
  // addGuestToList) and never goes through the self-registration claim flow — it is minted
  // `issued` and STAYS `issued` through check-in, because lib/events/checkin.ts only ever
  // sets `checked_in_at`, never `slot_status`. Treating "named" as isClaimed alone would
  // print every guest-list guest, before and after they arrive, as an anonymous blank
  // "to fill in" line — losing the name the sponsor actually gave. `guest_list_id` is the
  // signal that this `issued` row is not an unclaimed placeholder.
  const isNamed = (t: TicketRow) => isClaimed(t) || t.guest_list_id !== null;

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
    const guestList = t.guest_list_id ? guestListById.get(t.guest_list_id) : undefined;
    const base = {
      bookingRef,
      ticketType: typeTitle(t.ticket_type_id),
      partyLead,
      tickets: "",
      isLead: t.is_lead && isClaimed(t),
      guestListId: t.guest_list_id,
      guestListName: guestList?.name ?? "",
      guestListContact: guestList?.contact ?? "",
    };
    if (!isNamed(t)) {
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
    // Seats this booking can still bring through the door: what it bought, less what has
    // been cancelled. Using the raw quantity padded refunded seats back onto the sheet.
    const quantity = admissibleTicketsForRegistration(reg, cancelledByRegistration);
    const live = liveByReg.get(reg.id) ?? [];
    // Nothing left standing — a fully cancelled booking. Emit no rows at all: without this
    // the lead is rebuilt from the purchaser below and a refunded party prints as arrivable.
    if (quantity === 0 && live.length === 0) continue;
    const leadTicket = live.find((t) => t.is_lead && isClaimed(t)) ?? null;
    // Cancelled, not missing: do not rebuild this lead from the purchaser.
    const leadWasCancelled = cancelledLeadRegistrations.has(reg.id);

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

    // Null when the lead's own ticket was cancelled: the party still has live guests to
    // print, but the person who bought it is not coming and must not be given a line.
    let leadRow: RosterRow | null = null;
    if (leadTicket) {
      leadRow = {
        ...rowFromTicket(leadTicket, bookingRef, "lead"),
        tickets: String(quantity),
      };
    } else if (!leadWasCancelled) {
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
        // A reconstructed lead comes from a registration, never a guest list — a
        // guest-list ticket has no registration to reconstruct from (KD10).
        guestListId: null,
        guestListName: "",
        guestListContact: "",
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
    const emitted = live.length + (leadRow && !leadTicket ? 1 : 0);
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
      // Padding fills a registration's unminted seats — a guest-list ticket is always
      // individually minted (KD10) and never counted in a registration's quantity, so it
      // is never a source of padding.
      guestListId: null,
      guestListName: "",
      guestListContact: "",
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

    // With a cancelled lead there is no lead row, so the party size rides on its first
    // remaining line — otherwise the booking prints with no indication of how many it holds.
    const partyRows = [...namedGuests, ...unnamedGuests, ...padded];
    if (!leadRow && partyRows.length > 0) {
      partyRows[0] = { ...partyRows[0], tickets: String(quantity) };
    }
    rows.push(...(leadRow ? [leadRow] : []), ...partyRows);
  }

  // Tickets that belong to no registration: ops/bulk-imported rows, and — since U5/U6 —
  // guest-list guests (KD10: a guest-list ticket is minted with `registration_id: null`
  // and never gets one). Each files under its own surname among everyone else — not at the
  // end — because rowFromTicket now treats a guest-list ticket as named (see isNamed).
  // Grouping them by list, for staff working a sponsor's list as a unit, is a presentation
  // concern layered on top via rosterGuestListGroups below, not a change to this flat list.
  for (const t of tickets) {
    if (t.registration_id) continue;
    rows.push(rowFromTicket(t, "", ""));
  }

  // One global A–Z sort produces the whole flat list; the extended `bySurname` keeps
  // named one-word names ahead of the blank fill-in lines (see its comment).
  rows.sort(bySurname);

  return { status: "ok", event, rows };
}

export interface GuestListRosterGroup {
  id: string;
  name: string;
  contactName: string;
  rows: RosterRow[];
}

/**
 * Guest-list rows (U6), grouped under their list and sorted within it by the same
 * `bySurname` comparator the flat sheet uses — so a sponsor's list reads as one findable
 * unit ("Cardis brought 12, here they are") instead of scattered blank-bookingRef entries
 * through the A–Z sheet. Lists are ordered by name; a `rows` with no guest-list tickets
 * returns an empty array, so a caller that ignores this on an event with no guest lists
 * sees no change at all.
 */
export function rosterGuestListGroups(rows: RosterRow[]): GuestListRosterGroup[] {
  const byList = new Map<string, RosterRow[]>();
  for (const row of rows) {
    if (!row.guestListId) continue;
    const list = byList.get(row.guestListId) ?? [];
    list.push(row);
    byList.set(row.guestListId, list);
  }
  return [...byList.entries()]
    .map(([id, groupRows]) => ({
      id,
      name: groupRows[0].guestListName,
      contactName: groupRows[0].guestListContact,
      rows: groupRows.slice().sort(bySurname),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every ticket type on the sheet with its count — the catering line, in roster order. */
export function rosterTypeTotals(rows: RosterRow[]): Array<{ title: string; qty: number }> {
  const byTitle = new Map<string, number>();
  for (const r of rows) {
    const title = r.ticketType.trim();
    if (!title) continue;
    byTitle.set(title, (byTitle.get(title) ?? 0) + 1);
  }
  return [...byTitle.entries()]
    .map(([title, qty]) => ({ title, qty }))
    .sort((a, b) => b.qty - a.qty || a.title.localeCompare(b.title));
}
