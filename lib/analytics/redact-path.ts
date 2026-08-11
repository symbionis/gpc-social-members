// U5 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md.
//
// PostHog stamps `$current_url`/`$pathname` on every captured event. An offer
// link's token is a long-lived emailed secret (KTD4) — shipping it verbatim
// would leak a credential to an analytics vendor. These helpers replace the
// token segment with the literal placeholder `[token]` before capture.
//
// Redacting the PATH ALONE IS NOT ENOUGH. On a members-only event the offer
// landing sends a signed-out visitor to `/login?next=/public/offers/<token>`
// (AE8), so the live token rides in the query string of a page whose own path
// is innocuous. `redactUrlForAnalytics` is therefore the one to reach for at
// capture sites; `redactPathForAnalytics` remains for `$pathname`, which has no
// query component.
//
// Pure string logic, kept out of the client component so it's unit-testable
// without a DOM.

const REDACTED_PATH = "/public/offers/[token]";

const OFFER_PATH_RE = /^\/public\/offers\/[^/]+/;
// Unanchored: matches an offer path wherever it appears, including inside a
// query-parameter value. Stops at the delimiters that would end a path.
const OFFER_PATH_ANYWHERE_RE = /\/public\/offers\/[^/?#&\s]+/g;
// Percent-encoded form, for the fallback path where the URL can't be parsed and
// so the query string is never decoded (`?next=%2Fpublic%2Foffers%2F<token>`).
const OFFER_PATH_ENCODED_RE = /%2Fpublic%2Foffers%2F[^&#\s]+/gi;
const REDACTED_PATH_ENCODED = "%2Fpublic%2Foffers%2F%5Btoken%5D";

/** Redacts an offer token from a pathname so analytics never see the live secret. */
export function redactPathForAnalytics(pathname: string): string {
  return pathname.replace(OFFER_PATH_RE, REDACTED_PATH);
}

/**
 * Redacts an offer token from a full URL — both from the path itself and from
 * any query-parameter value carrying an offer path (the `?next=` sign-in round
 * trip). Every parameter is swept rather than just `next`, so a future redirect
 * param can't silently reopen the leak.
 *
 * Never throws: a URL that won't parse falls back to string-level redaction of
 * the plain and percent-encoded forms, which is strictly better than returning
 * the token intact from an analytics hook.
 */
export function redactUrlForAnalytics(href: string): string {
  try {
    const url = new URL(href);
    url.pathname = redactPathForAnalytics(url.pathname);
    for (const [key, value] of Array.from(url.searchParams.entries())) {
      const redacted = value.replace(OFFER_PATH_ANYWHERE_RE, REDACTED_PATH);
      if (redacted !== value) url.searchParams.set(key, redacted);
    }
    return url.toString();
  } catch {
    return href
      .replace(OFFER_PATH_ANYWHERE_RE, REDACTED_PATH)
      .replace(OFFER_PATH_ENCODED_RE, REDACTED_PATH_ENCODED);
  }
}
