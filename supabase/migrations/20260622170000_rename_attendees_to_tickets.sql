-- FEAT-41 / U1 — Rename event_attendees → tickets; add per-ticket QR credential + 'issued' state.
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- SHARED dev/prod DB. This migration is GATED to merge+deploy: it renames a live
-- table and MUST be applied together with the code that repoints event_attendees →
-- tickets. A transitional `event_attendees` VIEW aliases `tickets` so any prod code
-- surviving the apply→redeploy gap still resolves (reads AND writes, via an
-- auto-updatable security_invoker view). The view is DROPPED in a follow-up
-- migration once the repoint has deployed.
--
-- ADDITIVE:  credential_token column, 'issued' slot_status value, backfilled issued
--            rows, retro-credentials for in-flight named tickets.
-- BREAKING:  table rename (bridged by the view) and the constraint relaxations.
--
-- TYPES: after applying, regenerate types/database.ts and RE-APPEND the hand-written
--        MemberStatus / PaymentCaptureStatus aliases (Supabase regen drops them).

begin;

-- 1. Rename the table. The PK, all 4 FKs, the 6 indexes, and the one-lead partial
--    unique index carry over automatically (same physical relation, names retained).
alter table public.event_attendees rename to tickets;

-- 2. Per-ticket bearer credential (the QR payload). CSPRNG token, set at mint.
--    Partial unique index on non-null so many credential-less rows can coexist
--    (mirrors the self_reg_token / claim-token shape).
alter table public.tickets add column if not exists credential_token text;
create unique index if not exists tickets_credential_token_key
  on public.tickets (credential_token) where credential_token is not null;

-- 3. slot_status: add 'issued' (minted, has credential, no name yet). Keep the
--    existing 'unclaimed' (legacy open-slot) and 'claimed' (filled/named) values
--    UNCHANGED so every existing .eq('slot_status','claimed') read keeps working.
alter table public.tickets drop constraint if exists event_attendees_slot_status_check;
alter table public.tickets add constraint tickets_slot_status_check
  check (slot_status = any (array['unclaimed'::text, 'claimed'::text, 'issued'::text]));

-- 4. Relax the name/contact guards so an 'issued' row may hold a credential with no
--    name/contact (like 'unclaimed'), while keeping the invariant for 'claimed'.
alter table public.tickets drop constraint if exists event_attendees_claimed_named;
alter table public.tickets add constraint tickets_claimed_named
  check (slot_status in ('unclaimed', 'issued') or name is not null);

alter table public.tickets drop constraint if exists event_attendees_contact_present;
alter table public.tickets add constraint tickets_contact_present
  check (
    slot_status in ('unclaimed', 'issued')
    or email is not null
    or phone_e164 is not null
    or checked_in_at is not null
    or is_child = true
  );

-- (event_attendees_email_lower carries over unchanged under the rename.)

-- 5. Repoint every SECURITY DEFINER RPC that names public.event_attendees onto
--    public.tickets. Bodies are otherwise unchanged from their current definitions
--    (insert-on-claim stays until U3 replaces claim_self_registration). Repointing
--    here — rather than leaning on the transitional view — keeps the RPCs free of
--    any dependency on that view, so dropping the view later is safe.

create or replace function public.seed_lead_attendee(p_registration_id uuid, p_phone_e164 text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  INSERT INTO public.tickets
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id)
  SELECT r.event_id, r.id, r.member_id, r.name, lower(trim(r.email)),
         COALESCE(p_phone_e164, r.phone_e164), true, 'claimed', r.lead_ticket_type_id
  FROM public.event_registrations r
  WHERE r.id = p_registration_id
    AND r.status IN ('paid', 'free')
    AND trim(COALESCE(r.name, '')) <> ''
    AND trim(COALESCE(r.email, '')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets a
      WHERE a.registration_id = r.id AND a.is_lead = true
    );
END;
$function$;

create or replace function public.add_self_registration_children(p_token text, p_names text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_reg         record;
  v_child_count integer;
  v_child_type  uuid;
  v_purchased   integer;
  v_claimed     integer;
  v_remaining   integer;
  v_added       integer := 0;
  v_name        text;
  v_clean       text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT id, event_id, status INTO v_reg
  FROM public.event_registrations
  WHERE self_reg_token = p_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_reg.status NOT IN ('paid', 'free') THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  SELECT count(DISTINCT ri.ticket_type_id),
         (array_agg(DISTINCT ri.ticket_type_id))[1]
    INTO v_child_count, v_child_type
  FROM public.event_registration_items ri
  JOIN public.event_ticket_types tt ON tt.id = ri.ticket_type_id
  WHERE ri.registration_id = v_reg.id AND tt.is_child;

  IF v_child_count = 0 THEN
    RETURN jsonb_build_object('status', 'no_child_tickets', 'added', 0);
  END IF;
  IF v_child_count > 1 THEN
    RETURN jsonb_build_object('status', 'multiple_child_types', 'added', 0);
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO v_purchased
  FROM public.event_registration_items
  WHERE registration_id = v_reg.id AND ticket_type_id = v_child_type;

  SELECT count(*) INTO v_claimed
  FROM public.tickets
  WHERE registration_id = v_reg.id AND slot_status = 'claimed'
    AND released_at IS NULL AND ticket_type_id = v_child_type;

  v_remaining := v_purchased - v_claimed;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('status', 'full', 'added', 0);
  END IF;

  FOREACH v_name IN ARRAY COALESCE(p_names, ARRAY[]::text[]) LOOP
    EXIT WHEN v_added >= v_remaining;
    v_clean := NULLIF(trim(v_name), '');
    IF v_clean IS NULL THEN CONTINUE; END IF;
    -- Flip an issued child slot to claimed (FEAT-41) so the kid keeps the credential
    -- minted at purchase and gets a QR like any other ticket (R13). Fallback insert
    -- WITH a credential when no issued row exists, so the invariant still holds.
    UPDATE public.tickets
      SET slot_status = 'claimed', name = v_clean, is_child = true
    WHERE id = (
      SELECT id FROM public.tickets
      WHERE registration_id = v_reg.id AND ticket_type_id = v_child_type
        AND slot_status = 'issued' AND released_at IS NULL
      ORDER BY created_at
      LIMIT 1
    );
    IF NOT FOUND THEN
      INSERT INTO public.tickets
        (event_id, registration_id, name, is_lead, slot_status, ticket_type_id,
         is_child, credential_token)
      VALUES
        (v_reg.event_id, v_reg.id, v_clean, false, 'claimed', v_child_type, true,
         replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'));
    END IF;
    v_added := v_added + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'added', v_added,
                            'remaining', v_remaining - v_added);
END;
$function$;

create or replace function public.import_event_attendees(p_event_id uuid, p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_index   integer := -1;
  v_name    text;
  v_email   text;
  v_phone   text;
  v_phone_match_id uuid;
  v_email_match_id uuid;
  v_match_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_array(
      jsonb_build_object('index', 0, 'status', 'error', 'message', 'Event not found')
    );
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_index := v_index + 1;

    v_name  := NULLIF(trim(COALESCE(v_row->>'name', '')), '');
    v_email := lower(NULLIF(trim(COALESCE(v_row->>'email', '')), ''));
    v_phone := NULLIF(trim(COALESCE(v_row->>'phone_e164', '')), '');

    IF v_email IS NULL AND v_phone IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', 'No phone or email'
      );
      CONTINUE;
    END IF;

    IF v_name IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', 'Name is required'
      );
      CONTINUE;
    END IF;

    BEGIN
      -- Match each channel independently so a cross-write (phone -> A, email -> B)
      -- errors instead of silently splitting identity.
      v_phone_match_id := NULL;
      v_email_match_id := NULL;

      IF v_phone IS NOT NULL THEN
        SELECT a.id INTO v_phone_match_id
        FROM public.tickets a
        WHERE a.event_id = p_event_id AND a.phone_e164 = v_phone
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1;
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT a.id INTO v_email_match_id
        FROM public.tickets a
        WHERE a.event_id = p_event_id AND lower(a.email) = v_email
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1;
      END IF;

      IF v_phone_match_id IS NOT NULL AND v_email_match_id IS NOT NULL
         AND v_phone_match_id <> v_email_match_id THEN
        v_results := v_results || jsonb_build_object(
          'index', v_index, 'status', 'error',
          'message', 'Phone and email match different attendees'
        );
        CONTINUE;
      END IF;

      v_match_id := COALESCE(v_phone_match_id, v_email_match_id);

      IF v_match_id IS NOT NULL THEN
        UPDATE public.tickets
        SET
          email      = COALESCE(email, v_email),
          phone_e164 = COALESCE(phone_e164, v_phone)
        WHERE id = v_match_id;

        v_results := v_results || jsonb_build_object('index', v_index, 'status', 'merged');
      ELSE
        INSERT INTO public.tickets
          (event_id, name, email, phone_e164, is_lead, slot_status)
        VALUES
          (p_event_id, v_name, v_email, v_phone, false, 'claimed');

        v_results := v_results || jsonb_build_object('index', v_index, 'status', 'inserted');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'status', 'error', 'message', SQLERRM
      );
    END;
  END LOOP;

  RETURN v_results;
END;
$function$;

create or replace function public.claim_self_registration(p_token text, p_name text, p_email text, p_phone_e164 text, p_language text, p_waiver_version text, p_waiver_accepted boolean, p_marketing_consent boolean, p_ticket_type_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
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
  v_type_purchased integer;
  v_type_claimed   integer;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT id, event_id, quantity, status
    INTO v_reg
  FROM public.event_registrations
  WHERE self_reg_token = p_token
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
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'reason', 'contact');
  END IF;

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT id INTO v_ticket
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = v_reg.event_id;
  ELSE
    SELECT count(DISTINCT ticket_type_id), (array_agg(DISTINCT ticket_type_id))[1]
      INTO v_typecount, v_onlytype
    FROM public.event_registration_items
    WHERE registration_id = v_reg.id;
    IF v_typecount = 1 THEN
      v_ticket := v_onlytype;
    END IF;
  END IF;

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
      UPDATE public.tickets
        SET ticket_type_id = v_ticket
        WHERE id = v_existing.id;
    END IF;
    RETURN jsonb_build_object(
      'status', 'claimed',
      'attendee_id', v_existing.id,
      'name', v_existing.name,
      'already', true
    );
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tickets
  WHERE registration_id = v_reg.id
    AND slot_status = 'claimed'
    AND released_at IS NULL;

  IF v_count >= COALESCE(v_reg.quantity, 0) THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

  IF v_ticket IS NOT NULL THEN
    SELECT COALESCE(sum(quantity), 0) INTO v_type_purchased
    FROM public.event_registration_items
    WHERE registration_id = v_reg.id AND ticket_type_id = v_ticket;

    SELECT count(*) INTO v_type_claimed
    FROM public.tickets
    WHERE registration_id = v_reg.id
      AND slot_status = 'claimed'
      AND released_at IS NULL
      AND ticket_type_id = v_ticket;

    IF v_type_claimed >= v_type_purchased THEN
      RETURN jsonb_build_object('status', 'type_full');
    END IF;
  END IF;

  v_sign := COALESCE(p_waiver_accepted, false) AND p_waiver_version IS NOT NULL;

  INSERT INTO public.tickets
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id, waiver_version, waiver_accepted_at, language,
     marketing_consent)
  VALUES
    (v_reg.event_id, v_reg.id, NULL, v_name, v_email, v_phone, false,
     'claimed', v_ticket,
     CASE WHEN v_sign THEN p_waiver_version END,
     CASE WHEN v_sign THEN v_now END,
     CASE WHEN v_sign THEN NULLIF(p_language, '') END,
     CASE WHEN v_sign THEN COALESCE(p_marketing_consent, true) END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'attendee_id', v_id,
    'name', v_name,
    'already', false
  );
END;
$function$;

-- 6. Transitional alias so prod code referencing event_attendees survives the
--    apply→redeploy gap. security_invoker = true so the view respects the CALLER's
--    RLS (never the owner's) — without it the view would bypass tickets' RLS and
--    leak rows to anon/authenticated. The admin client (service_role) bypasses RLS
--    as before. Auto-updatable simple view, so INSERT/UPDATE/DELETE from
--    un-redeployed code still pass through to tickets. DROPPED in a follow-up
--    migration once the repoint deploys.
create view public.event_attendees with (security_invoker = true) as
  select * from public.tickets;

grant select, insert, update, delete on public.event_attendees to service_role;

-- 7. Backfill, scoped to in-flight events (event not yet ended) so we don't mint
--    credentials for long-past events. Two steps:
--    (a) one 'issued' row per unsold slot per ticket type, each with a credential;
--    (b) a credential for any already-named (claimed) in-flight ticket lacking one,
--        so existing holders can also use QR check-in (R1 — every ticket a QR).
--    Token: 24 CSPRNG bytes → base64url (matches generateSelfRegToken()).
insert into public.tickets
  (event_id, registration_id, ticket_type_id, slot_status, credential_token)
select r.event_id, r.id, it.ticket_type_id, 'issued',
       replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
from public.event_registrations r
join public.events e on e.id = r.event_id
cross join lateral (
  select ri.ticket_type_id,
         sum(ri.quantity)::int as purchased,
         (
           select count(*) from public.tickets t
           where t.registration_id = r.id
             and t.ticket_type_id = ri.ticket_type_id
             and t.released_at is null
         ) as existing
  from public.event_registration_items ri
  where ri.registration_id = r.id
  group by ri.ticket_type_id
) it
cross join lateral generate_series(1, greatest(it.purchased - it.existing, 0)) gs
where r.status in ('paid', 'free')
  and coalesce(e.end_date, e.start_date) >= current_date;

update public.tickets t
set credential_token =
      replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
from public.event_registrations r
join public.events e on e.id = r.event_id
where t.registration_id = r.id
  and t.credential_token is null
  and r.status in ('paid', 'free')
  and coalesce(e.end_date, e.start_date) >= current_date;

commit;
