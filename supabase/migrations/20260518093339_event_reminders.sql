-- Event reminder emails: per-event reminder schedule, idempotency table,
-- and the global default settings row.
--
-- See docs/plans/2026-05-08-002-feat-event-reminder-emails-plan.md
-- and docs/event-reminders.md.

-- Per-event extras layered on top of the global enabled presets.
-- Shape: jsonb array of { days_before: int >= 0, slot: 'morning'|'lunch'|'evening' }.
-- Application validates the per-element shape; the DB only enforces "is an array".
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reminder_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_reminder_schedule_is_array;

ALTER TABLE public.events
  ADD CONSTRAINT events_reminder_schedule_is_array
  CHECK (jsonb_typeof(reminder_schedule) = 'array');

-- Idempotency: one row per (event, registration, days_before, slot) actually sent.
-- The unique constraint is what guarantees no double-sends across cron retries
-- or concurrent ticks; the cron's send-then-insert ordering relies on it.
CREATE TABLE IF NOT EXISTS public.event_reminder_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  days_before int NOT NULL CHECK (days_before >= 0),
  slot text NOT NULL CHECK (slot IN ('morning', 'lunch', 'evening')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_reminder_sends_unique
    UNIQUE (event_id, registration_id, days_before, slot)
);

CREATE INDEX IF NOT EXISTS event_reminder_sends_event_registration_idx
  ON public.event_reminder_sends (event_id, registration_id);

-- Global default settings: two presets (morning-before ON, morning-of OFF)
-- plus the admin-editable slot_times map.
INSERT INTO public.email_settings (key, enabled, value)
VALUES (
  'event_reminder_default',
  true,
  jsonb_build_object(
    'presets', jsonb_build_array(
      jsonb_build_object('days_before', 1, 'slot', 'morning', 'enabled', true),
      jsonb_build_object('days_before', 0, 'slot', 'morning', 'enabled', false)
    ),
    'slot_times', jsonb_build_object(
      'morning', '08:00',
      'lunch',   '12:00',
      'evening', '18:00'
    )
  )
)
ON CONFLICT (key) DO NOTHING;
