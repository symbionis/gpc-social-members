// Stripe dashboard deep links.
//
// Pure string helpers — no Stripe SDK, no network. Safe to import from client
// components; the only server-only input is the secret key, which must be read
// in a server component and passed down as the `testMode` boolean (see
// `stripeTestModeFromKey` below).

// A Stripe handle that resolves to a dashboard page. The PaymentIntent is
// preferred over the Checkout Session: it resolves to a charge and to refund
// metadata, whereas a session can exist with no successful charge.
export interface StripeRef {
  kind: "payment_intent" | "checkout_session";
  id: string;
}

// Live keys (secret `sk_live_…` and restricted `rk_live_…`) carry this marker.
const LIVE_KEY_MARKER = "_live_";

// Derive dashboard mode from the Stripe secret key by testing for the LIVE
// marker rather than the test one. An absent, empty, renamed, or otherwise
// unrecognized key therefore resolves to TEST mode. The inverse check (testing
// for `_test_`) resolves to "live" whenever the key is missing — which points a
// staging admin at real production payments, where the obvious next action is a
// refund. Failing safe costs a broken link; failing open costs money.
export function stripeTestModeFromKey(key: string | null | undefined): boolean {
  return !(key ?? "").includes(LIVE_KEY_MARKER);
}

// Dashboard URL for a reference, or null when there is no reference to link to.
// Callers render an explicit "no reference" label for null rather than an empty
// cell — an absent link must never read as an absent payment.
export function stripeDashboardUrl(ref: StripeRef | null, testMode: boolean): string | null {
  if (!ref) return null;
  const mode = testMode ? "test/" : "";
  const path = ref.kind === "payment_intent" ? "payments" : "checkout/sessions";
  return `https://dashboard.stripe.com/${mode}${path}/${ref.id}`;
}

// Lowercase noun for the reference kind, for assistive-technology labels
// ("Open payment for Ana Adult…"). Exported so the UI never branches on `kind`.
export function stripeRefLabel(ref: StripeRef): string {
  return ref.kind === "payment_intent" ? "payment" : "checkout session";
}
