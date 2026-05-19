// Three-tier capacity badge ladder used on event list cards and detail
// pages. Mutually exclusive: a closed event shows nothing here; a full
// event shows "Fully booked"; a low-availability event shows "Only N
// left"; otherwise the event shows "Limited seats". An uncapped event
// (seatState null/undefined) shows nothing.
//
// Pass the registrationEnabled flag explicitly so this component never
// renders capacity copy on a closed event regardless of seatState.

import type { SeatState } from "@/lib/events/seat-usage";

interface Props {
  registrationEnabled: boolean | null | undefined;
  seatState: SeatState | undefined | null;
  /** Show no badges at all (used to hide capacity state from non-members). */
  suppress?: boolean;
}

export default function SeatBadges({
  registrationEnabled,
  seatState,
  suppress = false,
}: Props) {
  if (suppress) return null;
  if (!registrationEnabled) return null;
  if (!seatState) return null;

  const { isFullyBooked, isLowAvailability, seatsRemaining } = seatState;

  if (isFullyBooked) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-marine/10 text-marine">
        Fully booked
      </span>
    );
  }

  if (isLowAvailability && seatsRemaining !== null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
        Only {seatsRemaining} left
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-sky/10 text-sky-dark">
      Limited seats
    </span>
  );
}
