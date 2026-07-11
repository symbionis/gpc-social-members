-- FIX — claim_ticket's replay guard keyed on contact alone, so two different people
-- sharing an email collapsed into one ticket.
--
-- THE BUG
-- claim_ticket is the "fill an open slot" RPC. Before naming a new ticket it looks for a
-- prior claim on the same registration, so a double-submit, a network retry, or a
-- back-and-resubmit returns the existing row instead of burning a second slot. That guard
-- is right, but it matched on CONTACT ALONE:
--
--     (v_email IS NOT NULL AND lower(email) = v_email)
--     OR (v_phone IS NOT NULL AND phone_e164 = v_phone)
--
-- Two different people legitimately share an address — a couple, a family, a booker who
-- puts their own email on the whole party. Keying only on contact reads the SECOND person
-- as a replay of the FIRST: the RPC returns {status: claimed, already: true} naming the
-- first person, never claims a slot for the second, and every caller treats that as
-- success. The guest silently does not exist, and is turned away at the door.
--
-- Three live callers hit this:
--   1. claim_self_registration — a guest fills their own name via the party link
--   2. /api/public/door/[id]/save-attendee — staff typing a walk-up into an open slot
--   3. fillRegistrationRoster (lib/events/roster.ts) — the FREE checkout path, one
--      claim_ticket per guest the booker named. A booker who reuses their address across
--      guests loses every guest after the first.
-- (The paid checkout path goes through apply_pending_roster, which does not dedupe, which
-- is why paid group bookings on one email have all their tickets.)
--
-- THE FIX
-- Identity is name + contact, not contact. A replay is the SAME PERSON claiming twice:
-- same name AND same contact. A different name on the same address is a different person
-- and gets their own slot. Name is compared case- and whitespace-insensitively.
--
-- THE TRADE, STATED PLAINLY
-- This narrows the guard, so it can now under-dedupe: one person retrying with a
-- differently-spelled name ("Max" then "Max Pinter-Krainer") consumes a second slot. That
-- failure is BOUNDED — the cap check immediately below refuses to exceed the party's
-- purchased quantity — VISIBLE (the party shows an extra named guest), and RECOVERABLE
-- (staff release the slot). The failure it replaces is silent, loses a real guest, and is
-- discovered at the gate. Under-dedupe beats losing a person.

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

  IF NOT v_is_child AND v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  -- Replay guard. Identity = NAME + contact (see the header). Matching on contact alone
  -- silently swallowed the second of two people sharing an address.
  --
  -- The name comparison folds case AND collapses internal whitespace, so "Alice Smith",
  -- "alice smith" and "Alice  Smith" are one person on a retry. trim() alone is not
  -- enough: it strips the ends, not a double space in the middle, and a retry typed with
  -- sloppy spacing would burn a second slot.
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

revoke all on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_ticket(uuid, text, text, text, text, text, boolean, boolean, uuid)
  to service_role;
