// Derivation helpers for the waitlist paid-offer flow (U2 of
// docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md).
//
// Kept out of app/api/admin/events/[id]/waitlist/[waitlistId]/route.ts and out of the
// attendees page's server component so the logic is unit-testable in isolation and shared
// by both: a Next.js App Router route file may export only its HTTP handlers (see
// lib/events/guest-list-auth.ts's header comment for why), and the attendees page is a
// server component the repo does not unit-test directly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** The joined ticket type fields an offerability check needs, or null when the entry's
 * `ticket_type_id` is null or no longer resolves (a dangling reference). */
export interface OfferabilityTicketType {
  title: string;
  archived_at: string | null;
  counts_as_seat: boolean;
}

export interface WaitlistOfferabilityInput {
  ticket_type_id: string | null;
  quantity: number | null;
  ticketType: OfferabilityTicketType | null;
}

export interface WaitlistOfferabilityResult {
  offerable: boolean;
  /** Human-readable reason the entry cannot be offered, naming the ticket type where
   * relevant. Null when offerable. */
  reason: string | null;
}

/**
 * R13/R14: an offerable entry needs a live, non-archived, seat-counting ticket type
 * (KTD6) and a quantity between 1 and 10. Ticket-type problems are reported before
 * quantity problems, matching the order the plan states them in.
 */
export function deriveWaitlistOfferability(
  entry: WaitlistOfferabilityInput
): WaitlistOfferabilityResult {
  if (!entry.ticket_type_id) {
    return { offerable: false, reason: "No ticket type is set for this entry" };
  }
  if (!entry.ticketType) {
    return { offerable: false, reason: "The requested ticket type no longer exists" };
  }
  if (entry.ticketType.archived_at) {
    return {
      offerable: false,
      reason: `"${entry.ticketType.title}" has been archived`,
    };
  }
  if (!entry.ticketType.counts_as_seat) {
    return {
      offerable: false,
      reason: `"${entry.ticketType.title}" does not count toward capacity`,
    };
  }
  if (
    entry.quantity === null ||
    entry.quantity === undefined ||
    !Number.isInteger(entry.quantity) ||
    entry.quantity < 1 ||
    entry.quantity > 10
  ) {
    return { offerable: false, reason: "Quantity must be between 1 and 10" };
  }
  return { offerable: true, reason: null };
}

export interface LiveRegistrationForRedemption {
  waitlist_entry_id: string | null;
  email: string;
}

/**
 * KTD3: an entry is redeemed once its linked registration (`waitlist_entry_id`) reaches
 * paid or free. Legacy entries created before U1 have no such link, so also fall back to
 * an email match against a live (paid/free) registration for the same event — this is the
 * same email+event lookup the register route runs before its capacity check.
 *
 * `liveRegistrations` must already be scoped to the entry's event and to paid/free status.
 */
export function isWaitlistEntryRedeemed(
  entry: { id: string; email: string },
  liveRegistrations: LiveRegistrationForRedemption[]
): boolean {
  const emailLower = entry.email.trim().toLowerCase();
  return liveRegistrations.some(
    (r) =>
      r.waitlist_entry_id === entry.id ||
      r.email.trim().toLowerCase() === emailLower
  );
}

export type RedeemingRegistration = LiveRegistrationForRedemption & {
  reference_code: string;
};

/**
 * The live (paid/free) registration that redeems this entry, or null if there is none.
 * Returns the row rather than a boolean so a caller that needs to name it — the offer
 * landing's already-registered panel — doesn't have to re-implement the match.
 *
 * Asks the per-entry question with a per-entry query. Fetching the event's whole live
 * registration set and filtering client-side would hit the Supabase JS 1000-row default
 * truncation, which returns short WITHOUT an error: past 1000 registrations a redeemed
 * entry would silently read as un-redeemed, and the register route would send a buyer
 * who already holds a ticket to Stripe. Same rule, same reason as lib/events/seat-usage.ts.
 *
 * Matching mirrors isWaitlistEntryRedeemed: the `waitlist_entry_id` link is authoritative
 * (KTD3), with an email fallback for legacy entries created before U1. Email is compared
 * against the normalised (trimmed, lowercased) form the register route writes (route.ts:58)
 * and the existing duplicate guard already matches on.
 *
 * Used by the admin offer route, the admin repair route, the register route, and the public
 * offer landing. The attendees page does NOT use this — it answers the same question for a
 * whole list off its already-loaded registration set, via isWaitlistEntryRedeemed directly.
 */
export async function findRedeemingRegistration(
  supabase: SupabaseClient<Database>,
  eventId: string,
  entry: { id: string; email: string }
): Promise<{
  data: RedeemingRegistration | null;
  error: { message: string } | null;
}> {
  const select = "waitlist_entry_id, email, reference_code";
  const live = ["paid", "free"];

  const linked = await supabase
    .from("event_registrations")
    .select(select)
    .eq("event_id", eventId)
    .eq("waitlist_entry_id", entry.id)
    .in("status", live)
    .limit(1);
  if (linked.error) return { data: null, error: linked.error };
  if (linked.data && linked.data.length > 0) {
    return { data: linked.data[0], error: null };
  }

  // Two queries rather than one `.or()`: an email is caller-supplied text, and
  // interpolating it into PostgREST's filter grammar would make the match depend
  // on which punctuation it happens to contain.
  const byEmail = await supabase
    .from("event_registrations")
    .select(select)
    .eq("event_id", eventId)
    .eq("email", entry.email.trim().toLowerCase())
    .in("status", live)
    .limit(1);
  if (byEmail.error) return { data: null, error: byEmail.error };
  return { data: byEmail.data?.[0] ?? null, error: null };
}
