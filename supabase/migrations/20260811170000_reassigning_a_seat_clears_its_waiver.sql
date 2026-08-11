-- A waiver attests to a PERSON, not to a seat.
--
-- fill_ticket preserved the acceptance across a fill:
--
--   waiver_accepted_at = COALESCE(CASE WHEN v_sign THEN v_now END, waiver_accepted_at)
--
-- The public edit control posts here (app/api/public/bookings/[token]/fill/route.ts passes
-- p_waiver_accepted false), so v_sign is false, the CASE yields NULL, and COALESCE falls
-- through to whatever was already there. Rename the ticket and change its email, and the new
-- holder inherits a signature they never gave — the door reads waiver_accepted_at, sees it
-- set, and waves them through without ever showing them the text.
--
-- That was reachable in one move: a seat could be signed and then handed to someone else.
-- Two changes close it. This one is the durable half — the acceptance now follows the person,
-- so re-assigning a seat always re-arms the waiver. The other half lives in the waiver route,
-- which refuses to sign a ticket with no name on it.
--
-- Identity is (name, email), compared post-normalisation so a case-fold or a stray space is
-- not a re-assignment. Correcting "alice@x.com" to "Alice@X.com ", or fixing a typo in a name
-- while the email holds, must not make a guest sign again at the gate.
--
-- The columns are cleared as a PAIR. Nothing in the schema enforces that
-- (waiver_accepted_at and waiver_version are independently nullable), but every writer has
-- always set them together, and a row with one and not the other reads as signed to the door
-- while carrying no record of what was signed.

CREATE OR REPLACE FUNCTION public.fill_ticket(
  p_manage_token text, p_ticket_id uuid, p_name text, p_email text, p_phone_e164 text,
  p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_reg record; v_ticket record;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign boolean; v_now timestamptz := now();
  v_reassigned boolean;
begin
  IF p_manage_token IS NULL OR length(trim(p_manage_token)) = 0 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT id, status INTO v_reg FROM public.event_registrations WHERE manage_token = p_manage_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN RETURN jsonb_build_object('status', 'inactive'); END IF;

  -- name/email now come back too: they are what the re-assignment test compares against.
  SELECT t.id, t.ticket_type_id, t.name, t.email INTO v_ticket
  FROM public.tickets t
  WHERE t.id = p_ticket_id AND t.registration_id = v_reg.id
    AND t.released_at IS NULL AND t.checked_in_at IS NULL
  FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF v_name IS NULL THEN RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name'); END IF;
  -- Contact required for every type (R6/R8).
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;
  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  -- Compare like with like: the stored values are already normalised by an earlier fill, but
  -- rows predating that, or written by another path, may not be. IS DISTINCT FROM so a NULL
  -- on either side counts as a change — naming a blank seat is a re-assignment too, and a
  -- ticket that somehow holds a signature without a name must not keep it.
  v_reassigned :=
    NULLIF(lower(trim(COALESCE(v_ticket.name, ''))), '')  IS DISTINCT FROM lower(v_name)
    OR NULLIF(lower(trim(COALESCE(v_ticket.email, ''))), '') IS DISTINCT FROM v_email;

  UPDATE public.tickets SET
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone,
    -- On re-assignment the acceptance is dropped outright, so the new holder is asked at the
    -- door (or can sign ahead from their own ticket page). Otherwise unchanged: still never
    -- re-stamped by this path, since the edit control does not present the waiver text.
    waiver_version = CASE
      WHEN v_sign THEN p_waiver_version
      WHEN v_reassigned THEN NULL
      ELSE waiver_version END,
    waiver_accepted_at = CASE
      WHEN v_sign THEN v_now
      WHEN v_reassigned THEN NULL
      ELSE waiver_accepted_at END,
    language = CASE
      WHEN v_sign THEN NULLIF(p_language, '')
      WHEN v_reassigned THEN NULL
      ELSE language END,
    marketing_consent=COALESCE(p_marketing_consent, marketing_consent)
  WHERE id = v_ticket.id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_ticket.id, 'name', v_name);
end;
$function$;
