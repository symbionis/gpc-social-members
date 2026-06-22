-- FEAT-41 / U7 — Info-desk scan check-in by ticket credential.
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- One atomic RPC resolves a scanned credential to its EXACT ticket row (scoped to the
-- active event), fills any missing name on the spot, and stamps the arrival. It must
-- act on the scanned row itself — claim_ticket flips any issued row of a type, which
-- would name a different ticket than the one presented. Because the same UPDATE sets
-- checked_in_at, the contact_present constraint is satisfied by the arrival, so a name
-- alone completes check-in at the desk (R7) — contact is encouraged, never required.
--
-- States returned: not_recognised (unknown/released token), not_for_event (token for
-- another event), already (idempotent — original time), needs_name (issued/unnamed,
-- no name supplied), needs_waiver (unsigned, not accepted now), checked_in.

create or replace function public.checkin_by_credential(
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
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t        record;
  v_is_child boolean;
  v_email    text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone    text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name     text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign     boolean;
  v_now      timestamptz := now();
  v_needs_waiver boolean;
begin
  IF p_credential_token IS NULL OR length(trim(p_credential_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'not_recognised');
  END IF;

  SELECT t.id, t.event_id, t.registration_id, t.ticket_type_id, t.name,
         t.slot_status, t.checked_in_at, t.waiver_accepted_at, t.released_at,
         t.is_child, tt.is_child AS type_is_child, tt.title AS type_title
    INTO v_t
  FROM public.tickets t
  LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.credential_token = p_credential_token
  FOR UPDATE OF t;

  IF NOT FOUND OR v_t.released_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_recognised');
  END IF;
  IF v_t.event_id <> p_event_id THEN
    RETURN jsonb_build_object('status', 'not_for_event');
  END IF;

  -- Already arrived → idempotent, original time, no second bracelet.
  IF v_t.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already', 'ticket_id', v_t.id,
      'name', v_t.name, 'ticket_type_id', v_t.ticket_type_id,
      'ticket_type_title', v_t.type_title, 'checked_in_at', v_t.checked_in_at);
  END IF;

  v_is_child := COALESCE(v_t.type_is_child, v_t.is_child, false);

  -- Unnamed ticket and no name supplied → ask staff for a name first.
  IF NULLIF(trim(COALESCE(v_t.name, '')), '') IS NULL AND v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_name', 'ticket_id', v_t.id,
      'ticket_type_id', v_t.ticket_type_id, 'ticket_type_title', v_t.type_title,
      'is_child', v_is_child);
  END IF;

  -- Waiver: required unless already signed or accepted in this submission. Children
  -- are waiver-exempt (consistent with claim_ticket / fill_ticket / checkInChildren).
  v_needs_waiver := NOT v_is_child AND v_t.waiver_accepted_at IS NULL;
  IF v_needs_waiver AND COALESCE(p_waiver_accepted, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'needs_waiver', 'ticket_id', v_t.id,
      'name', COALESCE(v_name, v_t.name), 'ticket_type_id', v_t.ticket_type_id,
      'ticket_type_title', v_t.type_title, 'is_child', v_is_child);
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  -- One write: claim (if still issued), fill any newly-typed name/contact, sign the
  -- waiver if accepting now (never clobber an earlier signature), and stamp arrival.
  -- checked_in_at being set is what lets an adult complete with a name alone.
  UPDATE public.tickets SET
    slot_status        = 'claimed',
    name               = COALESCE(v_name, name),
    email              = COALESCE(v_email, email),
    phone_e164         = COALESCE(v_phone, phone_e164),
    is_child           = v_is_child,
    waiver_version     = COALESCE(waiver_version, CASE WHEN v_sign THEN p_waiver_version END),
    waiver_accepted_at = COALESCE(waiver_accepted_at, CASE WHEN v_sign THEN v_now END),
    language           = COALESCE(language, CASE WHEN v_sign THEN NULLIF(p_language, '') END),
    marketing_consent  = COALESCE(marketing_consent, CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END),
    checked_in_at      = v_now
  WHERE id = v_t.id AND checked_in_at IS NULL;

  IF NOT FOUND THEN
    -- Raced another scanner — re-read the original arrival time, idempotent.
    SELECT checked_in_at INTO v_t.checked_in_at FROM public.tickets WHERE id = v_t.id;
    RETURN jsonb_build_object('status', 'already', 'ticket_id', v_t.id,
      'name', v_t.name, 'ticket_type_id', v_t.ticket_type_id,
      'ticket_type_title', v_t.type_title, 'checked_in_at', v_t.checked_in_at);
  END IF;

  RETURN jsonb_build_object('status', 'checked_in', 'ticket_id', v_t.id,
    'name', COALESCE(v_name, v_t.name), 'ticket_type_id', v_t.ticket_type_id,
    'ticket_type_title', v_t.type_title, 'checked_in_at', v_now);
end;
$function$;

revoke all on function public.checkin_by_credential(uuid, text, text, text, text, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.checkin_by_credential(uuid, text, text, text, text, text, text, boolean, boolean)
  to service_role;
