-- Scope claim_ticket's replay guard to the ticket type.
--
-- The guard exists for IDEMPOTENCY: if the same claim runs twice (a replayed Stripe webhook,
-- a double submit), don't burn two seats. It was keyed on name + contact alone, which made it
-- also enforce a rule it was never designed for — one human, one seat per booking.
--
-- That rule is wrong for a multi-day event. ENLIGHTEN Summit sells "Friday: Leadership Day"
-- and "Saturday: Horizon Day" as separate types, and one person buying both is the ordinary
-- case. The unscoped guard saw the second claim as a replay of the first: it returned the
-- Friday ticket with already=true, claimed nothing, and left the Saturday seat `issued` with a
-- NULL name — permanently, and with nothing logged on the free checkout path. The seat still
-- counts against the event, and its QR reaches nobody, because grouped delivery keys on the
-- guest's own email. Two ENLIGHTEN bookings and two Breath & Polo bookings lost a guest
-- identity this way.
--
-- Narrowing the key costs no replay safety: a genuine retry replays the same ticket type too,
-- so it still collapses. What changes is only that the SAME person on a DIFFERENT type now
-- gets their own seat, which is what was bought.
--
-- Two matches are deliberately kept wide:
--   * v_ticket IS NULL — the caller could not resolve a type (a legacy multi-type registration
--     claimed without one). We cannot tell types apart, so fall back to the old identity-only
--     match rather than minting a duplicate on a replay.
--   * ticket_type_id IS NULL — a legacy seat minted before ticket types existed. The block
--     below already lets such a seat ADOPT the incoming type on match, and that adoption is
--     the reason it must stay matchable.
--
-- App-layer mirrors of this key live in lib/events/attendee-input.ts (attendeeIdentity /
-- collidesWithClaimed); they must move together or the API accepts what the DB then swallows.

CREATE OR REPLACE FUNCTION public.claim_ticket(
  p_registration_id uuid,
  p_name text,
  p_email text,
  p_phone_e164 text,
  p_language text,
  p_waiver_version text,
  p_waiver_accepted boolean,
  p_marketing_consent boolean,
  p_ticket_type_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_reg record; v_existing record; v_count integer; v_id uuid;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_now timestamptz := now(); v_sign boolean; v_ticket uuid := NULL;
  v_typecount integer; v_onlytype uuid;
  v_type_purchased integer; v_type_claimed integer;
begin
  SELECT id, event_id, quantity, status INTO v_reg
  FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN RETURN jsonb_build_object('status', 'inactive'); END IF;
  IF v_name IS NULL THEN RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name'); END IF;

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT id INTO v_ticket FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = v_reg.event_id;
  ELSE
    SELECT count(DISTINCT ticket_type_id), (array_agg(DISTINCT ticket_type_id))[1]
      INTO v_typecount, v_onlytype FROM public.event_registration_items WHERE registration_id = v_reg.id;
    IF v_typecount = 1 THEN
      SELECT id INTO v_ticket FROM public.event_ticket_types WHERE id = v_onlytype;
    END IF;
  END IF;

  -- Contact is required for every ticket type (R6/R8 — the former child exemption was
  -- retired in U5). Since U7 the type's is_child no longer participates at all.
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  -- Replay guard. Identity = NAME + contact + TICKET TYPE, not contact alone: two different
  -- people legitimately share an address (a couple, a family, a booker using their own email
  -- for the party), and keying on contact alone returned the FIRST person's ticket for the
  -- SECOND person, never claimed their slot, and reported success. They silently did not
  -- exist until the door.
  --
  -- The type is part of the key for the mirror-image reason: ONE person legitimately holds
  -- two seats of different types (Friday and Saturday of a multi-day event), and keying on
  -- name+contact alone silently swallowed the second one the same way. A retry replays the
  -- same type, so idempotency is unaffected.
  --
  -- The name comparison folds case AND collapses internal whitespace, so "Alice Smith",
  -- "alice smith" and "Alice  Smith" are one person on a retry. trim() alone is not
  -- enough: it strips the ends, not a double space in the middle.
  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    SELECT id, name, ticket_type_id INTO v_existing FROM public.tickets
    WHERE registration_id = v_reg.id AND slot_status = 'claimed' AND released_at IS NULL
      AND regexp_replace(lower(trim(COALESCE(name, ''))), '\s+', ' ', 'g')
        = regexp_replace(lower(v_name), '\s+', ' ', 'g')
      AND ((v_email IS NOT NULL AND lower(email) = v_email) OR (v_phone IS NOT NULL AND phone_e164 = v_phone))
      -- Type scoping. An unresolved incoming type, or an untyped legacy seat (which adopts
      -- the incoming type just below), still matches on identity alone.
      AND (v_ticket IS NULL OR ticket_type_id IS NULL OR ticket_type_id = v_ticket)
    ORDER BY created_at LIMIT 1;
    IF FOUND THEN
      IF v_ticket IS NOT NULL AND v_existing.ticket_type_id IS NULL THEN
        UPDATE public.tickets SET ticket_type_id = v_ticket WHERE id = v_existing.id;
      END IF;
      RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_existing.id, 'name', v_existing.name, 'already', true);
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.tickets
  WHERE registration_id = v_reg.id AND slot_status = 'claimed' AND released_at IS NULL;
  IF v_count >= COALESCE(v_reg.quantity, 0) THEN RETURN jsonb_build_object('status', 'full'); END IF;

  IF v_ticket IS NOT NULL THEN
    SELECT COALESCE(sum(quantity), 0) INTO v_type_purchased FROM public.event_registration_items
    WHERE registration_id = v_reg.id AND ticket_type_id = v_ticket;
    SELECT count(*) INTO v_type_claimed FROM public.tickets
    WHERE registration_id = v_reg.id AND slot_status = 'claimed' AND released_at IS NULL AND ticket_type_id = v_ticket;
    IF v_type_claimed >= v_type_purchased THEN RETURN jsonb_build_object('status', 'type_full'); END IF;
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets t SET
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone,
    ticket_type_id=COALESCE(t.ticket_type_id, v_ticket),
    waiver_version=CASE WHEN v_sign THEN p_waiver_version END,
    waiver_accepted_at=CASE WHEN v_sign THEN v_now END,
    language=CASE WHEN v_sign THEN NULLIF(p_language, '') END,
    marketing_consent=CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END
  WHERE t.id = (
    SELECT id FROM public.tickets
    WHERE registration_id = v_reg.id AND slot_status = 'issued' AND released_at IS NULL
      AND (v_ticket IS NULL OR ticket_type_id = v_ticket OR ticket_type_id IS NULL)
    ORDER BY (ticket_type_id IS NOT DISTINCT FROM v_ticket) DESC, created_at LIMIT 1
  ) RETURNING t.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_id, 'name', v_name, 'already', false);
  END IF;

  INSERT INTO public.tickets
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead, slot_status,
     ticket_type_id, credential_token, waiver_version, waiver_accepted_at, language, marketing_consent)
  VALUES
    (v_reg.event_id, v_reg.id, NULL, v_name, v_email, v_phone, false, 'claimed',
     v_ticket,
     replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'),
     CASE WHEN v_sign THEN p_waiver_version END, CASE WHEN v_sign THEN v_now END,
     CASE WHEN v_sign THEN NULLIF(p_language, '') END, CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_id, 'name', v_name, 'already', false);
end;
$function$;
