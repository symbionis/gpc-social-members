# Event Reminders

Automated reminder emails for registered, non-cancelled attendees. One generic
Postmark template handles every reminder via merge variables; offsets are
expressed as `(days_before, slot)` tuples where `slot ∈ {morning, lunch, evening}`.

## Plan

`docs/plans/2026-05-08-002-feat-event-reminder-emails-plan.md`

## How it works

1. **Cron tick** (`lib/cron/event-reminders.ts`) runs hourly via the existing
   `lib/cron/scheduler.ts`. Each tick determines the current Europe/Zurich hour,
   looks up which slot (if any) maps to that hour from
   `email_settings.event_reminder_default.value.slot_times`, and exits early if
   none matches.
2. For every published, registration-enabled event in the next 60 days, the
   cron computes its **active schedule** = enabled global presets ∪ per-event
   extras (deduped by `(days_before, slot)`).
3. For each tuple whose slot matches the current hour AND whose
   `event.start_date - days_before == today_local`, the cron finds all active
   registrations created at or before the firing instant and, for each one
   that doesn't already have a row in `event_reminder_sends`, calls
   `sendEventReminder(...)` then inserts the idempotency row.
4. The Postmark template `event-reminder` is rendered with the merge model
   listed below.

The send-then-insert ordering matters: a Postmark transient failure leaves no
idempotency row so the next slot-matching tick retries. The unique constraint
on `(event_id, registration_id, days_before, slot)` makes a true duplicate
send a hard DB error if two ticks race.

## Settings

Stored in the existing `email_settings` table, keyed by `event_reminder_default`.

| Field | Where | Default |
|---|---|---|
| Master enabled | `email_settings.enabled` | `true` |
| Preset: morning before | `value.presets[0]` | `{days_before:1, slot:"morning", enabled:true}` |
| Preset: morning of | `value.presets[1]` | `{days_before:0, slot:"morning", enabled:false}` |
| Slot times (Europe/Zurich) | `value.slot_times` | `morning 08:00`, `lunch 12:00`, `evening 18:00` |

Edit at `/admin/scheduled-jobs` (super admin only).

## Per-event extras

The `events.reminder_schedule` jsonb column holds an array of
`{days_before:int>=0, slot:string}` entries. The admin event editor exposes
a small list UI when registration is enabled. Extras layer on top of enabled
presets and dedupe — listing `{1, morning}` per-event has no effect because
that's already the default preset.

## Postmark template — merge variables

Alias: `event-reminder` (must exist in the Postmark dashboard before the
first cron run).

| Variable | Example |
|---|---|
| `first_name` | `"Alex"` |
| `event_title` | `"Season Kick-Off: Sunday Asado"` |
| `event_date_label` | `"Sunday, 24 May 2026"` |
| `event_time_label` | `"11:00"` (null if event has no start_time) |
| `event_location` | `"Field 2"` (null if absent) |
| `time_until_label` | `"Tomorrow morning"`, `"This evening"`, `"Friday morning"` |
| `motivation_label` | `"Today!"`, `"Tomorrow!"`, `"Coming up"`, `"Save the date"` |
| `slot` | `"morning"`, `"lunch"`, `"evening"` (raw) |
| `days_before` | `0`, `1`, `2`, … |
| `quantity` | `2` |
| `amount_label` | `"Free"` or `"CHF 80.00"` |
| `reference_code` | `"GPC-XYZ-123"` |
| `is_free` | `true` / `false` |
| `event_url` | full URL to the event page |
| `preheader` | one-line preview text |

Per the Mustachio convention, conditional blocks use `{{#x}}…{{/x}}` — not
`{{#if}}`. Null values cause the corresponding section to skip cleanly.

## Testing

**Admin button** — open any registration-enabled event in `/admin/events`,
pick a tuple from the picker in the Reminder schedule section, click "Send
test to my email". The test routes through the same template + merge model
with `to_email` overridden to the admin's address. The idempotency table is
NOT written for tests, so the same combination can be re-sent.

**Cron manual run** — `/admin/scheduled-jobs` → Event Reminders → Run Now.
Off-slot hours immediately return `{reason: "not slot"}`; in-slot hours
process candidate events and log `{sent, skipped, errors}`.

## Operational notes

- Slot time edits take effect on the next matching hourly tick.
- A multi-hour outage that spans a slot hour will silently drop reminders for
  that slot/day. Future mitigation: a reconcile-on-startup pass.
- `start_time` null on an event does NOT block reminders — the template can
  conditionally render the time via `{{#event_time_label}}…{{/event_time_label}}`.
- Cancellation/refund of a registration deletes any pending reminders from
  the queue implicitly (the cron filters on `status not in (cancelled, refunded)`)
  and the idempotency row cascades on registration delete.
