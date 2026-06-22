-- FEAT-41 / U5 — Forward a batch of tickets to a delegate (one level).
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- ADDITIVE: a batch_token column scoping a forwarded set of tickets, a
-- forward_ticket_batch RPC (lead stamps N of their tickets with a fresh batch token),
-- and fill_batch_ticket (delegate names a ticket, scoped to that batch — a ticket id
-- outside the batch is rejected). One level only: the delegate page has no re-forward.

alter table public.tickets add column if not exists batch_token text;
create index if not exists tickets_batch_token_idx
  on public.tickets (batch_token) where batch_token is not null;

-- Lead forwards N of their tickets: stamps a fresh batch token on the eligible ones
-- (belong to this booking, not released, not yet checked in). Returns the token so
-- the route can build the delegate link + email. Re-forwarding a ticket re-stamps it.
create or replace function public.forward_ticket_batch(p_manage_token text, p_ticket_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg   record;
  v_token text;
  v_count integer;
begin
  IF p_manage_token IS NULL OR length(trim(p_manage_token)) = 0
     OR p_ticket_ids IS NULL OR array_length(p_ticket_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT id, status INTO v_reg
  FROM public.event_registrations
  WHERE manage_token = p_manage_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  v_token := replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_');

  UPDATE public.tickets
    SET batch_token = v_token
  WHERE registration_id = v_reg.id
    AND id = ANY(p_ticket_ids)
    AND released_at IS NULL
    AND checked_in_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('status', 'none', 'count', 0);
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'batch_token', v_token, 'count', v_count);
end;
$function$;

revoke all on function public.forward_ticket_batch(text, uuid[]) from public, anon, authenticated;
grant execute on function public.forward_ticket_batch(text, uuid[]) to service_role;

-- Delegate names one ticket in their batch. Scoped + authorised by the batch token;
-- a ticket id NOT carrying this batch token is rejected (a delegate cannot touch the
-- lead's other tickets or another delegate's batch). Same field rules as fill_ticket.
create or replace function public.fill_batch_ticket(
  p_batch_token text,
  p_ticket_id uuid,
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
  v_reg_id   uuid;
  v_reg      record;
  v_ticket   record;
  v_is_child boolean;
  v_email    text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone    text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name     text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign     boolean;
  v_now      timestamptz := now();
begin
  IF p_batch_token IS NULL OR length(trim(p_batch_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT registration_id INTO v_reg_id
  FROM public.tickets
  WHERE batch_token = p_batch_token AND registration_id IS NOT NULL
  LIMIT 1;
  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT id, status INTO v_reg
  FROM public.event_registrations WHERE id = v_reg_id FOR UPDATE;
  IF v_reg.status NOT IN ('paid', 'free') THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  -- The ticket must carry THIS batch token (rejects ids outside the batch).
  SELECT t.id, t.ticket_type_id, t.is_child, tt.is_child AS type_is_child
    INTO v_ticket
  FROM public.tickets t
  LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.id = p_ticket_id
    AND t.batch_token = p_batch_token
    AND t.released_at IS NULL
  FOR UPDATE OF t;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'name');
  END IF;

  v_is_child := COALESCE(v_ticket.type_is_child, v_ticket.is_child, false);
  IF NOT v_is_child AND v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  UPDATE public.tickets SET
    slot_status        = 'claimed',
    name               = v_name,
    email              = v_email,
    phone_e164         = v_phone,
    is_child           = v_is_child,
    waiver_version     = COALESCE(CASE WHEN v_sign THEN p_waiver_version END, waiver_version),
    waiver_accepted_at = COALESCE(CASE WHEN v_sign THEN v_now END, waiver_accepted_at),
    language           = COALESCE(CASE WHEN v_sign THEN NULLIF(p_language, '') END, language),
    marketing_consent  = COALESCE(p_marketing_consent, marketing_consent)
  WHERE id = v_ticket.id;

  RETURN jsonb_build_object('status', 'claimed', 'attendee_id', v_ticket.id, 'name', v_name);
end;
$function$;

revoke all on function public.fill_batch_ticket(text, uuid, text, text, text, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.fill_batch_ticket(text, uuid, text, text, text, text, text, boolean, boolean)
  to service_role;
