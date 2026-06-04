-- Per-attendee ticket type (U12 / catering).
--
-- A booking records its ticket-type TOTALS on event_registration_items (e.g. "9 ×
-- Asado Standard, 1 × Asado Vegetarian"), but we never captured WHICH person in a
-- party holds which ticket. Catering needs the per-person split, and for this club
-- the ticket types ARE the meal choices (Asado Standard / Vegetarian / Kids /
-- Without Asado), so a per-attendee link to the event's own ticket types — not a
-- separate "meal" concept — is all that's needed.
--
-- ADDITIVE (nullable column + FK + function replace). NB: dev and prod share one
-- Supabase database, so applying this mutates production immediately.

ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS ticket_type_id uuid
    REFERENCES public.event_ticket_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_attendees.ticket_type_id IS
  'The event_ticket_types row this person holds (self-selected at self-registration '
  'or chosen by door staff). NULL when unknown. For asado events this is the meal '
  'choice; it always mirrors the event''s ticket types rather than a separate enum.';

-- Re-create the claim RPC with a ticket-type parameter. Drop the old 8-arg
-- signature first (adding a parameter would otherwise create a second overload).
DROP FUNCTION IF EXISTS public.claim_self_registration(
  text, text, text, text, text, text, boolean, boolean);

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
  v_reg       record;
  v_existing  record;
  v_count     integer;
  v_id        uuid;
  v_email     text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone     text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name      text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_now       timestamptz := now();
  v_sign      boolean;
  v_ticket    uuid := NULL;
  v_typecount integer;
  v_onlytype  uuid;
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

  -- Resolve the ticket type. An explicit choice is honoured only when it belongs to
  -- this event (else ignored, never an error). With no choice, auto-assign the party's
  -- sole purchased type — so single-type bookings need no selector and still get the
  -- per-person ticket recorded; a mixed booking is left NULL until someone picks.
  IF p_ticket_type_id IS NOT NULL THEN
    SELECT id INTO v_ticket
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = v_reg.event_id;
  ELSE
    SELECT count(DISTINCT ticket_type_id), min(ticket_type_id)
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
    -- Idempotent re-submit: fill in a ticket type if one is now known and the row
    -- doesn't have one yet (never overwrite an existing choice).
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
