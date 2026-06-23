---
date: 2026-06-23
type: feat
title: "Resend QR tickets / booking page to existing upcoming-event registrants"
status: planned
depth: standard
origin: docs/brainstorms/2026-06-22-event-qr-access-flow-requirements.md (FEAT-41)
---

# feat: Resend QR Tickets / Booking Page to Existing Upcoming-Event Registrants

## Summary

People who registered for **upcoming** events *before* the per-ticket QR system (FEAT-41) shipped have already been fully migrated — every one of their tickets has a `credential_token` (QR), a `manage_token` booking page, and a lead ticket type. The migrations did this. What never happened is **telling them**: they got the old confirmation email and have never seen their QR tickets or the booking page where they distribute/name guest tickets.

This plan adds a thin, reusable **"Resend tickets"** capability to the admin attendees page — per-registration and bulk — that re-fires the existing `sendEventRegistrationConfirmation()` email (lead QR + booking-page link). It adds a `ticket_email_sent_at` timestamp so we can see who's been notified and avoid double-sends, and a small resend-aware intro block in the email template so recipients understand why they're getting a second email. No data migration, no new QR/credential work, no new email infrastructure.

**Urgency:** "Fireside Chat: Agentic AI in real life" is **2026-06-24** — the per-registration resend (U3/U4) must be shippable and usable for that event ahead of the bulk/tracking polish.

---

## Problem Frame

The new ticketing model (FEAT-41) makes each ticket a bearer QR credential and gives the lead a booking page (`/public/bookings/[manage_token]`) to forward batches and name guests. New registrations get this automatically via the confirmation email.

The 12 registrations on the 3 upcoming events predate that email change. Verified against production (project `rmchkoktpzoojlglyfca`) on 2026-06-23:

- All 12 have `manage_token`, `self_reg_token`, and `lead_ticket_type_id` set.
- All their live tickets carry a `credential_token`.
- Several have **unnamed guest tickets** (e.g. a 4-ticket booking with 2 named, a 3-ticket with 1 named) — exactly the leads who need the booking page to distribute/name guests before the day.

The data is correct; only the communication is missing. The codebase already has `sendEventRegistrationConfirmation(registrationId)` building the full email (lead QR + `manage_url`), but nothing re-triggers it after the original registration. There is no existing "resend" action for event registrations (only member renewal/payment-link resends in `components/admin/MemberDetail.tsx`).

Past-event registrations have real gaps (279 with no tickets, 115 tickets without credentials) — but the backfills excluded them deliberately (`event_end_date >= current_date`) and they are out of scope here (archival history; no entry needed for a finished event).

---

## Scope Boundaries

**In scope**
- A reusable admin "Resend tickets" action (per-registration + bulk) on the event attendees page.
- A `ticket_email_sent_at` column on `event_registrations` for visibility + idempotency.
- A resend-aware intro block in the `event-registration-confirmed` Postmark template.
- Actually executing the resend for the 3 upcoming events.

**Out of scope**
- Past-event registrations (279 ticketless + 115 credential-less) — deliberate backfill cutoff, treated as archival. Revisit only if a reporting/export feature ever needs consistent historical attendance.
- Any new QR, credential, booking-page, forwarding, or check-in work (all shipped in FEAT-41).
- The members broadcast tool — it is members-only (`lib/broadcast/audience.ts`) and cannot target event registrants by event.
- New email template *infrastructure* — we reuse the existing transactional send path and template.

### Deferred to Follow-Up Work
- Audit/log row per resend (who triggered, when) beyond the single `ticket_email_sent_at` stamp.
- A general "registrants not yet notified" cross-event admin dashboard.

---

## Key Technical Decisions

- **KTD1. Reuse `sendEventRegistrationConfirmation()` verbatim — do not author a new email.** It already queries the registration, lead tickets, `credential_token`, and `manage_token`, and builds the QR image URLs and booking-page link. Resending is calling it again. (see `lib/email/event-registration.ts`)
- **KTD2. Transactional, no consent gate.** This is the recipient's own ticket, not marketing. Send on the existing transactional stream/sender (`"Geneva Polo Social Club" <social@genevapolo.com>`), exactly as the original confirmation. Marketing-consent filtering does not apply.
- **KTD3. Stamp `ticket_email_sent_at` inside the email function on success.** Stamping in `sendEventRegistrationConfirmation()` (rather than at each call site) covers all paths — initial registration, waitlist convert, and resend — with one change. Existing rows stay `NULL` until resent, which is precisely the "not yet notified" signal the bulk action filters on.
- **KTD4. Bulk targets `ticket_email_sent_at IS NULL` by default; per-row always allowed.** Bulk is the safe "notify everyone who hasn't been" button (no double-sends). The per-row button is a manual override usable anytime (e.g. a member who lost their email).
- **KTD5. Resend copy via a Mustachio conditional, defaulting safe.** Pass a `resend` boolean into the template model; wrap the "we've upgraded to QR tickets" intro in a `{{#resend}}...{{/resend}}` block per the project's Mustachio convention (no `{{#if}}`; pass `null`/omit for absent values). If the Postmark template block isn't deployed yet, Mustachio renders nothing — the email still sends correctly, so code and template can ship independently.
- **KTD6. Reuse the established admin API + auth pattern.** Mirror `app/api/admin/events/[id]/waitlist/convert/route.ts`: `assertAdmin()` with roles `super_admin | team_admin | events_admin`, `createAdminClient()` for the mutation, `{ success, ... }` / `{ error, status }` responses, client toasts as in `components/admin/MemberDetail.tsx`.

---

## Implementation Units

### U1. Add `ticket_email_sent_at` to `event_registrations`

**Goal:** Persist when the ticket/booking email was last sent, to drive the "not yet notified" filter and prevent accidental double-sends.

**Requirements:** Supports KTD3, KTD4.

**Dependencies:** none.

**Files:**
- `supabase/migrations/<timestamp>_add_ticket_email_sent_at.sql` (new)
- `types/database.ts` (regenerate; re-append hand-written aliases per project convention)

**Approach:** Additive, nullable `timestamptz` column. No backfill — existing rows intentionally stay `NULL` (= not yet sent the new ticket email). Forward-compatible and reversible (column add only; no drops, no data rewrite).

**Patterns to follow:** Other additive event-table migrations under `supabase/migrations/` (e.g. the `manage_token`/`lead_ticket_type_id` additions on 2026-06-22 / 2026-06-04).

**Test scenarios:**
- Migration applies cleanly on a DB with existing registrations; all existing rows have `ticket_email_sent_at IS NULL`.
- Column is nullable and defaults to `NULL` on new inserts that don't set it.
- `Test expectation: none for type regen` — `types/database.ts` change is generated; verify the hand-written `MemberStatus`/`PaymentCaptureStatus` aliases were re-appended after regen.

**Verification:** `\d event_registrations` shows the new nullable column; a `select count(*) where ticket_email_sent_at is null` equals the existing registration count.

---

### U2. Stamp on send + add `resend` flag in the email function

**Goal:** Make `sendEventRegistrationConfirmation()` record successful sends and support a resend-aware template variant.

**Requirements:** KTD1, KTD3, KTD5.

**Dependencies:** U1.

**Files:**
- `lib/email/event-registration.ts`

**Approach:**
- Add an optional `opts?: { resend?: boolean }` parameter. Pass `resend: opts?.resend ?? false` into `templateModel` (used by the `{{#resend}}` block — U6 template).
- After a successful `sendEmail()`, update `event_registrations.ticket_email_sent_at = now()` for that `registrationId`. Stamp only on success; a failed send must leave the timestamp unchanged so the row stays in the "not yet notified" set.
- Keep the existing return shape `{ success, error? }`.

**Patterns to follow:** Existing post-send side-effects in the same file / `app/api/admin/events/[id]/waitlist/convert/route.ts` (email-then-update sequencing). Mustachio rules from project memory (no `{{#if}}`; pass `null` for absent optionals).

**Test scenarios:**
- Happy path: successful send stamps `ticket_email_sent_at` to ~now for the target registration only.
- Failure path: when `sendEmail()` returns `{ success: false }`, `ticket_email_sent_at` is left unchanged (still `NULL` for a never-sent row).
- `resend: true` propagates `resend: true` into the template model; default call omits/sets it false.
- Default call (no `opts`) behaves exactly as before aside from the new stamp (backward compatible for registration + waitlist-convert callers).
- Covers KTD2: the From/stream/sender used is the existing transactional one (assert template alias `event-registration-confirmed` and sender unchanged).

**Verification:** Unit test with a mocked Postmark client asserts stamp-on-success, no-stamp-on-failure, and `resend` propagation.

---

### U3. Per-registration resend API route

**Goal:** An admin endpoint that resends the ticket email for one registration.

**Requirements:** KTD1, KTD4, KTD6. Enables the U4 button (and the day-of resend for Fireside Chat).

**Dependencies:** U2.

**Files:**
- `app/api/admin/events/[id]/registrations/[regId]/resend-confirmation/route.ts` (new)

**Approach:** `POST` handler. `assertAdmin()` (roles per KTD6). Verify the registration belongs to the event in the path and is `status IN ('paid','free')`. Call `sendEventRegistrationConfirmation(regId, { resend: true })`. Return `{ success, email, sent_at }` or `{ error, status }`.

**Patterns to follow:** `app/api/admin/events/[id]/waitlist/convert/route.ts` (auth, param validation, error/return shape).

**Test scenarios:**
- Happy path: admin resends a valid paid/free registration → 200, `success: true`, email function called with `{ resend: true }`, `ticket_email_sent_at` updated.
- Auth: non-admin / wrong-role → 403; unauthenticated → 401.
- Edge: `regId` not belonging to `[id]` event → 404/400 (not a silent success).
- Edge: registration `status = 'pending'` → rejected (no ticket email for unpaid).
- Error path: email send failure surfaces `{ error }` with non-200 and leaves `ticket_email_sent_at` unchanged.

**Verification:** `curl`/integration test hits the route with an admin session for a real upcoming registration and the recipient receives the email with QR + booking link.

---

### U4. Per-registration "Resend tickets" button in admin attendees UI

**Goal:** Let an admin resend to one registration from the roster, with a visible "last sent" indicator.

**Requirements:** KTD4, KTD6. This is the unit that must be usable for Fireside Chat (2026-06-24).

**Dependencies:** U3. (Depends on U1 only for surfacing `ticket_email_sent_at`; functionally usable once U3 exists.)

**Files:**
- `app/(admin)/admin/events/[id]/attendees/page.tsx` (load `ticket_email_sent_at`, `manage_token` presence per lead row)
- `components/admin/AttendeeList.tsx` (or the roster row component it renders) — add the action + indicator

**Approach:** On each lead registration row, a "Resend tickets" button that `POST`s to U3, shows a loading state, then a success/error toast (mirror `MemberDetail.tsx`). Show `ticket_email_sent_at` as "Notified <relative time>" or "Not yet notified". Only show on rows that have a `manage_token` (all 12 do; guards future edge rows).

**Patterns to follow:** Toast + fetch pattern in `components/admin/MemberDetail.tsx`; existing roster rendering in `ManageEventTabs`/`AttendeeList`.

**Test scenarios:**
- Happy path: clicking resends, button shows loading, success toast appears, indicator flips to "Notified just now".
- Error path: API failure → error toast, indicator unchanged.
- Display: a never-notified row shows "Not yet notified"; a previously-sent row shows the relative time.
- Edge: row without `manage_token` (hypothetical legacy) does not render the button.

**Verification:** In the admin UI on a staging/preview build, resend a real Fireside Chat registration and confirm the email arrives and the indicator updates.

---

### U5. Bulk "Resend to not-yet-notified" action

**Goal:** One click to notify all upcoming-event registrants on an event who haven't been sent the new ticket email.

**Requirements:** KTD4.

**Dependencies:** U2, U3 (reuses the send + stamp).

**Files:**
- `app/api/admin/events/[id]/registrations/resend-bulk/route.ts` (new)
- `app/(admin)/admin/events/[id]/attendees/page.tsx` + `components/admin/AttendeeList.tsx` (bulk button + count)

**Approach:** `POST` resolves all `status IN ('paid','free')` registrations for the event with `ticket_email_sent_at IS NULL` (default) and calls `sendEventRegistrationConfirmation(id, { resend: true })` for each sequentially. Return `{ sent, failed, skipped, results: [...] }`. UI button labelled "Resend tickets to N not-yet-notified", disabled when N=0; confirm dialog before sending; summary toast.

**Patterns to follow:** Event-audience iteration in `lib/broadcast/event-audience.ts` for resolving the registrant set; admin auth/return shape from U3.

**Test scenarios:**
- Happy path: event with N null-stamped paid/free registrations → all N sent, each stamped, `{ sent: N, failed: 0 }`.
- Idempotency: immediate second invocation finds 0 not-yet-notified → `{ sent: 0, skipped: ... }`, no duplicate emails.
- Partial failure: one send fails → `{ sent: N-1, failed: 1 }`, failed row keeps `NULL` stamp (eligible for retry), others stamped.
- Excludes `pending` and past-event registrations (query scope honored).
- Auth: non-admin → 403.

**Verification:** Run bulk on "Polo and DJ" / "Polo & Banya", confirm recipient count matches the not-yet-notified count and no one is emailed twice on re-run.

---

### U6. Resend-aware intro block in the email template

**Goal:** When `resend = true`, the email opens with a short note explaining the upgrade to QR tickets, so a second email isn't confusing.

**Requirements:** KTD5.

**Dependencies:** U2 (provides the `resend` flag in the model).

**Files:**
- Postmark `event-registration-confirmed` template (external — Postmark dashboard, **not a repo commit**)
- `docs/` note or the operational section below recording the template change

**Approach:** Add a `{{#resend}}...{{/resend}}` Mustachio block near the top: e.g. "We've upgraded to QR tickets — here are yours. Use the booking page below to add your guests' names and share their tickets." Leave the default (non-resend) body unchanged. Because Mustachio renders an absent/false section as empty, the code in U2 is safe to deploy before or after the template edit.

**Patterns to follow:** Existing Mustachio sections in the project's Postmark templates; project memory on Mustachio (`feedback_postmark_mustachio`).

**Test scenarios:**
- `Test expectation: none (external template)` — validate by sending a test: `resend: true` shows the intro; a normal registration (`resend` false/absent) does not.

**Verification:** Postmark "send test" with `{"resend": true}` renders the intro; with it omitted, the standard confirmation renders unchanged.

---

## Risks & Mitigations

- **Double-emailing real members.** Mitigated by `ticket_email_sent_at` + bulk defaulting to `IS NULL`, a confirm dialog on bulk, and idempotency test (U5).
- **Sending before the template block is live.** Safe by design (KTD5 — Mustachio renders empty); worst case is a resend that reads slightly oddly without the intro, not a broken email.
- **Type regen dropping hand-written aliases** (`feedback_db_types_aliases`). Mitigated by the explicit re-append step in U1.
- **Time pressure for Fireside Chat (2026-06-24).** U3+U4 are the critical path and are deliberately independent of U5/U6; ship them first and resend Fireside Chat manually per-row if needed.

## Operational / Rollout Notes

1. Deploy U1 migration (additive, safe anytime).
2. Deploy U2–U4; add the U6 Postmark template block (any order vs code).
3. **Fireside Chat (2026-06-24):** resend its 6 registrations via the per-row button (or bulk) as soon as U3/U4 are live.
4. Then bulk-resend "Polo and DJ" (2026-07-01) and "Polo & Banya" (2026-07-03).
5. Post-send audit query (no rows expected for upcoming, paid/free):
   ```sql
   select e.title, count(*) filter (where r.ticket_email_sent_at is null) as not_notified
   from event_registrations r join events e on e.id = r.event_id
   where r.status in ('paid','free') and coalesce(e.end_date,e.start_date) >= current_date
   group by e.title;
   ```

## Sources & Research

- Origin: `docs/brainstorms/2026-06-22-event-qr-access-flow-requirements.md` (FEAT-41).
- Production audit (project `rmchkoktpzoojlglyfca`, 2026-06-23): all 12 upcoming paid/free registrations have `manage_token`, credentialed tickets, and lead ticket types; past events deliberately excluded from credential/ticket backfill.
- Code: `lib/email/event-registration.ts` (`sendEventRegistrationConfirmation`), `lib/postmark.ts` (lazy client, `sendEmail`), `app/(checkin)/public/bookings/[token]/page.tsx` (manage_token booking page), `app/(admin)/admin/events/[id]/attendees/page.tsx` + `components/admin/AttendeeList.tsx`/`ManageEventTabs`, `app/api/admin/events/[id]/waitlist/convert/route.ts` (admin action pattern), `lib/broadcast/event-audience.ts` (event registrant resolution).
- Project memory: `feedback_postmark_mustachio`, `feedback_db_types_aliases`, `feedback_sdk_lazy_init`.
