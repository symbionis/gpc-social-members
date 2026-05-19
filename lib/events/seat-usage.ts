// Single source of truth for event capacity math.
//
// Cap counts SUM(quantity) across event_registrations WHERE status IN ('paid','free').
// Pending Stripe checkouts are NOT counted (oversell-by-one race accepted).
// See docs/plans/2026-05-19-001-feat-event-registration-cap-plan.md (U2).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const LOW_AVAILABILITY_THRESHOLD = 5;

const COUNTED_STATUSES = ["paid", "free"] as const;

export interface SeatState {
  isFullyBooked: boolean;
  seatsRemaining: number | null;
  isLowAvailability: boolean;
}

export async function getSeatsUsed(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("event_registrations")
    .select("quantity")
    .eq("event_id", eventId)
    .in("status", COUNTED_STATUSES as unknown as string[]);

  if (error) {
    throw new Error(`Failed to compute seat usage: ${error.message}`);
  }

  return (data ?? []).reduce((acc, row) => acc + (row.quantity ?? 0), 0);
}

export function deriveSeatState({
  seatCap,
  seatsUsed,
}: {
  seatCap: number | null;
  seatsUsed: number;
}): SeatState {
  if (seatCap === null || seatCap === undefined) {
    return {
      isFullyBooked: false,
      seatsRemaining: null,
      isLowAvailability: false,
    };
  }

  const remaining = Math.max(0, seatCap - seatsUsed);
  const isFullyBooked = remaining === 0;
  const isLowAvailability =
    !isFullyBooked && remaining <= LOW_AVAILABILITY_THRESHOLD;

  return {
    isFullyBooked,
    seatsRemaining: remaining,
    isLowAvailability,
  };
}

export function isFreeForRegistrant({
  unitAmount,
}: {
  unitAmount: number;
}): boolean {
  return unitAmount === 0;
}

// Batch helper for list views. Given a list of events with their seat caps,
// returns the subset of event IDs that are fully booked. One query for all
// events; rows summed in app code. Events with null seat_cap never appear.
export async function getFullyBookedEventIds(
  supabase: SupabaseClient<Database>,
  events: ReadonlyArray<{ id: string; seat_cap: number | null }>
): Promise<Set<string>> {
  const capped = events.filter(
    (e): e is { id: string; seat_cap: number } =>
      e.seat_cap !== null && e.seat_cap !== undefined
  );
  if (capped.length === 0) return new Set();

  const eventIds = capped.map((e) => e.id);
  const { data, error } = await supabase
    .from("event_registrations")
    .select("event_id, quantity")
    .in("event_id", eventIds)
    .in("status", COUNTED_STATUSES as unknown as string[]);

  if (error) {
    throw new Error(`Failed to compute seat usage: ${error.message}`);
  }

  const usedById: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.event_id) continue;
    usedById[row.event_id] = (usedById[row.event_id] ?? 0) + (row.quantity ?? 0);
  }

  const fullyBooked = new Set<string>();
  for (const e of capped) {
    if ((usedById[e.id] ?? 0) >= e.seat_cap) {
      fullyBooked.add(e.id);
    }
  }
  return fullyBooked;
}
