-- U7b (Phase B / step B5, DB half) — stop WRITING is_child in every DB function.
-- Plan: docs/plans/2026-07-20-001-feat-ticket-naming-and-guest-self-service-plan.md
--
-- U7a (#79) already removed every is_child READ + WRITE from the app source. The only
-- remaining writers of the two is_child columns are the SECURITY DEFINER functions below.
-- This migration re-declares each one with all is_child references removed, so no code
-- reads or writes the columns anymore. The columns themselves stay intact — the
-- irreversible DROP is U8, gated on this deploy soaking in prod first.
--
-- Both columns are NOT NULL DEFAULT false, so INSERTs that omit is_child get `false`
-- and UPDATEs that omit it leave the existing value — no data change. Signatures are
-- unchanged, so CREATE OR REPLACE preserves dependencies + grants. Every body below is
-- reproduced from its live definition (introspected 2026-07-21 via pg_get_functiondef)
-- minus the is_child references — a surgical change, nothing else touched.

-- claim_ticket: door walk-up + free-checkout roster fill. No longer reads/writes is_child.
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

-- fill_ticket: lead "My Booking" page names one ticket by id. No longer reads/writes is_child;
-- the LEFT JOIN to event_ticket_types existed only to read tt.is_child, so it is dropped.
create or replace function public.fill_ticket(p_manage_token text, p_ticket_id uuid, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg record; v_ticket record;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name  text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign boolean; v_now timestamptz := now();
begin
  IF p_manage_token IS NULL OR length(trim(p_manage_token)) = 0 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT id, status INTO v_reg FROM public.event_registrations WHERE manage_token = p_manage_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN RETURN jsonb_build_object('status', 'inactive'); END IF;

  SELECT t.id, t.ticket_type_id INTO v_ticket
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

  UPDATE public.tickets SET
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone,
    waiver_version=COALESCE(CASE WHEN v_sign THEN p_waiver_version END, waiver_version),
    waiver_accepted_at=COALESCE(CASE WHEN v_sign THEN v_now END, waiver_accepted_at),
    language=COALESCE(CASE WHEN v_sign THEN NULLIF(p_language, '') END, language),
    marketing_consent=COALESCE(p_marketing_consent, marketing_consent)
  WHERE id = v_ticket.id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_ticket.id, 'name', v_name);
end;
$function$;

-- fill_batch_ticket: forwarded-batch recipient names one ticket by id. No longer reads/writes
-- is_child; the is_child-only LEFT JOIN to event_ticket_types is dropped.
create or replace function public.fill_batch_ticket(p_batch_token text, p_ticket_id uuid, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg_id uuid; v_reg record; v_ticket record;
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

  SELECT t.id, t.ticket_type_id INTO v_ticket
  FROM public.tickets t
  WHERE t.id = p_ticket_id AND t.batch_token = p_batch_token
    AND t.released_at IS NULL AND t.checked_in_at IS NULL
  FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF v_name IS NULL THEN RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name'); END IF;
  -- Contact required for every type (R6/R8).
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;
  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets SET
    slot_status='claimed', name=v_name, email=v_email, phone_e164=v_phone,
    waiver_version=COALESCE(CASE WHEN v_sign THEN p_waiver_version END, waiver_version),
    waiver_accepted_at=COALESCE(CASE WHEN v_sign THEN v_now END, waiver_accepted_at),
    language=COALESCE(CASE WHEN v_sign THEN NULLIF(p_language, '') END, language),
    marketing_consent=COALESCE(p_marketing_consent, marketing_consent)
  WHERE id = v_ticket.id;
  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_ticket.id, 'name', v_name);
end;
$function$;

-- checkin_by_credential: door QR scan. No longer reads/writes is_child, and no longer
-- returns the (unconsumed) is_child key on needs_name/needs_waiver. The LEFT JOIN stays —
-- it still supplies tt.title AS type_title.
create or replace function public.checkin_by_credential(p_event_id uuid, p_credential_token text, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
         tt.title AS type_title
    INTO v_t
  FROM public.tickets t LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.credential_token = p_credential_token FOR UPDATE OF t;

  IF NOT FOUND OR v_t.released_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'not_recognised'); END IF;
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

-- claim_comp_guest_slot: admin comp-list writer. Stops writing is_child; the FROM/WHERE on
-- event_ticket_types stays as the type-existence guard it always doubled as.
create or replace function public.claim_comp_guest_slot(p_registration_id uuid, p_guest jsonb, p_caller text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_guest_name  text;
  v_guest_email text;
  v_guest_phone text;
  v_guest_type  uuid;
begin
  v_guest_name  := nullif(trim(coalesce(p_guest->>'name', '')), '');
  v_guest_email := nullif(lower(trim(coalesce(p_guest->>'email', ''))), '');
  v_guest_phone := nullif(trim(coalesce(p_guest->>'phone_e164', '')), '');
  v_guest_type  := (p_guest->>'ticket_type_id')::uuid;

  IF v_guest_name IS NULL THEN
    RAISE EXCEPTION '%: every guest requires a name', p_caller;
  END IF;

  UPDATE public.tickets t
     SET slot_status = 'claimed',
         name        = v_guest_name,
         email       = v_guest_email,
         phone_e164  = v_guest_phone,
         is_comp     = true
    FROM public.event_ticket_types tt
   WHERE tt.id = v_guest_type
     AND t.id = (
       SELECT s.id
       FROM public.tickets s
       WHERE s.registration_id = p_registration_id
         AND s.slot_status = 'issued'
         AND s.ticket_type_id = v_guest_type
         AND s.released_at IS NULL
       ORDER BY s.created_at, s.id
       LIMIT 1
       FOR UPDATE
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      '%: no issued ticket available for type % (guest %)',
      p_caller, v_guest_type, v_guest_name;
  END IF;
end;
$function$;

-- create_event_with_ticket_types: admin event creation. Stops writing is_child on new
-- ticket types (column defaults to false until U8 drops it). Grants (incl. anon/authenticated)
-- are preserved by CREATE OR REPLACE — deliberately not re-asserted here.
create or replace function public.create_event_with_ticket_types(p_event jsonb, p_types jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.events (
    title, event_type_id, start_date, end_date, start_time, location,
    description, is_confirmed, is_published, notes, season_id,
    image_url, image_url_2, images, visibility, registration_enabled,
    reminder_schedule
  )
  VALUES (
    p_event->>'title',
    NULLIF(p_event->>'event_type_id', '')::uuid,
    (p_event->>'start_date')::date,
    NULLIF(p_event->>'end_date', '')::date,
    NULLIF(p_event->>'start_time', '')::time,
    NULLIF(p_event->>'location', ''),
    NULLIF(p_event->>'description', ''),
    COALESCE((p_event->>'is_confirmed')::boolean, false),
    COALESCE((p_event->>'is_published')::boolean, false),
    NULLIF(p_event->>'notes', ''),
    NULLIF(p_event->>'season_id', '')::uuid,
    NULLIF(p_event->>'image_url', ''),
    NULLIF(p_event->>'image_url_2', ''),
    COALESCE(p_event->'images', '[]'::jsonb),
    COALESCE(p_event->>'visibility', 'members_only'),
    COALESCE((p_event->>'registration_enabled')::boolean, false),
    COALESCE(p_event->'reminder_schedule', '[]'::jsonb)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.event_ticket_types
    (event_id, title, price_member, price_non_member, invite_price, counts_as_seat, sort_order)
  SELECT
    v_event_id,
    t->>'title',
    NULLIF(t->>'price_member', '')::numeric,
    NULLIF(t->>'price_non_member', '')::numeric,
    NULLIF(t->>'invite_price', '')::numeric,
    COALESCE((t->>'counts_as_seat')::boolean, true),
    COALESCE((t->>'sort_order')::integer, 0)
  FROM jsonb_array_elements(p_types) AS t;

  RETURN v_event_id;
END;
$function$;

-- add_self_registration_children: the child-only self-registration RPC. U7a (#79) deleted
-- its route + helper, leaving it callerless; drop it now (U5 deferred this pending the
-- caller's removal). The self_reg_token column it read stays until U16.
drop function if exists public.add_self_registration_children(text, text[]);

-- Signatures unchanged (CREATE OR REPLACE preserves grants) — re-assert the service_role
-- grants on the re-declared functions to match the repo convention and stay idempotent.
-- create_event_with_ticket_types is intentionally omitted (it carries broader grants).
revoke all on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid) to service_role;
revoke all on function public.fill_ticket(text, uuid, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.fill_ticket(text, uuid, text, text, text, text, text, boolean, boolean) to service_role;
revoke all on function public.fill_batch_ticket(text, uuid, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.fill_batch_ticket(text, uuid, text, text, text, text, text, boolean, boolean) to service_role;
revoke all on function public.checkin_by_credential(uuid, text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.checkin_by_credential(uuid, text, text, text, text, text, text, boolean, boolean) to service_role;
revoke all on function public.claim_comp_guest_slot(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_comp_guest_slot(uuid, jsonb, text) to service_role;
