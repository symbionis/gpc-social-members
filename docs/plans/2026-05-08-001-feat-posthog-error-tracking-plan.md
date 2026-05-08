---
title: feat: Adopt PostHog Error Tracking across web + API
type: feat
status: active
date: 2026-05-08
---

# feat: Adopt PostHog Error Tracking across web + API

## Summary

Replace ad-hoc `posthog.capture("*_failed", ...)` events with PostHog's first-class Error Tracking product so unhandled exceptions, React render errors, and server-side request errors flow into PostHog as Issues (grouped, alertable, with stack traces). Wire client autocapture, App Router error boundaries, and a Next.js `instrumentation.ts` `onRequestError` hook that uses `posthog-node` for server-side exceptions. Keep the hand-rolled domain events (`event_save_failed`, `broadcast_*`) because they carry business-meaningful context that exception traces don't replace.

---

## Problem Frame

Today the only error signal in PostHog is custom `*_failed` capture events sprinkled in two components (`BroadcastComposer`, `EventManager`). Most failure modes — uncaught client exceptions, React render errors, `app/error.tsx` activations, API route 500s — produce nothing. We just confirmed this gap operationally: the Asado save was 500-failing in production for over a week without any signal in PostHog because no one had wrapped that path in a `try/catch + capture`. PostHog ships an Error Tracking product specifically for this; we're not using it.

---

## Requirements

- R1. Unhandled client-side exceptions in any route are captured in PostHog Error Tracking with stack traces and route context.
- R2. React render errors handled by `app/error.tsx` (and a new `app/global-error.tsx`) are reported to PostHog before the boundary renders.
- R3. Server-side exceptions in API routes, server components, and server actions are captured via Next.js `instrumentation.ts` `onRequestError`.
- R4. Existing domain events (`event_save_failed`, `broadcast_draft_*`, etc.) remain — they capture intentional, validation-tier failures that aren't exceptions.
- R5. Stack traces in PostHog point to original source (source maps uploaded at build time) so issues are debuggable without reproduction.
- R6. Capture works on Railway runtime — no NEXT_PUBLIC env baking surprises (matches the existing data-attribute fallback pattern in `app/layout.tsx`).
- R7. PII-sensitive request bodies are not blindly attached to exceptions; only safe metadata (path, method, user_id when admin, error message, stack).

---

## Scope Boundaries

- Reverse-proxy of PostHog through `social.genevapolo.com` to bypass ad blockers — separate concern (covered in conversation, not this plan).
- App-wide systematic `try/catch` audit of every fetch/await — this plan adopts autocapture and boundaries; per-route hardening is follow-up.
- Custom dashboards and alert rules in PostHog — configured by hand in PostHog UI, not in code.
- Server-side `posthog-node` event capture beyond exceptions (e.g., replacing `lib/analytics/server.ts` HTTP-direct captures) — not required; the existing helper stays for analytics, `posthog-node` is added strictly for error tracking.

### Deferred to Follow-Up Work

- Reverse-proxy PostHog through `/ph/*` rewrite to defeat ad blockers.
- Audit and instrument server-side `try/catch` blocks that currently swallow errors silently (e.g., the route handlers in `app/api/admin/events/update/route.ts` log to console only).

---

## Context & Research

### Relevant Code and Patterns

- `components/PostHogProvider.tsx` — current client init (autocapture: true, `disable_session_recording: true`). Reads key/host from body data-attributes; init flag stored on `window.__ph_initialized`.
- `app/layout.tsx` — passes `data-posthog-key` / `data-posthog-host` from env to body so Railway runtime envs work.
- `lib/analytics/server.ts` — fire-and-forget HTTP capture against `/i/v0/e/`. Pattern stays for analytics events; not used for exceptions.
- `app/error.tsx` — existing route-level error boundary; currently silent (no capture).
- `components/admin/BroadcastComposer.tsx`, `components/admin/EventManager.tsx` — domain `*_failed` events stay in place.

### Institutional Learnings

- `feedback_railway_nextjs_env.md` — `NEXT_PUBLIC_*` vars are baked at build time on Railway; runtime overrides require redeploy. Mitigation already applied via body data-attributes — the new error tracking init must use the same path.
- `feedback_sdk_lazy_init.md` — third-party SDKs that read env at module scope break the Next build. `posthog-node` client must be lazy-instantiated inside a getter, not at module top-level.

### External References

- PostHog Error Tracking docs (Next.js setup): exception autocapture flag in `posthog-js`, `posthog-node` `captureException`, `instrumentation.ts` `onRequestError` hook, `@posthog/nextjs-config` for source-map upload.
- Next.js 15 `instrumentation.ts` and `onRequestError` API.

---

## Key Technical Decisions

- **Use PostHog Error Tracking, not Sentry.** PostHog already ships in this app, the same identity/cookies join exceptions to sessions and feature flags, and a second observability vendor doubles the env/secret surface.
- **Keep both autocapture and explicit domain events.** Autocapture catches "something exploded"; explicit events like `event_save_failed` carry business context (which event_id, which visibility flip) that a generic stack trace can't reconstruct.
- **Lazy-init `posthog-node` via a `getServerPosthog()` getter** — same pattern used for Stripe/Postmark per the Railway feedback memory.
- **Source-map upload via `@posthog/nextjs-config`** wrapping `next.config.js`, not via a separate post-build script — simpler, idiomatic, and runs in Railway's build step automatically.
- **Server-only error tracker import.** `posthog-node` must never appear in a client bundle. Import path lives under `lib/analytics/server-errors.ts` and is only referenced from server contexts (`instrumentation.ts`, route handlers).
- **PII guard at capture time, not config.** Wrap `captureException` calls with a `sanitizeContext()` that strips bodies/headers and keeps only path, method, status, user-id (when known via Supabase session). Centralized so every call goes through one funnel.

---

## Open Questions

### Resolved During Planning

- Where to init `posthog-node`? — Lazy getter in `lib/analytics/server-errors.ts`; consumed by `instrumentation.ts` and any explicit `captureException` callers.
- Does `posthog-js` 1.372.8 support exception autocapture? — Yes; flag is `capture_exceptions: true` (added in 1.96+).
- How do exceptions reach PostHog in Edge runtime? — `instrumentation.ts` `onRequestError` runs in the Node runtime by default; we keep API routes on Node (already the case per repo memory). Edge-only routes are out of scope.

### Deferred to Implementation

- Exact shape of the `sanitizeContext()` allowlist — finalized when wiring the first capture call; depends on what fields the Supabase server client exposes synchronously.
- Whether to gate error capture behind a `NEXT_PUBLIC_POSTHOG_KEY` presence check the same way the provider does (likely yes; mirror the existing no-op fallback).

---

## Implementation Units

### U1. Enable client-side exception autocapture

**Goal:** Turn on PostHog's built-in exception autocapture so unhandled client errors create Issues automatically.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**
- Modify: `components/PostHogProvider.tsx`

**Approach:**
- Add `capture_exceptions: true` to the `posthog.init` options object.
- No new env vars; reuse existing key/host data-attribute resolution.
- Leave `disable_session_recording: true` and `person_profiles: "identified_only"` untouched.

**Patterns to follow:**
- The existing init block in `components/PostHogProvider.tsx` — add the new flag inline next to `autocapture: true`.

**Test scenarios:**
- Happy path: throwing `throw new Error("test-poshog-capture")` from a button handler in dev creates a PostHog Error Tracking issue with the message and stack.
- Edge case: when `NEXT_PUBLIC_POSTHOG_KEY` is empty, init short-circuits and no network call fires (existing behavior preserved).

**Verification:**
- A deliberate test exception triggered from the admin shell appears in PostHog Error Tracking within ~30s with file/line in the stack trace.

---

### U2. Wire `app/error.tsx` and add `app/global-error.tsx` to report React render errors

**Goal:** Capture errors that hit App Router error boundaries so the user-visible "Something went wrong" screen is also a PostHog Issue.

**Requirements:** R2

**Dependencies:** U1

**Files:**
- Modify: `app/error.tsx`
- Create: `app/global-error.tsx`

**Approach:**
- In both files, use a `useEffect` on mount to call `posthog.captureException(error, { digest: error.digest })`.
- `global-error.tsx` is required for App Router to catch errors thrown in the root layout itself; it must render its own `<html><body>` shell.
- Match existing `app/error.tsx` visual treatment in `global-error.tsx` (heading, button) so the fallback UI is consistent.

**Patterns to follow:**
- Existing `app/error.tsx` markup — extend with a `useEffect` block; do not change visual design.
- Existing `try { posthog.capture(...) } catch { /* not init */ }` defensive pattern in `BroadcastComposer.tsx`.

**Test scenarios:**
- Happy path: a server component that throws renders `app/error.tsx` AND emits an exception to PostHog with the same `digest`.
- Edge case: error in root layout falls through to `global-error.tsx` and is captured.
- Edge case: PostHog not initialized (e.g., key missing) — boundary still renders, no console error.

**Verification:**
- Forcing a `throw` in a member route shows the existing error UI and creates a PostHog Issue tagged with the route path.

---

### U3. Add `posthog-node` and a lazy server-side error capture helper

**Goal:** Provide a single server-only entry point for capturing exceptions, with a lazy-instantiated PostHog client and a context sanitizer.

**Requirements:** R3, R7, R6

**Dependencies:** None

**Files:**
- Create: `lib/analytics/server-errors.ts`
- Modify: `package.json` (add `posthog-node`)

**Approach:**
- Export `captureServerException(error: unknown, context?: Record<string, unknown>): void`.
- Lazy getter `getServerPosthog()` returns a singleton `PostHog` client instantiated on first call; reads `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`. Returns null when key is missing (no-op path).
- Sanitize context: allowlist `{ path, method, status, user_id, distinct_id, route_kind }`. Drop everything else — never pass through raw request bodies, headers, or query strings.
- Fire-and-forget pattern: `client.captureException(...).catch(() => {})`. Never await in caller paths; never throw.
- Module must be safe to import from server contexts only — add a top-of-file comment noting "do not import from client components".

**Patterns to follow:**
- Lazy-init pattern from existing Stripe/Postmark wrappers (per `feedback_sdk_lazy_init.md` memory).
- `lib/analytics/server.ts` for the env-resolution and silent-no-op patterns.

**Test scenarios:**
- Happy path: calling `captureServerException(new Error("boom"), { path: "/api/x" })` reaches PostHog as an exception with the path tag.
- Edge case: `NEXT_PUBLIC_POSTHOG_KEY` missing → returns immediately, no network call, no throw.
- Error path: PostHog HTTP 500 → caller path unaffected (no throw, no unhandled rejection).
- Integration: helper imported into a route handler and called inside a `catch` produces an Issue grouped with prior identical errors.

**Verification:**
- A unit test (or scripted `node -e`) calls the helper with a constructed error and observes the request body sent to the PostHog endpoint matches the sanitized shape.

---

### U4. Add `instrumentation.ts` with `onRequestError` to capture API/server-component errors

**Goal:** Catch exceptions thrown from API routes, server components, and server actions automatically — no per-route changes required.

**Requirements:** R3, R7

**Dependencies:** U3

**Files:**
- Create: `instrumentation.ts` (project root, alongside `next.config.js`)

**Approach:**
- Export `register()` and `onRequestError(err, request, context)`.
- `register()` may be empty (no global init needed since the helper is lazy).
- `onRequestError` calls `captureServerException(err, { path: request.path, method: request.method, route_kind: context.routerKind, status: context.routePath })`. Sanitizer in U3 enforces the final allowlist.
- Confirm Next.js config picks it up — `instrumentation.ts` at repo root is auto-detected in Next 15+; no `experimental.instrumentationHook` flag needed on current version.

**Patterns to follow:**
- Standard Next.js instrumentation shape from official docs — keep the file minimal.

**Test scenarios:**
- Happy path: throwing inside an API route handler (`/api/admin/events/update` forced to throw) creates a PostHog Issue with path `/api/admin/events/update` and method `POST`.
- Happy path: throwing in a server component renders the boundary AND emits a server exception (so the same incident produces a client + server pair, joinable by `digest`).
- Edge case: errors in `instrumentation.ts` itself (e.g., helper throws) do not crash the server — caller path catches.
- Integration: a handled 4xx response (e.g., the existing 400 validation in events/update) does NOT fire `onRequestError` — only true exceptions, not response codes.

**Verification:**
- A throw injected into one API route surfaces as a PostHog Issue grouped under that route name with stack lines pointing to source files.

---

### U5. Configure source-map upload via `@posthog/nextjs-config`

**Goal:** Production stack traces resolve to original TypeScript source instead of minified bundle output.

**Requirements:** R5

**Dependencies:** U1, U3

**Files:**
- Modify: `next.config.js` (or `next.config.ts` if present — confirm at implementation)
- Modify: `package.json` (add `@posthog/nextjs-config` devDependency)
- Modify: `.env.local.example` (document `POSTHOG_API_KEY` for source-map upload — distinct from `NEXT_PUBLIC_POSTHOG_KEY`)
- Modify: Railway env config (out-of-band, document in `## Documentation / Operational Notes`)

**Approach:**
- Wrap exported config: `module.exports = withPostHogConfig(nextConfig, { posthogToken: process.env.POSTHOG_API_KEY, posthogHost: ..., posthogEnvId: ... })`.
- Source-map upload runs at `next build` time. Requires a project-scoped personal API key in Railway env (build-time only, not exposed to client).
- Verify build still succeeds when the upload key is missing — the wrapper should no-op gracefully (confirm at implementation; fall back to a conditional wrap if not).

**Patterns to follow:**
- Existing `next.config.js` structure — minimal edits, single wrapper.

**Test scenarios:**
- Test expectation: none — build-time configuration. Verification is operational.

**Verification:**
- Build log shows source-map upload step succeeding.
- A captured exception in PostHog shows file paths like `app/api/admin/events/update/route.ts:87` rather than `chunks/abc.js:1:23456`.

---

### U6. Documentation and runtime config notes

**Goal:** Capture the setup, env vars, and operational expectations so this doesn't regress on the next deploy.

**Requirements:** R6

**Dependencies:** U1–U5

**Files:**
- Modify: `.env.local.example` (note `POSTHOG_API_KEY` for source maps; existing `NEXT_PUBLIC_POSTHOG_KEY` already there)
- Modify: `docs/agent-api.md` or a new `docs/observability.md` — short page describing what's captured, what's redacted, where Issues live in PostHog.

**Approach:**
- One-page doc: client autocapture, error boundaries, server `onRequestError`, source maps, redacted fields, opt-out (none — analytics-only product).
- Note Railway env vars: `NEXT_PUBLIC_POSTHOG_KEY` (runtime), `NEXT_PUBLIC_POSTHOG_HOST` (runtime), `POSTHOG_API_KEY` (build-time only).

**Test scenarios:**
- Test expectation: none — documentation.

**Verification:**
- Doc renders and lists all three env vars with their lifecycle (runtime vs build-time).

---

## System-Wide Impact

- **Interaction graph:** New imports of `lib/analytics/server-errors.ts` from `instrumentation.ts` and (later) any route handler that wants explicit capture. No client-side imports allowed.
- **Error propagation:** Autocapture and `onRequestError` are non-blocking; capture failures swallow and never affect user-facing requests.
- **State lifecycle risks:** `posthog-node` client is a singleton with an internal queue. On serverless cold starts (Railway is long-running so less of a concern, but still: the client should `flush()` on shutdown). Risk is bounded — at-most-some-events-lost on hard kill, never user impact.
- **API surface parity:** All API routes now reachable by `onRequestError` automatically; no per-route opt-in required.
- **Integration coverage:** Per-route try/catch blocks (e.g., the `console.error` paths in `app/api/admin/events/update/route.ts`) still don't propagate to PostHog. They catch and return JSON 500 *before* the error bubbles to `onRequestError`. Follow-up work to convert those to "log + captureServerException + return" is deferred (Scope Boundaries).
- **Unchanged invariants:** `lib/analytics/server.ts` continues to handle business event captures (broadcast_sent, etc.). No existing capture call sites change behavior.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `posthog-node` accidentally bundled into client → bundle bloat + crash | Server-only file path (`lib/analytics/server-errors.ts`), top-of-file marker comment, ESLint `no-restricted-imports` rule could be added if it recurs |
| Source-map upload fails on Railway and breaks deploy | Confirm graceful no-op when `POSTHOG_API_KEY` missing; otherwise wrap conditionally so upload is best-effort |
| PII leaking into stack traces (e.g., from request bodies in error messages) | Centralized `sanitizeContext()` allowlist in U3; no raw request data ever passed |
| Ad blockers continue to drop both pageviews and exceptions | Out of scope here; addressed by deferred reverse-proxy follow-up |
| Duplicate signals from autocapture + custom `*_failed` events | Intentional — custom events carry business context; PostHog dedupes exceptions by stack-trace fingerprint, not by tag |

---

## Documentation / Operational Notes

- Railway env vars to add at deploy time: `POSTHOG_API_KEY` (build-time secret, project-scoped personal API key with write access).
- After first deploy, manually verify in PostHog Error Tracking: a deliberate throw in an admin route appears as an Issue with readable stack frames.
- Any future migration to Edge runtime on a route requires re-validating that `onRequestError` still fires (Edge support varies by Next version).

---

## Sources & References

- Conversation context: silent failure on `app/api/admin/events/update/route.ts` 500 (May 7) — direct motivation for systematic exception capture.
- `components/PostHogProvider.tsx` — existing client setup.
- `lib/analytics/server.ts` — existing server-side analytics pattern.
- PostHog Error Tracking docs (Next.js section) — reference for `capture_exceptions`, `posthog-node`, `instrumentation.ts` `onRequestError`, `@posthog/nextjs-config`.
