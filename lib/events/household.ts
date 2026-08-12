import { createAdminClient } from "@/lib/supabase/admin";
import { credentialUrl } from "@/lib/events/credential";
import type { TicketCancellationStatus } from "@/lib/events/refunds";

// Household resolution for the guest manage page (U9/U10). A per-ticket manage_token opens
// a page showing every SAME-EMAIL ticket in the same booking — the "household" (KTD3): a
// couple or family who checked out on one shared address each get their own named ticket +
// QR, and any one of their manage links surfaces the whole group.
//
// Siblings are resolved by (registration_id, lower(email)), matched in JS rather than SQL so
// the case-fold is one obvious rule and there is no `lower()`-on-filter friction. A ticket
// with no registration (a standalone door walk-up) is its own solo household.

export interface HouseholdTicket {
  id: string;
  name: string;
  email: string;
  phone: string;
  typeId: string;
  typeTitle: string;
  status: string; // 'issued' | 'claimed'
  checkedIn: boolean;
  /** Holder cancellation (U14): null = live; 'requested'/'refunded' = cancelled. */
  cancellationStatus: TicketCancellationStatus | null;
  /** QR admission URL (/c/<credential_token>) — admission only, never the manage_token. */
  credentialUrl: string;
  /** True for the ticket whose manage_token opened this page. */
  isSelf: boolean;
  /**
   * True for the ticket seeded as the booking's purchaser (tickets.is_lead) — the payer,
   * regardless of which household ticket's token opened this page. Drives the receipt link's
   * visibility (U6, R22/AE10): only the payer's own token should ever show it, and this flag —
   * unlike the registration's email, which any holder can rewrite on their own ticket via R1 —
   * cannot be forged by a non-payer editing their address.
   */
  isLead: boolean;
  /**
   * Whether this ticket's holder has already accepted the waiver. The door skips its waiver
   * step for a signed ticket (lib/events/checkin.ts never re-stamps), so accepting here is
   * what buys a guest a faster arrival.
   */
  waiverSigned: boolean;
}

export interface HouseholdEvent {
  id: string;
  title: string;
  startDate: string;
  startTime: string | null;
  endDate: string | null;
  location: string | null;
  description: string | null;
}

export interface Household {
  /** Registration payment status, or 'free'/'paid' for a standalone ticket. */
  status: string;
  eventPublished: boolean;
  referenceCode: string | null;
  /** The registration's rate class — drives self-serve upgrade pricing (U11). */
  isMember: boolean;
  event: HouseholdEvent;
  tickets: HouseholdTicket[];
}

const LIVE_SLOTS = ["issued", "claimed"];

/**
 * The one projection both household branches select — the sibling query and the standalone
 * one. It was two hand-maintained copies that had to stay in step, and `waiverSigned` is
 * derived from a column in it: drop `waiver_accepted_at` from one list and every ticket in
 * that branch reads as SIGNED, hiding the only control that could fix it.
 *
 * Same reasoning as ADMISSIBLE_SLOT_STATUSES in lib/events/ticket-admissibility.ts — a rule
 * that governs a door belongs in one place, not in a copy per surface.
 */
const HOUSEHOLD_TICKET_COLUMNS =
  "id, name, email, phone_e164, ticket_type_id, slot_status, credential_token, checked_in_at, created_at, cancellation_status, waiver_accepted_at, is_lead";

/**
 * Resolve the household behind a per-ticket manage_token. Returns null when the token
 * matches no live ticket (unknown, rotated away, or released).
 */
export async function resolveHousehold(token: string): Promise<Household | null> {
  if (!token) return null;
  const supabase = createAdminClient();

  const { data: self } = await supabase
    .from("tickets")
    .select("id, event_id, registration_id, email")
    .eq("manage_token", token)
    .is("released_at", null)
    .maybeSingle();
  if (!self) return null;

  const { data: event } = await supabase
    .from("events")
    .select("id, title, start_date, start_time, end_date, location, description, is_published")
    .eq("id", self.event_id as string)
    .maybeSingle();
  if (!event) return null;

  const selfEmail = ((self.email as string | null) ?? "").trim().toLowerCase();

  let status = "free";
  let referenceCode: string | null = null;
  let isMember = false;
  let siblingRows: Record<string, unknown>[];

  if (self.registration_id) {
    const { data: reg } = await supabase
      .from("event_registrations")
      .select("id, status, reference_code, is_member")
      .eq("id", self.registration_id as string)
      .maybeSingle();
    status = (reg?.status as string | null) ?? "free";
    referenceCode = (reg?.reference_code as string | null) ?? null;
    isMember = Boolean(reg?.is_member);

    const { data: rows } = await supabase
      .from("tickets")
      .select(HOUSEHOLD_TICKET_COLUMNS)
      .eq("registration_id", self.registration_id as string)
      .in("slot_status", LIVE_SLOTS)
      .is("released_at", null);
    // Same-email household only. A null/empty self email → solo (just this ticket).
    siblingRows = (rows ?? []).filter((r) => {
      if (!selfEmail) return r.id === self.id;
      return ((r.email as string | null) ?? "").trim().toLowerCase() === selfEmail;
    });
  } else {
    // Standalone ticket (no registration) — its own solo household.
    status = "free";
    const { data: solo } = await supabase
      .from("tickets")
      .select(HOUSEHOLD_TICKET_COLUMNS)
      .eq("id", self.id as string)
      .maybeSingle();
    siblingRows = solo ? [solo] : [];
  }

  const typeTitleById = await loadTypeTitles(supabase, event.id as string);

  const tickets: HouseholdTicket[] = siblingRows
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((r) => {
      const typeId = (r.ticket_type_id as string | null) ?? null;
      return {
        id: r.id as string,
        name: (r.name as string | null) ?? "",
        email: (r.email as string | null) ?? "",
        phone: (r.phone_e164 as string | null) ?? "",
        typeId: typeId ?? "",
        typeTitle: typeId ? typeTitleById.get(typeId) ?? "" : "",
        status: r.slot_status as string,
        checkedIn: r.checked_in_at !== null,
        cancellationStatus: (r.cancellation_status as TicketCancellationStatus | null) ?? null,
        credentialUrl: credentialUrl((r.credential_token as string | null) ?? ""),
        isSelf: r.id === self.id,
        isLead: Boolean(r.is_lead),
        // Boolean(), not `!== null`: rows arrive untyped, so a missing column is `undefined`,
        // and `undefined !== null` is TRUE — every ticket would claim to be signed and the
        // Sign control would vanish for guests who signed nothing. On a legal acceptance the
        // default has to fail closed.
        waiverSigned: Boolean(r.waiver_accepted_at),
      };
    });

  return {
    status,
    eventPublished: Boolean(event.is_published),
    referenceCode,
    isMember,
    event: {
      id: event.id as string,
      title: (event.title as string | null) ?? "",
      startDate: event.start_date as string,
      startTime: (event.start_time as string | null) ?? null,
      endDate: (event.end_date as string | null) ?? null,
      location: (event.location as string | null) ?? null,
      description: (event.description as string | null) ?? null,
    },
    tickets,
  };
}

async function loadTypeTitles(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("event_ticket_types")
    .select("id, title")
    .eq("event_id", eventId);
  const map = new Map<string, string>();
  for (const t of data ?? []) map.set(t.id as string, (t.title as string | null) ?? "");
  return map;
}
