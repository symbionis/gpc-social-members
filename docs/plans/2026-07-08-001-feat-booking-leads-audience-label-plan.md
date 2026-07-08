---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: Rename the pre-event audience to \"Booking leads\""
date: 2026-07-08
depth: lightweight
---

# feat: Rename the pre-event audience to "Booking leads"

## Summary

The event **Messaging** tab's **Audience** dropdown offers *Pre-event — registered
attendees* and *Post-event — checked-in attendees*. The pre-event option's label
implies it reaches **everyone registered** (leads and their guests), but it does
not: its resolver reads `event_registrations`, which holds **one row per booking**,
so it already emails only the **booking lead** — once per booking, single or party.
Guests (individual `tickets` rows) are never included pre-event.

This plan corrects that mismatch by **repurposing the existing `event_pre` audience
into "Booking leads"** — a display-and-copy change only. The stored kind key
`event_pre` is left unchanged (it lives in `broadcasts.kind` and is referenced
across the API, resolver, and analytics), and the audience-resolution logic is
untouched because the population is already correct. The goal is that an admin
picking this audience understands they are messaging the person who manages each
booking, one email per booking.

**Explicitly deferred:** template-variable substitution (`{{first_name}}`,
`{{last_name}}`, `{{booking_link}}`) and the "Available variables" composer helper.
The composer today does not substitute placeholders; adding that is a separate,
larger change (recipient merge-fields, `manage_token` plumbing, channel-side
substitution) and is out of scope here. See **Scope Boundaries**.

**Product Contract preservation:** N/A — direct planning (no upstream brainstorm).

---

## Problem Frame

- **Who:** GPC admins composing event messages from the Manage Event → Messaging tab.
- **Symptom:** The label "Pre-event — registered attendees" and the hint "Goes to
  everyone registered for this event" read as *all attendees, guests included*. In
  reality the audience is booking leads only (one per booking).
- **Ask:** Add/clarify a **"Booking leads"** audience that omits guests and messages
  only the lead of each booking — so admins can confidently send booking-management
  messages to the right, de-duplicated set of people.
- **Key finding:** No resolution change is required. `resolveEventAudience` for
  `event_pre` already reads `event_registrations` (status `paid`/`free`, one row per
  booking) and de-duplicates by lowercased email — exactly "one message per booking
  to the lead." The gap is purely in the user-facing wording.

---

## Requirements

- **R1** — The Audience dropdown option currently reading "Pre-event — registered
  attendees" reads **"Booking leads"**.
- **R2** — The audience hint no longer implies all guests are reached; it states the
  audience is the lead of each booking, one email per booking, and (unchanged)
  regardless of marketing consent.
- **R3** — The pre-send confirmation dialog names the audience as booking leads
  (e.g. *Send "…" to 12 booking leads?*) rather than "registered attendees".
- **R4** — The "Messages sent" table's **Audience** column labels historical and new
  `event_pre` sends as **"Booking leads"**.
- **R5** — The stored `broadcasts.kind` value and the `EventMessageKind` union keep
  the identifier `event_pre`; no data migration and no API-contract change.
- **R6** — The messaged population is unchanged: booking leads only, guests excluded,
  de-duplicated by lowercased email (one email per lead; a lead who somehow holds
  two same-email bookings for the event collapses to one recipient — the normal
  case is one email per booking).

---

## Key Technical Decisions

- **KTD1 — Change display strings only; keep `event_pre` as the kind key.** The kind
  is persisted in `broadcasts.kind`, validated in `parseEventMessagePayload`, branched
  on in `resolveEventAudience`, and sent to PostHog as `kind`. Renaming the identifier
  would force a data migration and ripple through the API/analytics for zero user
  benefit. Rationale: labels are cheap and safe to change; enum churn is not.
- **KTD2 — No audience-resolver change.** `fetchRegistrations` already yields
  leads-only (one row per booking from `event_registrations`), and `dedupe` collapses
  duplicate emails. Guests live in `tickets` and are only read by the post-event path.
  R6 is satisfied by the existing code; we assert it with a test rather than rewrite it.
- **KTD3 — Rewrite the hint to remove the "everyone" misconception.** The current hint
  ("Goes to everyone registered…") is the root of the confusion this plan fixes, so
  the copy explicitly says "the person who manages each booking (the lead) — one email
  per booking."

---

## Implementation Units

### U1. Rename the pre-event audience to "Booking leads" in the composer

**Goal:** R1, R2, R4 — update the dropdown option, the audience hint, and the
"Messages sent" audience-column label for `event_pre`; R5 — keep `value="event_pre"`.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** none.

**Files:**
- `components/admin/EventMessaging.tsx` (modify)

**Approach:**
- Line ~220: change the `<option value="event_pre">` text from
  `Pre-event — registered attendees` to `Booking leads`. Keep `value="event_pre"`.
- Line ~67: `KIND_LABEL.event_pre` from `"Pre-event"` to `"Booking leads"` (this drives
  the sent-messages Audience column, R4).
- Line ~72: rewrite `AUDIENCE_HINT.event_pre` to something like: *"Goes to the lead
  who manages each booking (single or party) — not the individual guests. Regardless
  of marketing consent."* (R2, R3-adjacent). Avoid promising a literal "one email per
  booking" count (see R6 — dedupe is by email).
- Leave the `event_post` entries, the consent-override block, and all state/kind logic
  untouched.

**Patterns to follow:** the existing `KIND_LABEL` / `AUDIENCE_HINT` record shape and
the `event_post` copy tone in the same file.

**Test scenarios:** `Test expectation: none -- copy/label change in a client component
with no behavioral change. This repo unit-tests pure logic, not component rendering;
there is no existing E2E spec asserting these specific audience labels, so do not
claim E2E coverage for this edit. The behavioral confirmation-string change is
unit-tested in U2, and audience-resolution behavior is unchanged (locked by U3).`

**Verification:** In the Messaging tab, the Audience dropdown shows "Booking leads";
selecting it shows the rewritten hint; a previously-sent `event_pre` message shows
"Booking leads" in the Messages-sent Audience column.

---

### U2. Update the send-confirmation wording and its test

**Goal:** R3 — the pre-send `window.confirm` names booking leads.

**Requirements:** R3, R5.

**Dependencies:** none (independent of U1).

**Files:**
- `components/admin/event-messaging-state.ts` (modify)
- `components/admin/event-messaging-state.test.ts` (modify)

**Approach:**
- In `buildSendConfirm`, change the `event_pre` branch of `who` from
  `"registered attendee"` to `"booking lead"`. The existing `${plural}` suffix already
  produces "booking leads" for counts ≠ 1, so no other change is needed.
- Update the corresponding assertion in the test (currently expects
  `'Send "Venue moved" to 12 registered attendees?'`) to
  `'Send "Venue moved" to 12 booking leads?'`, and update the `it(...)` description
  from "names the registered audience for pre-event" to name the booking-leads audience.

**Patterns to follow:** the existing `buildSendConfirm` branch structure and the
sibling `event_post` test cases.

**Test scenarios:**
- Happy path (pre-event, count > 1): `buildSendConfirm({ kind: "event_pre",
  recipientCount: 12, includeNonConsented: false, subject: "Venue moved" })` returns
  `'Send "Venue moved" to 12 booking leads?'`.
- Singular boundary (count === 1): pre-event with `recipientCount: 1` returns
  `…to 1 booking lead?` (no trailing "s").
- Regression guard: the existing `event_post` cases (checked-in attendee, and the
  consent-override sentence) remain unchanged and still pass.

**Verification:** `event-messaging-state.test.ts` passes; the confirm dialog in the UI
reads "…to N booking lead(s)?" for the Booking-leads audience.

---

### U3. Lock the leads-only population with a resolver test

**Goal:** R6 — assert `event_pre` resolves to one recipient per booking and never
includes guests, so the "Booking leads" label stays truthful under future changes.

**Requirements:** R6, KTD2.

**Dependencies:** none.

**Files:**
- `lib/broadcast/event-audience.test.ts` (modify)

**Approach:**
- Rename the existing `describe("resolveEventAudience — pre-event (registered
  attendees)")` block to `… — booking leads` for consistency with the new vocabulary.
- Confirm existing coverage asserts: reads `event_registrations`, filters to
  `status IN ('paid','free')`, and de-duplicates by lowercased email (one recipient
  per booking). Add a scenario only if a gap exists (see below); do not rewrite the
  resolver.

**Patterns to follow:** the existing Supabase-client mock and row fixtures in
`event-audience.test.ts`; mirror the shape of the current pre-event cases.

**Test scenarios:**
- Covers R6. Two paid registrations with distinct lead emails resolve to exactly two
  recipients (one per booking).
- Covers R6. Duplicate lead email across two bookings collapses to a single recipient
  (dedupe by lowercased email) — guards "one message per booking to the lead."
- Covers R6/KTD2. A `cancelled`/`refunded` registration is excluded (status filter),
  confirming only active bookings' leads are messaged.
- Negative/isolation: the pre-event path issues no query against `tickets`, so guest
  `tickets` rows can never enter the audience — assert via the mock that only
  `event_registrations` is read for `kind: "event_pre"` (add only if not already
  asserted).

**Verification:** `event-audience.test.ts` passes; the booking-leads population is
pinned to leads-only, guests excluded.

---

## Scope Boundaries

**In scope:** user-facing labels, hint copy, and confirmation wording for the
`event_pre` audience; a resolver test locking the leads-only population; renaming the
matching test `describe` blocks.

### Deferred to Follow-Up Work
- **Template variables + booking-page link.** Substituting `{{first_name}}`,
  `{{last_name}}`, and a `{{booking_link}}` (the lead's `manage_token` →
  `…/public/bookings/{manage_token}`) in the subject/body, plus an "Available
  variables (paste into subject or message)" helper in the composer. This requires
  carrying per-recipient merge fields (notably `manage_token`) through
  `ResolvedEventAudience` / `BroadcastRecipient`, and performing substitution in the
  email channel — the composer currently states placeholders are **not** substituted.
  Own plan.
- **Renaming the `event_pre` kind identifier** (e.g. to `booking_leads`) in the DB
  enum/comment and API — intentionally not done; would need a data migration for zero
  user benefit (KTD1).
- **A separate "all attendees / guests included" pre-event audience** — not requested;
  the guest-inclusive population is only reachable post-event today.

### Non-goals (out of this change's identity)
- Any change to post-event (checked-in) audience behavior or copy.
- Any change to the reminder-email schedule or the broadcast send pipeline.

---

## System-Wide Impact

- **Data:** none. No migration; `broadcasts.kind` values unchanged.
- **API:** none. `parseEventMessagePayload` still accepts/validates `event_pre`.
- **Analytics:** none. PostHog `event_message_sent` still reports `kind: "event_pre"`;
  historical events remain comparable.
- **Internal doc comments (optional, non-blocking):** several code comments still
  describe `event_pre` as "registered attendees" — the DB column comment on
  `broadcasts.kind`, `lib/broadcast/event-audience.ts`, `lib/broadcast/send.ts`, and
  `app/api/admin/events/[id]/messages/send/route.ts`. None are user-facing or required
  by a requirement; they may be refreshed opportunistically for vocabulary consistency,
  but are not part of the Definition of Done.
- **Users:** admins see clearer audience labeling; recipients are unaffected (identical
  population, identical emails).

---

## Verification Contract

- `npm test` (or the repo's unit runner) passes, including the updated
  `event-messaging-state.test.ts` and `event-audience.test.ts`.
- Manual: Messaging tab dropdown reads "Booking leads"; hint reflects one-email-per-
  booking-lead; confirm dialog reads "…to N booking lead(s)?"; a prior `event_pre`
  send shows "Booking leads" in the Messages-sent Audience column.
- No new TypeScript errors; `event_pre` remains the kind key everywhere in code.

## Definition of Done

- R1–R6 satisfied.
- U1–U3 landed; U2 and U3 tests green.
- No data migration, no API-contract change, `event_pre` identifier preserved.
- Deferred items recorded above (not started).

---

## Sources & Research

- `components/admin/EventMessaging.tsx` — Audience dropdown, `KIND_LABEL`,
  `AUDIENCE_HINT` (edit sites for U1).
- `components/admin/event-messaging-state.ts` + `.test.ts` — `buildSendConfirm`
  wording and its assertion (U2).
- `lib/broadcast/event-audience.ts` — `resolveEventAudience` / `fetchRegistrations`
  reading `event_registrations` (status paid/free) with `dedupe` by lowercased email:
  the evidence that `event_pre` is already leads-only (KTD2, U3).
- `lib/broadcast/event-audience.test.ts` — existing pre-event coverage (U3).
- `CONCEPTS.md` — **Lead** ("the person who created a Registration and manages it… via
  a private manage link"), **Registration** (one active per person per Event),
  **Ticket**, **Booking Page**.
- `supabase/migrations/20260622200000_manage_token_and_fill_ticket.sql` —
  `event_registrations.manage_token` + `…/public/bookings/{manage_token}` (relevant to
  the deferred booking-link variable).
- `supabase/migrations/20260622170000_rename_attendees_to_tickets.sql` — `event_attendees`
  renamed to `tickets` (context for the roster/`is_lead` model).
