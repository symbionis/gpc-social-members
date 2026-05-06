---
title: "feat: Agent API surface for events + broadcasts"
type: feat
status: active
date: 2026-05-05
origin: docs/brainstorms/2026-05-05-agent-api-surface-requirements.md
---

# feat: Agent API surface for events + broadcasts

## Summary

Expose a small, token-protected HTTP surface under `app/api/agent/*` so a self-hosted agent can answer questions about events, broadcasts, members-by-tier, and submit draft events / draft broadcasts for human review. Wraps existing helpers (`requireSuperAdmin` → new `requireAgentToken`, `parseBroadcastPayload`, the audience resolver) rather than duplicating logic; the agent never sees the Supabase service-role key, never reads member PII directly, and cannot send mail or publish events.

---

## Problem Frame

The repo currently has two credentials capable of touching event and broadcast data: the Supabase service-role key (god-mode, including `auth.users` and payments-adjacent tables) and per-admin OTP-bound browser sessions. Neither is appropriate for a server-side agent. We need a third credential whose blast radius is strictly smaller than the service-role key, surfaced through a minimal HTTP API the agent can call from anywhere.

Broadcast drafts are now persistable (separate work, already merged) so the broadcast half of this surface is now feasible. Event drafts already work via `is_published=false`.

---

## Requirements

- R1. Agent calls authenticate with a single static bearer token (`AGENT_API_TOKEN`); rotating it disables agent access without touching any other credential.
- R2. A leaked token cannot read member emails, payment data, or any `auth.*` table.
- R3. Agent can list upcoming and recent published events filterable by event type, date range, and publish status.
- R4. Agent can list broadcasts filterable by status (`sent`, `draft`, `sending`, `failed`).
- R5. Agent can request audience preview for a given filter and receive recipient count + skipped-by-consent count + per-tier breakdown — counts only, no PII.
- R6. Agent can fetch reference lookups: tiers, event types, current season.
- R7. Agent can submit a draft event with `is_published=false`. The endpoint must reject any attempt to set `is_published=true`.
- R8. Agent can submit a draft broadcast with `status='draft'`. The endpoint must reject any attempt to set `status='sent'` or to call the send pipeline.
- R9. Every agent request emits a PostHog `agent_action` event tagged with endpoint, status code, and (where applicable) the created draft id.
- R10. Validation for broadcast drafts is shared with the admin path (`parseBroadcastPayload`), so the agent surface inherits future validation tightening for free.

---

## Scope Boundaries

- Agent **sending** broadcasts. Stays super-admin-only via the existing `/api/admin/broadcasts/send`.
- Agent **publishing** events. Admin keeps `is_published` flips.
- Agent reading or modifying member rows, registrations, payments, or any `auth.*` table.
- File / image uploads on behalf of the agent. Drafts can reference existing image URLs.
- Per-agent tokens, scoped roles, OAuth-style flows.
- MCP server wrapper, OpenAPI schema, GraphQL-style query language.
- Webhooks back to the agent.

### Deferred to Follow-Up Work

- Wrapping these endpoints as MCP tools if the agent host changes from self-hosted Openclaw to an MCP-aware client. Same business logic, different transport.
- Per-agent tokens stored in a DB table once we run more than one agent.

---

## Context & Research

### Relevant Code and Patterns

- `lib/broadcast/auth.ts` — `requireSuperAdmin()` helper. The agent auth helper mirrors this shape.
- `lib/broadcast/validate.ts` — `parseBroadcastPayload(body, { forDraft })` already supports the relaxed-validation draft mode the agent needs.
- `lib/broadcast/audience.ts` — `resolveAudience()` returns recipients (with PII) plus skipped consent count. The agent endpoint uses this internally but only returns counts and tier breakdown, never email addresses.
- `app/api/admin/broadcasts/drafts/route.ts` and `app/api/admin/broadcasts/drafts/[id]/route.ts` — pattern for create/list/update/delete drafts. Agent's `POST /api/agent/broadcasts/draft` calls into the same DB write path.
- `components/admin/EventManager.tsx` — schema/UX reference for event creation; defines required vs optional fields.
- `app/(public)/page.tsx` and `app/(public)/public/events/page.tsx` — current event-listing query shapes. The agent's read endpoint mirrors the same select list.
- `components/PostHogProvider.tsx` — server-side capture pattern: imports `posthog-js` only in client. For server-side `agent_action` events the plan uses the `posthog-node` pattern via a tiny `lib/analytics/server.ts` helper, OR — simpler for v1 — emit via the standard `events/capture` HTTPS POST so we don't pull in another dep.

### Institutional Learnings

- `docs/solutions/conventions/jsonb-filter-singular-to-plural-evolution.md` — `audience_filter` accepts `tier_ids[]` canonically and tolerates legacy `tier_id` strings. The agent surface accepts only the canonical plural form for new writes; reads still tolerate both shapes via `parseBroadcastPayload`.
- Memory note `feedback_db_types_aliases` — after any schema change, regenerate Supabase types and re-append the manual `MemberStatus` / `PaymentCaptureStatus` aliases. **This plan does not change schema**, so no regen needed.
- Memory note `feedback_railway_nextjs_env` — `NEXT_PUBLIC_*` vars are baked at build time. `AGENT_API_TOKEN` is **server-only** (no `NEXT_PUBLIC_` prefix), so this constraint doesn't apply: it can be set on Railway and picked up at runtime without a redeploy.

### External References

None needed. Bearer-token auth + Next.js route handlers are well-trodden ground here.

---

## Key Technical Decisions

- **Single static `AGENT_API_TOKEN` env var.** Constant-time comparison (`crypto.timingSafeEqual` with Buffer padding) to avoid timing attacks. Rationale: simplest credential model that satisfies R1/R2; per-agent tokens are deferred until we run more than one agent.
- **All agent routes live under `app/api/agent/*`.** Single directory makes auth-by-prefix easy to reason about and to grep. Rationale: separates agent surface from admin/member-auth surfaces, matching the brainstorm's "credential's blast radius is strictly smaller" goal.
- **Wrap existing helpers; don't duplicate logic.** Validation goes through `parseBroadcastPayload`; drafts hit the same DB shape as the admin draft route; audience resolution goes through `resolveAudience`. Rationale: keeps the agent surface honest — the day we tighten broadcast validation, the agent inherits it for free.
- **Audience preview returns counts + tier breakdown, never recipient lists.** The internal `resolveAudience` returns full `BroadcastRecipient[]` (with email); the agent endpoint reduces to numbers before responding. Rationale: R2 / R5 — token leak must not exfiltrate emails.
- **Server-side PostHog capture via the events/capture HTTP API**, not a new dep. One small `lib/analytics/server.ts` helper. Rationale: avoids adding `posthog-node` for one event type; keeps the install footprint exactly where it is today.
- **Pagination by simple `?limit` + `?offset`**, default 50, max 200. Rationale: simplest contract; the use cases (recent events, recent broadcasts) don't need cursors.
- **Read endpoints select specific columns**, never `*`. Rationale: belt-and-braces against accidentally surfacing columns we add later (e.g. private notes).

---

## Open Questions

### Resolved During Planning

- *Should the agent see broadcast recipients?* No — counts and tier breakdown only (R5).
- *Single token vs per-agent tokens?* Single token for v1; per-agent deferred (Scope Boundaries).
- *Server-side PostHog: new dep or HTTP capture?* HTTP capture in a tiny helper, no new dep.
- *Where to enforce write-restriction (`is_published=false`, `status='draft'`)?* In the route handler before any DB call, so the request body can't smuggle a publish/send.

### Deferred to Implementation

- Exact response shape of each endpoint (field names, date formats). Implementer picks the shape closest to existing read paths in `app/(public)/page.tsx` and `components/admin/BroadcastList.tsx` — the agent surface should feel like the admin views, not invent its own vocabulary.
- Whether `agent_action` events go to PostHog as `$set` person properties for the agent's anonymous distinct_id, or just plain events. Decide while wiring the helper.

---

## Implementation Units

- U1. **Agent auth helper + token wiring**

**Goal:** Add a single helper that all agent routes call as the first line of every handler; reject unauth requests with 401 and missing-config requests with 503.

**Requirements:** R1, R2

**Dependencies:** none

**Files:**
- Create: `lib/agent/auth.ts`
- Modify: `.env.local.example` (add `AGENT_API_TOKEN=` placeholder + comment about rotation)

**Approach:**
- Read `process.env.AGENT_API_TOKEN`. If not set, return 503 from the helper so missing-config doesn't masquerade as 401.
- Read `Authorization` header; require exact `Bearer ` prefix; compare the rest with `crypto.timingSafeEqual` after padding both buffers to the same length.
- Return a discriminated union `{ ok: true } | { ok: false, status: 401 | 503 }`, mirroring `requireSuperAdmin`.

**Patterns to follow:**
- `lib/broadcast/auth.ts` — same return shape and same call-site convention.

**Test scenarios:**
- Happy path: header `Authorization: Bearer <correct>` → `{ ok: true }`.
- Error path: missing header → `{ ok: false, status: 401 }`.
- Error path: header `Authorization: Bearer <wrong>` of equal and unequal length → `{ ok: false, status: 401 }` for both; both should take comparable time (sanity check, no statistical assertion).
- Error path: env var unset → `{ ok: false, status: 503 }`.
- Edge case: header with extra whitespace, non-Bearer scheme → 401.

**Verification:** Helper compiles, exports a single `requireAgentToken()` function, and behaves as above.

---

- U2. **Read endpoints: events + broadcasts + lookups**

**Goal:** GETs that let the agent answer factual questions: upcoming/recent events, broadcast list with status filter, reference lookups.

**Requirements:** R3, R4, R6

**Dependencies:** U1

**Files:**
- Create: `app/api/agent/events/route.ts`
- Create: `app/api/agent/broadcasts/route.ts`
- Create: `app/api/agent/lookups/route.ts`

**Approach:**
- Each handler starts with `requireAgentToken()`; on `ok: false` return the corresponding status with a JSON body like `{ error: "Unauthorized" }`.
- `events`: query params `?status=published|draft|all`, `?event_type_id=`, `?from=YYYY-MM-DD`, `?to=YYYY-MM-DD`, `?limit`, `?offset`. Default: published, from today. Always order by `start_date asc`. Select specific columns matching `app/(public)/public/events/page.tsx`.
- `broadcasts`: query params `?status=sent|draft|sending|failed|all`, `?limit`, `?offset`. Default: all. Order by `created_at desc`. Select id, subject, status, created_at, sent_at, recipient_count, error_count, audience_filter — never the body_html (large).
- `lookups`: returns `{ tiers: [{id, name, category, price_eur}], event_types: [{id, name, slug, color}], current_season: {id, year, start_date, end_date} | null }`. Single query each, all parallel.

**Patterns to follow:**
- `app/(public)/public/events/page.tsx` for the events select column set.
- `components/admin/BroadcastList.tsx` for the broadcasts column set.

**Test scenarios:**
- Happy path (events): with valid token, no params → returns published upcoming events ordered by start_date.
- Happy path (events): `?event_type_id=<id>` → results all match that type.
- Happy path (events): `?status=draft` → returns only `is_published=false` events.
- Happy path (broadcasts): `?status=draft` → returns only draft rows; body_html absent.
- Happy path (lookups): all three top-level keys present, current_season is `null` when no season covers today.
- Edge case: `?limit=500` → clamps to 200.
- Edge case: `?from=invalid-date` → 400 with explicit error.
- Error path: missing token → 401, no DB query made.
- Integration: server-side PostHog `agent_action` event captured for each successful call (verified in U5 once the helper exists; here just ensure the call site is in place).

**Verification:** Three GET endpoints respond correctly under curl with a valid token; no PII leaks in any response.

---

- U3. **Read endpoint: audience preview**

**Goal:** Given an audience filter, return how many recipients would receive a broadcast — counts only, no emails.

**Requirements:** R5

**Dependencies:** U1

**Files:**
- Create: `app/api/agent/audience/preview/route.ts`

**Approach:**
- Accept POST (filter is a JSON body, not a query string, because tier_ids is an array). Body: `{ status: "active"|"expired"|"all", tier_ids?: string[] }`.
- Validate via the same allowed statuses list `parseBroadcastPayload` uses — extract a small `validateAudienceFilter` helper from `lib/broadcast/validate.ts` if it doesn't already exist as a separate export.
- Call `resolveAudience()` to get `{ recipients, skipped }`.
- Build per-tier breakdown by counting `recipients` grouped by `tier_name`. Do not include any email/name in the response.
- Respond with `{ recipient_count, skipped_count, per_tier: [{ tier_name: string|null, count: number }] }`.

**Patterns to follow:**
- `app/api/admin/broadcasts/preview/route.ts` for filter validation; reduce the response to counts.

**Test scenarios:**
- Happy path: active members, no tier filter → returns sensible recipient_count and per_tier breakdown summing to recipient_count.
- Happy path: filter with two tier_ids → only members in those tiers counted; per_tier has at most two entries.
- Edge case: filter that matches zero members → `{ recipient_count: 0, skipped_count: 0, per_tier: [] }`.
- Edge case: members with `tier_id=null` → grouped under `tier_name: null`.
- Error path: invalid `status` → 400.
- Error path: `tier_ids` is not an array → 400.
- Error path: missing token → 401.
- Integration: response body never contains an `email` or `member_id` substring (regex assert).

**Verification:** No PII leaks in output; counts match the admin preview endpoint when given the same filter.

---

- U4. **Write endpoints: draft event + draft broadcast**

**Goal:** Let the agent stage a draft event and a draft broadcast that admins review in the existing UI.

**Requirements:** R7, R8, R10

**Dependencies:** U1

**Files:**
- Create: `app/api/agent/events/draft/route.ts`
- Create: `app/api/agent/broadcasts/draft/route.ts`

**Approach (events/draft):**
- Accept POST. Required body fields: `title`, `start_date`. Optional: `end_date`, `start_time`, `location`, `description`, `event_type_id`, `season_id`, `images[]`, `visibility` (defaulting to `public`).
- Strip / ignore: `is_published`, `id`, `created_at`, `updated_at`. The route forces `is_published: false` regardless of input.
- Validate `start_date` parses, `end_date >= start_date`, `event_type_id` exists if provided, `season_id` exists if provided.
- Insert via admin Supabase client. Respond 201 `{ event_id, edit_url: "/admin/events" }`.

**Approach (broadcasts/draft):**
- Accept POST. Body: `{ subject, body_html, audience_filter }` — exact same shape as the existing admin draft route.
- Call `parseBroadcastPayload(body, { forDraft: true })` so the agent surface inherits any future validation tightening.
- Insert via admin Supabase client with `status: 'draft'` (force it; do not read from input).
- Respond 201 `{ broadcast_id, edit_url: "/admin/messages?tab=drafts" }`.

**Patterns to follow:**
- `app/api/admin/broadcasts/drafts/route.ts` POST handler — same DB shape, same insert columns.
- The existing event-creation path in `components/admin/EventManager.tsx` for required fields and validation logic. Mirror its required set, not its UX defaults.

**Test scenarios:**
- Happy path (event): minimal valid body → 201, returns event_id, row exists with `is_published=false`.
- Happy path (event): full body with all optional fields → 201; row contains every field.
- Happy path (broadcast): minimal subject + body + active filter → 201, returns broadcast_id, row exists with `status='draft'`.
- Edge case (event): body includes `is_published: true` → row still saved with `is_published=false`.
- Edge case (broadcast): body includes `status: 'sent'` → row still saved with `status='draft'`.
- Edge case (event): `start_date` after `end_date` → 400.
- Error path: invalid `event_type_id` (not a uuid) → 400 from validation, not from DB.
- Error path: invalid `event_type_id` (uuid but no row) → 400 with explicit "unknown event type" message (so the agent can self-correct).
- Error path: `parseBroadcastPayload` rejects payload (e.g. body_html only whitespace) → 400 with the error from validate.
- Error path: missing token → 401.

**Verification:** Both endpoints insert rows that the existing admin UIs (events list, broadcasts drafts pane) display and let an admin send/publish normally. No bypass of the publish/send gates.

---

- U5. **Server-side PostHog capture for `agent_action`**

**Goal:** Every agent request emits a PostHog event so we can see usage and failure rate without grepping logs.

**Requirements:** R9

**Dependencies:** U1 (so the helper knows whether the call was authorized; we only emit `agent_action` for authenticated calls — anonymous 401s are not interesting)

**Files:**
- Create: `lib/analytics/server.ts`
- Modify: `app/api/agent/events/route.ts`, `app/api/agent/broadcasts/route.ts`, `app/api/agent/lookups/route.ts`, `app/api/agent/audience/preview/route.ts`, `app/api/agent/events/draft/route.ts`, `app/api/agent/broadcasts/draft/route.ts`

**Approach:**
- `lib/analytics/server.ts` exports `captureServerEvent(event: string, properties: Record<string, unknown>, distinctId?: string)`.
- Implementation: read `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` at call time; if either missing, no-op silently. Otherwise `fetch(host + "/i/v0/e/", { method: POST, body: JSON.stringify({ api_key, event, distinct_id, properties, timestamp }) })`. Fire-and-forget; don't await on the request response — wrap in `.catch(() => {})` to guarantee we never block the agent response on PostHog being slow.
- distinct_id default: `"agent:openclaw"` so all agent activity rolls up to a single PostHog person profile (since `person_profiles: 'identified_only'` in the client config, this just becomes a single anonymous-but-stable id for filtering in the dashboard).
- Each agent route, after sending its response, fires `captureServerEvent("agent_action", { endpoint, method, status_code, latency_ms, draft_id?, recipient_count? })`. Use a small `withTiming` wrapper or just `Date.now()` deltas inline.

**Patterns to follow:**
- `components/PostHogProvider.tsx` for the env-var lookup pattern. Server-side has direct access to `process.env`, no data-attr hack needed.

**Test scenarios:**
- Happy path: a successful agent request causes one outbound `fetch` to the PostHog `/i/v0/e/` endpoint (assert via mock).
- Edge case: PostHog request hangs or fails → agent response is unaffected (assert response status code and body).
- Edge case: env vars missing → no fetch made; helper resolves immediately.
- Integration: in dev with real PostHog key, hitting `GET /api/agent/events` results in an `agent_action` event visible in PostHog Live Events within a few seconds (manual verification only).

**Verification:** Hitting any agent endpoint with valid token results in an `agent_action` event in PostHog within seconds. PostHog outage does not affect agent latency.

---

- U6. **Documentation: agent README**

**Goal:** A single doc the agent's owner can read to learn the surface — endpoints, auth, request/response shapes, error conventions, rate limits.

**Requirements:** advances no R-ID directly; supports adoption of R3-R8.

**Dependencies:** U2, U3, U4 (so we can document final shapes)

**Files:**
- Create: `docs/agent-api.md`

**Approach:**
- Sections: Authentication, Conventions (status codes, error shape, pagination), Endpoints (one section each, with example curl + JSON response).
- Note the deferred items (no MCP, no per-agent tokens) so future readers know what's intentional.
- Cross-link the brainstorm + this plan.

**Test scenarios:**
- Test expectation: none -- documentation, no runtime behavior.

**Verification:** A reader can paste the curl examples, set their token, and see all six endpoints respond correctly.

---

## System-Wide Impact

- **Interaction graph:** New top-level routing prefix `/api/agent/*` adds a third auth model alongside admin (Supabase session) and Stripe webhook (signed secret). No middleware changes — auth lives in each route handler.
- **Error propagation:** Every agent route returns a uniform `{ error: string }` JSON body with conventional status codes (400 invalid request, 401 missing/wrong token, 403 reserved for future per-agent scope checks, 503 missing config). Implementers should not invent ad-hoc shapes.
- **State lifecycle risks:** Agent-created drafts share the `events` and `broadcasts` tables with admin-created drafts. Admin discard/edit flows already handle these uniformly; nothing new to add.
- **API surface parity:** `parseBroadcastPayload` is now consumed by three call sites (admin draft, admin send, agent draft). Future changes to validation hit all three. Same for `resolveAudience` (admin preview, admin send, agent preview).
- **Integration coverage:** The "agent draft → admin sees in UI → admin sends" path crosses route handlers, the broadcasts table, and the existing admin drafts view. One e2e-ish manual test in U4's verification covers it.
- **Unchanged invariants:** Existing admin and member auth flows are untouched. The Supabase service-role key is never exposed to the agent. `is_published` and `status='sent'` transitions remain super-admin-only.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `AGENT_API_TOKEN` leaks (committed by accident, exposed in logs, copied into the wrong place). | Token is single-purpose and rotatable in seconds via Railway; routes only enable read + draft, so the worst-case is "agent submits junk drafts that admins discard". `.env.local` is gitignored; ensure `.env.local.example` shows only a placeholder. |
| Agent floods the broadcasts table with junk drafts. | Drafts are cheap rows; admins discard from the existing UI. If abuse becomes real, add a per-day insert cap in `lib/agent/auth.ts`. Out of scope for v1. |
| Future contributor adds a new column to `events` or `broadcasts` containing private data and the agent endpoints select `*`. | Each read endpoint has an explicit column list. Code review must catch a column-list change. Optionally add a unit test that asserts the response shape matches a snapshot. |
| Audience preview accidentally serializes recipients. | The endpoint reduces to numbers before `NextResponse.json`. Add a regex-based test that fails if any future change reintroduces an `email` field in the response body. |
| PostHog server capture blocks request latency. | Fire-and-forget pattern with `.catch`. Test scenario in U5. |
| Token comparison timing attacks. | `crypto.timingSafeEqual` with equal-length buffer padding. Not strictly necessary for an internal-only token but cheap insurance. |

---

## Documentation / Operational Notes

- Add `AGENT_API_TOKEN` to Railway's environment variables. Generate a random 48-byte token (`openssl rand -base64 48`) and paste it into Railway. Server-only var (no `NEXT_PUBLIC_` prefix), so no rebuild is required after rotation.
- Update `docs/agent-api.md` is U6.
- Mention the new prefix in the project README's "Routing" overview if such a section exists; if not, skip — the brainstorm + this plan are the canonical reference.
- PostHog dashboard: create an `agent_action` insight (events count over time, breakdown by endpoint and status_code) so agent activity is visible at a glance.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-05-agent-api-surface-requirements.md`
- Related code: `lib/broadcast/auth.ts`, `lib/broadcast/validate.ts`, `lib/broadcast/audience.ts`, `app/api/admin/broadcasts/drafts/route.ts`
- Related learning: `docs/solutions/conventions/jsonb-filter-singular-to-plural-evolution.md`
