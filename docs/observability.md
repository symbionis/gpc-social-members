# Observability

PostHog is the single observability backend for this app. It handles product
analytics, web analytics, and error tracking.

## What gets captured

| Source | Captured as | Where wired |
|---|---|---|
| Page navigation | `$pageview` events | `components/PostHogProvider.tsx` |
| Click + form interactions | `$autocapture` | `components/PostHogProvider.tsx` (`autocapture: true`) |
| Unhandled client exceptions and unhandledrejection | PostHog Issues | `components/PostHogProvider.tsx` (`capture_exceptions: true`) |
| React render errors | PostHog Issues | `app/error.tsx`, `app/global-error.tsx` |
| API route / server component / server action exceptions | PostHog Issues | `instrumentation.ts` `onRequestError` → `lib/analytics/server-errors.ts` |
| Domain validation failures (`event_save_failed`, `broadcast_draft_*`, …) | Custom events | Component-local `posthog.capture(...)` calls |
| Domain success events | Custom events | `lib/analytics/server.ts` (HTTP capture) |

## Redacted fields

Server-side exception capture passes context through a strict allowlist in
`lib/analytics/server-errors.ts`. Only these keys reach PostHog:

`path`, `method`, `status`, `user_id`, `distinct_id`, `route_kind`, `digest`

Request bodies, headers, query strings, and cookies are never forwarded.

## Environment variables

| Variable | Lifecycle | Required for | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | Runtime | analytics, error tracking | Read via body data-attribute fallback so Railway runtime envs work without a rebuild |
| `NEXT_PUBLIC_POSTHOG_HOST` | Runtime | analytics, error tracking | Defaults to `https://eu.i.posthog.com` |
| `POSTHOG_PERSONAL_API_KEY` | Build-time | source-map upload | Personal API key with `write` scope; project-scoped |
| `POSTHOG_ENV_ID` | Build-time | source-map upload | Found under PostHog → Settings → Environment |

Source maps upload only when **both** `POSTHOG_PERSONAL_API_KEY` and
`POSTHOG_ENV_ID` are present. Builds without them succeed but produce
minified stack traces in PostHog Issues.

## Verifying capture

1. Trigger a deliberate client-side exception from the admin shell:
   `posthog.captureException(new Error("verify-error-tracking"))` in the dev
   console, or wire a temporary `throw` in any client component.
2. Confirm the Issue appears in PostHog → Error Tracking within ~30 seconds.
3. For server-side: throw inside an API route handler in dev. The same Issue
   surface should receive it with `path` and `method` set.

## Why both autocapture and explicit `*_failed` events?

Autocapture catches "something exploded" — generic visibility for the long
tail of crashes. Domain events like `event_save_failed` carry business
context (`event_id`, `visibility`, `registration_enabled`) that a stack trace
can't reconstruct. They're complementary, not redundant.
