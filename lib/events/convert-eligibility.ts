// Pure eligibility logic for the Booking Page "Change ticket type" affordance (U4).
// Kept out of the client component so it can be unit-tested in the node env.
//
// The server (POST .../convert) is the authority on eligibility, pricing, and seat cap;
// this only decides what to OFFER so the lead isn't shown targets that would be rejected.
// Upgrade-only: a target must be same-or-higher priced (delta >= 0) and not be the
// ticket's current type. The child<->adult restriction is gone (R9) — any same-or-higher
// priced type is a valid target regardless of the former child flag.

export interface ConvertType {
  id: string;
  title: string;
  /** Numeric price at the booking's rate class (member vs non-member, invite fallback). */
  price: number;
}

/**
 * Same-or-higher priced target types, excluding the current type, sorted cheapest-first.
 * Returns [] when the current type is unknown (e.g. archived) so no conversion is offered.
 */
export function eligibleConvertTargets(
  currentTypeId: string,
  types: ConvertType[]
): ConvertType[] {
  const current = types.find((t) => t.id === currentTypeId);
  if (!current) return [];
  return types
    .filter((t) => t.id !== current.id && t.price >= current.price)
    .sort((a, b) => a.price - b.price);
}
