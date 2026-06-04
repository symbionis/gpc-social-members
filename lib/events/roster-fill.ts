// Per-party self-registration fill, derived from the roster. Approach B pre-
// provisions no placeholder rows, so a party's fill is a number — purchased
// quantity minus the count of claimed attendees for that registration — not a
// list of empty slots. Shared by the admin Attendees view (expandable party rows,
// incomplete filter, roster summary) and the door console (party search results).

/** One claimed attendee as the helper needs it (raw event_attendees shape). */
export interface RosterAttendeeInput {
  id: string;
  registration_id: string | null;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  is_lead: boolean;
  waiver_accepted_at: string | null;
  checked_in_at: string | null;
  /** The event_ticket_types row this person holds (resolved to a title for display). */
  ticket_type_id?: string | null;
  /** A name-only child (contactless) — checked in via their adult, not the kiosk. */
  is_child?: boolean;
}

/** One registration's purchased quantity. */
export interface RegistrationInput {
  id: string;
  quantity: number;
}

/** A claimed guest (non-lead) within a party, flattened for display. */
export interface PartyGuest {
  id: string;
  name: string;
  email: string;
  phone_e164: string;
  waiverSigned: boolean;
  checkedIn: boolean;
  arrivedAt: string | null;
  /** The guest's ticket-type title (asado meal), or "" when none/unknown. */
  ticketTypeTitle: string;
  /** True for a name-only child (no contact; checked in via their adult). */
  isChild: boolean;
}

/** Per-party fill: tickets bought, how many claimed, how many still open, guests. */
export interface PartyFill {
  quantity: number;
  /** Claimed attendees for this registration, the lead included. */
  claimedCount: number;
  /** Open slots = max(0, quantity − claimedCount). */
  remaining: number;
  complete: boolean;
  /** Non-lead claimed attendees, in roster order. */
  guests: PartyGuest[];
}

/** A lead row's party fill plus the registration's self-reg token (for link/QR). */
export type PartyDetail = PartyFill & { selfRegToken: string | null };

function toGuest(
  a: RosterAttendeeInput,
  ticketTitleById?: Map<string, string>
): PartyGuest {
  return {
    id: a.id,
    name: a.name ?? "",
    email: a.email ?? "",
    phone_e164: a.phone_e164 ?? "",
    waiverSigned: a.waiver_accepted_at !== null,
    checkedIn: a.checked_in_at !== null,
    arrivedAt: a.checked_in_at,
    ticketTypeTitle: a.ticket_type_id
      ? ticketTitleById?.get(a.ticket_type_id) ?? ""
      : "",
    isChild: a.is_child ?? false,
  };
}

/**
 * Build a per-registration fill map from the claimed roster. Attendees with no
 * registration_id (admin/bulk-imported, ops) belong to no party and are ignored
 * here — they appear in the flat roster but have no fill bar. `attendees` is
 * expected to be the claimed roster (the caller already filters slot_status).
 */
export function computePartyFills(
  registrations: RegistrationInput[],
  attendees: RosterAttendeeInput[],
  /** event_ticket_types id → title, to resolve each guest's ticket-type label. */
  ticketTitleById?: Map<string, string>
): Map<string, PartyFill> {
  const claimedByReg = new Map<string, RosterAttendeeInput[]>();
  for (const a of attendees) {
    if (!a.registration_id) continue;
    const list = claimedByReg.get(a.registration_id) ?? [];
    list.push(a);
    claimedByReg.set(a.registration_id, list);
  }

  const fills = new Map<string, PartyFill>();
  for (const reg of registrations) {
    const claimed = claimedByReg.get(reg.id) ?? [];
    const quantity = reg.quantity ?? 0;
    const claimedCount = claimed.length;
    fills.set(reg.id, {
      quantity,
      claimedCount,
      remaining: Math.max(0, quantity - claimedCount),
      complete: claimedCount >= quantity,
      guests: claimed.filter((a) => !a.is_lead).map((a) => toGuest(a, ticketTitleById)),
    });
  }
  return fills;
}

/**
 * Roster-wide "X of Y guests registered": X = claimed attendees on the roster
 * (everyone captured, leads included), Y = total tickets sold across the parties.
 */
export function rosterGuestSummary(
  registrations: RegistrationInput[],
  attendees: RosterAttendeeInput[]
): { registered: number; total: number } {
  return {
    registered: attendees.length,
    total: registrations.reduce((sum, r) => sum + (r.quantity ?? 0), 0),
  };
}
