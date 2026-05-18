---
title: feat: Event reminder emails (calendar slots, daily cadence)
type: feat
status: active
date: 2026-05-13
---

# feat: Event reminder emails (calendar slots, daily cadence)

## Summary

Send reminder emails to registered, non-cancelled attendees on a per-event basis. A reminder is a `(days_before, slot)` tuple where `slot ∈ {morning, lunch, evening}` mapped to admin-configurable wall-clock times. Two global presets ship with toggles: "morning before the event" (default ON, `{days_before: 1, slot: "morning"}`) and "morning of the event" (default OFF, `{days_before: 0, slot: "morning"}`). Each event can layer arbitrary additional tuples on top. A single Postmark template handles every reminder via merge variables including `motivation_label` and `time_until_label`. Implemented as a new hourly cron job in the existing `lib/cron/` registry, an idempotency table keyed by `(event, registration, days_before, slot)`, and small UI additions to the event editor and `/admin/scheduled-jobs`.

---

## Problem Frame

The app sends a registration confirmation when someone signs up for an event but never reminds them again. For paid events, attendance and show-up rate suffer when the reminder window between registration and event day is wide (often 1–4 weeks). The team wants reminders configurable per event without hard-coding offsets — today the only timed sends are manual broadcast drafts. Reminders are calendar-shaped ("morning before", "morning of") rather than precise-hour-shaped — humans think in days and times of day, not in `T-24h`.

---

## Requirements

- R1. A registered, non-cancelled attendee receives a reminder email for every configured `(days_before, slot)` that applies to their event, fired at the configured wall-clock time for that slot in Europe/Zurich.
- R2. There are two global presets — "morning before" and "morning of" — each independently toggleable by admins. Default state: morning before = ON, morning of = OFF. Both presets use the same Postmark template as custom entries.
- R3. Each event can have zero or more additional `(days_before, slot)` entries layered on top of the enabled global presets. Duplicates between presets and per-event extras are deduped.
- R4. Slot → wall-clock time mapping (`morning`, `lunch`, `evening`) is admin-editable in global settings; defaults are 08:00 / 12:00 / 18:00 Europe/Zurich.
- R5. The same reminder is never sent twice for the same `(event, registration, days_before, slot)` tuple, even if the cron reruns or the event date changes.
- R6. Reminders are skipped if the registration was created *after* the firing instant — no retroactive sends.
- R7. Cancelled, refunded, or otherwise non-active registrations do not receive reminders.
- R8. Admins can fire a test reminder from the event editor that uses the production template and merge data but sends to the admin's email address only.
- R9. The Postmark template is parameterized with merge variables including `motivation_label` and `time_until_label`, both human-readable and slot-aware (e.g. `time_until_label = "Tomorrow morning"`, `"This evening"`, `"Friday morning"`).
- R10. Cron runs on the existing scheduler in `lib/cron/`; the new global settings appear on `/admin/scheduled-jobs` alongside other timed jobs.

---

## Scope Boundaries

- SMS or push reminders — email only.
- Reminders to non-registered members ("don't miss this Sunday's…") — closer to a scheduled broadcast, intentionally left to the existing broadcast drafts surface.
- Sub-hour or arbitrary clock-time slots — three named slots only (morning/lunch/evening) with admin-editable times.
- Per-event-type slot defaults — global presets are sufficient for v1; per-type tuning can layer on later in the same `email_settings` row.
- Calendar attachments (.ics) on the reminder — useful but out of scope; can be added later via a merge var or attachment without touching the cron.
- Per-registration unsubscribe from reminders — registered attendees are getting transactional reminders for an event they signed up for; treated as transactional, not promotional.
- Per-event override of slot times — slot times are global; if one event needs a different "morning", admins use a custom `(days_before, slot)` extra and accept the global slot time.

---

## Context & Research

### Relevant Code and Patterns

- `lib/cron/scheduler.ts`, `lib/cron/job-registry.ts`, `lib/cron/job-definitions.ts` — node-cron scheduler with a registry pattern; new job registers via these three files. Logging and error handling already wrapped by `withJobLogging`.
- `lib/cron/renewal-reminders.ts` — closest precedent: reads `email_settings` for cadence, finds candidates, checks idempotency column, sends. Multi-stage offset logic already proven there. Mirror its shape for event reminders, but use a separate idempotency table since the per-tuple grain doesn't fit on the registration row.
- `lib/email/event-registration.ts` — Postmark template-send pattern with merge vars; mirror function signature and date/time formatting helpers.
- `lib/postmark.ts` — `sendEmail` wrapper; lazy-init per project memory `feedback_sdk_lazy_init.md`.
- `email_settings` table — existing key/value/enabled triple used for `auto_renewal_reminder`. Add a new key `event_reminder_default`.
- `app/(admin)/admin/scheduled-jobs/page.tsx` + `components/admin/ScheduledJobsList.tsx` — UI surface for cron job toggles and recent runs. Extend with the new global settings.
- `components/admin/EventManager.tsx` — event editor; add a small "Reminder schedule" field for per-event extras.
- `app/api/admin/events/update/route.ts` and `app/api/admin/events/create/route.ts` — accept and persist the new field.
- `event_registrations` columns observed: `id, name, email, quantity, total_amount_chf, reference_code, status, event_id, created_at`.
- `events` columns observed: `id, title, start_date, start_time, location, visibility, price_member, price_non_member, registration_enabled, is_published`.

### Institutional Learnings

- `feedback_postmark_mustachio.md` — Postmark templates use Mustachio. **No `{{#if x}}`** — use `{{#x}}…{{/x}}` for conditional sections. Pass `null` (not `""`) for absent optional values so the template skips the block correctly.
- `feedback_sdk_lazy_init.md` — Postmark client must be lazy-instantiated. The existing `lib/postmark.ts` already follows this; don't break it.
- `feedback_db_types_aliases.md` — `types/database.ts` has hand-written aliases that get dropped by Supabase MCP regen. Re-append after any regen.

### External References

- Postmark template merge-var docs (Mustachio dialect) for the new template body.

---

## Key Technical Decisions

- **Slots, not hours.** A reminder is `(days_before: int, slot: "morning"|"lunch"|"evening")`. Slot is mapped to a wall-clock time at firing-decision time, not at storage time, so admins can shift "morning" from 08:00 to 09:00 globally without touching per-event data.
- **Hourly cron, slot-aware match.** Cron runs at minute 0 of every hour (`0 * * * *`). Each tick computes `(today, current_hour_local)` and looks up which slot the current hour matches (with a small tolerance window — slot fires if `current_hour ∈ [slot_hour, slot_hour + 1)`). 24× fewer ticks than the previous 15-min plan, no DB load wasted on calendars where no reminder is due.
- **Idempotency table over per-row columns.** Renewal reminders use bounded `_1_sent_at` columns because the offsets are fixed. Event reminders allow arbitrary tuples, so a separate `event_reminder_sends(event_id, registration_id, days_before, slot, sent_at)` table with a composite unique constraint scales without schema churn.
- **Compute firing date in Europe/Zurich.** Events store `start_date` (DATE) and `start_time` (TIME) as Europe/Zurich-local fields. Firing date for a `(days_before, slot)` tuple is `start_date - days_before` (calendar arithmetic, not timestamp arithmetic — DST safe by construction).
- **Presets and per-event extras share a single data shape.** Both stored as arrays of `{days_before: int, slot: string}` (presets carry an extra `enabled: bool`). The cron derives the active list per event as `unique(enabled_presets ++ per_event_extras)`. Pure derivation — no separate "effective schedule" cache.
- **Per-registration eligibility check at firing time, not registration time.** A registration created after the firing instant is naturally skipped because the cron query joins `event_registrations` with `created_at <= firing_instant`. No retroactive backfill, no confusion when entries are added late.
- **Single Postmark template, all merge vars resolved server-side.** Template alias: `event-reminder`. Server computes the friendly labels (`time_until_label`, `motivation_label`) so the template renders without branching on slot or `days_before`.
- **Test send is a separate route, not a flag on the cron.** `/api/admin/events/[id]/send-test-reminder` calls the same email module with a synthesized fake registration (admin's name + email) so the test exercises real templating. Idempotency table is NOT written for tests — test sends should be repeatable.

---

## Open Questions

### Resolved During Planning

- Where do global settings live? — Existing `email_settings` table, new key `event_reminder_default`. Same shape as `auto_renewal_reminder`, with a richer `value` JSON.
- Where does the global UI go? — `/admin/scheduled-jobs` page (per user direction).
- How are per-event entries stored? — `reminder_schedule jsonb` column on `events`, default `'[]'::jsonb`. Validated as an array of `{days_before: int >= 0, slot: enum}`.
- What if `start_time` is null? — Treat as 12:00 local for any `time_until_label` that needs to reference the event time; document this in the email module. The firing date computation does not depend on `start_time`.
- Does the test-send respect the global toggles? — No. Test always sends regardless of toggles so admins can preview the template even when both presets are off.
- What if a `(days_before, slot)` resolves to a past instant at config time (e.g. admin adds `{7, morning}` to an event that's 5 days out)? — Acceptable. Reminders are forward-looking. The cron's firing-date filter naturally skips it. No UI warning in v1.

### Deferred to Implementation

- Exact template body and the full merge-var list beyond the named two — finalized when designing the template in Postmark; the email module passes everything the template references.
- Whether to persist `last_run_at` for this job in `email_settings.value` (matching renewal-reminders) or rely on `cron_job_runs` — pick after seeing how the admin UI reads the data.
- Whether `event_reminder_sends` needs a `postmark_message_id` column for delivery debugging — add only if Postmark webhooks land in scope.
- Whether slot enum is a Postgres `CHECK` or a `text` column with app-level validation — pick during the migration once the team weighs migration cost of future slot additions.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
email_settings (key='event_reminder_default')
  value = {
    presets: [
      { days_before: 1, slot: "morning", enabled: true  },   // default
      { days_before: 0, slot: "morning", enabled: false }    // morning-of
    ],
    slot_times: { morning: "08:00", lunch: "12:00", evening: "18:00" }
  }

events
  reminder_schedule jsonb   // e.g. [{ days_before: 3, slot: "morning" }]

┌─ runEventReminders() (cron, 0 * * * *) ───────────────────────────┐
│                                                                    │
│  now_local = nowInZurich()                                         │
│  current_slot = matchSlot(now_local.hour, settings.slot_times)     │
│  if current_slot is null: return { sent: 0, reason: "not slot" }   │
│                                                                    │
│  enabled_presets = settings.presets.filter(p => p.enabled)         │
│                                                                    │
│  for each published, registration_enabled event in next 60d:       │
│    schedule = unique(enabled_presets + event.reminder_schedule)    │
│    for each (days_before, slot) in schedule:                       │
│      if slot != current_slot: continue                             │
│      if event.start_date - days_before != now_local.date: continue │
│      firing_instant_utc = today + slot_time → UTC                  │
│      for each active registration created ≤ firing_instant_utc:    │
│        if not exists in event_reminder_sends:                      │
│          sendReminderEmail(registration, event, days_before, slot) │
│          insert into event_reminder_sends                          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Merge-var derivation (server-side, before Postmark call):

```
days_until_event = days_before   // 0, 1, 2, ...

time_until_label =
  days_before == 0 ? `This ${slot}`                    // "This morning"
  days_before == 1 ? `Tomorrow ${slot}`                // "Tomorrow morning"
  else             : `${weekday} ${slot}`              // "Friday morning"

motivation_label =
  days_before == 0 ? "Today!"
  days_before == 1 ? "Tomorrow!"
  days_before <= 3 ? "Coming up"
  else             : "Save the date"
```

---

## Implementation Units

### U1. Schema: per-event schedule column + idempotency table + settings row

**Goal:** Add the per-event schedule column, the idempotency table, and the global settings row that the rest of the work depends on.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Create: `supabase/migrations/20260513120000_event_reminders.sql`
- Modify: `types/database.ts` (re-append hand-written aliases if Supabase MCP regen drops them — see `feedback_db_types_aliases.md`)

**Approach:**
- `events` table: add `reminder_schedule jsonb not null default '[]'::jsonb`. Add a CHECK that it is a JSON array. App-level validation enforces the per-element shape.
- New table `event_reminder_sends`:
  - `id uuid pk default gen_random_uuid()`
  - `event_id uuid not null references events(id) on delete cascade`
  - `registration_id uuid not null references event_registrations(id) on delete cascade`
  - `days_before int not null check (days_before >= 0)`
  - `slot text not null check (slot in ('morning','lunch','evening'))`
  - `sent_at timestamptz not null default now()`
  - Unique constraint on `(event_id, registration_id, days_before, slot)`
  - Index on `(event_id, registration_id)` for the cron lookup
- `email_settings`: insert one row with `key='event_reminder_default'`, `enabled=true`, `value` as the JSON shown in the High-Level Technical Design (presets + slot_times). ON CONFLICT do nothing so re-running is safe.
- Apply via Supabase MCP `apply_migration`.

**Patterns to follow:**
- `supabase/migrations/20260505093723_broadcasts_draft_status.sql` for migration style.
- Existing `email_settings` rows for the JSON value shape.

**Test scenarios:**
- Happy path: migration applies cleanly to local + remote; the settings row exists; `reminder_schedule` defaults to `[]` on existing events.
- Edge case: re-applying the migration does not duplicate the settings row (ON CONFLICT).
- Error path: inserting a duplicate `(event_id, registration_id, days_before, slot)` raises a unique-constraint violation.
- Error path: inserting `slot='afternoon'` is rejected by the CHECK.

**Verification:**
- `select value from email_settings where key='event_reminder_default'` returns the JSON with both presets and the slot_times map.
- `\d events` shows `reminder_schedule jsonb` with default `[]`.
- `\d event_reminder_sends` shows the unique index.

---

### U2. Email module: send a single event reminder

**Goal:** Pure function `sendEventReminder(registration_id, event_id, days_before, slot, overrides?)` that resolves merge vars and posts to Postmark via the existing wrapper. Reused by cron and test-send.

**Requirements:** R1, R9

**Dependencies:** U1

**Files:**
- Create: `lib/email/event-reminder.ts`

**Approach:**
- Mirror the shape of `lib/email/event-registration.ts`: load registration + event with `createAdminClient`, build merge data, call `sendEmail` with `TEMPLATE_ALIAS = "event-reminder"`.
- Compute merge vars including but not limited to:
  - `first_name`, `event_title`, `event_date_label` (e.g. "Sunday, 24 May 2026"), `event_time_label` (e.g. "11:00"), `event_location` (or `null` if absent — per Mustachio rule)
  - `time_until_label` — slot-aware label per the design ("This morning", "Tomorrow morning", "Friday morning")
  - `motivation_label` — `"Today!"`, `"Tomorrow!"`, `"Coming up"`, or `"Save the date"` per the design
  - `slot` (raw — useful if the template wants to vary copy by time of day)
  - `reference_code`, `quantity`, `amount_label` (`"Free"` or `"CHF 80.00"`)
  - Detail page URL: `${NEXT_PUBLIC_APP_URL}/public/events/${event_id}`
- `overrides`: `{ to_email?: string; to_name?: string }` so the test-send route can route to the admin without forging a registration record.
- Weekday label uses Europe/Zurich locale (`en-GB`) so "Friday" not "vendredi".
- Return `{ success: boolean; error?: unknown }`.

**Patterns to follow:**
- `lib/email/event-registration.ts` (shape, helpers, error returns).
- Pass `null` (not empty string) for absent fields.

**Test scenarios:**
- Happy path: with a registration + event seeded for tomorrow at 11:00, calling with `(days_before=1, slot="morning")` produces `time_until_label: "Tomorrow morning"`, `motivation_label: "Tomorrow!"`.
- Happy path: same event, `(days_before=0, slot="morning")` → `time_until_label: "This morning"`, `motivation_label: "Today!"`.
- Happy path: same event 5 days out, `(days_before=5, slot="evening")` → `time_until_label: "Friday evening"` (weekday derived from `event.start_date - 5`), `motivation_label: "Save the date"`.
- Edge case: `event.location` null → merge model carries `event_location: null`, not `""`.
- Edge case: registration whose `event_id` has been deleted → returns `{ success: false }` with a clear error; no Postmark call.
- Edge case: `start_time` null → `event_time_label: null`; rest of the template still renders (date + slot labels are independent of `start_time`).
- Error path: Postmark `sendEmail` rejects → propagated in the return value, no throw.
- Happy path with override: `overrides.to_email = "admin@x"` → Postmark `To` is the override, not the registration email.

**Verification:**
- Smoke run calls the function with a known registration and a `(days_before, slot)` and observes the Postmark request body matches the expected merge model.

---

### U3. Cron job: hourly tick, fire due slot reminders

**Goal:** `runEventReminders()` job in the existing cron registry that fires reminders for whichever slot the current hour matches.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R10

**Dependencies:** U1, U2

**Files:**
- Create: `lib/cron/event-reminders.ts`
- Modify: `lib/cron/job-definitions.ts` (add the UI definition entry)
- Modify: `lib/cron/job-registry.ts` (add the runner mapping)

**Approach:**
- Job key: `event-reminders`. Schedule: `0 * * * *` (minute 0 of every hour).
- Read settings from `email_settings.event_reminder_default`. Compute:
  - `enabled_presets = value.presets.filter(p => p.enabled)`
  - `slot_times = value.slot_times`
- Compute Europe/Zurich local time `now_local`. Determine `current_slot`: the slot whose `slot_times[slot]` hour equals `now_local.hour`. If no slot matches, return `{sent: 0, reason: "not slot"}` immediately.
- Window: select events with `is_published = true AND registration_enabled = true AND start_date BETWEEN today_local AND today_local + 60 days`. (60 days is a generous upper bound covering any reasonable `days_before`.)
- For each event, compute `active_schedule = unique(enabled_presets + event.reminder_schedule)`.
- For each `(days_before, slot)` in `active_schedule`:
  - Skip if `slot !== current_slot`.
  - Skip if `event.start_date - days_before !== today_local`.
  - Compute `firing_instant_utc = today_local at slot_times[slot] in Europe/Zurich → UTC` (just for the registration `created_at` cutoff).
  - Find candidate registrations: `event_id` matches AND `status` not in `('cancelled', 'refunded')` AND `created_at <= firing_instant_utc`.
  - Left-join `event_reminder_sends` on `(event_id, registration_id, days_before, slot)`; keep rows where the join is null.
  - For each surviving candidate: call `sendEventReminder(registration_id, event_id, days_before, slot)`; on success, INSERT into `event_reminder_sends` (send-then-insert ordering — see System-Wide Impact).
- Return `{ sent, skipped, errors }` for `withJobLogging`.

**Patterns to follow:**
- `lib/cron/renewal-reminders.ts` — settings read, candidate loop, sent-marker write, return shape.
- Logging conventions (`console.log("[event-reminders] …")`).

**Test scenarios:**
- Happy path: event tomorrow at 11:00, master preset enabled `{days_before:1, slot:"morning"}`, slot_times.morning=08:00. At 08:00 Europe/Zurich → 1 send + 1 idempotency row.
- Happy path with extras: same event also has `[{days_before:3, slot:"evening"}]`. At 18:00 Europe/Zurich three days before, 1 send. Two distinct idempotency rows accumulate across the two days.
- Happy path "morning of": morning-of preset enabled, event today at 11:00. At 08:00, 1 send to each registration.
- Idempotency: rerun cron at the same wall-clock hour → finds the row in `event_reminder_sends` and skips. `sent: 0, skipped: N`.
- Late registration: registration created at 09:00 on the day of an 08:00 firing → no send for that morning's tuple (created_at filter).
- Cancelled registration: skipped (status filter).
- Disabled presets, empty extras: event entirely skipped.
- Disabled presets, extras present: extras still fire (R2 invariant).
- Date-shift: admin moves event from Sunday to Saturday — already-fired tuples do not re-fire (idempotency keyed by `(event, registration, days_before, slot)`, independent of the absolute date the firing happened on).
- Off-slot hour: cron tick at 09:00 (no slot matches) → returns `{sent:0, reason:"not slot"}` immediately.
- Slot-time edit: admin changes `slot_times.morning` from 08:00 to 09:00 → next 09:00 tick is the new morning trigger; 08:00 ticks no longer match.
- Error path: `sendEventReminder` returns failure → no row inserted; next slot-matching tick retries (which is the next day, since slots are once-per-day). Acceptable.
- Edge case: DST transition day — calendar arithmetic on `start_date - days_before` is DST-agnostic; only the `firing_instant_utc` cutoff conversion uses the zoned time. Verify with a fixture event around the EU DST switch.

**Verification:**
- Manual run via `/admin/scheduled-jobs` "run now" at an in-slot hour surfaces a `success` row in `cron_job_runs` with `result.sent` matching expectation against a seeded fixture.
- Second manual run in the same hour logs `result.sent: 0, skipped: N`.

---

### U4. Admin UI: global presets + slot times on /admin/scheduled-jobs + per-event extras in the editor

**Goal:** Surfaces for editing the global presets, the slot-time map, and the per-event extras.

**Requirements:** R2, R3, R4, R10

**Dependencies:** U1

**Files:**
- Modify: `app/(admin)/admin/scheduled-jobs/page.tsx` (load the new setting alongside existing ones)
- Modify: `components/admin/ScheduledJobsList.tsx` (render the two preset toggles + slot-time inputs; PATCH on change)
- Create: `app/api/admin/email-settings/event-reminder-default/route.ts` (PATCH handler accepting `{ enabled?, value? }` with full validation of the JSON shape)
- Modify: `components/admin/EventManager.tsx` (add a "Reminder schedule" field — small list with add/remove rows; each row is a `(days_before, slot)` picker)
- Modify: `app/api/admin/events/update/route.ts` and `app/api/admin/events/create/route.ts` (accept and persist `reminder_schedule`; validate as an array of valid tuples)

**Approach:**
- Global UI (on scheduled-jobs page):
  - Two toggle rows: "Send the morning before the event" (preset 0) and "Send the morning of the event" (preset 1). Each toggles `presets[i].enabled`.
  - Three small time inputs for slot_times.morning/lunch/evening. Saved as `HH:MM` strings.
  - Save inline on change with optimistic UI; on failure, revert + alert (matching the recently-shipped `event_save_failed` pattern).
- Per-event UI:
  - A list of `{days_before, slot}` rows with `+ Add reminder` and `×` per row.
  - Each row: a small integer input (0–30) and a `<select>` with the three slots.
  - Client-side: dedupe, reject negatives.
  - Section is hidden when registration is disabled — reminders only make sense for registration-enabled events.
- Persistence: server-side validation re-applies the same rules. Reject any other slot strings, non-integer `days_before`, or negative values with 400.

**Patterns to follow:**
- `components/admin/ScheduledJobsList.tsx` for existing email_settings toggle wiring.
- The `event_save_failed`/`event_save_succeeded` PostHog capture in `EventManager.tsx` — capture analogous events for these new fields (`event_reminder_schedule_saved` / `_failed`).
- The existing EventManager form layout for placing the new field consistently.

**Test scenarios:**
- Happy path: toggling preset 0 OFF then ON persists `presets[0].enabled` and the cron's next slot tick reflects it.
- Happy path: editing slot_times.morning from 08:00 to 09:00 persists; next 09:00 tick matches morning.
- Happy path: adding `[{days_before:3, slot:"evening"}]` to an event persists; reload shows the same.
- Edge case: empty schedule saves as `[]` not `null`.
- Edge case: duplicate `(days_before, slot)` entries typed client-side get deduped before save.
- Error path: server rejects `slot:"afternoon"` with 400 and the UI surfaces the error.
- Error path: server rejects `days_before: -1` with 400.
- Integration: both presets enabled + per-event `[{days_before:7, slot:"morning"}]` → cron fires at 7-day, 1-day, and 0-day morning slots over the week leading to the event.

**Verification:**
- After admin edits, a manual cron "run now" at an in-slot hour picks up the new configuration without a deploy.

---

### U5. Test send: button on event editor + guarded admin route

**Goal:** Admin can preview the rendered reminder by sending a test to their own email.

**Requirements:** R8

**Dependencies:** U2

**Files:**
- Create: `app/api/admin/events/[id]/send-test-reminder/route.ts`
- Modify: `components/admin/EventManager.tsx` (add a "Send test reminder" button next to the per-event schedule; pick a `(days_before, slot)` from the active list)

**Approach:**
- Button is shown only when at least one tuple is active (enabled preset OR per-event extra). Disabled with a tooltip otherwise.
- A small picker shows the active tuples as labeled options ("Morning before", "Morning of", "Friday morning, 5 days before", etc.). Submits POST `{ days_before, slot }`.
- Route (admin-auth gated, same shape as other `/api/admin/events/*` routes): looks up the admin's email via the existing Supabase auth helper, synthesizes a fake registration object (no DB write — pass via `overrides` to the email module), and calls `sendEventReminder`.
- Idempotency table is intentionally NOT written.
- Returns `{ ok: true }` or `{ error: string }`. Capture `event_test_reminder_sent` / `_failed` to PostHog with the tuple and event_id.

**Patterns to follow:**
- `app/api/admin/events/update/route.ts` for the admin auth check.
- `lib/email/event-registration.ts` for the email module interface.

**Test scenarios:**
- Happy path: admin clicks Send test, picks "Morning of" → email lands in admin's inbox with `time_until_label = "This morning"`.
- Happy path: with per-event extra `{days_before:5, slot:"evening"}` → picker shows it; sending uses that tuple.
- Edge case: event with no active tuples → button disabled with tooltip explaining why.
- Edge case: passing `{days_before:99, slot:"morning"}` not in the active list → server still sends (test path doesn't constrain to active list — admins can preview any tuple).
- Error path: Postmark fails → response surfaces error to UI; no rows written anywhere.
- Authorization: non-admin POST → 401/403, no email sent.

**Verification:**
- Triggering test send delivers an email with the production template body and merge vars; `event_reminder_sends` remains empty.

---

### U6. Documentation + operational notes

**Goal:** Capture the Postmark template requirement and the operational shape so the system isn't fragile across a re-deploy or template edit.

**Requirements:** R9, R10

**Dependencies:** U1–U5

**Files:**
- Create: `docs/event-reminders.md`

**Approach:**
- One short page: how the cron decides which slot is active, what the presets + extras model means, how to edit the Postmark template, the full list of merge vars the template can read, and how to test (admin button + manual run from `/admin/scheduled-jobs`).
- Note that the Postmark template `event-reminder` must exist in the Postmark dashboard before the first send.
- Cross-link from `docs/observability.md` if helpful.

**Test scenarios:**
- Test expectation: none — documentation.

**Verification:**
- A reader unfamiliar with the system can answer: where do the global settings live, how do I add an extra `(days_before, slot)` to one event, what merge vars can the template use, how do I test without waiting for the cron.

---

## System-Wide Impact

- **Interaction graph:** Cron registry gains a new entry; `withJobLogging` continues to wrap it. The Postmark `sendEmail` wrapper is invoked from a new caller. EventManager's save flow gains a new persisted field. ScheduledJobsList gains a new settings block.
- **Error propagation:** Cron errors flow through `withJobLogging` → `cron_job_runs` log → also surface via PostHog Error Tracking if any throw escapes (inner try/catch should prevent it). Per-send failures do not throw — they return failure and the row is left absent so the next slot-matching tick retries.
- **State lifecycle risks:** Test send must NOT write to `event_reminder_sends` (would mask real reminders). The cron's send-then-insert ordering is load-bearing: a Postmark transient failure leaves no idempotency row, so the next slot-matching tick retries; a successful send followed by an INSERT failure (rare — unique-constraint duplicate could only happen via concurrent ticks) would re-attempt and the unique constraint hard-errors the duplicate INSERT, preventing a second email.
- **API surface parity:** Two existing admin event routes (`update`, `create`) gain a new field. Agent API (`PATCH /api/agent/events/{id}`) does NOT — separate decision to extend agent surface to `reminder_schedule`.
- **Integration coverage:** The cron + send + idempotency triplet must be tested end-to-end against a real DB (not mocked) since the unique-constraint guarantee is the load-bearing part.
- **Unchanged invariants:** Existing reminder jobs (renewal, payment, committee, hold-expiry) are untouched. The `email_settings` schema is unchanged — a new key joins existing rows. The `events` table gains one column; no existing reads break.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Postmark template `event-reminder` missing or alias typo'd → first send fails silently | Send module returns failure; no idempotency row written; next slot-matching tick retries. Operational step in docs: trigger a test send post-deploy to verify. |
| Cron tick missed entirely at a slot hour (Railway redeploy, container kill) | A daily slot has only one trigger window. A missed slot means lost reminders for that day at that slot. Acceptable for an MVP. Future mitigation: reconcile-on-startup pass that scans for unfired `(today, slot)` tuples whose slot hour has already passed. |
| Time-zone or DST bug → reminder fires at wrong wall-clock time | Calendar math (`start_date - days_before`) is DST-agnostic by construction. Slot-hour matching uses Europe/Zurich local time consistently. Verify with a seeded event spanning the EU DST switch. |
| Admin adds tuple in the past (e.g. `{7, morning}` for an event 5 days out) → silently never fires | Acceptable — reminders are forward-looking. Test-send button gives admins a way to preview anyway. |
| Test send accidentally hits a real registration's email | Fake registration synthesized in-memory; `overrides.to_email` forces destination to admin. No code path exists to use a real registration's email. |
| Concurrent cron ticks (overlapping schedule) double-send | Unique constraint on `event_reminder_sends` makes duplicates a hard DB error. Send-then-insert ordering is the contract. |
| Slot time admin-edited to an hour that already passed today → that slot is skipped today | Acceptable. Documented in the operational notes. Cron picks up the new time starting from the next matching hour. |

---

## Documentation / Operational Notes

- A Postmark template with alias `event-reminder` must exist before the first cron run. Initial body and merge vars designed during U2.
- Add a Slack channel alert for this job's failures if not already covered by the existing cron alerting.
- After deploy: edit the global presets and slot times from `/admin/scheduled-jobs`, trigger a test send from one event to verify end-to-end before the cron fires for real.

---

## Sources & References

- `lib/cron/renewal-reminders.ts` — primary reference pattern.
- `lib/email/event-registration.ts` — primary email-module reference.
- `email_settings` table — reused for global config.
- `app/(admin)/admin/scheduled-jobs/page.tsx` — UI surface for global settings.
- Project memory: `feedback_postmark_mustachio.md`, `feedback_sdk_lazy_init.md`, `feedback_db_types_aliases.md`.
- Postmark Mustachio template docs.
