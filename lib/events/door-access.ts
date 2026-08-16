// Door console access (U4). The console is a public, per-event surface keyed on
// the event id (KTD1 — no secret token, no login): anyone with the public event
// link can open it. The single gate is "the event exists and is published". Used
// by the console page and its search route so both resolve the event the same way.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ADMISSIBLE_SLOT_STATUSES,
  partitionByCancellation,
  admissibleTicketsForRegistration,
} from "@/lib/events/ticket-admissibility";

export interface DoorEvent {
  id: string;
  title: string;
  startDate: string | null;
}

/**
 * One ticket slot in a party: a filled pre-registration (attendeeId set) or an open
 * slot the door can fill in (attendeeId null). Each slot carries its ticket type so
 * the door knows the bracelet to hand over.
 */
export interface DoorSlot {
  attendeeId: string | null;
  name: string;
  email: string;
  phone: string;
  ticketTypeId: string | null;
  ticketTypeTitle: string;
  isLead: boolean;
  checkedIn: boolean;
  arrivedAt: string | null;
}

/** One party as the door console shows it: header + every ticket slot + token. */
export interface DoorParty {
  registrationId: string;
  referenceCode: string | null;
  leadName: string;
  quantity: number;
  claimedCount: number;
  remaining: number;
  complete: boolean;
  /**
   * A sponsor's comp guest list — its open seats belong to the sponsor, so the door must
   * route staff to the welcome desk before filling one rather than treating it as a normal
   * open slot.
   */
  isGuestList: boolean;
  slots: DoorSlot[];
}

/**
 * One list from the NEW guest-list model (U5/U6 — `event_guest_lists` + registration-less
 * tickets, KD10), as opposed to the OLD per-registration `isGuestList` comp parties above.
 * Shaped for the console rather than reusing `GuestListEntry` from lib/events/guest-lists.ts
 * as-is: that type carries `GuestListGuest` (ticketId, name, email, ticketTypeId, checkedIn),
 * which is missing the phone/arrivedAt/ticketTypeTitle fields SlotRow needs to render and
 * check in a guest exactly like every other slot. `buildNewGuestListGroups` below assembles
 * `slots` in the `DoorSlot` shape already used everywhere else on this console.
 */
export interface DoorGuestListGroup {
  id: string;
  name: string;
  contactName: string;
  slots: DoorSlot[];
}

/**
 * One ticket as the arrivals / not-arrived feeds show it: the ticket plus the party
 * it belongs to and the type it was sold as. Contact fields ride along because the
 * arrivals search matches on them exactly as the Pre-registered tab's does (R15).
 */
interface DoorTicketRow {
  id: string;
  partyName: string;
  referenceCode: string | null;
  ticketTypeTitle: string;
  email: string;
  phone: string;
}

/** A checked-in ticket. Always named — a ticket is named before it can arrive. */
export interface DoorArrival extends DoorTicketRow {
  name: string;
  arrivedAt: string;
}

/** An expected-but-absent ticket: a named guest, or an unnamed open slot (null name). */
export interface DoorNotArrived extends DoorTicketRow {
  name: string | null;
}

export interface DoorRoster {
  parties: DoorParty[];
  /** Checked-in tickets, most-recent first (arrivals feed). */
  arrivals: DoorArrival[];
  /** Everyone still expected: named no-shows AND unnamed open slots (KTD8). */
  notArrived: DoorNotArrived[];
  /** Checked-in headcount. */
  arrived: number;
  /**
   * The denominator: the headcount still expected at the door — each party's quantity less
   * its cancelled seats. It is NOT necessarily arrived + outstanding — see `unaccounted`.
   */
  expected: number;
  /**
   * The not-arrived headcount — literally `notArrived.length`, so the number the door shows
   * and the list it shows it over are always the SAME population.
   *
   * Deliberately NOT `expected − arrived`: those agree only when every party's non-released
   * ticket rows exactly equal its quantity, and nothing enforces that. A legacy registration
   * with no ticket rows at all (claim_ticket's own fallback documents these), or a legacy
   * `slot_status = 'unclaimed'` row (still permitted by the CHECK constraint), holds a seat
   * in `expected` while appearing in neither feed. Deriving this from the quantity would
   * print "14 outstanding" over a list of 11 and leave three ticket-holders unfindable
   * anywhere on the console — a guest with a seat turned away at the door.
   */
  outstanding: number;
  /**
   * expected − arrived − outstanding: live seats (quantity less cancellations) with NO
   * ticket row in either feed. Zero for
   * a healthy event. Non-zero means some party's rows and its quantity disagree, and those
   * people cannot be found or checked in from the console.
   *
   * NOTE for components/door/DoorConsole.tsx: surface this when it is non-zero (e.g. "2
   * unaccounted — check the party's tickets"). It exists so the mismatch is VISIBLE instead
   * of silently absorbed into a count that no longer matches its own list.
   */
  unaccounted: number;
}

type RegRow = {
  id: string;
  reference_code: string | null;
  name: string | null;
  quantity: number | null;
  is_guest_list: boolean | null;
};

type AttRow = {
  id: string;
  registration_id: string | null;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  is_lead: boolean;
  ticket_type_id: string | null;
  checked_in_at: string | null;
  created_at: string;
  slot_status: string;
  cancellation_status: string | null;
};

/** PostgREST's default response cap. A bigger read comes back SHORT, with no error. */
const PAGE_SIZE = 1000;

/**
 * Read EVERY row of a query, a page at a time.
 *
 * A comp list has no quantity ceiling (R6), so a busy match day pushes an event past 1000
 * tickets — and an unpaginated select would then hand the door a silently truncated roster:
 * guests past row 1000 missing from Pre-registered, Arrivals and Not-arrived, unfindable by
 * search, while `expected` kept counting them. See
 * docs/solutions/database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md
 *
 * A failed page THROWS rather than returning what it has: at the door, a truncated roster is
 * worse than an error page — it turns real ticket-holders away and no one can tell. Same
 * stance as the admin roster's failLoad.
 */
async function readAllRows<T>(
  label: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`buildDoorRoster: could not load ${label}: ${error.message}`, {
        cause: error,
      });
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/**
 * Assemble the full door roster: every party expanded into one slot per purchased
 * ticket — filled from its live claimed attendees (lead first), then an open slot for
 * each remaining ticket of each type — plus the arrivals feed and expected headcount.
 * The console filters this client-side; no per-keystroke server search. Read-only.
 */
export async function buildDoorRoster(eventId: string): Promise<DoorRoster> {
  const supabase = createAdminClient();

  // Paged (and ordered — a paged read needs a stable sort or rows can repeat or vanish
  // between pages).
  const registrations = await readAllRows<RegRow>("registrations", (from, to) =>
    supabase
      .from("event_registrations")
      .select("id, reference_code, name, quantity, is_guest_list")
      .eq("event_id", eventId)
      .in("status", ["paid", "free"])
      .order("id", { ascending: true })
      .range(from, to)
  );

  // Both filled (claimed) and open (issued) tickets in one read — issued rows ARE
  // the open slots now (U3), so there is no purchased−claimed synthesis. Released
  // rows are excluded (a released slot is reopened as a fresh issued row).
  const allAttendees = await readAllRows<AttRow>("tickets", (from, to) =>
    supabase
      .from("tickets")
      .select(
        "id, registration_id, name, email, phone_e164, is_lead, ticket_type_id, checked_in_at, created_at, slot_status, cancellation_status"
      )
      .eq("event_id", eventId)
      .in("slot_status", [...ADMISSIBLE_SLOT_STATUSES])
      .is("released_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  // Cancelled seats are excluded so the console shows the same people as the admin roster
  // and the printed sheet — the shared rule, and why it is not just a query filter, lives in
  // lib/events/ticket-admissibility.ts.
  const { live: attendees, cancelledByRegistration } =
    partitionByCancellation(allAttendees);
  const seatsFor = (reg: { id: string; quantity: number | null }) =>
    admissibleTicketsForRegistration(reg, cancelledByRegistration);

  // Active ticket types → titles + sort order for empty slots.
  const { data: ttRows, error: ttErr } = await supabase
    .from("event_ticket_types")
    .select("id, title, sort_order")
    .eq("event_id", eventId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  // Throw rather than degrade, exactly as readAllRows does above: on failure every slot would
  // render with a blank ticket type, so door staff get a console with no bracelet on any line
  // and no sign anything is wrong.
  if (ttErr) {
    throw new Error(`buildDoorRoster: could not load ticket types: ${ttErr.message}`, {
      cause: ttErr,
    });
  }
  const ticketTitleById = new Map<string, string>();
  const ticketSortById = new Map<string, number>();
  for (const t of ttRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
    ticketSortById.set(t.id as string, (t.sort_order as number | null) ?? 0);
  }

  // Partition each party's tickets into filled (claimed) and open (issued) rows.
  const claimedByReg = new Map<string, AttRow[]>();
  const issuedByReg = new Map<string, AttRow[]>();
  for (const a of attendees) {
    if (!a.registration_id) continue;
    const map = a.slot_status === "issued" ? issuedByReg : claimedByReg;
    const list = map.get(a.registration_id) ?? [];
    list.push(a);
    map.set(a.registration_id, list);
  }

  const toSlot = (a: AttRow): DoorSlot => ({
    attendeeId: a.id,
    name: a.name ?? "",
    email: a.email ?? "",
    phone: a.phone_e164 ?? "",
    ticketTypeId: a.ticket_type_id,
    ticketTypeTitle: a.ticket_type_id ? ticketTitleById.get(a.ticket_type_id) ?? "" : "",
    isLead: a.is_lead,
    checkedIn: a.checked_in_at !== null,
    arrivedAt: a.checked_in_at,
  });

  const parties: DoorParty[] = registrations
    // A booking whose every seat was cancelled has nothing left to admit. Without this it
    // still rendered a party card at the door — a refunded guest listed as expected.
    // Keyed on ANY live row, not just claimed ones. An over-cancelled booking that still
    // holds an issued ticket has someone the scan would admit; dropping the party made that
    // person unfindable on the console and, because `expected` went to 0 too, invisible in
    // `unaccounted` as well. The sheet keeps such a party, and the two must agree.
    .filter(
      (reg) =>
        seatsFor(reg) > 0 ||
        (claimedByReg.get(reg.id)?.length ?? 0) > 0 ||
        (issuedByReg.get(reg.id)?.length ?? 0) > 0
    )
    .map((reg) => {
    const claimed = (claimedByReg.get(reg.id) ?? []).slice().sort((a, b) => {
      if (a.is_lead !== b.is_lead) return a.is_lead ? -1 : 1; // lead first
      return a.created_at.localeCompare(b.created_at);
    });
    const filled = claimed.map(toSlot);

    // Open slots = the party's stored 'issued' rows (ordered by the type's sort
    // order, then mint order). attendeeId stays null so the console treats them as
    // fillable; the fill RPC picks an issued row of the chosen type to flip.
    const openSlots: DoorSlot[] = (issuedByReg.get(reg.id) ?? [])
      .slice()
      .sort((a, b) => {
        const sa = a.ticket_type_id ? ticketSortById.get(a.ticket_type_id) ?? 0 : 0;
        const sb = b.ticket_type_id ? ticketSortById.get(b.ticket_type_id) ?? 0 : 0;
        if (sa !== sb) return sa - sb;
        return a.created_at.localeCompare(b.created_at);
      })
      .map((a) => ({
        attendeeId: null,
        name: "",
        email: "",
        phone: "",
        ticketTypeId: a.ticket_type_id,
        ticketTypeTitle: a.ticket_type_id ? ticketTitleById.get(a.ticket_type_id) ?? "" : "",
        isLead: false,
        checkedIn: false,
        arrivedAt: null,
      }));

    const quantity = seatsFor(reg);
    return {
      registrationId: reg.id,
      referenceCode: reg.reference_code,
      leadName:
        claimed.find((a) => a.is_lead)?.name ?? reg.name ?? "",
      quantity,
      claimedCount: claimed.length,
      remaining: Math.max(0, quantity - claimed.length),
      complete: claimed.length >= quantity,
      isGuestList: Boolean(reg.is_guest_list),
      slots: [...filled, ...openSlots],
    };
    });

  // Both feeds are keyed on the party, so a ticket with no registration — a legacy
  // imported row (R9) — is skipped exactly as `parties` already skips it, and stays
  // invisible at the door. That skip is also what keeps the counts reconciling:
  // `expected` only ever sums each registration's uncancelled seats (KTD8).
  const partyById = new Map(parties.map((p) => [p.registrationId, p]));

  const ticketRow = (a: AttRow, party: DoorParty): DoorTicketRow => ({
    id: a.id,
    partyName: party.leadName,
    referenceCode: party.referenceCode,
    ticketTypeTitle: a.ticket_type_id ? ticketTitleById.get(a.ticket_type_id) ?? "" : "",
    email: a.email ?? "",
    phone: a.phone_e164 ?? "",
  });

  const arrivals: DoorArrival[] = [];
  const notArrived: DoorNotArrived[] = [];
  for (const a of attendees) {
    const party = a.registration_id ? partyById.get(a.registration_id) : undefined;
    if (!party) continue;
    if (a.checked_in_at !== null) {
      arrivals.push({
        ...ticketRow(a, party),
        name: a.name ?? "",
        arrivedAt: a.checked_in_at,
      });
      continue;
    }
    // An 'issued' row is an unfilled slot: no name, so the door renders "Open slot".
    // It is counted in `expected`, so it belongs in the not-arrived list (KTD8).
    notArrived.push({
      ...ticketRow(a, party),
      name: a.slot_status === "issued" ? null : a.name ?? "",
    });
  }

  arrivals.sort((x, y) => y.arrivedAt.localeCompare(x.arrivedAt));
  notArrived.sort(
    (x, y) =>
      x.partyName.localeCompare(y.partyName) ||
      // Named guests first within a party; the party's open slots trail them.
      Number(x.name === null) - Number(y.name === null) ||
      (x.name ?? "").localeCompare(y.name ?? "")
  );

  const expected = registrations.reduce((sum, r) => sum + seatsFor(r), 0);

  // The number and the list are the same population BY CONSTRUCTION: outstanding IS the
  // not-arrived list's length. Any daylight between the seats sold and the ticket rows that
  // represent them (a legacy party with no rows, an 'unclaimed' row filtered out of both
  // feeds) lands in `unaccounted`, where it can be seen, instead of inflating a count over a
  // list that does not contain those people.
  const outstanding = notArrived.length;

  return {
    parties,
    arrivals,
    notArrived,
    arrived: arrivals.length,
    expected,
    outstanding,
    // Unclamped on purpose: negative means the party has MORE live ticket rows than seats
    // sold, which is just as broken as fewer, and hiding it behind a floor of 0 is how a
    // mismatch stays invisible.
    unaccounted: expected - arrivals.length - outstanding,
  };
}

/**
 * Guest lists from the NEW list model (U5/U6/U9 — KD10) for the live door console. A
 * guest-list ticket has no registration, so it is invisible to `buildDoorRoster` above by
 * construction (that function only ever walks tickets it can attach to a party) — this is a
 * deliberately separate, independent read, not a filter bolted onto the party model. Read-only.
 *
 * Not paged: an event's guest-list guests are expected to be a few hundred at most, well
 * under one page — revisit with `readAllRows` if that stops being true.
 */
export async function buildNewGuestListGroups(eventId: string): Promise<DoorGuestListGroup[]> {
  const supabase = createAdminClient();

  // The guest lists and the ticket-type titles are independent reads (neither's filter
  // depends on the other) — fire them concurrently rather than paying two round trips in
  // series. Only the `tickets` read below genuinely depends on a prior result (`listIds`).
  const [
    { data: lists, error: listsError },
    { data: ttRows, error: ttErr },
  ] = await Promise.all([
    supabase
      .from("event_guest_lists")
      .select("id, list_name, contact_name")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true }),
    // Ticket-type titles for the slots, same pattern as buildDoorRoster's own lookup above —
    // a second, independent query rather than threading state between the two functions.
    supabase.from("event_ticket_types").select("id, title").eq("event_id", eventId),
  ]);
  if (listsError) {
    throw new Error(`buildNewGuestListGroups: could not load guest lists: ${listsError.message}`, {
      cause: listsError,
    });
  }
  if (ttErr) {
    throw new Error(`buildNewGuestListGroups: could not load ticket types: ${ttErr.message}`, {
      cause: ttErr,
    });
  }
  const listRows = lists ?? [];
  if (listRows.length === 0) return [];

  const ticketTitleById = new Map<string, string>();
  for (const t of ttRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
  }

  const listIds = listRows.map((l) => l.id as string);
  const { data: tickets, error: ticketsError } = await supabase
    .from("tickets")
    .select("id, guest_list_id, name, email, phone_e164, ticket_type_id, checked_in_at")
    .in("guest_list_id", listIds)
    .is("released_at", null)
    .order("created_at", { ascending: true });
  if (ticketsError) {
    throw new Error(
      `buildNewGuestListGroups: could not load guest-list tickets: ${ticketsError.message}`,
      { cause: ticketsError }
    );
  }

  const slotsByList = new Map<string, DoorSlot[]>();
  for (const t of tickets ?? []) {
    const guestListId = t.guest_list_id as string | null;
    if (!guestListId) continue;
    const slot: DoorSlot = {
      attendeeId: t.id as string,
      name: (t.name as string | null) ?? "",
      email: (t.email as string | null) ?? "",
      phone: (t.phone_e164 as string | null) ?? "",
      ticketTypeId: t.ticket_type_id as string | null,
      ticketTypeTitle: t.ticket_type_id ? ticketTitleById.get(t.ticket_type_id as string) ?? "" : "",
      // A guest-list guest is never anyone's "lead" — there is no registration for them to
      // lead. isLead only ever means something on the old, registration-based party model.
      isLead: false,
      checkedIn: t.checked_in_at !== null,
      arrivedAt: t.checked_in_at as string | null,
    };
    const list = slotsByList.get(guestListId) ?? [];
    list.push(slot);
    slotsByList.set(guestListId, list);
  }

  return listRows.map((l) => ({
    id: l.id as string,
    name: l.list_name as string,
    contactName: l.contact_name as string,
    slots: slotsByList.get(l.id as string) ?? [],
  }));
}

/**
 * Resolve a published event by id for the door console. Returns null for an
 * unknown, malformed, or unpublished id (the caller renders a neutral
 * "not available" state — never a leak of why).
 */
export async function resolveDoorEvent(eventId: string): Promise<DoorEvent | null> {
  if (!eventId) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, start_date, is_published")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  // A malformed uuid surfaces as a query error, not a throw — treat as not found.
  if (error || !data || !data.is_published) return null;
  return {
    id: data.id as string,
    title: data.title as string,
    startDate: (data.start_date as string | null) ?? null,
  };
}
