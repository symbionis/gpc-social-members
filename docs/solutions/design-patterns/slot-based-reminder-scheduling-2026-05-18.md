---
title: Slot-based reminder scheduling with layered presets and idempotent sends
date: 2026-05-18
category: design-patterns
module: events
problem_type: design_pattern
component: background_job
severity: medium
applies_when:
  - "Scheduling user-facing notifications tied to a future date but anchored to admin-controlled wall-clock times"
  - "An hourly cron must dispatch reminders without sending duplicates across retries or overlapping runs"
  - "Defaults should apply globally while individual records can opt into additional reminder occurrences"
  - "Reminder dispatch must be timezone-aware (Europe/Zurich) independent of server timezone"
  - "Send-side side effects (email) and tracking writes need ordering that prevents silent drops on partial failure"
related_components:
  - database
  - email_processing
tags:
  - cron
  - reminders
  - idempotency
  - events
  - scheduling
  - timezone
  - jsonb
  - postmark
---

# Slot-based reminder scheduling with layered presets and idempotent sends

## Context

Before this work, the GPC events product sent a single confirmation email at registration time and then went silent until the event itself. The only scheduled outbound surface was the manual broadcast drafts UI — admins could compose a one-off message and pick a send time, but nothing was tied to a per-attendee, per-event lifecycle. Show-up rates suffered on events with long lead times (1–4 weeks between registration and event day).

The natural reach for an automated reminder system is to model offsets as hours: "send at T-24h", "send at T-2h". That shape is precise, easy to compute from a single `timestamptz`, and easy to test. It is also wrong for this domain. Humans schedule reminders in calendar language — "the morning before", "the morning of", "the night before a Sunday match" — not in numeric hour offsets from a wall-clock instant. An hour-offset model forces admins to mentally translate "morning of a Sunday 11:00 event" into "T-3h" and re-translate every time the event start time changes.

A calendar-shaped model was chosen instead: each reminder is a `(days_before, slot)` tuple where `slot` is symbolic (`morning | lunch | evening`). The mapping from slot to clock time is held separately and resolved at firing-decision time. The same tuple `{days_before: 1, slot: "morning"}` continues to mean "the morning before" no matter what `start_time` the event has, and admins can shift all "morning" reminders by one hour with a single edit.

## Guidance

The pattern has six load-bearing pieces.

**1. Tuple shape: `(days_before, slot)`, slot symbolic.** Per `lib/events/reminder-schedule.ts`:

```ts
export type ReminderSlot = "morning" | "lunch" | "evening";
export interface ReminderEntry { days_before: number; slot: ReminderSlot; }
```

Slot is never stored as an hour. The slot→hour map lives once, globally, and the cron reads it on each tick.

**2. Two composing layers: enabled global presets + per-event extras.** Global settings live in `email_settings` keyed `event_reminder_default`:

```
value = {
  presets:    [ {days_before, slot, enabled}, ... ],
  slot_times: { morning, lunch, evening }
}
```

Per-event extras live in `events.reminder_schedule jsonb` (an array of `{days_before, slot}`). The cron derives the active schedule per event as `dedupeSchedule([...enabledPresets, ...perEvent])` — pure derivation, no "effective schedule" cache to invalidate. Listing `{1, "morning"}` per-event is a harmless no-op because the morning-before preset already covers it.

**3. Hourly cron with early-exit on no-match slot.** From `lib/cron/event-reminders.ts`:

```ts
const currentSlot = SLOTS.find(
  (slot) => parseHour(slotTimes[slot], DEFAULT_SLOT_HOURS[slot]) === now.hour
);
if (!currentSlot) {
  return { sent: 0, skipped: 0, errors: 0, reason: "not slot" };
}
```

Most ticks (21 of every 24 by default) do nothing beyond reading one settings row. Slot detection is a tiny in-memory lookup, not a DB scan.

**4. Idempotency via a composite unique constraint.** From `supabase/migrations/20260518093339_event_reminders.sql`:

```sql
CONSTRAINT event_reminder_sends_unique
  UNIQUE (event_id, registration_id, days_before, slot)
```

The cron checks for existing rows with the same key before sending, but the unique constraint is the source of truth — not the read-before-write. The read is a cheap fast-path; the constraint is the correctness boundary.

**5. Send-then-insert ordering, with `23505` race classification.** The cron calls `sendEventReminder` first, then inserts the idempotency row. If the insert fails with Postgres unique-violation code `23505`, it is a concurrent-tick race — counted as `skipped++`, not `errors++`:

```ts
const isDuplicate = (insertErr as { code?: string }).code === "23505";
if (isDuplicate) { skipped++; continue; }
```

The rationale: for event reminders, silent under-send is worse than a rare double-send. Insert-then-send means a Postmark transient failure leaves a row claiming the send happened and the reminder is permanently lost. Send-then-insert means a Postmark transient failure leaves no row and the next slot-matching tick retries cleanly.

**6. Calendar arithmetic, not timestamp arithmetic.** The match condition is:

```ts
addDays(event.start_date, -entry.days_before) === now.date && entry.slot === currentSlot
```

`event.start_date` is a DATE, not a timestamp. Subtracting days from a date is DST-agnostic by construction. The only zoned-time conversion is `zurichInstantToUtc(now.date, slotHour)` from `lib/format.ts` — used only to compute the `created_at <= firing_instant_utc` cutoff for the registrations query.

**Template is generic.** `lib/email/event-reminder.ts` resolves the friendly labels server-side (`buildTimeUntilLabel`, `buildMotivationLabel`) so the Postmark template `event-reminder` never branches on numeric `days_before`. The template sees `time_until_label = "Tomorrow evening"`, not `days_before = 1` plus a conditional. The time-of-day word in that label is derived from the **event's** `start_time`, never from the send slot — see the footnote below for why those must not be conflated.

**Testing note (gotcha).** The cron filters registrations on `created_at <= firingInstantUtc`. This correctly prevents retroactive sends when an admin adds a per-event extra after some registrations exist. It also means a test registration created in the same hour as your test cron run is excluded. To verify the cron actually fires end-to-end, you have to backdate the test registration via SQL (`update event_registrations set created_at = ... where id = ...`) before triggering the slot-matching tick.

## Why This Matters

Three tradeoffs in this pattern are non-obvious and each is the reason another shape would be worse.

**Symbolic slots vs absolute hours.** If reminders were stored as `(days_before, hour)` tuples, shifting "morning" from 08:00 to 09:00 globally would require updating every persisted reminder row across every event. With the slot-times map, it is a one-row update on `email_settings.event_reminder_default.value.slot_times.morning`. The per-event extras (`events.reminder_schedule`) carry no clock data at all — they survive the edit unchanged.

**Send-then-insert vs insert-then-send.** Insert-then-send is the textbook idempotency-key pattern: claim the slot before doing the side-effect. It optimizes against double-send. For event reminders, the worse failure mode is under-send — a missed reminder is invisible to operators until the attendee no-shows. Send-then-insert flips the optimization: a Postmark transient failure is naturally retried on the next slot-matching tick (which is the next day for that slot), and the unique constraint plus `23505` detection means the rare concurrent-tick race is bounded to at most one extra email and is observable as `skipped++` in the cron log, distinct from real `errors++`.

**Calendar math over timestamp math.** Storing `firing_instant_utc` per `(event, days_before, slot)` would require recomputing every row on a DST transition, on a slot-times edit, or on a per-event `start_date` change. Doing `addDays(start_date, -days_before)` at firing time means none of those edits trigger any data migration — the next cron tick simply produces the right answer. The DST safety is a free consequence: subtracting one day from a DATE never crosses a DST boundary because DATEs do not have a notion of clock time.

## When to Apply

Reach for this pattern when:

- Reminders or notifications are calendar-shaped — humans schedule "the morning of" or "the night before", not "T-13h". If admins would say "give me an extra reminder three days out", you want days-and-slots, not hours.
- The trigger condition can be reduced to a small composite key suitable for a unique constraint (here: `event_id, registration_id, days_before, slot`). If the natural key is high-cardinality or non-stable, the idempotency story is weaker.
- Per-recipient and global configuration need to compose without code branches. The "enabled presets ∪ per-event extras, deduped" pattern is a one-line `dedupeSchedule([...enabledPresets, ...perEvent])` precisely because both layers share one shape.
- Time-of-day flexibility is wanted but precision is not. The pattern explicitly does not support sub-hour offsets, two reminders in the same slot, or per-event slot times — that simplicity is what makes the slot-times edit a one-row update.

Do not reach for it when reminders are inherently relative to a moving target (an SLA timer, a checkout abandonment), when sub-hour precision matters (a "your meeting starts in 15 minutes" alert), or when the trigger needs more than one independent dimension (slot + channel + locale per recipient would push back toward a row-per-scheduled-send queue).

**Testing reminder**: any pattern that gates sends on `created_at <= firing_instant` needs a backdating step in its end-to-end test fixtures, because a registration created during the test will be invisible to the same-hour cron tick. This is correctness in production and a footgun in local verification.

## Examples

**Settings shape** — single row in `email_settings` with `key = 'event_reminder_default'`:

```jsonc
{
  "presets": [
    { "days_before": 1, "slot": "morning", "enabled": true  },  // morning before
    { "days_before": 0, "slot": "morning", "enabled": false }   // morning of
  ],
  "slot_times": { "morning": "08:00", "lunch": "12:00", "evening": "18:00" }
}
```

Per-event extras live alongside in `events.reminder_schedule`, e.g. `[{ "days_before": 3, "slot": "evening" }]`. Admins edit slot times in `components/admin/EventReminderSettings.tsx`; the component rejects duplicate slot hours on blur because `SLOTS.find` in the cron silently keeps only the first match.

**Cron match logic, distilled** — from `lib/cron/event-reminders.ts`:

```ts
const dueTuples = activeSchedule.filter(
  (entry) =>
    entry.slot === currentSlot &&
    addDays(event.start_date, -entry.days_before) === now.date
);
```

That single filter is the whole "is this reminder due now" decision. Everything else in the cron — the events window, the registration query, the idempotency lookup, the send, the insert — is plumbing around that one expression.

## Footnote (2026-05-21): send slot ≠ event time-of-day

The symbolic `slot` (`morning | lunch | evening`) answers **when the email is sent** — it maps to a wall-clock hour (08:00 / 12:00 / 18:00) purely for the cron's firing decision. It says nothing about **when the event happens**.

The original `buildTimeUntilLabel` conflated the two: it built the body copy as `` `Tomorrow ${slot}` ``, reusing the send-slot word to describe the event. A real 17:30 event reminded in the 08:00 "morning" send slot therefore went out reading "happening **Tomorrow morning**" while the same email's event card correctly showed "Starts at 17:30". The date and clock time were right; only the time-of-day phrase was sourced from the wrong place.

Fix: derive the time-of-day word from the event's own `start_time` via a local `eventTimeOfDay(start_time)` helper (`< 12` → morning, `< 17` → afternoon, else evening), and pass `start_time` — not `slot` — into `buildTimeUntilLabel`. The `slot` argument stays in `sendEventReminder` for the idempotency key and the template model var; it is just never used to generate copy. Events with no `start_time` now drop the word entirely ("Tomorrow" / "Today" / a weekday) rather than borrowing the send slot.

Takeaway: a scheduling dimension and a display dimension can look like the same enum and tempt reuse. Keep them separate — the send slot is admin-facing scheduling truth, the event time-of-day is recipient-facing descriptive truth, and they only coincide by accident.

## Related Documentation

- [`best-practices/admin-scheduled-jobs-dashboard-pattern-2026-04-15.md`](../best-practices/admin-scheduled-jobs-dashboard-pattern-2026-04-15.md) — registry pattern this job plugs into (JOB_DEFINITIONS, JOB_REGISTRY, `withJobLogging`).
- [`design-patterns/draft-row-claim-and-transition-2026-05-06.md`](./draft-row-claim-and-transition-2026-05-06.md) — adjacent use of a unique-constraint-backed transition (different domain, same underlying primitive).
- [`runtime-errors/safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md`](../runtime-errors/safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md) — convention that `lib/format.ts` owns Geneva-time helpers (this pattern's `nowInZurich` and `zurichInstantToUtc` are exported from there).

## File References

- `lib/cron/event-reminders.ts` — the cron tick + match + send loop
- `lib/email/event-reminder.ts` — pure send fn with slot-aware merge vars
- `lib/events/reminder-schedule.ts` — wire-format validator (shared by create/update routes)
- `supabase/migrations/20260518093339_event_reminders.sql` — schema (column + idempotency table + settings row)
- `components/admin/EventReminderSettings.tsx` — global presets + slot-times UI
- `lib/format.ts` — Geneva-time helpers used by the cron
- `docs/event-reminders.md` — operational doc
- `docs/plans/2026-05-08-002-feat-event-reminder-emails-plan.md` — original plan
- PR #16 / commit `e51d572` on `main` — the landed work
