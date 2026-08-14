import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { RateClass } from "@/lib/events/pricing";

// Per-booking ticket limits, one per rate class (U1-U2). Mirrors the price columns in
// lib/events/pricing.ts: three optional per-event columns, one resolver, kept deliberately
// distinct from seat_cap (event-wide capacity) and MAX_TICKETS/MAX_QTY (per-request abuse
// guards) — this module governs how many tickets ONE booking may hold.

/** Unset resolves to this. Deliberately a code constant, not a DB default — "blank" stays a
 *  distinct, queryable state from "explicitly 10". */
export const DEFAULT_BOOKING_LIMIT = 10;

/** Absolute ceiling. Mirrors MAX_TICKETS (register route) / the settings-route CHECK — a
 *  stored or requested value above this could never take effect. */
export const ABSOLUTE_MAX_TICKETS = 20;

/** A pending top-up older than this no longer reserves allowance — an abandoned checkout
 *  should not strand a guest's allowance indefinitely (R12). */
const PENDING_TOPUP_WINDOW_MINUTES = 60;

export interface BookingLimitColumns {
  max_tickets_member: number | null;
  max_tickets_invite: number | null;
  max_tickets_non_member: number | null;
}

const LIMIT_COLUMN_BY_RATE_CLASS: Record<RateClass, keyof BookingLimitColumns> = {
  member: "max_tickets_member",
  invite: "max_tickets_invite",
  non_member: "max_tickets_non_member",
};

/** Register checkout + top-up: the per-booking ceiling for a resolved rate class. A stored
 *  value that is not a positive integer (should be impossible past the column CHECK, but this
 *  route is unauthenticated) is treated as unset rather than trusted blindly. */
export function resolveBookingLimit(event: BookingLimitColumns, rateClass: RateClass): number {
  const column = LIMIT_COLUMN_BY_RATE_CLASS[rateClass];
  const raw = event[column];
  const configured = Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null;
  return Math.min(configured ?? DEFAULT_BOOKING_LIMIT, ABSOLUTE_MAX_TICKETS);
}

/** Top-up-side mirror of the register route's session-based rate-class resolution — the
 *  register route decides from the authenticated session, this decides from what got stored on
 *  the registration. The one place they legitimately differ: an admin-created comp guest list
 *  (`is_guest_list`) is a non-member registration on a members-only event that did NOT arrive
 *  through the invite link, so it resolves to `member` (no whole-booking rule, R11) rather than
 *  `invite`. A future third surface should call this rather than re-deriving inline. */
export function rateClassForRegistration(
  registration: { is_member: boolean; is_guest_list: boolean },
  event: { visibility: string }
): RateClass {
  if (registration.is_member || registration.is_guest_list) return "member";
  return event.visibility === "members_only" ? "invite" : "non_member";
}

/**
 * Live-plus-pending ticket count for one booking, counting every ticket type (R9 — this
 * deliberately diverges from seats_used, which counts only counts_as_seat types). Mirrors
 * seats_used's shape (lib/events/seat-usage.ts) but scoped to a single registration:
 *
 *   live = purchased items (or the itemless registration.quantity fallback)
 *        + pending top-up quantity within the reservation window (R12)
 *        - cancelled tickets (any cancellation_status — R6)
 *
 * Throws on any query error rather than returning a partial count — a silent zero would fail
 * OPEN on this unauthenticated route, handing back full allowance on every failed read, which
 * is the opposite of what R5 exists to do. Callers must fail closed on the throw.
 */
export async function countLiveTickets(
  supabase: SupabaseClient<Database>,
  registrationId: string
): Promise<number> {
  const { data: items, error: itemsErr } = await supabase
    .from("event_registration_items")
    .select("quantity")
    .eq("registration_id", registrationId);
  if (itemsErr) {
    throw new Error(`Failed to read registration items: ${itemsErr.message}`);
  }

  let purchased: number;
  if (items && items.length > 0) {
    purchased = items.reduce((sum, i) => sum + (i.quantity as number), 0);
  } else {
    // Itemless registration fallback, mirroring seats_used's NOT EXISTS branch — an old
    // registration with no event_registration_items rows falls back to the parent quantity
    // rather than counting as zero and being allowed past its limit.
    const { data: reg, error: regErr } = await supabase
      .from("event_registrations")
      .select("quantity")
      .eq("id", registrationId)
      .limit(1)
      .maybeSingle();
    if (regErr) {
      throw new Error(`Failed to read registration quantity: ${regErr.message}`);
    }
    purchased = (reg?.quantity as number | undefined) ?? 0;
  }

  const windowStart = new Date(
    Date.now() - PENDING_TOPUP_WINDOW_MINUTES * 60 * 1000
  ).toISOString();
  const { data: pendingTopups, error: topupsErr } = await supabase
    .from("event_registration_topups")
    .select("items")
    .eq("registration_id", registrationId)
    .eq("status", "pending")
    .gte("created_at", windowStart);
  if (topupsErr) {
    throw new Error(`Failed to read pending top-ups: ${topupsErr.message}`);
  }
  const pending = (pendingTopups ?? []).reduce((sum, t) => {
    const topupItems = (t.items as { quantity?: unknown }[] | null) ?? [];
    const topupQty = topupItems.reduce(
      (s, i) => s + (typeof i.quantity === "number" ? i.quantity : 0),
      0
    );
    return sum + topupQty;
  }, 0);

  const { count: cancelled, error: cancelledErr } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("registration_id", registrationId)
    .not("cancellation_status", "is", null);
  if (cancelledErr) {
    throw new Error(`Failed to read cancelled tickets: ${cancelledErr.message}`);
  }

  return purchased + pending - (cancelled ?? 0);
}
