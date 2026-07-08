-- Guest QR delivery — "no QR, no bracelet".
--
-- ADDITIVE: records when THIS ticket's own entry-QR email (event-ticket template) was
-- last sent to its guest. Drives the auto-send when a guest is named with an email
-- (checkout confirmation + self-registration) and guards against double-sends (e.g. a
-- Stripe webhook that fires the confirmation more than once). Distinct from
-- event_registrations.ticket_email_sent_at, which tracks the lead's whole-booking
-- confirmation. Existing rows stay NULL (never sent). No backfill, no drops, reversible.

alter table public.tickets
  add column if not exists qr_email_sent_at timestamptz;

comment on column public.tickets.qr_email_sent_at is
  'When this ticket''s own entry-QR email (event-ticket template) was last sent to its '
  'guest. NULL = never sent. Guards the guest-QR auto-send (checkout confirmation + '
  'self-registration) against double-sends. Stamped on a successful sendTicketQrEmail().';
