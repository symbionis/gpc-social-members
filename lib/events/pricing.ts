// Shared event pricing (U11, KTD5). One module owns how a ticket type resolves to a unit
// price, so register, top-up, upgrade, and the booking display page stop hand-copying the
// expression and drift can't reappear.
//
// There are TWO distinct rules in the codebase, kept distinct here on purpose — collapsing
// them into one would silently change prices:
//
//   1. priceForRateClass — the register checkout. The rate class is decided up front from
//      session + event visibility (member / invited-guest-on-members-only / public
//      non-member), and each class reads exactly one column.
//
//   2. resolvePrice — top-up, upgrade (convert), and the booking display. These only know
//      the registration's membership, so a non-member coalesces price_non_member → invite_price
//      (a members-only event has no non-member price, so an invited guest keeps the invite
//      rate they booked at).
//
// Both return the RAW column value (a `number | null`); callers apply the strict null/finite
// guard via `isUsablePrice` before charging — `Number(null) === 0` would silently make a line
// free, so an unset price must fail loud, never under-charge.

export interface PriceColumns {
  price_member: number | null;
  price_non_member: number | null;
  invite_price: number | null;
}

export type RateClass = "member" | "invite" | "non_member";

/** Register checkout: price for an explicitly-decided rate class. */
export function priceForRateClass(t: PriceColumns, rateClass: RateClass): number | null {
  switch (rateClass) {
    case "member":
      return t.price_member;
    case "invite":
      return t.invite_price;
    case "non_member":
      return t.price_non_member;
  }
}

/** Top-up / upgrade / display: price from the registration's membership, with the
 *  members-only invite fallback for non-members. */
export function resolvePrice(t: PriceColumns, reg: { is_member: boolean }): number | null {
  return reg.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
}

/** True when a resolved price is safe to charge: present, finite, non-negative. Mirrors the
 *  strict guard every call site used inline. */
export function isUsablePrice(unit: number | null): unit is number {
  return unit !== null && Number.isFinite(Number(unit)) && Number(unit) >= 0;
}
