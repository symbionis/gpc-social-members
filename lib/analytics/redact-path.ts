// U5 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md.
//
// `PageviewTracker` in components/PostHogProvider.tsx builds `$current_url` from
// the real browser pathname. An offer link's token is a long-lived emailed secret
// (KTD4) — shipping it verbatim to PostHog would leak a credential to an analytics
// vendor on every offer-landing view. This redacts the token segment before the
// pageview is captured, replacing it with the literal placeholder `[token]`.
//
// Pure string logic, kept out of the client component so it's unit-testable
// without a DOM.

const OFFER_PATH_RE = /^\/public\/offers\/[^/]+/;

/** Redacts an offer token from a pathname so analytics never see the live secret. */
export function redactPathForAnalytics(pathname: string): string {
  return pathname.replace(OFFER_PATH_RE, "/public/offers/[token]");
}
