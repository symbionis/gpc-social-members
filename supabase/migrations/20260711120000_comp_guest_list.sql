-- FEAT — Admin comp guest list (U1). Schema + three write RPCs.
-- Plan: docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md
--
-- A sponsor's comp list is a REAL registration (status 'free', CHF 0 line items) so
-- the door console understands it with no door-side change (KTD7). Three things the
-- existing schema cannot express are added here:
--
--   1. event_registrations.is_guest_list — a comp list is not a waitlist comp; both
--      are status='free' with converted_by set, so an explicit flag is needed (KTD4).
--   2. tickets.is_comp — tickets_contact_present today allows a 'claimed' row only
--      with an email, a phone, an arrival, or is_child. A name-only adult comp guest
--      (the feature's central case) satisfies none and raises 23514. The widening must
--      be COLUMN-LOCAL because Postgres forbids subqueries in a CHECK constraint, so a
--      lookup back to event_registrations.is_guest_list is not an option (KTD3).
--   3. comp_guest_batches — the durable replay guard for add_comp_guests. A FOR UPDATE
--      lock serialises two identical submits; it does not dedupe them (KTD2).
--
-- The RPCs ORCHESTRATE the existing registration RPCs (create_event_registration,
-- seed_lead_attendee, mint_registration_tickets) rather than restating them (KTD1).
-- Only claim_ticket is not reused: it rejects a contactless adult outright and dedupes
-- on email or phone, neither of which a name-only comp guest has — so naming a guest
-- writes directly to the freshly minted 'issued' row.
--
-- SHARED dev/prod DB. Every change here is BACKWARD-COMPATIBLE: two defaulted columns,
-- one new table, a constraint widening every existing row already satisfies, and three
-- new functions. The migration landing before the app deploys breaks nothing.
--
-- TYPES: types/database.ts is hand-edited to match. If it is ever regenerated,
--        RE-APPEND the hand-written MemberStatus / PaymentCaptureStatus aliases.

begin;

-- ---------------------------------------------------------------------------
-- 1. Flags
-- ---------------------------------------------------------------------------
alter table public.event_registrations
  add column if not exists is_guest_list boolean not null default false;

alter table public.tickets
  add column if not exists is_comp boolean not null default false;

-- Widen tickets_contact_present with one further disjunct so a contactless NAMED comp
-- ticket is legal. Same shape as 20260604150000_allow_contactless_arrival.sql: every
-- existing row still satisfies the wider constraint. tickets_claimed_named is left
-- alone — a comp guest always has a name.
alter table public.tickets
  drop constraint if exists tickets_contact_present;

alter table public.tickets
  add constraint tickets_contact_present check (
    slot_status in ('unclaimed', 'issued')
    or email is not null
    or phone_e164 is not null
    or checked_in_at is not null
    or is_child = true
    or is_comp = true
  );

-- ---------------------------------------------------------------------------
-- 2. Replay guard for add_comp_guests (KTD2)
-- ---------------------------------------------------------------------------
-- A client-side submitting flag is not a retry guard: it does not survive a network
-- retry, a proxy retry, or a back-and-resubmit. The key is persisted, so a replay
-- returns the prior result and adds nothing. RLS is enabled with NO policies — the
-- app touches this table only through the service_role admin client, which bypasses
-- RLS (same shape as event_registration_topups).
create table if not exists public.comp_guest_batches (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  idempotency_key text not null,
  guests_added    integer not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.comp_guest_batches enable row level security;

create unique index if not exists comp_guest_batches_registration_key_uniq
  on public.comp_guest_batches (registration_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- 3. claim_comp_guest_slot
-- ---------------------------------------------------------------------------
-- Name ONE guest onto ONE of their party's freshly minted 'issued' slots. Shared by
-- create_comp_guest_list and add_comp_guests, which each carried a byte-identical copy
-- of this block. p_caller is used ONLY as the RAISE prefix, so both keep their own error
-- strings unchanged.
--
-- The caller has already locked the registration and resolved every ticket_type_id
-- against the event, so this only parses the guest, takes a slot of the requested type,
-- and names it.
--
-- is_child comes from the TYPE, never from client input — and is read in the SAME
-- statement that takes the slot (UPDATE ... FROM event_ticket_types). The lookup used to
-- be a separate SELECT per guest even though it is keyed only on the type, so a sponsor
-- list of forty guests across three types re-ran it forty times while holding the
-- registration lock.
--
-- The slot is taken with a deterministic order + FOR UPDATE, so two guests on the same
-- type can never grab the same row. Naming the slot IN PLACE keeps the credential minted
-- for it, so a later resend delivers a working QR. is_comp is what makes a contactless
-- adult legal here (tickets_contact_present, widened above).
create or replace function public.claim_comp_guest_slot(
  p_registration_id uuid,
  p_guest           jsonb,
  p_caller          text
)
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
         is_comp     = true,
         is_child    = coalesce(tt.is_child, false)
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

  -- Per-guest, and named: which guest ran the type out is what the admin has to fix.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      '%: no issued ticket available for type % (guest %)',
      p_caller, v_guest_type, v_guest_name;
  END IF;
end;
$function$;

revoke all on function public.claim_comp_guest_slot(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.claim_comp_guest_slot(uuid, jsonb, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. create_comp_guest_list
-- ---------------------------------------------------------------------------
-- Build a whole comp party in one transaction: registration + CHF 0 line items (one
-- per DISTINCT ticket type) + the lead's ticket + one named, claimed, is_comp ticket
-- per guest.
--
-- p_lead   = {name, email, ticket_type_id, phone_e164?}
-- p_guests = [{name, ticket_type_id, email?, phone_e164?}, ...]
--
-- Every supplied ticket_type_id is resolved against event_ticket_types SCOPED TO THIS
-- EVENT with archived_at IS NULL. Nothing else validates this: a ticket's type is a
-- bare foreign key with no event scoping, so an unscoped id would render as a blank
-- ticket-type pill at the door and silently drop the child flag.
--
-- self_reg_token is deliberately left NULL — a comp party must not expose a public
-- self-registration link. Duplicate creation is caught by the existing partial unique
-- index on (event_id, lower(email)) for paid/free, which raises 23505 and rolls the
-- whole function back, leaving no partial registration.
create or replace function public.create_comp_guest_list(
  p_event_id       uuid,
  p_lead           jsonb,
  p_guests         jsonb,
  p_reference_code text,
  p_converted_by   uuid
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_registration_id uuid;
  v_guests          jsonb   := coalesce(p_guests, '[]'::jsonb);
  v_lead_name       text;
  v_lead_email      text;
  v_lead_phone      text;
  v_lead_type       uuid;
  v_active_types    integer;
  v_items           jsonb;
  v_guest           jsonb;
begin
  v_lead_name  := nullif(trim(coalesce(p_lead->>'name', '')), '');
  v_lead_email := nullif(lower(trim(coalesce(p_lead->>'email', ''))), '');
  v_lead_phone := nullif(trim(coalesce(p_lead->>'phone_e164', '')), '');
  v_lead_type  := nullif(trim(coalesce(p_lead->>'ticket_type_id', '')), '')::uuid;

  IF v_lead_name IS NULL OR v_lead_email IS NULL THEN
    RAISE EXCEPTION 'create_comp_guest_list: the lead requires a name and an email';
  END IF;

  -- An event with no active ticket types cannot carry a comp list at all.
  SELECT count(*) INTO v_active_types
  FROM public.event_ticket_types
  WHERE event_id = p_event_id AND archived_at IS NULL;

  IF v_active_types = 0 THEN
    RAISE EXCEPTION 'create_comp_guest_list: event % has no active ticket types', p_event_id;
  END IF;

  -- Every ticket_type_id (the lead's and every guest's) must resolve on THIS event and
  -- must not be archived. A missing id is a refusal too.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT v_lead_type AS tt
      UNION ALL
      SELECT nullif(trim(coalesce(g->>'ticket_type_id', '')), '')::uuid
      FROM jsonb_array_elements(v_guests) AS g
    ) s
    WHERE s.tt IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.event_ticket_types t
         WHERE t.id = s.tt AND t.event_id = p_event_id AND t.archived_at IS NULL
       )
  ) THEN
    RAISE EXCEPTION
      'create_comp_guest_list: every ticket_type_id must be an active ticket type of event %',
      p_event_id;
  END IF;

  -- One CHF 0 line item per DISTINCT ticket type, quantity = the number of PEOPLE on
  -- that type (the lead counts). create_event_registration derives the registration's
  -- quantity and total from these.
  SELECT jsonb_agg(jsonb_build_object(
           'ticket_type_id',  s.tt,
           'title_snapshot',  t.title,
           'quantity',        s.qty,
           'unit_amount_chf', 0,
           'line_total_chf',  0
         ))
    INTO v_items
  FROM (
    SELECT people.tt, count(*)::int AS qty
    FROM (
      SELECT v_lead_type AS tt
      UNION ALL
      SELECT (g->>'ticket_type_id')::uuid
      FROM jsonb_array_elements(v_guests) AS g
    ) people
    GROUP BY people.tt
  ) s
  JOIN public.event_ticket_types t ON t.id = s.tt;

  v_registration_id := public.create_event_registration(
    p_event_id,
    v_lead_name,
    v_lead_email,
    false,             -- p_is_member: a comp list's lead is a sponsor contact, not a member
    NULL::uuid,        -- p_member_id
    'free',            -- p_status
    p_reference_code,
    now(),             -- p_paid_at: a comp list is settled on creation
    p_converted_by,
    v_items
  );

  -- lead_ticket_type_id must be set BEFORE seed_lead_attendee — that is where the lead's
  -- ticket gets its type from (R4: the lead's own type, not the event's first type).
  -- self_reg_token stays NULL: no public self-registration link for a comp party.
  UPDATE public.event_registrations
     SET is_guest_list       = true,
         lead_ticket_type_id = v_lead_type,
         manage_token        = replace(replace(
           encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
   WHERE id = v_registration_id;

  -- Serialise anything else touching this party for the rest of the transaction.
  PERFORM 1 FROM public.event_registrations WHERE id = v_registration_id FOR UPDATE;

  PERFORM public.seed_lead_attendee(v_registration_id, v_lead_phone);

  UPDATE public.tickets
     SET is_comp = true
   WHERE registration_id = v_registration_id AND is_lead = true;

  -- Mints (purchased − existing) 'issued' rows per type. The lead's ticket already
  -- exists, so this mints exactly one credentialled slot per guest.
  PERFORM public.mint_registration_tickets(v_registration_id);

  FOR v_guest IN SELECT * FROM jsonb_array_elements(v_guests)
  LOOP
    PERFORM public.claim_comp_guest_slot(v_registration_id, v_guest, 'create_comp_guest_list');
  END LOOP;

  RETURN v_registration_id;
end;
$function$;

revoke all on function public.create_comp_guest_list(uuid, jsonb, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_comp_guest_list(uuid, jsonb, jsonb, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. add_comp_guests
-- ---------------------------------------------------------------------------
-- Add guests to an EXISTING comp list: line items + quantity bump + mint + name, under
-- the registration lock. Idempotent on (registration_id, idempotency_key): a replay
-- returns the prior guests_added unchanged and writes nothing (KTD2). Shape mirrors
-- apply_registration_topup's locked bump-quantity-and-insert-items.
create or replace function public.add_comp_guests(
  p_registration_id uuid,
  p_idempotency_key text,
  p_guests          jsonb
)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg         record;
  v_guests      jsonb   := coalesce(p_guests, '[]'::jsonb);
  v_key         text    := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_prior       integer;
  v_count       integer;
  v_guest       jsonb;
begin
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'add_comp_guests: an idempotency key is required';
  END IF;

  SELECT id, event_id, is_guest_list INTO v_reg
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'add_comp_guests: registration % not found', p_registration_id;
  END IF;
  IF NOT v_reg.is_guest_list THEN
    RAISE EXCEPTION 'add_comp_guests: registration % is not a comp guest list', p_registration_id;
  END IF;

  -- Replay guard: the key is already recorded, so this request already ran.
  SELECT b.guests_added INTO v_prior
  FROM public.comp_guest_batches b
  WHERE b.registration_id = p_registration_id AND b.idempotency_key = v_key;

  IF FOUND THEN
    RETURN v_prior;
  END IF;

  v_count := jsonb_array_length(v_guests);

  IF v_count > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_guests) AS g
      WHERE nullif(trim(coalesce(g->>'ticket_type_id', '')), '')::uuid IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public.event_ticket_types t
           WHERE t.id = (g->>'ticket_type_id')::uuid
             AND t.event_id = v_reg.event_id
             AND t.archived_at IS NULL
         )
    ) THEN
      RAISE EXCEPTION
        'add_comp_guests: every ticket_type_id must be an active ticket type of event %',
        v_reg.event_id;
    END IF;

    -- One CHF 0 line item per distinct type among the NEW guests. There is no unique
    -- index on (registration_id, ticket_type_id): a repeated type simply adds another
    -- item row, and mint_registration_tickets sums them per type.
    INSERT INTO public.event_registration_items
      (registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf)
    SELECT p_registration_id, s.tt, t.title, s.qty, 0, 0
    FROM (
      SELECT (g->>'ticket_type_id')::uuid AS tt, count(*)::int AS qty
      FROM jsonb_array_elements(v_guests) AS g
      GROUP BY 1
    ) s
    JOIN public.event_ticket_types t ON t.id = s.tt;

    -- The bump is what makes the new slots mintable and fillable — the door roster and
    -- the per-party cap both derive capacity from quantity.
    UPDATE public.event_registrations
       SET quantity = coalesce(quantity, 0) + v_count
     WHERE id = p_registration_id;

    PERFORM public.mint_registration_tickets(p_registration_id);

    FOR v_guest IN SELECT * FROM jsonb_array_elements(v_guests)
    LOOP
      PERFORM public.claim_comp_guest_slot(p_registration_id, v_guest, 'add_comp_guests');
    END LOOP;
  END IF;

  -- Durable record of this request. The unique index on (registration_id,
  -- idempotency_key) is the backstop if two replays race past the read above.
  INSERT INTO public.comp_guest_batches (registration_id, idempotency_key, guests_added)
  VALUES (p_registration_id, v_key, v_count);

  RETURN v_count;
end;
$function$;

revoke all on function public.add_comp_guests(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.add_comp_guests(uuid, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. remove_comp_guest
-- ---------------------------------------------------------------------------
-- Removing a comp guest SHRINKS THE PARTY. This is why release_ticket is not reused
-- (KTD5): release_ticket tombstones the row and then mints a fresh 'issued'
-- replacement, and never touches quantity or the line items — correct for the door,
-- where reopening a freed slot is the point, and wrong here. Reused unchanged it would
-- leave the seat consumed, keep the guest counted in `expected` forever, and hand the
-- sponsor's party a self-registerable open slot on the public door page.
--
-- Keeps release_ticket's refusals (never the lead, never a checked-in ticket), mints NO
-- replacement, and decrements both quantity and the matching line item, so the seat is
-- genuinely returned to the event (R10) and the party is left with no open slot.
create or replace function public.remove_comp_guest(p_registration_id uuid, p_ticket_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg  record;
  v_row  record;
  v_item record;
begin
  SELECT id, is_guest_list INTO v_reg
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_reg.is_guest_list THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT id, ticket_type_id, is_lead, checked_in_at, released_at
    INTO v_row
  FROM public.tickets
  WHERE id = p_ticket_id AND registration_id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
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

  -- Tombstone (released_at kept for audit; the old credential now resolves to a
  -- released row, so the door console rejects that QR). NO replacement is minted.
  UPDATE public.tickets
     SET released_at = now()
   WHERE id = p_ticket_id AND checked_in_at IS NULL AND released_at IS NULL
     AND is_lead = false;

  IF NOT FOUND THEN
    -- Lost a race with a concurrent check-in.
    RETURN jsonb_build_object('status', 'checked_in');
  END IF;

  UPDATE public.event_registrations
     SET quantity = greatest(coalesce(quantity, 0) - 1, 0)
   WHERE id = p_registration_id;

  -- Give the seat back on the matching line item too, so `expected` (which sums line
  -- quantities via the registration) stops counting the removed guest. Repeated types
  -- can span several item rows; take one with a seat left to give back.
  SELECT i.id, i.quantity INTO v_item
  FROM public.event_registration_items i
  WHERE i.registration_id = p_registration_id
    AND i.ticket_type_id IS NOT DISTINCT FROM v_row.ticket_type_id
    AND i.quantity > 0
  ORDER BY i.quantity DESC, i.created_at, i.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_item.quantity <= 1 THEN
      DELETE FROM public.event_registration_items WHERE id = v_item.id;
    ELSE
      UPDATE public.event_registration_items
         SET quantity = v_item.quantity - 1
       WHERE id = v_item.id;
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'already', false);
end;
$function$;

revoke all on function public.remove_comp_guest(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_comp_guest(uuid, uuid)
  to service_role;

commit;
