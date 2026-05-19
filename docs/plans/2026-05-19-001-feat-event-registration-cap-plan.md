---
date: 2026-05-19
type: feat
topic: event-registration-cap
status: active
origin: docs/brainstorms/2026-05-19-event-registration-cap-requirements.md
---

# feat: Event Registration Cap & Waitlist

## Summary

Add an optional `seat_cap` to events. Server-side checks reject new registrations when paid+free seats consumed (sum of `quantity`) would reach or exceed the cap. Public and member event pages render "Fully booked" with a minimal waitlist form (name + email only) instead of the registration CTA; when seats are low, a "Only N seats left" warning appears and the quantity selector is clamped. Admin event form gains a cap input with a below-current-usage warning. Admin event detail shows seats used vs. cap and the waitlist list.

---

## Problem Frame

Events have no concept of capacity (see origin: `docs/brainstorms/2026-05-19-event-registration-cap-requirements.md`). The only way to stop sales today is to flip `registration_enabled = false`, which silently kills the registration UI with no "fully booked" affordance and no way to capture leftover demand. This plan adds the missing capacity primitive plus a manual-managed waitlist so admins can both stop sales automatically and retain interested members for follow-up.

---

## Requirements Traceability

Origin requirements covered (see origin doc for full text):

- R1–R5 — schema + counting semantics → U1, U2
- R6 — low-availability threshold (5 seats) → U3, U4
- R7 — fully-booked CTA disable → U3, U4
- R8 — waitlist form when fully booked → U5
- R9 — `registration_enabled = false` overrides cap → U3, U4
- R10 — quantity clamp to remaining seats → U3, U4
- R11–R13 — waitlist data + API → U2, U5, U6
- R14 — admin cap input → U7
- R15 — admin seats-used + waitlist view → U8
- R16 — cap-below-usage warning, non-blocking → U7

Acceptance examples AE1–AE6 are bound to test scenarios in U2, U3, U4, U5, U7.

---

## Key Technical Decisions

- **Counting query**: a single SQL aggregate `SELECT COALESCE(SUM(quantity), 0)` on `event_registrations` filtered by `event_id` and `status IN ('paid', 'free')`. Wrapped in a small helper `lib/events/seat-usage.ts` so server pages, the register route, and admin views share one source of truth.
- **Cap enforcement** lives in the registration POST handler only (Option A, per origin Key Decisions: oversell-by-one accepted). No webhook-side recount, no Stripe refund path, no new status value. If oversell ever happens in practice, the admin sees it on the event detail page (seats used > cap) and handles manually.
- **Free-event detection** reuses the same `unitAmount === 0` resolution already in the register route. Extracted to a helper for clarity but no semantic change.
- **Waitlist table** is a separate `event_waitlist` table, not a status on `event_registrations`. Waitlist is not a registration — no payment, no quantity, no member linkage, different lifecycle. Separate table keeps `event_registrations` semantics clean.
- **Low-availability threshold** = `5` as a module-level constant in `lib/events/seat-usage.ts`. Not a column, not env-configurable. Origin Key Decisions: tunable in code if 5 turns out wrong.
- **Server-rendered page data**: the public + member event pages already fetch the event server-side. They will also compute `seatsUsed`, `seatsRemaining`, and pass them to the drawer/form via props. No new client fetch.
- **No RLS on `event_waitlist`** to start — same posture as `event_registrations` writes, which go through the admin client. Anonymous waitlist join goes through a new POST route that uses the admin client server-side.

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

State the cap derivation in one place:

```
seatsUsed(event)   = SUM(quantity) WHERE event_id = e.id AND status IN ('paid','free')
seatsRemaining(e)  = e.seat_cap IS NULL ? Infinity : max(0, e.seat_cap - seatsUsed(e))
isFullyBooked(e)   = e.seat_cap IS NOT NULL AND seatsRemaining(e) <= 0
isLowAvailability  = seatsRemaining(e) > 0 AND seatsRemaining(e) <= 5
```

Page-level rendering decision tree on the event page:

```
if !event.registration_enabled        → existing "registration closed" block (unchanged)
elif isFullyBooked(event)             → "Fully booked" + WaitlistForm
else                                  → RegistrationDrawer
                                         (with maxQuantity = min(6, seatsRemaining))
                                         + low-availability badge if applicable
```

Server-side enforcement in the register POST (after the existing duplicate guard, before INSERT):

```
if event.seat_cap is not null:
  used = seatsUsed(event)
  if used + quantity > event.seat_cap:
    return 409 "Not enough seats remaining"
```

---

## Implementation Units

### U1. Schema: add `seat_cap` to `events` and create `event_waitlist`

**Goal**: Database support for capacity and waitlist.

**Requirements**: R1, R11

**Dependencies**: none

**Files**:
- `supabase/migrations/<timestamp>_event_seat_cap_and_waitlist.sql` (new)
- `types/database.ts` (regenerate via Supabase MCP, then re-append hand-written aliases per project memory)

**Approach**:
- `ALTER TABLE public.events ADD COLUMN seat_cap integer NULL CHECK (seat_cap IS NULL OR seat_cap > 0);` — nullable, must be positive when set.
- `CREATE TABLE public.event_waitlist (id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade, name text not null, email text not null, created_at timestamptz not null default now());`
- Index: `CREATE INDEX event_waitlist_event_created_idx ON public.event_waitlist(event_id, created_at);`
- No RLS policies in this migration — table is admin-client-only on writes, server-rendered on reads.

**Patterns to follow**: existing migrations in `supabase/migrations/` (e.g. `20260518093339_event_reminders.sql`) for naming and structure.

**Test scenarios**:
- Migration applies cleanly on a fresh database and on the current dev branch.
- After regen, `types/database.ts` shows `seat_cap` on events and full `event_waitlist` table type; hand-written `MemberStatus` / `PaymentCaptureStatus` aliases still present (re-append after regen).
- `INSERT INTO events (..., seat_cap) VALUES (..., 0)` fails the check constraint.
- `INSERT INTO event_waitlist` with valid event_id succeeds; with bad event_id fails FK.

**Verification**: migration in `supabase/migrations/`, types regenerated, hand-written aliases re-appended, `supabase db reset` runs cleanly locally.

---

### U2. Seat-usage helper

**Goal**: Single source of truth for seat-usage math, free-event detection, and the low-availability threshold.

**Requirements**: R2, R3, R6

**Dependencies**: U1

**Files**:
- `lib/events/seat-usage.ts` (new)
- `lib/events/__tests__/seat-usage.test.ts` (new)

**Approach**:
- Exports:
  - `LOW_AVAILABILITY_THRESHOLD = 5`
  - `async function getSeatsUsed(supabase, eventId): Promise<number>` — SQL aggregate `SUM(quantity) FILTER (WHERE status IN ('paid','free'))`
  - `function deriveSeatState({ seatCap, seatsUsed }): { isFullyBooked, seatsRemaining, isLowAvailability }`
  - `function isFreeForRegistrant({ unitAmount }): boolean` — wraps `unitAmount === 0` (used by register route + page)
- `seatsRemaining` returns `null` (uncapped) when `seatCap` is null. Downstream callers treat `null` as "no cap, no warning, no clamp".

**Patterns to follow**: existing helpers in `lib/events/reminder-schedule.ts` for module shape and unit-testable pure functions.

**Test scenarios**:
- **Covers AE1, AE2.** `getSeatsUsed` returns the sum of `quantity` only across `status IN ('paid','free')` — pending and cancelled rows do not contribute. Seed three rows: paid qty=2, pending qty=3, free qty=1 → result is 3.
- `deriveSeatState({ seatCap: null, seatsUsed: 100 })` → `{ isFullyBooked: false, seatsRemaining: null, isLowAvailability: false }`.
- `deriveSeatState({ seatCap: 10, seatsUsed: 10 })` → `{ isFullyBooked: true, seatsRemaining: 0, isLowAvailability: false }`.
- `deriveSeatState({ seatCap: 10, seatsUsed: 11 })` → `{ isFullyBooked: true, seatsRemaining: 0, ... }` (overbooked clamps to zero, not negative).
- **Covers AE3.** `deriveSeatState({ seatCap: 30, seatsUsed: 27 })` → `{ isLowAvailability: true, seatsRemaining: 3 }`.
- `deriveSeatState({ seatCap: 30, seatsUsed: 25 })` → `isLowAvailability: false` (boundary at 5).
- `isFreeForRegistrant({ unitAmount: 0 })` → true; `{ unitAmount: 0.01 }` → false.

**Verification**: helper exported, used by U3+ without duplication; tests green.

---

### U3. Register route: cap enforcement + quantity clamp

**Goal**: Server-side rejection when capacity exceeded; honour `registration_enabled = false` ahead of capacity.

**Requirements**: R3, R4, R5, R9, R10

**Dependencies**: U2

**Files**:
- `app/api/events/[id]/register/route.ts` (modify)
- `app/api/events/[id]/register/__tests__/route.test.ts` (new — or extend if a sibling test exists)

**Approach**:
- Add `seat_cap` to the existing `SELECT` from `events`.
- Order of checks (preserve existing first): published → registration_enabled → members-only auth → duplicate-email → **new: capacity recount**.
- New step (only when `event.seat_cap !== null`): call `getSeatsUsed(supabase, eventId)`. If `seatsUsed + quantity > seat_cap`, return `409 "Not enough seats remaining"`.
- The check runs immediately before the insert. Accepts the documented oversell-by-one race (no webhook-side recount).
- Existing `quantity` validation (1–6) stays; the dynamic clamp lives client-side in U4.

**Patterns to follow**: existing structure of `app/api/events/[id]/register/route.ts` — same `bad()` helper, same admin client, same error logging.

**Test scenarios**:
- **Covers AE5.** Event with `registration_enabled = false` AND `seat_cap = 50` AND 10 paid seats: POST returns `400 "Registration is not open for this event"` — capacity check never runs.
- **Covers AE1.** Event with `seat_cap = 10`, 8 paid seats; quantity=2 in body → 200 (proceeds to Stripe checkout). Existing pending row from earlier abandoned checkout (qty=2) does NOT contribute.
- Event with `seat_cap = 10`, 9 paid seats; quantity=2 → 409 with body `{ error: "Not enough seats remaining" }`.
- **Covers AE2.** Free event (`price_member = 0`, `price_non_member = 0`) with `seat_cap = 20` and 20 free registrations: POST returns 409.
- Event with `seat_cap = null` (uncapped) and 1000 paid seats: POST returns 200 — capacity check skipped.
- Members-only event with cap: non-authenticated request returns 403 before any capacity check.

**Verification**: tests green; manual smoke: create capped event in dev, register up to cap, next request returns 409.

---

### U4. Public + member event pages: state computation and conditional rendering

**Goal**: Server-render fully-booked, low-availability, and clamped-quantity states. `registration_enabled = false` always wins.

**Requirements**: R6, R7, R9, R10

**Dependencies**: U2

**Files**:
- `app/(public)/public/events/[id]/page.tsx` (modify)
- `app/(member)/events/[id]/page.tsx` (modify)
- `components/public/EventRegistrationDrawer.tsx` (modify — accept `maxQuantity` prop)
- `components/public/EventRegistrationForm.tsx` (modify — accept `maxQuantity` prop, replace constant)
- `components/public/EventFullyBookedBlock.tsx` (new — composes the "Fully booked" copy + `WaitlistForm`)

**Approach**:
- Both page files compute `seatsUsed` and `deriveSeatState` server-side after fetching the event.
- Replace the existing `event.registration_enabled ? <Drawer /> : <ClosedBlock />` ternary with the three-way decision tree from High-Level Technical Design.
- `EventRegistrationForm` replaces `const MAX_QUANTITY = 6` with `const maxQuantity = props.maxQuantity ?? 6`. Quantity validation, the select dropdown, and the error message all use this value. The `maxQuantity` prop is computed by the page as `Math.min(6, seatsRemaining ?? 6)`.
- Low-availability indicator: a small inline element in the sticky sidebar above the drawer button, shown when `isLowAvailability` is true. Text: `Only {seatsRemaining} {seatsRemaining === 1 ? 'seat' : 'seats'} left`. Style follows existing sidebar typography.
- `EventFullyBookedBlock` shows a "Fully booked" heading and the `WaitlistForm` (U5). Replaces the drawer entirely when full.
- Member page uses the same components — no separate member variant of fully-booked or waitlist.

**Patterns to follow**: existing layout in both page files (sticky aside, `font-heading` / `font-body` typography, `text-marine` brand colour).

**Test scenarios**:
- **Covers AE3.** Event with `seat_cap = 30`, 27 paid seats: public page renders the drawer button AND a visible "Only 3 seats left" indicator. Opening the drawer shows the quantity dropdown with options 1–3 only.
- **Covers AE2, R8.** Event with `seat_cap = 20`, 20 paid seats: public page does NOT render the drawer button; renders `EventFullyBookedBlock` with "Fully booked" copy + waitlist form.
- **Covers AE5.** Event with `registration_enabled = false`, `seat_cap = 50`, 10 paid seats: page renders the existing "Information only — registration is not open" block. No fully-booked block, no waitlist form, no low-availability indicator.
- Event with `seat_cap = null`, 1000 paid seats: drawer renders normally with quantity 1–6, no low-availability indicator.
- Event with `seat_cap = 5`, 0 paid seats: drawer renders, low-availability indicator shows "Only 5 seats left" (threshold is inclusive), quantity dropdown is 1–5.
- Member event page: same three states behave identically on the member view.

**Verification**: visual smoke in dev for each state; component renders pass type-check.

---

### U5. Waitlist form component + join API

**Goal**: Anonymous-or-authenticated visitor can submit name + email to the waitlist when an event is fully booked. Members-only events restrict the form to authenticated members.

**Requirements**: R8, R11, R12, R13

**Dependencies**: U1, U4

**Files**:
- `components/public/WaitlistForm.tsx` (new)
- `app/api/events/[id]/waitlist/route.ts` (new — POST)
- `app/api/events/[id]/waitlist/__tests__/route.test.ts` (new)

**Approach**:
- `WaitlistForm` is a small client component: name input, email input, submit button. POSTs `{ name, email }` to `/api/events/[id]/waitlist`. Renders a success confirmation in place on success. Reuses field styling from `EventRegistrationForm`.
- POST route validates: event exists, `is_published`, NOT `registration_enabled = false` (waitlist follows same gating: closed events show no waitlist), `seat_cap` is not null, event is actually fully booked (recount), visibility check (members-only → require authenticated active member).
- On valid input: insert into `event_waitlist`. No dedupe. Returns 200 with `{ success: true }`.
- Validation mirrors register route: trimmed name required, regex-validated email required.
- Note: the page-level rendering in U4 already gates whether the form is shown. The API check is defense-in-depth so direct POSTs cannot bypass the UI logic.

**Patterns to follow**: `app/api/events/[id]/register/route.ts` for route shape, validation helpers, admin client usage, session-bound member lookup.

**Test scenarios**:
- **Covers AE4.** Public event fully booked: anonymous POST with `{ name: "X", email: "x@y.com" }` returns 200; a row exists in `event_waitlist` with the supplied values.
- Members-only event fully booked: anonymous POST returns 403; same POST from a session-authenticated active member returns 200.
- Event NOT fully booked: POST returns 400 `"Event still has availability"` (waitlist is only for full events).
- Event with `registration_enabled = false`: POST returns 400 `"Registration is not open for this event"` (no waitlist for closed events).
- Event with `seat_cap = null`: POST returns 400 (no waitlist for uncapped events).
- Invalid email: 400.
- Duplicate email + event_id: 200 (no dedupe per R13); two rows exist.

**Verification**: tests green; manual smoke against a fully-booked event in dev.

---

### U6. (folded into U5 — no separate unit needed)

The brainstorm imagined a separate "waitlist data" unit; in practice the schema lands in U1 and the API + component land in U5. U6 reserved as a placeholder so the U-ID stays available for any reviewer-requested split.

---

### U7. Admin event form: `seat_cap` input + below-usage warning

**Goal**: Admin can set, change, or clear the cap from the existing event create/edit form. Lowering below current usage warns but does not block.

**Requirements**: R14, R16

**Dependencies**: U1, U2

**Files**:
- `components/admin/EventManager.tsx` (modify — add field to form state, render input, wire warning)
- `app/api/admin/events/create/route.ts` (modify — accept `seat_cap`)
- `app/api/admin/events/update/route.ts` (modify — accept `seat_cap`)
- `app/api/agent/events/route.ts`, `app/api/agent/events/draft/route.ts`, `app/api/agent/events/[id]/route.ts` (modify — accept `seat_cap` in the agent surface for parity)

**Approach**:
- Form state gains `seat_cap: ""` (blank-string for empty, parsed to integer or null on submit).
- Input rendered next to existing `registration_enabled` toggle. Label: `Seat cap (optional)`. Helper text: `Leave blank for uncapped. Counts paid + free seats.`
- On edit, when the entered cap is less than current `seatsUsed` (fetched once when the form mounts for an existing event), show inline warning: `Cap is below current usage of {seatsUsed} seats. Saving will leave the event overbooked.` Warning does not block save.
- Create + update routes accept `seat_cap` (integer or null) and persist as-is. Validate: integer > 0 OR null; reject negatives, zero, or non-integers with 400.
- Agent endpoints accept the same field for create/update parity.

**Patterns to follow**: existing `registration_enabled` handling in `components/admin/EventManager.tsx` for state + form wiring; existing field validation in create/update routes.

**Test scenarios**:
- Create with `seat_cap: 30` → event row has `seat_cap = 30`.
- Create with `seat_cap: null` (blank input) → event row has `seat_cap = null`.
- Create with `seat_cap: 0` or `-1` or `"abc"` → 400.
- Update from `seat_cap = 30` to `seat_cap = null` → cap cleared.
- **Covers AE6.** Update event with 24 paid seats from `seat_cap = 30` to `seat_cap = 20` → 200; row updated to 20; UI warning shown before save (verified via component test or smoke).
- Agent endpoint create accepts `seat_cap` and persists.

**Verification**: form renders + saves correctly across create/edit/clear; agent endpoints accept the field.

---

### U8. Admin event detail: seats-used + waitlist list

**Goal**: Admin can see capacity utilisation and the waitlist for any event.

**Requirements**: R15

**Dependencies**: U1, U2

**Files**:
- `app/(admin)/admin/events/[id]/attendees/page.tsx` (modify — add seats-used header + waitlist section), OR
- `app/(admin)/admin/events/[id]/page.tsx` (new — if no detail page exists today; choose based on current admin nav)
- Possibly `components/admin/EventWaitlistTable.tsx` (new, small)

**Approach**:
- Decision in implementation: extend the existing `attendees` page (current admin event detail surface) rather than create a separate page. Add a `Capacity` row at the top: `{seatsUsed} / {seat_cap ?? '∞'} seats`. Show in red when `seatsUsed > seat_cap`.
- New `Waitlist` section below attendees: simple table with columns Name, Email, Joined. Ordered by `created_at ASC`. Hide entirely when `seat_cap` is null or waitlist is empty (show "No waitlist entries.").
- No CSV export, no admin "promote to registration" button, no email triggers — per origin scope boundaries.

**Patterns to follow**: existing `app/(admin)/admin/events/[id]/attendees/page.tsx` for layout, data fetching, table styles.

**Test scenarios**:
- Event with `seat_cap = 30`, 24 paid seats, 2 waitlist entries: page shows `24 / 30 seats`, lists both waitlist entries oldest first.
- Event with `seat_cap = null`, 5 paid: page shows `5 / ∞ seats` (or equivalent), no waitlist section.
- Event with `seat_cap = 20`, 22 paid seats: capacity row visually flagged (e.g. red text).
- Event with `seat_cap = 10`, 0 waitlist entries: capacity row shows `0 / 10`, waitlist section shows "No waitlist entries."

**Verification**: visual smoke in dev; counts match what the seat-usage helper returns; table renders waitlist entries oldest first.

---

## Test Strategy

- **Unit tests**: `lib/events/seat-usage.ts` pure-function cases (U2). Cover counting semantics, the threshold boundary at 5, and the null-cap branch.
- **Route tests**: register POST (U3) and waitlist POST (U5) cover the full state matrix from origin acceptance examples. Use the existing test scaffolding for `app/api/events/[id]/register/route.ts` if present; otherwise model after sibling API route tests in the repo.
- **No end-to-end Stripe webhook test** — Option A means the webhook is unchanged.
- **Manual smoke** on a dev branch for each rendering state (uncapped, capped-with-room, low-availability, fully-booked + waitlist, registration-disabled) on both public and member event pages.

---

## System-Wide Impact

- **Webhook** (`app/api/webhooks/stripe/route.ts`): **unchanged**. Option A.
- **Agent API surface**: `seat_cap` flows through agent event create/update routes (U7) for parity with the admin form. No new agent-specific endpoints.
- **Cron / reminders**: no impact. Reminder scheduling uses `event_registrations` rows that are already paid/free, which is exactly what counts toward the cap; no behavioural change.
- **Existing events**: `seat_cap` defaults to NULL — all existing events remain uncapped with identical behaviour.

---

## Scope Boundaries

### Carried from origin

- No automated waitlist promotion, claim links, expiry, or notification emails.
- No cancellation/refund flow.
- No admin override to register past the cap (admin raises the cap instead).
- No pending-checkout seat reservation or TTL.
- No per-tier or per-member-type quotas.
- No member-facing "added to waitlist" automated email.
- No public count display beyond the low-availability warning.

### Deferred to follow-up work

- **U6** (waitlist data unit) folded into U5 — placeholder retained for U-ID stability if reviewer wants a split.
- Webhook-side recount + auto-refund on race-window oversell. Deferred per origin Key Decisions; revisit only if oversells happen in practice.
- Admin "notify me when seats open" / broadcast integration with the waitlist list.

---

## Dependencies / Assumptions

- Supabase MCP regen of `types/database.ts` after U1 will drop hand-written `MemberStatus` / `PaymentCaptureStatus` aliases — re-append per `feedback_db_types_aliases.md` memory.
- Existing Stripe webhook reliably transitions `pending → paid` (already in production). Cap math depends on this contract.
- Existing `EventRegistrationForm` is the only consumer of `MAX_QUANTITY`; replacing the constant with a prop won't break other call sites. (Verified at planning time — only one match.)
- `app/(admin)/admin/events/[id]/attendees/page.tsx` is the right surface for admin capacity + waitlist (current admin event detail). U8 confirms during implementation.

---

## Outstanding Questions

### Deferred to Implementation

- [Affects U8][Technical] Final placement of the capacity + waitlist sections — extend `attendees/page.tsx` or create a separate event detail page. Decide while implementing based on the current admin nav shape.
- [Affects U7][Technical] Whether `seatsUsed` for the below-usage warning is fetched on form mount, or already available in the page-level event data. Cheap either way.
- [Affects U5][Needs research] Whether the existing Postmark transactional setup is worth using for a simple "you've joined the waitlist" confirmation email later. Out of scope now; flagged for future.
