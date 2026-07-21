-- U5 (Phase B / step B3) — retire the is_child contact & waiver exemptions in the
-- ticket-claim RPCs. Plan: docs/plans/2026-07-20-001-feat-ticket-naming-and-guest-self-service-plan.md
--
-- Every ticket now requires contact regardless of type (R6/R8): the four functions
-- below each dropped their single `NOT v_is_child AND ...` branch. Everything else is
-- reproduced byte-for-byte from the live definitions (introspected 2026-07-21 via
-- pg_get_functiondef) so this is a surgical change to hot functions, nothing more.
-- The functions STILL write is_child (columns stay intact until U8); U7 stops writing.
-- Signatures are unchanged, so CREATE OR REPLACE preserves dependencies + grants.
--
-- NOTE: add_self_registration_children (a child-only self-registration RPC) is NOT
-- dropped here even though the plan's U5 lists it — its caller and UI live in the
-- self-registration flow that is retired atomically in U16, and dropping it now would
-- strand a live (if child-only, unreachable-on-current-events) caller. Deferred to U16.

-- claim_ticket: door walk-up + free-checkout roster fill. Contact required for all types.
create or replace function public.claim_ticket(p_registration_id uuid, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean, p_ticket_type_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg record; v_existing record; v_count integer; v_id uuid;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_now timestamptz := now(); v_sign boolean; v_ticket uuid := NULL;
  v_typecount integer; v_onlytype uuid; v_is_child boolean := false;
  v_type_purchased integer; v_type_claimed integer;
begin
  SELECT id, event_id, quantity, status INTO v_reg
  FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN RETURN jsonb_build_object('status', 'inactive'); END IF;
  IF v_name IS NULL THEN RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name'); END IF;

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT id, is_child INTO v_ticket, v_is_child FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = v_reg.event_id;
  ELSE
    SELECT count(DISTINCT ticket_type_id), (array_agg(DISTINCT ticket_type_id))[1]
      INTO v_typecount, v_onlytype FROM public.event_registration_items WHERE registration_id = v_reg.id;
    IF v_typecount = 1 THEN
      SELECT id, is_child INTO v_ticket, v_is_child FROM public.event_ticket_types WHERE id = v_onlytype;
    END IF;
  END IF;
  v_is_child := COALESCE(v_is_child, false);

  -- Contact is now required for every ticket type (R6/R8 — the former child exemption
  -- is retired). Previously: IF NOT v_is_child AND v_email IS NULL AND v_phone IS NULL.
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  -- Replay guard. Identity = NAME + contact, not contact alone: two different people
  -- legitimately share an address (a couple, a family, a booker using their own email for
  -- the party), and keying on contact alone returned the FIRST person's ticket for the
  -- SECOND person, never claimed their slot, and reported success. They silently did not
  -- exist until the door.
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
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone, is_child=v_is_child,
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
     ticket_type_id, is_child, credential_token, waiver_version, waiver_accepted_at, language, marketing_consent)
  VALUES
    (v_reg.event_id, v_reg.id, NULL, v_name, v_email, v_phone, false, 'claimed', v_ticket, v_is_child,
     replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'),
     CASE WHEN v_sign THEN p_waiver_version END, CASE WHEN v_sign THEN v_now END,
     CASE WHEN v_sign THEN NULLIF(p_language, '') END, CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_id, 'name', v_name, 'already', false);
end;
$function$;

-- fill_ticket: lead "My Booking" page names one ticket by id. Contact required for all.
create or replace function public.fill_ticket(p_manage_token text, p_ticket_id uuid, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg record; v_ticket record; v_is_child boolean;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign boolean; v_now timestamptz := now();
begin
  IF p_manage_token IS NULL OR length(trim(p_manage_token)) = 0 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT id, status INTO v_reg FROM public.event_registrations WHERE manage_token = p_manage_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN RETURN jsonb_build_object('status', 'inactive'); END IF;

  SELECT t.id, t.ticket_type_id, t.is_child, tt.is_child AS type_is_child INTO v_ticket
  FROM public.tickets t LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.id = p_ticket_id AND t.registration_id = v_reg.id
    AND t.released_at IS NULL AND t.checked_in_at IS NULL
  FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF v_name IS NULL THEN RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name'); END IF;
  v_is_child := COALESCE(v_ticket.type_is_child, v_ticket.is_child, false);
  -- Contact now required for every type (R6/R8). Previously: IF NOT v_is_child AND ...
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;
  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets SET
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone, is_child=v_is_child,
    waiver_version=COALESCE(CASE WHEN v_sign THEN p_waiver_version END, waiver_version),
    waiver_accepted_at=COALESCE(CASE WHEN v_sign THEN v_now END, waiver_accepted_at),
    language=COALESCE(CASE WHEN v_sign THEN NULLIF(p_language, '') END, language),
    marketing_consent=COALESCE(p_marketing_consent, marketing_consent)
  WHERE id = v_ticket.id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_ticket.id, 'name', v_name);
end;
$function$;

-- fill_batch_ticket: forwarded-batch recipient names one ticket by id. Contact required for all.
create or replace function public.fill_batch_ticket(p_batch_token text, p_ticket_id uuid, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg_id uuid; v_reg record; v_ticket record; v_is_child boolean;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign boolean; v_now timestamptz := now();
begin
  IF p_batch_token IS NULL OR length(trim(p_batch_token)) = 0 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT registration_id INTO v_reg_id FROM public.tickets
  WHERE batch_token = p_batch_token AND registration_id IS NOT NULL LIMIT 1;
  IF v_reg_id IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT id, status INTO v_reg FROM public.event_registrations WHERE id = v_reg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN RETURN jsonb_build_object('status', 'inactive'); END IF;

  SELECT t.id, t.ticket_type_id, t.is_child, tt.is_child AS type_is_child INTO v_ticket
  FROM public.tickets t LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.id = p_ticket_id AND t.batch_token = p_batch_token
    AND t.released_at IS NULL AND t.checked_in_at IS NULL
  FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF v_name IS NULL THEN RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name'); END IF;
  v_is_child := COALESCE(v_ticket.type_is_child, v_ticket.is_child, false);
  -- Contact now required for every type (R6/R8). Previously: IF NOT v_is_child AND ...
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;
  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets SET
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone, is_child=v_is_child,
    waiver_version=COALESCE(CASE WHEN v_sign THEN p_waiver_version END, waiver_version),
    waiver_accepted_at=COALESCE(CASE WHEN v_sign THEN v_now END, waiver_accepted_at),
    language=COALESCE(CASE WHEN v_sign THEN NULLIF(p_language, '') END, language),
    marketing_consent=COALESCE(p_marketing_consent, marketing_consent)
  WHERE id = v_ticket.id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_ticket.id, 'name', v_name);
end;
$function$;

-- checkin_by_credential: door QR scan. Waiver now required for every ticket (R29 — the
-- former child waiver exemption is retired).
create or replace function public.checkin_by_credential(p_event_id uuid, p_credential_token text, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t record; v_is_child boolean;
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
         t.is_child, tt.is_child AS type_is_child, tt.title AS type_title
    INTO v_t
  FROM public.tickets t LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.credential_token = p_credential_token FOR UPDATE OF t;

  IF NOT FOUND OR v_t.released_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'not_recognised'); END IF;
  IF v_t.event_id <> p_event_id THEN RETURN jsonb_build_object('status', 'not_for_event'); END IF;

  IF v_t.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already', 'ticket_id', v_t.id, 'name', v_t.name,
      'ticket_type_id', v_t.ticket_type_id, 'ticket_type_title', v_t.type_title, 'checked_in_at', v_t.checked_in_at);
  END IF;

  v_is_child := COALESCE(v_t.type_is_child, v_t.is_child, false);

  IF NULLIF(trim(COALESCE(v_t.name, '')), '') IS NULL AND v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_name', 'ticket_id', v_t.id,
      'ticket_type_id', v_t.ticket_type_id, 'ticket_type_title', v_t.type_title, 'is_child', v_is_child);
  END IF;

  -- Waiver now required for every ticket (R29). Previously: NOT v_is_child AND ...
  v_needs_waiver := v_t.waiver_accepted_at IS NULL;
  IF v_needs_waiver AND COALESCE(p_waiver_accepted, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'needs_waiver', 'ticket_id', v_t.id,
      'name', COALESCE(v_name, v_t.name), 'ticket_type_id', v_t.ticket_type_id,
      'ticket_type_title', v_t.type_title, 'is_child', v_is_child);
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets SET
    slot_status='claimed', name=COALESCE(v_name, name), email=COALESCE(v_email, email),
    phone_e164=COALESCE(v_phone, phone_e164), is_child=v_is_child,
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

-- Signatures unchanged (CREATE OR REPLACE preserves grants) — re-assert them anyway to
-- match the repo convention and stay idempotent.
revoke all on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid) to service_role;
revoke all on function public.fill_ticket(text, uuid, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.fill_ticket(text, uuid, text, text, text, text, text, boolean, boolean) to service_role;
revoke all on function public.fill_batch_ticket(text, uuid, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.fill_batch_ticket(text, uuid, text, text, text, text, text, boolean, boolean) to service_role;
revoke all on function public.checkin_by_credential(uuid, text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.checkin_by_credential(uuid, text, text, text, text, text, text, boolean, boolean) to service_role;
