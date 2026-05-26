-- Add the private invite-link columns to events.
-- invite_code: per-event secret in the public URL that unlocks members-only
--   registration for logged-out visitors (regenerate = overwrite = revoke).
-- invite_price: flat guest price (CHF) for a logged-out invitee; 0 = free.
-- Both nullable and owned solely by the invite-code endpoint. Additive — safe.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS invite_code text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS invite_price numeric(10,2);

-- Partial unique index: an invite_code is a credential, so two events must
-- never share one. Turns the astronomically-unlikely collision into a hard
-- DB error at regenerate rather than silent cross-event access.
CREATE UNIQUE INDEX IF NOT EXISTS events_invite_code_unique
  ON public.events (invite_code)
  WHERE invite_code IS NOT NULL;
