-- Resend tickets to existing registrants — U1.
-- Plan: docs/plans/2026-06-23-001-feat-resend-tickets-existing-registrants-plan.md
--
-- ADDITIVE: records when the ticket/booking confirmation email was last sent for a
-- registration. Drives the admin "not yet notified" filter + bulk resend, and guards
-- against double-sends. Existing rows are intentionally left NULL — registrants who
-- booked before the per-ticket QR system (FEAT-41) have never been sent the new email,
-- and NULL is exactly the "not yet notified" signal the resend flow keys on.
-- No backfill, no drops, fully reversible.

alter table public.event_registrations
  add column if not exists ticket_email_sent_at timestamptz;

comment on column public.event_registrations.ticket_email_sent_at is
  'When the ticket/booking confirmation email was last sent for this registration. '
  'NULL = never sent (e.g. pre-FEAT-41 registrations awaiting a resend). '
  'Stamped on every successful sendEventRegistrationConfirmation().';
