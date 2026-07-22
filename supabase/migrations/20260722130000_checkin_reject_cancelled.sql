-- U14 — the door must refuse a cancelled ticket.
--
-- Cancellation (20260722120000) frees a ticket's seat immediately, so that seat can be
-- resold. But cancellation left the ticket's credential live, and checkin_by_credential
-- filtered only on released_at — so a cancelled holder could still scan in, admitting two
-- people against one seat (the resold buyer + the cancelled holder). Reject a cancelled
-- ticket at the scanner as `not_recognised` (the void ticket is no longer a valid credential).
--
-- Only the credential guard changes; the rest of the function is unchanged from its current
-- (post-is_child-drop) definition.

CREATE OR REPLACE FUNCTION public.checkin_by_credential(
  p_event_id uuid,
  p_credential_token text,
  p_name text,
  p_email text,
  p_phone_e164 text,
  p_language text,
  p_waiver_version text,
  p_waiver_accepted boolean,
  p_marketing_consent boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t record;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign boolean; v_now timestamptz := now(); v_needs_waiver boolean;
begin
  IF p_credential_token IS NULL OR length(trim(p_credential_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'not_recognised');
  END IF;

  SELECT t.id, t.event_id, t.registration_id, t.ticket_type_id, t.name,
         t.slot_status, t.checked_in_at, t.waiver_accepted_at, t.released_at,
         t.cancellation_status,
         tt.title AS type_title
    INTO v_t
  FROM public.tickets t LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.credential_token = p_credential_token FOR UPDATE OF t;

  IF NOT FOUND OR v_t.released_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'not_recognised'); END IF;
  -- A cancelled ticket is void — refuse admission (its seat was freed / possibly resold).
  IF v_t.cancellation_status IS NOT NULL THEN RETURN jsonb_build_object('status', 'not_recognised'); END IF;
  IF v_t.event_id <> p_event_id THEN RETURN jsonb_build_object('status', 'not_for_event'); END IF;

  IF v_t.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already', 'ticket_id', v_t.id, 'name', v_t.name,
      'ticket_type_id', v_t.ticket_type_id, 'ticket_type_title', v_t.type_title, 'checked_in_at', v_t.checked_in_at);
  END IF;

  IF NULLIF(trim(COALESCE(v_t.name, '')), '') IS NULL AND v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_name', 'ticket_id', v_t.id,
      'ticket_type_id', v_t.ticket_type_id, 'ticket_type_title', v_t.type_title);
  END IF;

  -- Waiver required for every ticket (R29).
  v_needs_waiver := v_t.waiver_accepted_at IS NULL;
  IF v_needs_waiver AND COALESCE(p_waiver_accepted, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'needs_waiver', 'ticket_id', v_t.id,
      'name', COALESCE(v_name, v_t.name), 'ticket_type_id', v_t.ticket_type_id,
      'ticket_type_title', v_t.type_title);
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets SET
    slot_status='claimed', name=COALESCE(v_name, name), email=COALESCE(v_email, email),
    phone_e164=COALESCE(v_phone, phone_e164),
    waiver_version=COALESCE(waiver_version, CASE WHEN v_sign THEN p_waiver_version END),
    waiver_accepted_at=COALESCE(waiver_accepted_at, CASE WHEN v_sign THEN v_now END),
    language=COALESCE(language, CASE WHEN v_sign THEN NULLIF(p_language, '') END),
    marketing_consent=COALESCE(marketing_consent, CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END),
    checked_in_at=v_now
  WHERE id = v_t.id AND checked_in_at IS NULL;

  IF NOT FOUND THEN
    SELECT checked_in_at INTO v_t.checked_in_at FROM public.tickets WHERE id = v_t.id;
    RETURN jsonb_build_object('status', 'already', 'ticket_id', v_t.id, 'name', v_t.name,
      'ticket_type_id', v_t.ticket_type_id, 'ticket_type_title', v_t.type_title, 'checked_in_at', v_t.checked_in_at);
  END IF;

  RETURN jsonb_build_object('status', 'checked_in', 'ticket_id', v_t.id,
    'name', COALESCE(v_name, v_t.name), 'ticket_type_id', v_t.ticket_type_id,
    'ticket_type_title', v_t.type_title, 'checked_in_at', v_now);
end;
$function$;
