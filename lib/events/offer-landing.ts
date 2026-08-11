// U5 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md.
//
// Pure decision logic for the offer landing's gate (the "Offer landing
// gate" flowchart in the plan's High-Level Technical Design). Kept out of
// app/(public)/public/offers/[token]/page.tsx — a server component the repo does
// not unit-test directly (see lib/events/waitlist-offer.ts's header comment for the
// same reasoning) — so the gate order and each branch's conditions are
// unit-testable without a Supabase client or a DOM.
//
// The caller is responsible for every I/O step this function's inputs assume:
// resolving the token, loading the event, checking the session, and deriving
// `redeemed` / `seatsFree` (via lib/events/waitlist-offer.ts's
// isWaitlistEntryRedeemed and lib/events/seat-usage.ts's getSeatsUsed).

export interface OfferLandingEntry {
  id: string;
  email: string;
  /** R13: a legacy entry can carry a null/invalid quantity. Treated as an invalid
   *  link rather than silently coerced — the register route makes the same call. */
  quantity: number | null;
}

export interface OfferLandingEvent {
  is_published: boolean;
  registration_enabled: boolean;
  /** True when the event's visibility is anything other than "public". */
  isMembersOnly: boolean;
}

export interface RedeemedRegistration {
  reference_code: string;
}

export interface ResolveOfferLandingInput {
  /** null when the token did not resolve to any waitlist entry. */
  entry: OfferLandingEntry | null;
  /** null when the entry resolved but its event could not be loaded. */
  event: OfferLandingEvent | null;
  isLoggedIn: boolean;
  isActiveMember: boolean;
  /** Non-null when the entry (or its email, R12) already holds a live paid/free
   *  registration for the event — the caller has already run that lookup. */
  redeemedRegistration: RedeemedRegistration | null;
  /** Seats free right now, already accounting for the event's cap. null = uncapped. */
  seatsFree: number | null;
  /** Where to send a signed-out visitor to sign in, already carrying `?next=`. */
  loginUrl: string;
}

export type OfferLandingOutcome =
  | { kind: "invalid" }
  | { kind: "closed" }
  | { kind: "signin_redirect"; loginUrl: string }
  | { kind: "members_only" }
  | { kind: "already_registered"; referenceCode: string }
  | { kind: "seats_gone" }
  | { kind: "checkout"; redeemableQuantity: number };

/**
 * Resolves one outcome — six pre-checkout ones plus checkout itself — in the order
 * the flowchart states them: token → event open → membership → redeemed → seats free → checkout.
 */
export function resolveOfferLandingOutcome(
  input: ResolveOfferLandingInput
): OfferLandingOutcome {
  const { entry, event, isLoggedIn, isActiveMember, redeemedRegistration, seatsFree, loginUrl } =
    input;

  if (!entry) return { kind: "invalid" };
  // A repaired-but-never-fixed legacy entry (R13) fails closed here exactly as the
  // register route does — no path may derive a redeemable quantity from a null.
  if (entry.quantity === null || !Number.isInteger(entry.quantity) || entry.quantity < 1) {
    return { kind: "invalid" };
  }

  if (!event) return { kind: "invalid" };
  if (!event.is_published || !event.registration_enabled) return { kind: "closed" };

  if (event.isMembersOnly) {
    if (!isLoggedIn) return { kind: "signin_redirect", loginUrl };
    if (!isActiveMember) return { kind: "members_only" };
  }

  if (redeemedRegistration) {
    return { kind: "already_registered", referenceCode: redeemedRegistration.reference_code };
  }

  const redeemableQuantity =
    seatsFree === null ? entry.quantity : Math.min(entry.quantity, seatsFree);

  if (redeemableQuantity <= 0) return { kind: "seats_gone" };

  return { kind: "checkout", redeemableQuantity };
}
