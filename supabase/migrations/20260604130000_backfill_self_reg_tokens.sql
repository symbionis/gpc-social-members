-- Backfill self_reg_token for existing upcoming registrations (U9 follow-up).
--
-- The self-registration token is only set on NEW registrations (register route /
-- waitlist-convert). Registrations created before U9 shipped — including already-
-- booked upcoming events — have a NULL token, so the door console can't show their
-- self-reg QR. This backfills a CSPRNG token for each so the console and the
-- confirmation-email link work for already-booked upcoming events too.
--
-- Token format mirrors lib/events/registration.ts generateSelfRegToken: 24 random
-- bytes (pgcrypto gen_random_bytes) encoded base64url (≈192 bits, 32 chars, no
-- padding since 24 is divisible by 3). gen_random_bytes is VOLATILE, so it is
-- evaluated per row → distinct tokens; the unique partial index on self_reg_token
-- turns the astronomically-unlikely collision into a hard error rather than shared
-- access.
--
-- Idempotent: guarded on self_reg_token IS NULL, so a re-apply only fills new nulls
-- and never rewrites an existing token. Scoped to published / upcoming events to
-- avoid touching historical rows (mirrors the U1 attendee backfill scope). ADDITIVE
-- (data only, no schema change). NB: dev and prod share one Supabase database, so
-- applying this mutates production immediately.

UPDATE public.event_registrations r
SET self_reg_token =
  translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_')
FROM public.events e
WHERE r.event_id = e.id
  AND r.status IN ('paid', 'free')
  AND r.self_reg_token IS NULL
  AND e.is_published = true
  AND (e.start_date IS NULL OR e.start_date >= CURRENT_DATE);
