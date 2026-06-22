// Door console access (U4). The console is a public, per-event surface keyed on
// the event id (KTD1 — no secret token, no login): anyone with the public event
// link can open it. The single gate is "the event exists and is published". Used
// by the console page and its search route so both resolve the event the same way.

import { createAdminClient } from "@/lib/supabase/admin";

export interface DoorEvent {
  id: string;
  title: string;
  startDate: string | null;
}

/**
 * One ticket slot in a party: a filled pre-registration (attendeeId set) or an open
 * slot the door can fill in (attendeeId null). Each slot carries its ticket type so
 * the door knows the bracelet and whether contact is needed (kids are name-only).
 */
export interface DoorSlot {
  attendeeId: string | null;
  name: string;
  email: string;
  phone: string;
  ticketTypeId: string | null;
  ticketTypeTitle: string;
  isChild: boolean;
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
  selfRegToken: string | null;
  slots: DoorSlot[];
}

export interface DoorRoster {
  parties: DoorParty[];
  /** Checked-in attendees, most-recent first (arrivals feed). */
  arrivals: { id: string; name: string; arrivedAt: string }[];
  /** Total tickets sold = expected headcount. */
  expected: number;
}

type RegRow = {
  id: string;
  reference_code: string | null;
  name: string | null;
  quantity: number | null;
  self_reg_token: string | null;
};

type AttRow = {
  id: string;
  registration_id: string | null;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  is_lead: boolean;
  ticket_type_id: string | null;
  is_child: boolean | null;
  checked_in_at: string | null;
  created_at: string;
  slot_status: string;
};

/**
 * Assemble the full door roster: every party expanded into one slot per purchased
 * ticket — filled from its live claimed attendees (lead first), then an open slot for
 * each remaining ticket of each type — plus the arrivals feed and expected headcount.
 * The console filters this client-side; no per-keystroke server search. Read-only.
 */
export async function buildDoorRoster(eventId: string): Promise<DoorRoster> {
  const supabase = createAdminClient();

  const { data: regRows } = await supabase
    .from("event_registrations")
    .select("id, reference_code, name, quantity, self_reg_token")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  const registrations = (regRows ?? []) as RegRow[];

  // Both filled (claimed) and open (issued) tickets in one read — issued rows ARE
  // the open slots now (U3), so there is no purchased−claimed synthesis. Released
  // rows are excluded (a released slot is reopened as a fresh issued row).
  const { data: attRows } = await supabase
    .from("tickets")
    .select(
      "id, registration_id, name, email, phone_e164, is_lead, ticket_type_id, is_child, checked_in_at, created_at, slot_status"
    )
    .eq("event_id", eventId)
    .in("slot_status", ["claimed", "issued"])
    .is("released_at", null);
  const attendees = (attRows ?? []) as AttRow[];

  // Active ticket types → titles + the per-type child flag for empty slots.
  const { data: ttRows } = await supabase
    .from("event_ticket_types")
    .select("id, title, is_child, sort_order")
    .eq("event_id", eventId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  const ticketTitleById = new Map<string, string>();
  const ticketIsChildById = new Map<string, boolean>();
  const ticketSortById = new Map<string, number>();
  for (const t of ttRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
    ticketIsChildById.set(t.id as string, Boolean(t.is_child));
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
    // Child if the row flag OR the live ticket type says so — the row flag is a
    // point-in-time copy that can go stale (see listPartyChildrenToCheckIn).
    isChild:
      (a.is_child ?? false) ||
      (a.ticket_type_id ? ticketIsChildById.get(a.ticket_type_id) ?? false : false),
    isLead: a.is_lead,
    checkedIn: a.checked_in_at !== null,
    arrivedAt: a.checked_in_at,
  });

  const parties: DoorParty[] = registrations.map((reg) => {
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
        isChild: a.ticket_type_id ? ticketIsChildById.get(a.ticket_type_id) ?? false : false,
        isLead: false,
        checkedIn: false,
        arrivedAt: null,
      }));

    const quantity = reg.quantity ?? 0;
    return {
      registrationId: reg.id,
      referenceCode: reg.reference_code,
      leadName:
        claimed.find((a) => a.is_lead)?.name ?? reg.name ?? "",
      quantity,
      claimedCount: claimed.length,
      remaining: Math.max(0, quantity - claimed.length),
      complete: claimed.length >= quantity,
      selfRegToken: reg.self_reg_token,
      slots: [...filled, ...openSlots],
    };
  });

  const arrivals = attendees
    .filter((a) => a.checked_in_at !== null)
    .sort((a, b) => (b.checked_in_at as string).localeCompare(a.checked_in_at as string))
    .map((a) => ({
      id: a.id,
      name: a.name ?? "",
      arrivedAt: a.checked_in_at as string,
    }));

  const expected = registrations.reduce((sum, r) => sum + (r.quantity ?? 0), 0);

  return { parties, arrivals, expected };
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
