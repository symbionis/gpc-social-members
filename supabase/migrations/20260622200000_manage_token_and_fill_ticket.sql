-- FEAT-41 / U4 — Lead "My Booking" page: manage_token + per-ticket fill by id.
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- ADDITIVE: new manage_token column (path-secret for the lead booking page, mirrors
-- self_reg_token) + a fill_ticket RPC that names ONE specific ticket by id (so each
-- QR stays bound to the name the lead typed next to it). Backfills manage_token for
-- in-flight registrations so existing leads can reach their page.

alter table public.event_registrations add column if not exists manage_token text;
create unique index if not exists event_registrations_manage_token_uniq
  on public.event_registrations (manage_token) where manage_token is not null;

update public.event_registrations r
set manage_token =
      replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
from public.events e
where r.event_id = e.id
  and r.manage_token is null
  and r.status in ('paid', 'free')
  and coalesce(e.end_date, e.start_date) >= current_date;

-- Fill ONE specific ticket (by id) on the lead booking page, scoped + authorised by
-- the booking's manage_token. Unlike claim_ticket (door: flip any issued row of a
-- type), this names the exact ticket the lead is looking at, so its credential/QR
-- stays bound to that person. Re-editable: naming an already-named ticket updates it.
-- No cap check needed — the row is already a purchased slot; issued→claimed doesn't
-- add capacity. Child tickets are name-only; contact required otherwise.
create or replace function public.fill_ticket(
  p_manage_token text,
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
  v_reg      record;
  v_ticket   record;
  v_is_child boolean;
  v_email    text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone    text := NULLIF(trim(COALESCE(p_phone_e164, '')), '');
  v_name     text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_sign     boolean;
  v_now      timestamptz := now();
begin
  IF p_manage_token IS NULL OR length(trim(p_manage_token)) = 0 THEN
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

  -- The ticket must belong to THIS booking, not be a released tombstone, and not be
  -- already checked in — an arrived guest's identity is immutable (mirrors
  -- release_ticket / forward_ticket_batch, which both refuse checked-in rows).
  SELECT t.id, t.ticket_type_id, t.is_child, tt.is_child AS type_is_child
    INTO v_ticket
  FROM public.tickets t
  LEFT JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.id = p_ticket_id
    AND t.registration_id = v_reg.id
    AND t.released_at IS NULL
    AND t.checked_in_at IS NULL
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

revoke all on function public.fill_ticket(text, uuid, text, text, text, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.fill_ticket(text, uuid, text, text, text, text, text, boolean, boolean)
  to service_role;
