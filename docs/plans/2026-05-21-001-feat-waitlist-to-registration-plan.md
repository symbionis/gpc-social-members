---
title: "feat: Convert waitlist entry to registration"
type: feat
status: completed
date: 2026-05-21
origin: docs/brainstorms/2026-05-21-waitlist-to-registration-requirements.md
---

# feat: Convert waitlist entry to registration

## Summary

Add an admin action that promotes an `event_waitlist` entry into a confirmed, comped registration: the admin sets a ticket count (default 1), the conversion creates a free `event_registrations` row that ignores the seat cap, deletes the waitlist entry, and emails the person a new "your spot has freed up — you're confirmed" message. The converted person then matches automatically at door check-in. Reuses the existing registration-creation, Postmark, and email-matching patterns; adds one new Postmark template.

---

## Problem Frame

When an event fills, sign-ups land on the read-only `event_waitlist` (name + email only). There's no way to promote a waitlisted person — the public register route enforces the cap and (for paid events) payment. Organizers need a one-click way to confirm a waitlisted person, notify them, and have them appear as a real attendee. See origin: docs/brainstorms/2026-05-21-waitlist-to-registration-requirements.md.

---

## Requirements

**Admin action**
- R1. Each waitlist entry (in the Manage Event waitlist UI) has a ticket-count input (default 1, integer 1–6) and a "Register" button that converts it.
- R2. When a conversion would exceed the seat cap, the admin gets a confirmation showing the resulting count (e.g. "this will put the event at 501 / 500 — convert anyway?"); within cap, no confirmation. The cap never blocks the action.
- R11. The conversion endpoint is admin-only via the existing `assertAdmin` roles (`super_admin`, `team_admin`, `events_admin`).

**Conversion behavior**
- R3. Conversion creates an `event_registrations` row: `status='free'`, `unit_amount_chf=0`, `total_amount_chf=0`, `quantity`=chosen count, generated `reference_code`, `paid_at=now`.
- R4. The conversion overrides the seat cap — no capacity check blocks it; it may exceed the cap.
- R5. The waitlisted email is matched (case-insensitive) against active members; a match sets `is_member=true` + `member_id`, else `is_member=false`. Amount stays 0.
- R6. If the email already has a `paid`/`free` registration for the event, the conversion is rejected (409, clear message); no second registration is created and the waitlist entry is left in place.
- R7. On success, the waitlist entry is deleted.
- R8. Conversion is a manual admin action — no automatic promotion.

**Email**
- R9. On success, send a confirmation via a new Postmark template `event-waitlist-confirmed` (reusing the `main-polo-club` Layout), English-only, with the spot-freed message + event details + reference code.
- R10. Email is best-effort — a failed send is logged but does not roll back the registration.

**Origin actors:** A1 (admin/organizer), A2 (waitlisted person), A3 (member directory)
**Origin flows:** F1 (convert a waitlist entry to a registration)
**Origin acceptance examples:** AE1 (full event → free reg + remove + email), AE2 (member match), AE3 (duplicate reject), AE4 (quantity), AE5 (waitlist email, not the standard reg email)

---

## Scope Boundaries

- No Stripe payment / payment links on conversion — always comped free, even on paid events.
- No automatic promotion when a spot frees — manual admin action only.
- No waitlist status lifecycle — entries are deleted on conversion, not archived.
- Email is English-only — no bilingual version (matches all existing transactional emails).
- No bulk/multi-select conversion — one entry at a time.

### Deferred to Follow-Up Work

- The standalone "Waitlist" tab (PR #20, branch `fix/event-waitlist-tab`) is in flight. This plan adds the convert action to the waitlist UI in `components/admin/ManageEventTabs.tsx` wherever the waitlist renders — the Waitlist tab if PR #20 has merged, otherwise the waitlist section inside the Registrations tab. Either way the row markup is the integration point.

---

## Context & Research

### Relevant Code and Patterns

- Registration creation: `app/api/events/[id]/register/route.ts` — `generateReferenceCode()` (8-char `EV-XXXX`), the `event_registrations` insert shape (status/amounts/quantity/reference_code/paid_at), and the paid/free duplicate guard (`.eq("email").in("status",["paid","free"])`).
- Email send: `lib/postmark.ts` `sendEmail({ to, templateAlias, templateModel })` (Postmark `sendEmailWithTemplate`). Existing example: `lib/email/event-registration.ts` (`sendEventRegistrationConfirmation`, alias `event-registration-confirmed`, English, rich `templateModel`). Mirror it.
- Postmark template management: `app/api/admin/email-templates/[alias]/route.ts` uses `getPostmarkClient()` with `getTemplate`/`editTemplate`; the same client supports `createTemplate` (with `LayoutTemplate`). Layout alias is `main-polo-club`.
- Email template source copies live in `docs/email-templates/` (e.g. `event-reminder.html`/`.txt`).
- Member-by-email matching: the case-insensitive `ilike` + exact-lowercase pattern in `lib/events/checkin.ts` (`matchEmail`/`escapeLike`) — reuse the approach for the member lookup and the duplicate-registration check.
- Admin endpoint shape: `assertAdmin()` in `app/api/admin/events/[id]/attendees/route.ts` (roles + `{error,status}` union).
- Admin client: `createAdminClient()` (service role); `createClient()` (server) only for `getUser()`.
- Waitlist UI: `components/admin/ManageEventTabs.tsx` (waitlist table) — page already loads waitlist in `app/(admin)/admin/events/[id]/attendees/page.tsx`.
- Vitest unit-test patterns (mocked admin client / mocked deps): `lib/events/checkin.test.ts`, `app/api/events/[id]/check-in/route.test.ts`.

### Institutional Learnings

- `docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md` — route files export only HTTP handlers; shared helpers (the reference-code generator, lookups) must live in `lib/`. This is why U1 extracts `generateReferenceCode`.
- `docs/solutions/database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md` — the resulting-seat-count for the overbook check should come from the existing `seats_used` RPC (`lib/events/seat-usage.ts`), not a TS row count.

### External References

- None — fully patterned internally.

---

## Key Technical Decisions

- **Always comp as free** (`status free`, amount 0) regardless of event price (see origin: requirements Key Decisions).
- **Cap overridden by design**; the only cap interaction is a confirm-on-overbook in the UI (R2), driven by the existing `seats_used` RPC for the resulting count.
- **New Postmark template `event-waitlist-confirmed`**, English, reusing Layout `main-polo-club`, created via `getPostmarkClient().createTemplate(...)`; HTML/text source copies committed under `docs/email-templates/` to match the existing convention.
- **Member detection by email is acceptable here** because this is an authenticated admin action — distinct from the public register route, which deliberately trusts only the auth session.
- **Extract `generateReferenceCode` to `lib/events/registration.ts`** so both the register route and the new convert route share it (honors the route-export rule).
- **Duplicate guard rejects (409)** rather than creating a second registration; mirrors the register route.
- **Email best-effort** but **awaited and reported** — the response carries `email_sent` so the admin is told if the courtesy notification failed (the whole point of the action is notifying the person). The Postmark template is verified to exist before the first conversion.
- **Insert → delete, registration as source of truth, no transaction/RPC for v1.** If the waitlist delete fails after the insert, the registration stands and the Waitlist UI self-heals by hiding entries already registered. An atomic insert+delete RPC was considered and deferred as unnecessary for a low-traffic admin action with a visual self-heal.
- **Duplicate guard is race-safe:** a fast-path `hasExistingRegistration` pre-check plus a partial `UNIQUE (event_id, lower(email)) WHERE status IN ('paid','free')` index (U5) as the backstop; `23505` is caught and returned as 409 (mirrors `recordCheckin`). The same index also hardens the public register route's previously check-then-insert-only guard (register route updated to catch `23505`).
- **Audit trail:** a nullable `converted_by` FK on `event_registrations` (→ `admin_users`) records which admin comped the spot; set on conversion. Payments remain the source of truth for accounting.

---

## Open Questions

### Resolved During Planning

- Postmark Layout alias: `main-polo-club` (user-confirmed).
- Overbook UX: confirm step when the conversion exceeds the cap; passive otherwise (user-confirmed).
- Member lookup + duplicate check: reuse the case-insensitive matching approach from `lib/events/checkin.ts`.
- Duplicate hardening (partial unique index) and audit trail (`converted_by`) are IN scope (U5), per user decision.

### Deferred to Implementation

- Final English email copy wording (drafted during U2; product-approved before the template is created in Postmark).
- Whether `createTemplate` runs as a one-off script (`scripts/`) or a manual dashboard create — both reuse the `main-polo-club` Layout; pick whichever is least friction at execution.
- Resolving any pre-existing duplicate paid/free `(event_id, lower(email))` rows surfaced by U5's pre-check (only if the production data actually has any).

---

## Implementation Units

### U1. Shared registration helpers

**Goal:** Extract the reference-code generator into a shared module and add the member-lookup + duplicate-registration helpers the convert route needs.

**Requirements:** R3, R5, R6

**Dependencies:** None

**Files:**
- Create: `lib/events/registration.ts`
- Modify: `app/api/events/[id]/register/route.ts` (import `generateReferenceCode` from the new module instead of defining it locally)
- Create: `lib/events/registration.test.ts`

**Approach:**
- Move `generateReferenceCode()` verbatim into `lib/events/registration.ts`; re-import it in the register route (behavior unchanged).
- Add `findActiveMemberByEmail(email)` → `{ id } | null`, matching `members` by lowercased email with `status='active'` (reuse the `escapeLike` + `ilike` + exact-lowercase compare approach from `lib/events/checkin.ts`). If more than one active member matches, pick deterministically (earliest by `created_at`), mirroring `resolveMatch`.
- Add `hasExistingRegistration(eventId, email)` → boolean, matching `event_registrations` for the event by lowercased email in `('paid','free')`.
- All use `createAdminClient()`. Keep helpers here (not exported from any `route.ts`).

**Patterns to follow:**
- `lib/events/checkin.ts` (`matchEmail`, `escapeLike`, normalize-then-exact-compare); register route's existing duplicate-guard query.

**Test scenarios:**
- Happy: `generateReferenceCode()` returns `EV-` + 8 chars from the reference alphabet.
- Happy: `findActiveMemberByEmail` returns the member id for an active member matching case-insensitively. Covers AE2.
- Edge: `findActiveMemberByEmail` returns null for a non-active match and for no match.
- Happy: `hasExistingRegistration` returns true when a paid/free row exists for the event+email, false otherwise. Covers AE3.
- Edge: mixed-case email matches in both helpers (normalization).

**Verification:**
- The register route still builds and its tests/behavior are unchanged; the three helpers return correct values under the mocked admin client.

---

### U2. Waitlist-confirmed email + Postmark template

**Goal:** A send function and a new Postmark template for the spot-freed confirmation.

**Requirements:** R9, R10

**Dependencies:** None

**Files:**
- Create: `lib/email/event-waitlist.ts`
- Create: `docs/email-templates/event-waitlist-confirmed.html`, `docs/email-templates/event-waitlist-confirmed.txt`
- Create: `lib/email/event-waitlist.test.ts`

**Approach:**
- `sendWaitlistConfirmation(registrationId)` mirrors `sendEventRegistrationConfirmation`: load the registration + event via `createAdminClient()`, build the `templateModel` (`first_name`, `event_title`, `event_date_label`, `event_time`, `event_location`, `quantity`, `reference_code`, `event_url`, `preheader`), and `sendEmail({ to, templateAlias: "event-waitlist-confirmed", templateModel })`. Best-effort; log on failure, never throw to the caller.
- Author the HTML + text bodies (the "a spot has freed up / you're now confirmed / looking forward to welcoming you" copy) as source copies under `docs/email-templates/`, using the same Mustachio variables.
- Create the template in Postmark via `getPostmarkClient().createTemplate({ Alias: "event-waitlist-confirmed", Name, Subject, HtmlBody, TextBody, LayoutTemplate: "main-polo-club" })` — one-off (script or dashboard).

**Patterns to follow:**
- `lib/email/event-registration.ts` (model shape, date/time formatting, `event_url` logic); `lib/postmark.ts`.

**Test scenarios:**
- Happy: given a registration + event, `sendWaitlistConfirmation` calls `sendEmail` with `templateAlias: "event-waitlist-confirmed"` and a model carrying the recipient first name, event title, quantity, and reference code. Covers AE5.
- Error: a missing registration returns `{ success: false }` and does not call `sendEmail`.
- Error: a `sendEmail` failure is returned as `{ success: false }` (logged), not thrown.

**Verification:**
- Sending uses the new alias (not `event-registration-confirmed`); the template renders within the `main-polo-club` layout in Postmark.

---

### U3. Waitlist-to-registration convert API route

**Goal:** The admin endpoint that performs the conversion.

**Requirements:** R3, R4, R5, R6, R7, R8, R10, R11

**Dependencies:** U1, U2, U5

**Files:**
- Create: `app/api/admin/events/[id]/waitlist/convert/route.ts` (POST)
- Create: `app/api/admin/events/[id]/waitlist/convert/route.test.ts`

**Approach:**
- `assertAdmin()` (note: `assertAdmin` is a local, non-exported helper copied per admin route — not a shared import). This route's `assertAdmin` also returns the acting admin's `admin_users.id` (for `converted_by`). Body `{ waitlistId, quantity }`: validate `quantity` with `Number.isInteger` **and** range 1–6 (reject `1.5`, `"3"`, etc. with 400).
- Load the `event_waitlist` row by `id` **and** `event_id` (the path id) — 404 if absent. The new registration copies `name` and `email` from this row (both are NOT NULL on `event_registrations`); lowercase the email to match the register route.
- `hasExistingRegistration(eventId, email)` → if true, 409 (no insert, leave the waitlist row). Covers R6. Race note: this is a check-then-insert with no DB unique constraint on `event_registrations(event_id,email)` (same as the register route) — see Risks for the accepted concurrent window and the optional hardening.
- `findActiveMemberByEmail(email)` → sets `is_member`/`member_id`.
- Insert `event_registrations` (`name`, `email`, status `free`, amounts 0, `quantity`, `generateReferenceCode()`, `paid_at=now`, `is_member`, `member_id`, `converted_by`=acting admin id). **No seat-cap check** (R4). Catch a `23505` from the partial unique index (U5) and return the same 409 as the pre-check — race-safe dedupe (mirrors `recordCheckin`'s `isUniqueViolation` handling).
- Delete the `event_waitlist` row, scoped to `id` **and** `event_id` (R7). **Failure contract:** the registration is the source of truth; order is insert → delete. If the delete fails after a successful insert, log it — the Waitlist UI hides entries whose email already has a paid/free registration (U4), so the orphaned row self-heals visually rather than blocking.
- `await sendWaitlistConfirmation(registrationId)` (a single send; admin-action latency is fine) and include its outcome in the response so the UI can flag a failed notification.
- Return `{ success: true, reference_code, seats_used, email_sent }` — the post-conversion `seats_used` (RPC) lets the UI show the true resulting count even if the pre-click estimate was stale.

**Patterns to follow:**
- `app/api/events/[id]/register/route.ts` (insert shape, free-path email send), `app/api/admin/events/[id]/attendees/route.ts` (`assertAdmin`, `bad()`). For the auth-branch tests mock `createClient` (`@/lib/supabase/server`) to drive `auth.getUser()` plus the `admin_users` lookup on the admin client — the pattern in `app/api/admin/events/[id]/settings/route.test.ts`. (Do NOT model on `app/api/events/[id]/check-in/route.test.ts` — that route is public/unauthenticated and has no admin auth to mock.)

**Test scenarios:**
- Auth: no session → 401; signed-in non-admin → 403 (mock `createClient` getUser + `admin_users`).
- Error: `quantity` not a strict integer 1–6 (e.g. `1.5`, `"3"`, `0`, `7`) → 400.
- Error: unknown `waitlistId` → 404.
- IDOR: a `waitlistId` belonging to a different event → 404, no delete. Covers R6/R7 scoping.
- Edge/Error: email already has a paid/free registration → 409, no insert, waitlist row not deleted. Covers AE3.
- Happy: valid entry → creates a free registration (status free, amount 0, `name`/`email` copied from the waitlist row), deletes the waitlist row, calls `sendWaitlistConfirmation`. Covers AE1.
- Happy: email matches an active member → inserted row has `is_member=true` + `member_id`. Covers AE2.
- Happy: `quantity=3` → inserted row has `quantity=3`. Covers AE4.
- Happy: the inserted row records `converted_by` = the acting admin's id. Covers R3 (audit).
- Integration: a duplicate insert that slips past the pre-check raises `23505` → 409, no second registration. Covers R6 (race-safe).
- Edge: event already at/over cap → conversion still succeeds (no cap block); response carries the post-conversion `seats_used`. Covers R4.
- Integration: email send failure → still 200 with `reference_code` and `email_sent: false`; registration persists. Covers R10.

**Verification:**
- A waitlisted person is converted to a free registration, removed from the waitlist, and emailed; duplicates and bad input are rejected; the cap never blocks.

---

### U4. Waitlist UI — convert action

**Goal:** The ticket-count + Register control on each waitlist row, with overbook confirmation.

**Requirements:** R1, R2

**Dependencies:** U3

**Files:**
- Modify: `components/admin/ManageEventTabs.tsx` (waitlist row markup — Waitlist tab if merged, else the waitlist section)
- Modify: `app/(admin)/admin/events/[id]/attendees/page.tsx` (pass `seats_used`/resulting-count inputs if not already available)
- Test: Playwright E2E / manual QA

**Approach:**
- Per waitlist row: a small number input (default 1, min 1, max 6) and a "Register" button. **Disable the button while the request is in flight** so a double-click can't create two registrations.
- On click: if `currentSeatsUsed + quantity > seatCap` (capped events), show a confirm ("this will put the event at {n} / {cap} — convert anyway?"); otherwise proceed directly. The pre-click count is an estimate (server never re-checks the cap). Then `fetch` POST to `/api/admin/events/${eventId}/waitlist/convert` with `{ waitlistId, quantity }`.
- On success: `router.refresh()` so the data reloads; surface the true resulting count from the response (`seats_used`), and if `email_sent` is false show "converted — confirmation email failed, notify manually." On error show an inline message (e.g. the 409 "already registered").
- **Self-heal:** the waitlist list filters out entries whose email already has a paid/free registration, so an orphaned row (delete-after-insert failure) disappears on the next load rather than re-triggering a 409.
- Mirror the inline-error style of the former `AttendeeList` toggle / existing admin fetches.

**Execution note:** UI unit — browser/manual verification; no vitest.

**Patterns to follow:**
- Existing admin client-component fetch + inline error patterns (`components/admin/EventCheckInSettings.tsx`, prior `AttendeeList` toggle); `lib/events/seat-usage.ts` for the resulting-count.

**Test scenarios:**
- Happy: entering 1 and clicking Register on a within-cap event converts the entry and it disappears from the waitlist (manual/E2E).
- Edge: converting when it would exceed the cap shows the overbook confirmation; confirming proceeds, cancelling does nothing. Covers R2.
- Error: converting an email already registered surfaces the 409 message inline.
- Edge: ticket-count input is bounded 1–6.

**Verification:**
- An organizer can convert a waitlist entry from the UI, sees the overbook confirmation when relevant, and the list updates on success.

---

### U5. Schema: registration dedupe index + comp audit column

**Goal:** Make the duplicate guard race-safe at the DB level and record which admin comped a conversion.

**Requirements:** R3 (audit), R6 (race-safe dedupe)

**Dependencies:** None (U3 depends on this)

**Files:**
- Create: `supabase/migrations/20260521HHMMSS_event_registrations_dedupe_index_and_converted_by.sql`
- Modify: `types/database.ts`
- Modify: `app/api/events/[id]/register/route.ts` (catch `23505` → its existing "already registered" 409, so the new index never surfaces as a 500 on a racing duplicate)

**Approach:**
- **Pre-check (blocking):** before creating the index, run `SELECT event_id, lower(email), count(*) FROM event_registrations WHERE status IN ('paid','free') GROUP BY 1,2 HAVING count(*) > 1` — the index creation fails if existing duplicates exist, so resolve any first.
- Add `CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_email_paidfree_uniq ON public.event_registrations (event_id, lower(email)) WHERE status IN ('paid','free');`.
- Add `converted_by uuid NULL REFERENCES public.admin_users(id) ON DELETE SET NULL` to `event_registrations`.
- Regenerate types; re-append the hand-written `MemberStatus`/`PaymentCaptureStatus` aliases.
- Apply additively to the remote project (consistent with prior migration handling), after the duplicate pre-check passes.

**Patterns to follow:**
- Prior migrations under `supabase/migrations/` (idempotent, commented header citing this plan).

**Test scenarios:**
- Test expectation: none (schema). Verify via `get_advisors`, types compile, and that the duplicate pre-check returns zero rows before the index is created. The `23505`-handling behavior is covered by U3's tests and the register route's existing duplicate test.

**Verification:**
- The partial unique index and `converted_by` column exist; `types/database.ts` includes both and still carries the hand-written aliases; the duplicate pre-check returned zero; the register route catches `23505` cleanly.

---

## System-Wide Impact

- **Interaction graph:** New admin POST route; reuses the register route's insert shape and the Postmark sender. The register route gains an import (the extracted `generateReferenceCode`) — behavior unchanged.
- **State lifecycle:** Conversion creates a registration and deletes the waitlist row; on a duplicate it does neither. Email is fire-and-forget after the row is created (registration persists even if email fails).
- **Capacity:** Converted registrations count toward `seats_used` (the RPC counts paid/free quantity), intentionally pushing past the cap — and they then appear at door check-in as matched attendees.
- **Unchanged invariants:** The public register route's cap + payment behavior, the check-in flow, and the waitlist join flow are unchanged. Member detection by email is new and confined to this admin route.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| New Postmark template missing in production at first send | Create the `event-waitlist-confirmed` template (Layout `main-polo-club`) before/with deploy; `sendEmail` failure is non-fatal and logged, so a missing template doesn't break the conversion. |
| Extracting `generateReferenceCode` changes the register route | Pure move + re-import, covered by U1 verification; no behavior change. |
| Overbook is intentional but could surprise | R2 confirmation surfaces the resulting count before exceeding the cap. |
| Waitlist UI integration point depends on PR #20 (Waitlist tab) | U4 targets the waitlist row markup regardless of which tab/section hosts it; note the dependency at execution. |
| Email copy not finalized | Drafted in U2, product-approved before the Postmark template is created. |
| Orphaned waitlist row if the delete fails after the insert | Registration is the source of truth; the Waitlist UI hides entries already registered so the row self-heals on next load; the failure is logged. |
| Double-click / concurrent convert creates two free registrations | Partial unique index (U5) makes it race-safe (`23505` → 409); the UI also disables the button during the request. |
| Adding the unique index fails if production already has duplicate paid/free `(event_id, lower(email))` rows | U5 runs a blocking duplicate pre-check and resolves any before creating the index. |
| A converted person is never notified (email fails, esp. missing template on first send) | Send is awaited and `email_sent` is returned so the admin sees the failure; template existence verified before first use. |

---

## Documentation / Operational Notes

- Create the `event-waitlist-confirmed` Postmark template (Layout `main-polo-club`) as part of shipping; commit the HTML/text source under `docs/email-templates/`.
- After shipping, capture the comp-conversion pattern with `/ce-compound` if reused (the admin-comp-from-waitlist + email flow).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-21-waitlist-to-registration-requirements.md](docs/brainstorms/2026-05-21-waitlist-to-registration-requirements.md)
- Related code: `app/api/events/[id]/register/route.ts`, `lib/email/event-registration.ts`, `lib/postmark.ts`, `app/api/admin/email-templates/[alias]/route.ts`, `lib/events/checkin.ts`, `lib/events/seat-usage.ts`, `components/admin/ManageEventTabs.tsx`
- Related PRs: #19 (event door check-in), #20 (Waitlist tab — in flight)
