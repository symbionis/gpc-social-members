-- U9 (Phase C) — per-ticket manage_token + household rotation.
-- Plan: docs/plans/2026-07-20-001-feat-ticket-naming-and-guest-self-service-plan.md
--
-- Every ticket gets its own rotatable manage_token (distinct from credential_token, which
-- stays admission-only, KTD3). The token is minted alongside credential_token in
-- mint_registration_tickets and backfilled onto every existing ticket. The manage page
-- (U10) resolves same-email household siblings by (registration_id, lower(email)); rotation
-- rotates every same-email sibling's token together (KTD4), so a leaked link can be revoked
-- for the whole household at once. Uses gen_url_token() (U1).

-- 1. Column + backfill (gen_url_token() is volatile → a distinct token per row) + unique index.
alter table public.tickets add column manage_token text;
update public.tickets set manage_token = public.gen_url_token() where manage_token is null;
create unique index tickets_manage_token_uniq on public.tickets (manage_token) where manage_token is not null;

-- 2. Mint the manage_token on every newly-issued ticket (reproduced from the live
--    mint_registration_tickets definition; the only change is the added column + value).
create or replace function public.mint_registration_tickets(p_registration_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reg    record;
  v_minted integer := 0;
begin
  select id, event_id, status into v_reg
  from public.event_registrations
  where id = p_registration_id
  for update;

  if not found then return 0; end if;
  if v_reg.status not in ('paid', 'free') then return 0; end if;

  with to_mint as (
    select ri.ticket_type_id,
           sum(ri.quantity)::int as purchased,
           (
             select count(*) from public.tickets t
             where t.registration_id = v_reg.id
               and t.ticket_type_id = ri.ticket_type_id
               and t.released_at is null
           ) as existing
    from public.event_registration_items ri
    where ri.registration_id = v_reg.id
    group by ri.ticket_type_id
  )
  insert into public.tickets
    (event_id, registration_id, ticket_type_id, slot_status, credential_token, manage_token)
  select v_reg.event_id, v_reg.id, tm.ticket_type_id, 'issued',
         replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'),
         public.gen_url_token()
  from to_mint tm
  cross join lateral generate_series(1, greatest(tm.purchased - tm.existing, 0)) gs;

  get diagnostics v_minted = row_count;
  return v_minted;
end;
$function$;

-- 3. Household rotation. Authorized by the caller's own per-ticket manage_token: look up the
--    ticket, then rotate every live same-email sibling in the registration to a fresh, distinct
--    token, and return the caller's ticket's NEW token. Single-writer of tickets.manage_token
--    alongside mint (see docs/solutions/architecture-patterns/single-writer-field-ownership-across-routes.md).
--    Server-generated only — a client-supplied token is never accepted.
create or replace function public.rotate_ticket_manage_token(p_manage_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid; v_reg uuid; v_email text; v_new text;
begin
  if p_manage_token is null or length(trim(p_manage_token)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select id, registration_id, lower(email) into v_id, v_reg, v_email
  from public.tickets
  where manage_token = p_manage_token and released_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  -- Rotate the caller's own ticket ALWAYS (id = v_id), plus every same-email household
  -- sibling — but only when the ticket belongs to a real registration. registration_id is
  -- nullable (standalone door tickets), and `= NULL` matches nothing, so a bare
  -- `registration_id = v_reg` would silently rotate zero rows for a standalone ticket while
  -- still reporting ok. The explicit `id = v_id` branch guarantees the caller's own token
  -- always rotates; the sibling branch is guarded by `v_reg is not null` so unrelated
  -- standalone (null-registration) tickets never co-rotate. gen_url_token() is volatile, so
  -- each matched row gets its own distinct token.
  update public.tickets
     set manage_token = public.gen_url_token()
   where released_at is null
     and (
       id = v_id
       or (v_reg is not null and registration_id = v_reg and lower(email) is not distinct from v_email)
     );

  select manage_token into v_new from public.tickets where id = v_id;
  return jsonb_build_object('status', 'ok', 'manage_token', v_new);
end;
$function$;

revoke all on function public.rotate_ticket_manage_token(text) from public, anon, authenticated;
grant execute on function public.rotate_ticket_manage_token(text) to service_role;
