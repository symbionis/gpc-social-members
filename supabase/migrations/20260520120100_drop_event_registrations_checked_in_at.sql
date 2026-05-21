-- Drop the legacy event_registrations.checked_in_at column.
--
-- See docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md
--
-- Superseded by the event_checkins table: arrival is now tracked there for all
-- attendee kinds (a registrant has arrived iff an event_checkins row exists with
-- their registration_id). The old manual admin toggle that wrote this column is
-- removed in the same release.
--
-- DEPLOY ORDERING: this migration must run only after the code that referenced
-- checked_in_at is removed (admin attendees route CSV + PATCH toggle, AttendeeList
-- UI). In this PR those references are gone, so the drop is safe to apply with the
-- deploy. It is intentionally a separate migration so it can be held back from any
-- ahead-of-code application.
ALTER TABLE public.event_registrations
  DROP COLUMN IF EXISTS checked_in_at;
