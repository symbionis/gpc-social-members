-- Add an optional buyer-facing description to event ticket types.
--
-- A short plain-text blurb an admin writes per type (e.g. "Includes welcome
-- drink + seated dinner") that renders to members/guests at registration so
-- they can tell types apart. Live metadata on the type — deliberately NOT
-- snapshotted into event_registration_items (editing it changes what future
-- buyers see, leaving historical purchase records unchanged).
--
-- ADDITIVE ONLY: a single nullable column plus a length CHECK. Safe to apply
-- before the reading code ships — older deployments ignore the column and never
-- write it. NB: dev and prod share one Supabase database, so applying this
-- mutates production immediately; it is a pure ADD COLUMN with no backfill, so
-- there is nothing to double-count on a re-apply.
--
-- The 500-char cap is enforced primarily in the single-writer normalizer
-- (lib/events/ticket-types.ts) as a 400 field error; this CHECK is the
-- belt-and-suspenders backstop. Keep the two numerically identical.

ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.event_ticket_types
  DROP CONSTRAINT IF EXISTS event_ticket_types_description_len;
ALTER TABLE public.event_ticket_types
  ADD CONSTRAINT event_ticket_types_description_len
  CHECK (description IS NULL OR char_length(description) <= 500);
