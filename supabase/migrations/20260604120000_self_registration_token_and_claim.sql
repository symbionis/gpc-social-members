-- Guest self-registration link (Milestone 2, U9).
--
-- A purchase produces a shareable, capped self-registration link so the OTHER
-- people in a paid party (not the lead/purchaser) can put themselves on the door
-- roster — name + email or phone, and optionally sign their own waiver — without
-- staff data-entry. The link is scoped to one registration via a CSPRNG secret
-- carried in the URL path (mirroring events.invite_code).
--
-- CAP MODEL (KTD6 revisited — approved deviation, "approach B"): the link admits at
-- most N self-registrations, N = the party's purchased ticket quantity
-- (event_registrations.quantity). Rather than PRE-PROVISIONING N-1 placeholder
-- rows inside create_event_registration (which would change the money-path RPC and
-- the Stripe/confirmation seed, and leave orphan rows behind abandoned checkouts),
-- the claim RPC below locks the registration row (SELECT ... FOR UPDATE) and
-- counts the party's claimed attendees under that lock — race-safe without
-- pre-provisioning. KTD6's stated reason for pre-provisioning (a supabase-js
-- 1000-row read truncation) does not apply to count() inside an RPC. This leaves
-- create_event_registration and the confirmation/webhook seed UNCHANGED.
--
-- This migration is ADDITIVE ONLY: a nullable token column + unique partial index
-- + one SECURITY DEFINER function. NB: dev and prod share one Supabase database, so
-- applying this mutates production immediately. Nothing reads the token until the
-- U9 code ships. DEPLOY ORDERING: apply after 20260603120000_event_attendees and
-- 20260603121000_event_registrations_phone_and_lead_seed. TYPES: regenerate
-- types/database.ts after apply and re-append the manual aliases at the tail.

-- ---------------------------------------------------------------------------
-- Token column: a per-registration self-registration secret. NULL until set by
-- the app at registration creation (generateSelfRegToken). The partial unique
-- index enforces uniqueness without indexing the many legacy NULLs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS self_reg_token text;

COMMENT ON COLUMN public.event_registrations.self_reg_token IS
  'CSPRNG self-registration link secret (U9). NULL on legacy / token-less rows.';

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_self_reg_token_uniq
  ON public.event_registrations (self_reg_token)
  WHERE self_reg_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- claim_self_registration: a guest claims a slot on a party via its self-reg
-- token. Race-safe (locks the registration row), idempotent on contact, capped at
-- the party's purchased quantity. Returns a jsonb status the route maps to HTTP:
--   invalid       — no/blank token, or no registration matches it
--   inactive      — the registration isn't paid/free (e.g. an unpaid checkout)
--   invalid_input — name missing, or neither email nor phone supplied
--   full          — the party already has `quantity` claimed attendees
--   claimed       — a row was created (already=false) OR an existing matching row
--                   was returned (already=true, double-submit idempotency)
--
-- The waiver may be signed here (R11): when p_waiver_accepted and a server-sourced
-- p_waiver_version are supplied, the waiver fields are written on the new row.
-- SECURITY DEFINER + service_role-only (the table's RLS denies anon/authenticated).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_self_registration(
  p_token             text,
  p_name              text,
  p_email             text,
  p_phone_e164        text,
  p_language          text,
  p_waiver_version    text,
  p_waiver_accepted   boolean,
  p_marketing_consent boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg      record;
  v_existing record;
  v_count    integer;
  v_id       uuid;
  v_email    text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone    text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name     text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_now      timestamptz := now();
  v_sign     boolean;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Lock the party row so concurrent claims for the same link serialize: the
  -- count-and-insert below cannot interleave, so the cap can never be exceeded.
  SELECT id, event_id, quantity, status
    INTO v_reg
  FROM public.event_registrations
  WHERE self_reg_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_reg.status NOT IN ('paid', 'free') THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name');
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  -- Idempotency: a claimed attendee on this party with the same contact already
  -- exists (a double-submit, or the lead re-using the link) → return it, no new row.
  SELECT id, name INTO v_existing
  FROM public.event_attendees
  WHERE registration_id = v_reg.id
    AND slot_status = 'claimed'
    AND (
      (v_email IS NOT NULL AND lower(email) = v_email)
      OR (v_phone IS NOT NULL AND phone_e164 = v_phone)
    )
  ORDER BY created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'claimed',
      'attendee_id', v_existing.id,
      'name', v_existing.name,
      'already', true
    );
  END IF;

  -- Cap: count the party's claimed attendees (the lead counts) under the lock.
  SELECT count(*) INTO v_count
  FROM public.event_attendees
  WHERE registration_id = v_reg.id
    AND slot_status = 'claimed';

  IF v_count >= COALESCE(v_reg.quantity, 0) THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

  -- Sign the waiver now only with a server-sourced version + explicit acceptance.
  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  INSERT INTO public.event_attendees
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, waiver_version, waiver_accepted_at, language, marketing_consent)
  VALUES
    (v_reg.event_id, v_reg.id, NULL, v_name, v_email, v_phone, false,
     'claimed',
     CASE WHEN v_sign THEN p_waiver_version END,
     CASE WHEN v_sign THEN v_now END,
     CASE WHEN v_sign THEN NULLIF(p_language, '') END,
     CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'attendee_id', v_id,
    'name', v_name,
    'already', false
  );
END;
$$;

-- FROM PUBLIC alone is NOT enough on Supabase — default privileges also grant
-- EXECUTE to anon/authenticated. Revoke those explicitly (service_role-only).
-- See docs/solutions/security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md
REVOKE ALL ON FUNCTION public.claim_self_registration(text, text, text, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_self_registration(text, text, text, text, text, text, boolean, boolean) TO service_role;
