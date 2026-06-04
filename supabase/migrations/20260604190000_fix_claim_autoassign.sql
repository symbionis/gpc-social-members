-- Fix the claim RPC's single-type auto-assign (U12 bugfix).
--
-- 20260604160000/170000 used `min(ticket_type_id)` to pick a party's sole purchased
-- type, but uuid has no `min` aggregate, so the auto-assign branch (p_ticket_type_id
-- NULL on a single-type booking) would error at runtime. plpgsql doesn't validate the
-- body at CREATE, so it slipped through. Replace with `(array_agg(DISTINCT ...))[1]`,
-- which is well-defined for uuid. Same 9-arg signature → CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.claim_self_registration(
  p_token             text,
  p_name              text,
  p_email             text,
  p_phone_e164        text,
  p_language          text,
  p_waiver_version    text,
  p_waiver_accepted   boolean,
  p_marketing_consent boolean,
  p_ticket_type_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg            record;
  v_existing       record;
  v_count          integer;
  v_id             uuid;
  v_email          text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone          text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name           text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_now            timestamptz := now();
  v_sign           boolean;
  v_ticket         uuid := NULL;
  v_typecount      integer;
  v_onlytype       uuid;
  v_type_purchased integer;
  v_type_claimed   integer;
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

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT id INTO v_ticket
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = v_reg.event_id;
  ELSE
    SELECT count(DISTINCT ticket_type_id), (array_agg(DISTINCT ticket_type_id))[1]
      INTO v_typecount, v_onlytype
    FROM public.event_registration_items
    WHERE registration_id = v_reg.id;
    IF v_typecount = 1 THEN
      v_ticket := v_onlytype;
    END IF;
  END IF;

  SELECT id, name, ticket_type_id INTO v_existing
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
    IF v_ticket IS NOT NULL AND v_existing.ticket_type_id IS NULL THEN
      UPDATE public.event_attendees
        SET ticket_type_id = v_ticket
        WHERE id = v_existing.id;
    END IF;
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

  IF v_ticket IS NOT NULL THEN
    SELECT COALESCE(sum(quantity), 0) INTO v_type_purchased
    FROM public.event_registration_items
    WHERE registration_id = v_reg.id AND ticket_type_id = v_ticket;

    SELECT count(*) INTO v_type_claimed
    FROM public.event_attendees
    WHERE registration_id = v_reg.id
      AND slot_status = 'claimed'
      AND released_at IS NULL
      AND ticket_type_id = v_ticket;

    IF v_type_claimed >= v_type_purchased THEN
      RETURN jsonb_build_object('status', 'type_full');
    END IF;
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  INSERT INTO public.event_attendees
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id, waiver_version, waiver_accepted_at, language,
     marketing_consent)
  VALUES
    (v_reg.event_id, v_reg.id, NULL, v_name, v_email, v_phone, false,
     'claimed', v_ticket,
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

REVOKE ALL ON FUNCTION public.claim_self_registration(text, text, text, text, text, text, boolean, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_self_registration(text, text, text, text, text, text, boolean, boolean, uuid) TO service_role;
