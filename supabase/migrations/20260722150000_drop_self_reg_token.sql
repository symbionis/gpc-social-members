-- Follow-up to U16 — drop the now-callerless self-registration remnants.
--
-- U16 retired self-registration end to end and deferred dropping the DB objects until we
-- confirmed nothing depended on them. Confirmed: no app code reads/writes
-- event_registrations.self_reg_token, and claim_self_registration has no caller. Drop both.
-- (claim_ticket survives — the door's walk-up naming path still uses it.)

DROP FUNCTION IF EXISTS public.claim_self_registration(
  p_token text, p_name text, p_email text, p_phone_e164 text, p_language text,
  p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean, p_ticket_type_id uuid
);

-- The unique partial index is auto-dropped with the column, but drop it explicitly first so
-- the intent is legible in the ledger.
DROP INDEX IF EXISTS public.event_registrations_self_reg_token_uniq;
ALTER TABLE public.event_registrations DROP COLUMN IF EXISTS self_reg_token;
