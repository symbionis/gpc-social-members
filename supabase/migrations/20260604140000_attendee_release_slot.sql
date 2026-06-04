-- "Free a slot" support (U11 / door-console guest swaps).
--
-- An admin or door volunteer can release a not-yet-arrived guest's slot so a
-- replacement can self-register. Releasing never deletes the row — the person's
-- identity and any signed waiver are a record we keep — so we mark it with a
-- released_at timestamp and exclude released rows everywhere a "live" claimed
-- attendee is counted or matched: the self-reg cap, the door matcher, the admin
-- roster, and the door console. A checked-in attendee is never releasable (guarded
-- in the route), so released rows are always pre-arrival.
--
-- ADDITIVE (nullable column + function replace). NB: dev and prod share one
-- Supabase database, so applying this mutates production immediately.

ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

COMMENT ON COLUMN public.event_attendees.released_at IS
  'When set, this claimed slot was freed (guest swap) — retained for audit but '
  'excluded from the cap, the door match, and the roster. NULL = live.';

-- Re-create the claim RPC so released rows no longer count toward the cap and a
-- released contact does not satisfy the double-submit idempotency check (a freed
-- guest re-registering gets a fresh live row). Body is unchanged otherwise.
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

  SELECT id, name INTO v_existing
  FROM public.event_attendees
  WHERE registration_id = v_reg.id
    AND slot_status = 'claimed'
    AND released_at IS NULL
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

  SELECT count(*) INTO v_count
  FROM public.event_attendees
  WHERE registration_id = v_reg.id
    AND slot_status = 'claimed'
    AND released_at IS NULL;

  IF v_count >= COALESCE(v_reg.quantity, 0) THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

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

REVOKE ALL ON FUNCTION public.claim_self_registration(text, text, text, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_self_registration(text, text, text, text, text, text, boolean, boolean) TO service_role;
