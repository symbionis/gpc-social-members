-- Race-safe duplicate guard + comp audit for event registrations.
--
-- See docs/plans/2026-05-21-001-feat-waitlist-to-registration-plan.md (U5)
--
-- Partial unique index: at most one paid/free registration per (event,
-- lowercased email). Makes the register route and the waitlist-convert duplicate
-- guards race-safe — a concurrent duplicate insert raises 23505 instead of
-- silently double-booking. Pre-checked clean before creation (no existing
-- (event_id, lower(email)) duplicates among paid/free rows).
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_email_paidfree_uniq
  ON public.event_registrations (event_id, lower(email))
  WHERE status IN ('paid', 'free');

-- Audit: which admin comped this registration (e.g. a waitlist conversion).
-- Nullable: only set for admin-comped rows; SET NULL so removing an admin keeps
-- the registration record.
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS converted_by uuid
    REFERENCES public.admin_users(id) ON DELETE SET NULL;
