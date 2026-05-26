import { createAdminClient } from "@/lib/supabase/admin";

export interface NormalizedTicketType {
  title: string;
  price_member: number | null;
  price_non_member: number | null;
  invite_price: number | null;
  counts_as_seat: boolean;
}

function parsePrice(
  raw: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: Number(n.toFixed(2)) };
}

/**
 * Normalize + validate a single ticket-type payload against the event's
 * visibility. Visibility-dependent null rules mirror what the old events price
 * columns enforced: members_only => price_non_member forced null; public =>
 * invite_price forced null.
 *
 * Does NOT require price_member here — a draft / registration-disabled event may
 * carry an unpriced type. The "every active type must be priced" rule is
 * enforced at registration-enable time by assertEventRegistrationPriceable
 * (which replaced the dropped events_prices_required_when_registration_enabled
 * constraint).
 */
export function normalizeTicketType(
  input: unknown,
  visibility: string
): { ok: true; value: NormalizedTicketType } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid ticket type" };
  }
  const o = input as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return { ok: false, error: "Ticket type title is required" };

  const pm = parsePrice(o.price_member);
  if (!pm.ok) {
    return { ok: false, error: `Member price for "${title}" must be 0 or a positive amount` };
  }
  const pnm = parsePrice(o.price_non_member);
  if (!pnm.ok) {
    return { ok: false, error: `Non-member price for "${title}" must be 0 or a positive amount` };
  }
  const inv = parsePrice(o.invite_price);
  if (!inv.ok) {
    return { ok: false, error: `Guest price for "${title}" must be 0 or a positive amount` };
  }

  const isMembersOnly = visibility === "members_only";
  return {
    ok: true,
    value: {
      title,
      price_member: pm.value,
      // members_only events never carry a non-member price; public events never
      // carry an invite (guest) price. Force the irrelevant one null.
      price_non_member: isMembersOnly ? null : pnm.value,
      invite_price: isMembersOnly ? inv.value : null,
      // Accept a real boolean; anything else (absent, or a stray non-boolean)
      // defaults to true rather than being silently coerced.
      counts_as_seat: typeof o.counts_as_seat === "boolean" ? o.counts_as_seat : true,
    },
  };
}

/**
 * Guard that MUST be called before flipping events.registration_enabled true,
 * on every event-update path that can do so (admin update route, agent route).
 * The admin create route enforces the same rule inline instead of calling this
 * (it validates pre-insert normalized values rather than stored rows). It
 * replaces the dropped events_prices_required_when_registration_enabled DB
 * constraint: every ACTIVE ticket type must carry the prices its visibility
 * requires.
 */
export async function assertEventRegistrationPriceable(
  eventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient();

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("visibility")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) return { ok: false, error: "Could not verify event pricing" };
  if (!event) return { ok: false, error: "Event not found" };

  const { data: types, error: tErr } = await supabase
    .from("event_ticket_types")
    .select("title, price_member, price_non_member")
    .eq("event_id", eventId)
    .is("archived_at", null);
  if (tErr) return { ok: false, error: "Could not verify event pricing" };
  if (!types || types.length === 0) {
    return {
      ok: false,
      error: "Add at least one ticket type before enabling registration",
    };
  }

  const isMembersOnly = event.visibility === "members_only";
  for (const t of types) {
    if (t.price_member === null) {
      return {
        ok: false,
        error: `"${t.title}" needs a member price before registration can open`,
      };
    }
    if (!isMembersOnly && t.price_non_member === null) {
      return {
        ok: false,
        error: `"${t.title}" needs a non-member price before registration can open`,
      };
    }
  }
  return { ok: true };
}
