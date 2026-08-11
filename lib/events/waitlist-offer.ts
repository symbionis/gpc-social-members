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

/**
 * Every live (paid/free) registration for an event, scoped for the redemption check above.
 * The single query behind isWaitlistEntryRedeemed at all four call sites (the admin repair
 * route, the admin offer route, the register route, and the public offer landing) — kept
 * here so the query shape can't drift from what the predicate expects.
 */
export async function fetchLiveRegistrationsForRedemption(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<{
  data: (LiveRegistrationForRedemption & { reference_code: string })[] | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("event_registrations")
    .select("waitlist_entry_id, email, reference_code")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  return { data, error };
}
