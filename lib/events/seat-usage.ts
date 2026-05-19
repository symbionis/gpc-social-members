// Single source of truth for event capacity math.
//
// Cap counts SUM(quantity) across event_registrations WHERE status IN ('paid','free').
// Pending Stripe checkouts are NOT counted (oversell-by-one race accepted).
// See docs/plans/2026-05-19-001-feat-event-registration-cap-plan.md (U2).
//
// Counting goes through Postgres RPC functions (seats_used, seats_used_by_events)
// rather than fetching rows and summing client-side. This avoids the Supabase JS
// 1000-row default truncation, which would silently under-count on hot events.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const LOW_AVAILABILITY_THRESHOLD = 5;

export interface SeatState {
  isFullyBooked: boolean;
  seatsRemaining: number | null;
  isLowAvailability: boolean;
}

export async function getSeatsUsed(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<number> {
  const { data, error } = await supabase.rpc("seats_used", { eid: eventId });

  if (error) {
    throw new Error(`Failed to compute seat usage: ${error.message}`);
  }

  return typeof data === "number" ? data : 0;
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
// returns a map of eventId -> SeatState. One query for all events; rows
// summed in app code. Uncapped events are omitted from the map (caller
// treats absence as "no badge, no indicator").
export async function getSeatStateByEvent(
  supabase: SupabaseClient<Database>,
  events: ReadonlyArray<{ id: string; seat_cap: number | null }>
): Promise<Record<string, SeatState>> {
  const capped = events.filter(
    (e): e is { id: string; seat_cap: number } =>
      e.seat_cap !== null && e.seat_cap !== undefined
  );
  if (capped.length === 0) return {};

  const eventIds = capped.map((e) => e.id);
  const { data, error } = await supabase.rpc("seats_used_by_events", {
    ids: eventIds,
  });

  if (error) {
    throw new Error(`Failed to compute seat usage: ${error.message}`);
  }

  const usedById: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ event_id: string; seats_used: number }>) {
    if (!row.event_id) continue;
    usedById[row.event_id] = row.seats_used;
  }

  const result: Record<string, SeatState> = {};
  for (const e of capped) {
    result[e.id] = deriveSeatState({
      seatCap: e.seat_cap,
      seatsUsed: usedById[e.id] ?? 0,
    });
  }
  return result;
}
