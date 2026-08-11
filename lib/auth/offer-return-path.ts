// U5 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md.
//
// The member sign-in redirect (`verifyOtpCode` in app/actions/auth.ts, and the
// OAuth-equivalent path in app/auth/callback/route.ts) both hard-code `/dashboard`
// as the post-login destination for a member. R11/KTD7 need a signed-out offer
// holder to land back on the offer landing they came from, so both call sites
// accept an optional `next` and use this validator to decide whether to honour it.
//
// This is a security-relevant redirect target: `next` arrives as an unauthenticated
// query param an attacker fully controls, so only a same-origin relative path under
// `/public/offers/` is ever trusted. Everything else — an absolute URL, a
// protocol-relative `//host/...` open-redirect, a path outside the offer landing —
// falls back to `/dashboard`. Kept as a pure function so the fallback behaviour is
// unit-testable without exercising Supabase auth.

const OFFER_PATH_PREFIX = "/public/offers/";

/**
 * Returns `next` unchanged when it is a safe same-origin relative path into the
 * offer landing, otherwise null so the caller can fall back to its default
 * destination (`/dashboard`).
 */
export function safeOfferReturnPath(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0) return null;
  // Reject anything that isn't a bare relative path: no scheme (`https:...`,
  // `javascript:...`), and — critically — no leading `//`, which a browser resolves
  // as protocol-relative to an attacker-controlled host rather than as a path.
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  // Backslashes are browser-normalized to forward slashes by some UAs, so
  // `/\evil.com` can behave like `//evil.com`. Reject any backslash outright.
  if (next.includes("\\")) return null;
  if (!next.startsWith(OFFER_PATH_PREFIX)) return null;
  // Must name a token — the prefix alone isn't a valid landing.
  if (next.length <= OFFER_PATH_PREFIX.length) return null;
  return next;
}
