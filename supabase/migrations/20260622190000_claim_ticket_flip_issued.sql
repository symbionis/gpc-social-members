-- FEAT-41 / U3 — Race-safe fill: flip an issued row to claimed (not insert).
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- ADDITIVE + REPLACE: new claim_ticket(registration_id, …) core that, under a
-- registration-row lock, idempotently flips one 'issued' row to 'claimed' rather
-- than inserting. claim_self_registration is rewritten as a token-resolving wrapper
-- that delegates to it (same signature + return shape, so its route is unchanged).
-- The door fill route calls claim_ticket directly with a registration id.
--
-- CAP DENOMINATOR: 'filled' = claimed AND released_at IS NULL — NOT all non-released
-- rows. Issued rows ARE the purchased capacity; counting them as redeemed would read
-- a freshly-minted party as full at mint time. A flip can only consume an issued row
-- that exists, so availability and the explicit cap agree; the explicit cap stays as
-- the plan's belt-and-suspenders and gates the legacy insert fallback.

create or replace function public.claim_ticket(
  p_registration_id uuid,
  p_name text,
  p_email text,
  p_phone_e164 text,
  p_language text,
  p_waiver_version text,
  p_waiver_accepted boolean,
  p_marketing_consent boolean,
  p_ticket_type_id uuid default null::uuid
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
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
  v_is_child       boolean := false;
  v_type_purchased integer;
  v_type_claimed   integer;
begin
  SELECT id, event_id, quantity, status
    INTO v_reg
  FROM public.event_registrations
  WHERE id = p_registration_id
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

  -- Resolve the ticket type: explicit (validated against the event) or the sole type.
  IF p_ticket_type_id IS NOT NULL THEN
    SELECT id, is_child INTO v_ticket, v_is_child
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = v_reg.event_id;
  ELSE
    SELECT count(DISTINCT ticket_type_id), (array_agg(DISTINCT ticket_type_id))[1]
      INTO v_typecount, v_onlytype
    FROM public.event_registration_items
    WHERE registration_id = v_reg.id;
    IF v_typecount = 1 THEN
      SELECT id, is_child INTO v_ticket, v_is_child
      FROM public.event_ticket_types WHERE id = v_onlytype;
    END IF;
  END IF;
  v_is_child := COALESCE(v_is_child, false);

  -- Contact required unless this is a child ticket (kids are name-only).
  IF NOT v_is_child AND v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  -- Idempotency: a prior claim with the same contact returns that row unchanged.
  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    SELECT id, name, ticket_type_id INTO v_existing
    FROM public.tickets
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
        UPDATE public.tickets SET ticket_type_id = v_ticket WHERE id = v_existing.id;
      END IF;
      RETURN jsonb_build_object(
        'status', 'claimed', 'attendee_id', v_existing.id,
        'name', v_existing.name, 'already', true
      );
    END IF;
  END IF;

  -- Cap: filled = CLAIMED non-released rows (issued rows are capacity, not redeemed).
  SELECT count(*) INTO v_count
  FROM public.tickets
  WHERE registration_id = v_reg.id AND slot_status = 'claimed' AND released_at IS NULL;
  IF v_count >= COALESCE(v_reg.quantity, 0) THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

  IF v_ticket IS NOT NULL THEN
    SELECT COALESCE(sum(quantity), 0) INTO v_type_purchased
    FROM public.event_registration_items
    WHERE registration_id = v_reg.id AND ticket_type_id = v_ticket;

    SELECT count(*) INTO v_type_claimed
    FROM public.tickets
    WHERE registration_id = v_reg.id AND slot_status = 'claimed'
      AND released_at IS NULL AND ticket_type_id = v_ticket;

    IF v_type_claimed >= v_type_purchased THEN
      RETURN jsonb_build_object('status', 'type_full');
    END IF;
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  -- FLIP one issued row to claimed, preferring an exact ticket-type match. The
  -- registration lock above serialises concurrent flips, so a plain LIMIT 1 is safe.
  UPDATE public.tickets t SET
    slot_status        = 'claimed',
    name               = v_name,
    email              = v_email,
    phone_e164         = v_phone,
    is_child           = v_is_child,
    ticket_type_id     = COALESCE(t.ticket_type_id, v_ticket),
    waiver_version     = CASE WHEN v_sign THEN p_waiver_version END,
    waiver_accepted_at = CASE WHEN v_sign THEN v_now END,
    language           = CASE WHEN v_sign THEN NULLIF(p_language, '') END,
    marketing_consent  = CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END
  WHERE t.id = (
    SELECT id FROM public.tickets
    WHERE registration_id = v_reg.id AND slot_status = 'issued' AND released_at IS NULL
      AND (v_ticket IS NULL OR ticket_type_id = v_ticket OR ticket_type_id IS NULL)
    ORDER BY (ticket_type_id IS NOT DISTINCT FROM v_ticket) DESC, created_at
    LIMIT 1
  )
  RETURNING t.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_id,
                              'name', v_name, 'already', false);
  END IF;

  -- Fallback: cap allowed but no issued row exists (legacy registration minted
  -- before credentials, or its issued rows were removed). Insert a claimed row WITH
  -- a credential, so the "every ticket has a QR" invariant (R1) holds even here.
  INSERT INTO public.tickets
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id, is_child, credential_token, waiver_version,
     waiver_accepted_at, language, marketing_consent)
  VALUES
    (v_reg.event_id, v_reg.id, NULL, v_name, v_email, v_phone, false,
     'claimed', v_ticket, v_is_child,
     replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'),
     CASE WHEN v_sign THEN p_waiver_version END,
     CASE WHEN v_sign THEN v_now END,
     CASE WHEN v_sign THEN NULLIF(p_language, '') END,
     CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_id,
                            'name', v_name, 'already', false);
end;
$function$;

revoke all on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid)
  to service_role;

-- Rewrite claim_self_registration as a token-resolving wrapper over claim_ticket.
-- Keeps its signature + return shape so the self-reg claim route is unchanged.
create or replace function public.claim_self_registration(
  p_token text, p_name text, p_email text, p_phone_e164 text, p_language text,
  p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean,
  p_ticket_type_id uuid default null::uuid
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg record;
begin
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT id, status INTO v_reg
  FROM public.event_registrations
  WHERE self_reg_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  RETURN public.claim_ticket(
    v_reg.id, p_name, p_email, p_phone_e164, p_language,
    p_waiver_version, p_waiver_accepted, p_marketing_consent, p_ticket_type_id
  );
end;
$function$;

-- Release a not-arrived slot AND reopen it. In the issued-row model an open slot is
-- a real 'issued' row, so freeing a claimed slot tombstones it (released_at kept for
-- audit; its credential now resolves to a released row → the console rejects that old
-- QR) and mints a fresh 'issued' replacement so the slot shows as open and forwardable
-- again with a NEW credential. Replaces the door free-slot route's inline released_at
-- write so the reopen is atomic.
create or replace function public.release_ticket(p_ticket_id uuid, p_event_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row record;
begin
  SELECT id, registration_id, event_id, ticket_type_id, is_lead, checked_in_at,
         released_at, slot_status
    INTO v_row
  FROM public.tickets
  WHERE id = p_ticket_id AND event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.slot_status <> 'claimed' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.is_lead THEN
    RETURN jsonb_build_object('status', 'is_lead');
  END IF;
  IF v_row.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'checked_in');
  END IF;
  IF v_row.released_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'already', true);
  END IF;

  UPDATE public.tickets
    SET released_at = now()
  WHERE id = p_ticket_id AND checked_in_at IS NULL AND released_at IS NULL
    AND is_lead = false;
  IF NOT FOUND THEN
    -- Lost a race with a concurrent check-in.
    RETURN jsonb_build_object('status', 'checked_in');
  END IF;

  -- Mint a fresh issued replacement so the freed slot reopens (new credential).
  INSERT INTO public.tickets
    (event_id, registration_id, ticket_type_id, slot_status, credential_token)
  VALUES
    (v_row.event_id, v_row.registration_id, v_row.ticket_type_id, 'issued',
     replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'));

  RETURN jsonb_build_object('status', 'ok', 'already', false);
end;
$function$;

revoke all on function public.release_ticket(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_ticket(uuid, uuid) to service_role;
