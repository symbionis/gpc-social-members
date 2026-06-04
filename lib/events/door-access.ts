// Door console access (U4). The console is a public, per-event surface keyed on
// the event id (KTD1 — no secret token, no login): anyone with the public event
// link can open it. The single gate is "the event exists and is published". Used
// by the console page and its search route so both resolve the event the same way.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  computePartyFills,
  type PartyGuest,
  type RosterAttendeeInput,
} from "@/lib/events/roster-fill";

export interface DoorEvent {
  id: string;
  title: string;
  startDate: string | null;
}

/** One party as the door console shows it: lead + fill + claimed guests + token. */
export interface DoorParty {
  registrationId: string;
  referenceCode: string | null;
  leadName: string;
  leadEmail: string;
  leadPhone: string;
  quantity: number;
  claimedCount: number;
  remaining: number;
  complete: boolean;
  selfRegToken: string | null;
  guests: PartyGuest[];
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
  email: string | null;
  phone_e164: string | null;
  quantity: number | null;
  self_reg_token: string | null;
};

/**
 * Assemble the full door roster for an event: every party (lead + live claimed
 * guests, released rows excluded) with its fill and self-reg token, plus the
 * arrivals feed and expected headcount. The console filters this client-side, so
 * there's no per-keystroke server search. Read-only.
 */
export async function buildDoorRoster(eventId: string): Promise<DoorRoster> {
  const supabase = createAdminClient();

  const { data: regRows } = await supabase
    .from("event_registrations")
    .select("id, reference_code, name, email, phone_e164, quantity, self_reg_token")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  const registrations = (regRows ?? []) as RegRow[];

  const { data: attRows } = await supabase
    .from("event_attendees")
    .select(
      "id, registration_id, name, email, phone_e164, is_lead, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", eventId)
    .eq("slot_status", "claimed")
    .is("released_at", null);
  const attendees = (attRows ?? []) as (RosterAttendeeInput & { created_at: string })[];

  const fills = computePartyFills(
    registrations.map((r) => ({ id: r.id, quantity: r.quantity ?? 0 })),
    attendees
  );

  const parties: DoorParty[] = registrations.map((reg) => {
    const fill = fills.get(reg.id);
    return {
      registrationId: reg.id,
      referenceCode: reg.reference_code,
      leadName: reg.name ?? "",
      leadEmail: reg.email ?? "",
      leadPhone: reg.phone_e164 ?? "",
      quantity: fill?.quantity ?? reg.quantity ?? 0,
      claimedCount: fill?.claimedCount ?? 0,
      remaining: fill?.remaining ?? 0,
      complete: fill?.complete ?? false,
      selfRegToken: reg.self_reg_token,
      guests: fill?.guests ?? [],
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
