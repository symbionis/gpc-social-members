---
title: "feat: Event messaging (Manage Event Messaging tab)"
type: feat
status: completed
date: 2026-05-21
origin: docs/brainstorms/2026-05-21-event-messaging-requirements.md
---

# feat: Event messaging (Manage Event Messaging tab)

## Summary

Add a Messaging tab to the Manage Event admin page that surfaces the automatic reminder emails already sent for the event and lets an admin compose and send two free-form messages: a pre-event message to registered attendees and a post-event thank-you to checked-in attendees. The send path reuses the existing broadcast orchestration and per-recipient audit trail, but dispatches through a new transactional Postmark channel (the main `gpc-postmark-layout`, `social@` sender, no marketing unsubscribe footer) so event-specific comms reach attendees regardless of marketing state.

---

## Problem Frame

Admins can email members in bulk and the system sends automatic event reminders, but there is no in-product way to reach the people attached to a specific event — no way to push a last-minute logistics note or weather cancellation to registered attendees, and no way to thank the people who actually checked in (including door guests who exist in no other table). See origin for the full pain narrative and product decisions.

---

## Requirements

- R1. Add a Messaging tab to the Manage Event page following the existing tab pattern.
- R2. Compose and send a free-form (subject + body) message to registered attendees.
- R3. Pre-event audience is all registrations not cancelled/refunded, regardless of marketing consent (transactional).
- R4. Compose and send a free-form message to checked-in attendees.
- R5. Post-event audience respects the check-in `marketing_consent` flag by default; an optional transactional-only override sends to all check-ins, and whether the override was used is recorded on the send.
- R6. Before sending, the admin sees the resolved recipient count for the selected audience.
- R7. Each send reuses the broadcast dispatch path and writes a per-recipient delivery record consistent with the existing broadcast audit trail.
- R8. The tab shows a log of comms already sent for this event: automatic reminder sends plus any ad-hoc messages sent from this tab, each with timestamp, audience, and recipient count.

**Origin actors:** A1 (Admin — composes/sends, reviews sent reminders), A2 (Registered attendee — pre-event recipient), A3 (Checked-in attendee — post-event recipient, may be a door guest in no other table)
**Origin flows:** F1 (Send a pre-event message), F2 (Send a post-event thank-you), F3 (Review reminders already sent)
**Origin acceptance examples:** AE1 (covers R3), AE2 (covers R5), AE3 (covers R5), AE4 (covers R6)

---

## Scope Boundaries

- Broad CRM/Mailchimp-style comms to anyone who registered/attended with consent — deferred to the later CRM track.
- A real "cancel event" feature (status change, refunds, registration close) — the pre-event message is the deliberate stopgap.
- SMS or any non-email channel.
- Templated/branded composition beyond free-form subject + body; the admin authors the message (including any bilingual content) themselves.
- A draft/save-for-later workflow for event messages — v1 composes and sends in one action (member broadcasts keep their draft workflow; event messages do not adopt it).
- Editing or resending the automatic reminder configuration — that stays in existing event/reminder settings.

---

## Context & Research

### Relevant Code and Patterns

- `lib/broadcast/send.ts` — `sendBroadcast(input)` orchestration: resolve audience → insert `broadcasts` row (`status='sending'`) → dispatch via channel → persist `broadcast_recipients` → mark `sent`/`failed`. The audience-resolution step is members-only and is the part event messaging must replace; the persistence/dispatch core is the part to reuse.
- `lib/broadcast/audience.ts` — `resolveAudience()` / `previewAudienceCounts()`. `PAGE_SIZE = 1000` pagination loop (`while(true)` + `.range(from, from+PAGE_SIZE-1)`) is the pattern the new event resolvers must replicate. Members-only; not reusable directly.
- `lib/broadcast/channels/email-postmark.ts` — `PostmarkEmailChannel`: batch send (≤500/call), per-recipient result mapping, per-batch try/catch so a failing batch keeps prior audit rows. Hardwired to the broadcast stream + `members-comms-broadcast` template + `POSTMARK_BROADCAST_FROM`. The new transactional channel mirrors this structure but with the transactional sender/stream/template.
- `lib/postmark.ts` — transactional `getPostmarkClient()` and `sendEmail()` (From `social@genevapolo.com`, default stream). The transactional From/stream the new channel should use.
- `lib/broadcast/auth.ts` — `requireSuperAdmin()`. Event message routes need a broader gate (`events_admin` + `super_admin`) mirroring `app/(admin)/layout.tsx:36-44`.
- `lib/broadcast/validate.ts` — `parseBroadcastPayload(body, {forDraft})` (trim subject, strip-tag body check). Pattern to mirror for an event-message payload validator.
- `app/api/admin/broadcasts/send/route.ts` + `preview/route.ts` — API-route-handler pattern (no server actions); auth gate → validate → orchestrate → JSON result.
- `components/admin/BroadcastComposer.tsx` — `"use client"` composer: `RichTextEditor` body, audience preview count, `handlePreview`/`handleSend`, `window.confirm` summary, PostHog events. Model for the EventMessaging compose UI.
- `components/admin/ManageEventTabs.tsx` — `Tab` union (line 8), conditional tab button pattern (waitlist, line 167), `{tab === "X" && (...)}` content blocks, settings tab delegating to a self-contained `EventCheckInSettings` component (the model for an `EventMessaging` tab component).
- `app/(admin)/admin/events/[id]/attendees/page.tsx` — server component loading event/registrations/checkins/waitlist and passing to `ManageEventTabs`.
- `lib/cron/event-reminders.ts` — reads `event_reminder_sends` by event; source of truth for the "reminders already sent" display.
- `docs/email-templates/gpc-postmark-layout.html` — the main transactional polo-club layout the new `event-message` template wraps. `gpc-postmark-members-comms-layout.html` is the broadcast layout (with `{{{pm:unsubscribe}}}`) we are deliberately NOT using.

### Institutional Learnings

- `docs/solutions/database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md` (high) — a bare `.select()` silently truncates at 1000 rows. The event audience resolvers MUST paginate; a large event would otherwise skip recipients past row 1000 with no error.
- `docs/solutions/architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md` — audience resolution + per-recipient audit live above the channel; add a new resolver rather than overloading the member resolver, and keep the `skipped` count for the UI.
- `docs/solutions/tooling-decisions/postmark-broadcasts-setup-2026-04-29.md` — the broadcast stream/sender/unsubscribe separation. Event messages take the transactional side of this split: default stream, `social@`, no marketing unsubscribe footer.
- `docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md` — Mustachio templating: no `{{#if}}`; pass `null` (not `""`) for absent optional template fields. Applies to any optional merge field in the `event-message` template.
- `docs/solutions/design-patterns/draft-row-claim-and-transition-2026-05-06.md` — broadcast row lifecycle; relevant for status-guarding, though v1 event messages skip the draft state and insert directly at `status='sending'`.
- Auto-memory `feedback_db_types_aliases` — after regenerating `types/database.ts`, re-append the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases.

---

## Key Technical Decisions

- **Reuse the broadcast dispatch core; replace only audience resolution.** Factor `sendBroadcast`'s post-resolution body (insert `broadcasts` row → dispatch via channel → persist `broadcast_recipients` → mark sent/failed) so both member broadcasts and event messages share it. Member broadcasts resolve via `resolveAudience`; event messages resolve via the new event resolvers and pass pre-resolved recipients + a transactional channel. Honors the origin decision to reuse the pipeline and audit trail (R7).
- **New transactional Postmark channel, not the broadcast channel.** Event messages send from `social@genevapolo.com` on the default transactional stream, wrapped in the main `gpc-postmark-layout` via a new `event-message` passthrough template — no marketing unsubscribe footer. Confirmed with the user. Consent is enforced at audience selection (R3/R5), not via an unsubscribe footer.
- **Associate sends with the event via new columns on `broadcasts`.** Add nullable `event_id` (FK → events) and `kind` (e.g. `member` | `event_pre` | `event_post`). The Messaging tab filters to `event_id = <this event>`; the existing member broadcast history filters to `event_id IS NULL` so event sends never appear there. Avoids overloading the members-only `audience_filter` resolver path.
- **Record the consent override in `audience_filter` JSON** (e.g. `{ kind, event_id, include_non_consented: boolean }`), additive per the JSONB-evolution convention. Satisfies R5's "record whether the override was used."
- **Event audience resolvers paginate and de-duplicate by email.** Both `event_registrations` and `event_checkins` can contain duplicate emails (multi-quantity, member + guest sharing) and neither enforces uniqueness; dedupe before dispatch so no one is emailed twice. Pagination is mandatory (1000-row truncation learning).
- **No draft workflow for v1.** Event messages compose-and-send in one action; the row is inserted directly at `status='sending'`.
- **Double-send guarded server-side, with the UI disable as first line.** Two cheap mechanisms on the `broadcasts` insert: (1) a partial unique index on `(event_id, kind) WHERE status='sending' AND event_id IS NOT NULL` so only one in-flight event send per event+kind can exist — concurrent double-submits (one admin double-clicking, or two admins sending at once) collide; (2) a client-supplied `idempotency_key` with a unique index, so a retried request after a lost response reuses the key and returns the existing result instead of re-sending. The insert's `23505` is classified as a benign duplicate (return "a send is already in progress" / the existing result), never a 500 — same pattern as the reminder idempotency and the partial-unique-index learning. The member path is unaffected: it has `event_id NULL` (excluded from the in-flight index) and supplies no `idempotency_key`.
- **Broader auth gate.** Event message routes accept `events_admin` and `super_admin` (mirroring the Manage Event page gate), unlike member broadcast routes which stay `super_admin`-only.

---

## Open Questions

### Resolved During Planning

- Sender/stream/layout for event messages: transactional (`social@`, default stream, main `gpc-postmark-layout`, no unsubscribe footer) — user-confirmed.
- Who may send: `events_admin` and `super_admin` — user-confirmed.
- Free-form vs templated: free-form subject + body through a passthrough template — confirmed; the broadcast path already proves passthrough rendering works.

### Deferred to Implementation

- Exact `kind` enum values and whether it is a CHECK constraint or a Postgres enum type — settle when writing the migration.
- Name-splitting strategy for the single `name` field into `first_name`/`last_name` for the template model — the template likely only needs `first_name` (or a greeting fallback); confirm against the `event-message` template's merge fields once created.
- Whether the pre-event audience uses `.not("status","in","(cancelled,refunded)")` (cron semantics) or `.in("status",["paid","free"])` (attendees-page semantics) — both exclude cancelled/refunded; pick the one matching the attendees list already shown on the page for consistency.
- Whether to gate pre-event vs post-event compose availability by event timing (before/after start) or always show both — UI affordance, decide during the component build.
- Per-admin event ownership for `events_admin` (beyond the existence check shipped in U4) — current posture lets any `events_admin` message any event by id. Model ownership only if the role expands. Flagged in review (security).

---

## Implementation Units

### U1. Add event association + kind to broadcasts

**Goal:** Schema support for associating a broadcast row with an event and distinguishing message kind.

**Requirements:** R5, R7, R8

**Dependencies:** None

**Files:**
- Create: `supabase/migrations/<timestamp>_broadcasts_event_association.sql`
- Modify: `types/database.ts` (regenerate, then re-append hand-written aliases)

**Approach:**
- Add nullable `event_id uuid` (FK → `events(id)` ON DELETE SET NULL), `kind text` (default `'member'`), and nullable `idempotency_key text` to `broadcasts`.
- Index `(event_id)` for the per-event tab query.
- Add the two double-send-guard indexes: a partial unique index on `(event_id, kind) WHERE status='sending' AND event_id IS NOT NULL` (one in-flight event send per event+kind; member rows with NULL `event_id` are excluded), and a partial unique index on `(idempotency_key) WHERE idempotency_key IS NOT NULL`.
- Existing rows backfill to `kind='member'`, `event_id NULL`, `idempotency_key NULL` (defaults) — they remain in member broadcast history untouched and outside both guard indexes.

**Patterns to follow:**
- `supabase/migrations/20260505093723_broadcasts_draft_status.sql` (a prior `broadcasts` ALTER + CHECK).
- Auto-memory `feedback_db_types_aliases` for the post-regen alias re-append.

**Test scenarios:**
- Test expectation: none — schema migration; behavior is exercised by U2–U6. Verify the migration applies cleanly and `types/database.ts` reflects the new columns.

**Verification:**
- Migration applies; `broadcasts` has `event_id` (nullable FK), `kind` (default `member`), and `idempotency_key`; both guard indexes exist; existing broadcast history queries still return prior rows; two concurrent member-broadcast inserts (NULL `event_id`) do not collide on the in-flight index.

---

### U2. Event audience resolvers (paginated, de-duplicated, consent-aware)

**Goal:** Resolve the two new audiences into recipient lists with counts.

**Requirements:** R3, R5, R6

**Dependencies:** None

**Files:**
- Create: `lib/broadcast/event-audience.ts`
- Test: `lib/broadcast/__tests__/event-audience.test.ts` (mirror existing broadcast test location/convention)

**Approach:**
- `resolveEventAudience({ event_id, kind, include_non_consented })` returning `{ recipients, skipped }` in the recipient shape the dispatch core expects (`email`, `first_name`, `member_id` nullable; `tier_name` omitted/null).
- Pre-event (`event_pre`): query `event_registrations` for the event excluding cancelled/refunded; no consent filter.
- Post-event (`event_post`): query `event_checkins` for the event; when `include_non_consented` is false, filter `marketing_consent = true` (treat `null` as not-consented) and count excluded rows as `skipped`; when true, include all.
- Paginate every query with the `PAGE_SIZE = 1000` `.range()` loop. De-duplicate recipients by lowercased email after fetch.

**Patterns to follow:**
- `lib/broadcast/audience.ts` pagination loop and `{ recipients, skipped }` return shape.

**Test scenarios:**
- Happy path: pre-event resolves all non-cancelled/refunded registrations for the event.
- Covers AE1. Edge case: a registration with `marketing_consent` not applicable (no such column) — pre-event includes a registrant who would be excluded from member broadcasts.
- Covers AE2. Happy path: post-event with override off excludes a check-in whose `marketing_consent` is false; that recipient is counted in `skipped`.
- Covers AE2. Edge case: post-event with override off treats `marketing_consent = null` as not-consented (excluded).
- Covers AE3. Happy path: post-event with override on includes the non-consented check-in.
- Edge case: duplicate emails across rows (member + guest sharing an address, multi-quantity) collapse to one recipient.
- Edge case: audience exceeding 1000 rows returns all recipients (pagination), not a truncated 1000.
- Edge case: event with no matching rows returns empty recipients, zero count.

**Verification:**
- Resolver returns correct recipient sets and `skipped` counts for both kinds and both override states; large audiences are not truncated; emails are unique in the output.

---

### U3. Transactional event email channel + shared dispatch core

**Goal:** Send event messages through the transactional Postmark path while reusing the broadcast persistence/dispatch orchestration.

**Requirements:** R5, R7

**Dependencies:** U1, U2

**Files:**
- Create: `lib/broadcast/channels/email-transactional.ts`
- Modify: `lib/broadcast/send.ts` (extract the post-resolution dispatch core; thread `event_id`, `kind`, and a selectable channel)
- Modify: `lib/broadcast/types.ts` (widen `member_id` to `string | null` on the recipient types — see Approach)
- Modify: `app/(admin)/admin/messages/page.tsx` and `app/api/agent/broadcasts/route.ts` (add `event_id IS NULL` filter so event sends don't leak into member history — see System-Wide Impact)
- Test: `lib/broadcast/__tests__/event-send.test.ts`

**Approach:**
- Extract the body of `sendBroadcast` after audience resolution into a shared dispatch function taking pre-resolved `{ recipients, skipped }`, `subject`, `body_html`, `channel`, `created_by`, `audience_filter`, and the new `event_id` / `kind`. `sendBroadcast` keeps its current signature (resolve members → dispatch). Add `sendEventMessage({ event_id, kind, subject, body_html, include_non_consented, created_by })` that resolves via U2 then calls the shared core with the transactional channel.
- Pass the channel to the dispatch core as a `BroadcastChannel` object (not a registry key) so no widening of `BroadcastChannel['key']` or the `CHANNELS` map is needed — the existing `key: "email"` literal stays as-is.
- Widen the shared recipient types for door guests: `BroadcastRecipient.member_id` and `RecipientResult.member_id` to `string | null` (the DB column is already nullable). Treat the single `name` column as the source — derive `first_name` best-effort with a greeting fallback; event recipients have no `last_name`/`tier_name`. Confirm the member path still type-checks after widening.
- New `TransactionalEmailChannel`: mirrors `PostmarkEmailChannel` (batch ≤500, per-recipient result mapping, per-batch try/catch) but `From = social@genevapolo.com`, default transactional stream (no `MessageStream: broadcast`), `TemplateAlias = "event-message"`, template model `{ subject, body_html, body_text, first_name, email }` with optional fields mapped `|| null` (Mustachio).
- Persist `broadcasts` row with `event_id`, `kind`, `idempotency_key`, and `audience_filter = { kind, event_id, include_non_consented }`; persist `broadcast_recipients` exactly as the member path does.
- `sendEventMessage` catches the guarded-insert `23505` (in-flight index or idempotency-key collision) and returns a typed "duplicate / already in progress" outcome instead of throwing, so U4 can map it to a friendly response rather than a 500.

**Patterns to follow:**
- `lib/broadcast/channels/email-postmark.ts` structure; `lib/broadcast/send.ts` insert/persist/mark-sent flow.

**Test scenarios:**
- Happy path: a resolved event audience produces one `broadcasts` row (correct `event_id`, `kind`) and one `broadcast_recipients` row per recipient with `sent` status.
- Covers AE3. Integration: post-event send with override on persists `audience_filter.include_non_consented = true` on the broadcast row.
- Error path: a failing Postmark batch records `failed` per-recipient rows for that batch and does not lose prior batches' audit rows; the broadcast is marked `failed`.
- Edge case: empty resolved audience short-circuits to a `sent` row with zero recipients (mirror existing empty-audience behavior).
- Integration: transactional channel sets `social@` From and does NOT set the broadcast `MessageStream` (assert the batch payload).

**Verification:**
- Event messages send via the transactional stream/template; broadcast + recipient rows are written with event association; failure modes preserve the audit trail.

---

### U4. Event message API routes (preview + send)

**Goal:** HTTP endpoints to preview the recipient count and send an event message, gated to event/super admins.

**Requirements:** R2, R4, R6

**Dependencies:** U2, U3

**Files:**
- Create: `app/api/admin/events/[id]/messages/preview/route.ts`
- Create: `app/api/admin/events/[id]/messages/send/route.ts`
- Create: `lib/broadcast/event-auth.ts` (or extend `lib/broadcast/auth.ts`) — `requireEventsAdmin()` allowing `events_admin` + `super_admin`
- Create: `lib/broadcast/validate-event-message.ts` (or extend `validate.ts`) — validate `{ kind, subject, body_html, include_non_consented }`
- Test: `app/api/admin/events/[id]/messages/__tests__/route.test.ts`

**Approach:**
- Preview: auth → validate → `resolveEventAudience` count → return `{ recipient_count, skipped_count }`.
- Send: auth → validate (non-empty subject + body) → `sendEventMessage(...)` with the client `idempotency_key` → return `{ broadcast_id, recipient_count, sent, failed, skipped }`. A guarded-insert `23505` maps to a friendly 409 ("a send for this event is already in progress") or, for an idempotency-key match, returns the existing send's result — never a 500.
- `kind` constrained to `event_pre` | `event_post`; `include_non_consented` only honored for `event_post`.
- The validator inherits `parseBroadcastPayload`'s subject-trim and body strip-tag/non-empty check; if rich HTML is permitted, sanitize `body_html` with the same allowlist the member path uses rather than passing raw admin input into the email template.
- `requireEventsAdmin()` verifies the path `event_id` exists in `events` after the role check, so an `events_admin` cannot resolve-and-send against an arbitrary or non-existent event id (existence check; per-admin event ownership is not modeled — see Open Questions).

**Patterns to follow:**
- `app/api/admin/broadcasts/send/route.ts` and `preview/route.ts`; `lib/broadcast/auth.ts`; `lib/broadcast/validate.ts`.

**Test scenarios:**
- Happy path: valid pre-event send returns success counts and creates the broadcast row.
- Error path: empty subject or empty body → 400, no send.
- Error path: a non-admin (neither events_admin nor super_admin) → 403.
- Happy path: `events_admin` is allowed to send (not just super_admin).
- Edge case: `include_non_consented` passed with `kind=event_pre` is ignored (pre-event has no consent filter).
- Covers AE4. Happy path: preview returns a higher `recipient_count` for `event_post` when `include_non_consented` is true vs false.
- Error path: a second send for the same `event_id`+`kind` while the first is still `status='sending'` is rejected with a friendly 409, not a 500, and does not create a second broadcast row or re-send.
- Edge case: a retried send carrying the same `idempotency_key` returns the original send's result (no second dispatch).
- Edge case: two member broadcasts (NULL `event_id`) sending concurrently are unaffected by the in-flight guard.

**Verification:**
- Both routes enforce the broader admin gate, validate input, and return the documented JSON shapes; counts match the resolver; concurrent/retried event sends cannot double-dispatch and surface as friendly responses.

---

### U5. Per-event reminders-sent summary

**Goal:** Read the automatic reminder sends for an event, grouped for display.

**Requirements:** R8

**Dependencies:** None

**Files:**
- Create: `lib/events/reminder-summary.ts`
- Test: `lib/events/__tests__/reminder-summary.test.ts`

**Approach:**
- Query `event_reminder_sends` by `event_id` (paginate — could exceed 1000 on a large event), group in JS by `(days_before, slot)` → `{ days_before, slot, recipient_count, last_sent_at }`.

**Patterns to follow:**
- `lib/cron/event-reminders.ts` read of `event_reminder_sends`; pagination pattern from `lib/broadcast/audience.ts`.

**Test scenarios:**
- Happy path: multiple sends across two slots group into two summary rows with correct counts and latest `sent_at`.
- Edge case: an event with no reminder sends returns an empty list.
- Edge case: more than 1000 send rows are fully counted (pagination).

**Verification:**
- Returns one summary row per `(days_before, slot)` with accurate counts and latest timestamp.

---

### U6. Messaging tab UI + page wiring

**Goal:** The Messaging tab: reminders-sent log, ad-hoc sent-messages history, and the two compose flows.

**Requirements:** R1, R2, R4, R5, R6, R8

**Dependencies:** U4, U5

**Files:**
- Create: `components/admin/EventMessaging.tsx`
- Modify: `components/admin/ManageEventTabs.tsx` (add `"messaging"` to `Tab`, tab button, content block)
- Modify: `app/(admin)/admin/events/[id]/attendees/page.tsx` (load reminder summary + this event's sent messages; pass to the tab)
- Test: `components/admin/__tests__/EventMessaging.test.tsx`

**Approach:**
- Mirror `EventCheckInSettings` as a self-contained client component mounted by the settings-style tab block.
- Audience selector (Pre-event / Post-event); subject input + `RichTextEditor` body; PostHog events mirroring `BroadcastComposer`.
- Recipient-count preview: auto-fetched when the audience selector changes and when the override is toggled (AE4); shows a loading indicator while fetching and disables Send during the fetch; the count stays valid when only subject/body change. Send is enabled when subject and body are non-empty and a completed fetch returned `recipient_count > 0`.
- Post-event consent override: checkbox labeled e.g. "Send to all check-ins, including those who didn't opt in", with helper copy "Use only for operational messages — this bypasses marketing consent" (final wording at author's discretion). Hidden/disabled for the pre-event audience. The `window.confirm` summary explicitly states when the override is active (e.g. "including N who didn't opt in").
- Send button is disabled and labeled "Sending…" while the request is in flight, and the other controls are disabled during the send (first-line double-send guard, backed by the server guard in U1/U4). The client generates an `idempotency_key` per send attempt and includes it in the POST; a 409 "already in progress" response is surfaced as an inline notice rather than an error.
- Post-send states: full success → inline "Sent to N recipients", composer resets, "Messages sent" list refreshes; partial failure (`failed > 0`) → inline warning "Sent to N, failed for M — see the comms log"; all-failed → error shown, composed message preserved.
- Available-variables hint lists only `{{first_name}}` and `{{email}}` (the event-message template model has no `last_name`/`tier_name`); do not copy `BroadcastComposer`'s variable list verbatim.
- Empty-state copy: Reminders sent → "No reminders have been sent for this event yet."; Messages sent → "No messages have been sent for this event yet."
- Sections: "Reminders sent" (from U5), "Messages sent" (this event's `broadcasts` where `event_id = id`, with timestamp/kind/recipient_count), and the composer.
- Page server component loads the reminder summary (U5) and the event's sent messages (`broadcasts` filtered by `event_id`).

**Patterns to follow:**
- `components/admin/BroadcastComposer.tsx` (compose + preview + confirm + PostHog); `components/admin/ManageEventTabs.tsx` conditional tab + content-block pattern; `EventCheckInSettings` as a tab-mounted component.

**Test scenarios:**
- Happy path: selecting Pre-event then previewing shows the registered-attendee count.
- Covers AE4. Happy path: toggling the post-event override checkbox updates the displayed recipient count.
- Edge case: the override checkbox is hidden/disabled for the pre-event audience.
- Happy path: the reminders-sent and messages-sent sections render rows from their data sources; empty states render when there are none.
- Error path: a failed send surfaces an error message and does not clear the composed message.

**Verification:**
- The tab appears on Manage Event, shows reminders + sent messages, and both compose flows preview accurate counts and send successfully end-to-end.

---

## System-Wide Impact

- **Interaction graph:** New API routes under `app/api/admin/events/[id]/messages/`; the attendees page server component gains two reads; `sendBroadcast` is refactored (member path behavior must stay identical).
- **Member broadcast history must exclude event sends:** the actual leak surfaces are the member "Sent" list `app/(admin)/admin/messages/page.tsx` (its query filters only `.neq("status","draft")`) and the agent endpoint `app/api/agent/broadcasts/route.ts` (lists all broadcasts with no event filter) — both must add `.is("event_id", null)` (or `.eq("kind","member")`). Without it, event sends surface as member broadcasts and render as "All members" because their `audience_filter` carries no `status`. The `app/api/admin/broadcasts/drafts` route needs no change — event messages never enter `draft` status. (Found in review: feasibility + adversarial.)
- **Error propagation:** Per-recipient failures are recorded as `failed` rows before the broadcast is marked `failed`, preserved by the shared dispatch core (unchanged from member path).
- **State lifecycle risks:** Double-send guarded server-side (in-flight partial unique index + idempotency key) with the UI disable as first line; `23505` is treated as benign. A row stuck at `status='sending'` (process killed mid-send) would block further sends of that event+kind until cleared — acceptable, since the dispatch core marks `failed` on adapter throw; noted as a residual. A partial Postmark batch failure must not drop earlier batches' audit rows.
- **API surface parity:** The member broadcast routes are untouched and stay `super_admin`-only; only the new event routes use the broader gate.
- **Unchanged invariants:** `resolveAudience` / `previewAudienceCounts` (members), the broadcast Postmark channel, and the `broadcasts` draft workflow are unchanged. `sendBroadcast`'s external behavior for member broadcasts must be preserved by the refactor.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Audience silently truncated at 1000 rows (skips recipients) | Mandatory pagination in U2 and U5; explicit >1000-row test scenarios. |
| `sendBroadcast` refactor regresses member broadcasts | Extract dispatch core without changing `sendBroadcast`'s signature/behavior; keep/extend existing member-broadcast tests green. |
| Event sends leaking into member broadcast history (and breaking its `audience_filter` display) | Filter member history to `event_id IS NULL`; event-shaped `audience_filter` never reaches the member display. |
| Duplicate emails → someone emailed twice | De-dupe by lowercased email in U2 before dispatch. |
| Double-send (double-click, two admins, lost-response retry) → attendees emailed twice | Server guard in U1/U4: in-flight partial unique index on `(event_id, kind)` + `idempotency_key` unique index; `23505` handled as benign; UI disable as first line. |
| Missing `event-message` Postmark template/env at runtime | Prerequisite below; the transactional channel should fail loudly if the template alias is missing, like the broadcast channel does for its env. |

### Dependencies / Prerequisites

- **Postmark `event-message` template** must be created in the Postmark dashboard on the main `gpc-postmark-layout` (passthrough body rendering `subject` + `body_html`, no `{{{pm:unsubscribe}}}` footer), mirroring the `members-comms-broadcast` setup. Until it exists, sends will fail. Add a local copy under `docs/email-templates/event-message.html` / `.txt` for parity with the other templates.

---

## Documentation / Operational Notes

- Add `docs/email-templates/event-message.html` / `.txt` mirroring the repo's template-copy convention.
- After regenerating `types/database.ts` (U1), re-append the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases (auto-memory `feedback_db_types_aliases`).
- No new env vars required (reuses the transactional `POSTMARK_SERVER_TOKEN` and `social@` From); confirm the transactional From source the new channel reads.

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-05-21-event-messaging-requirements.md
- Related code: `lib/broadcast/send.ts`, `lib/broadcast/audience.ts`, `lib/broadcast/channels/email-postmark.ts`, `lib/postmark.ts`, `components/admin/ManageEventTabs.tsx`, `app/(admin)/admin/events/[id]/attendees/page.tsx`, `lib/cron/event-reminders.ts`
- Learnings: `docs/solutions/database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md`, `docs/solutions/architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md`, `docs/solutions/tooling-decisions/postmark-broadcasts-setup-2026-04-29.md`, `docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md`
