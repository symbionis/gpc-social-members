-- FEAT-41 / U2 — Mint one issued, credentialled ticket per purchased slot.
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- ADDITIVE: new SECURITY DEFINER RPC, no table changes. Called after the lead is
-- seeded, on both the free path (register route) and the paid path (Stripe webhook).
--
-- Idempotent by construction: mints (purchased − existing) issued rows per ticket
-- type under a registration-row lock, so a webhook replay (or a double free-confirm)
-- mints nothing once the party is full. The lock serialises concurrent callers.
-- Credential: 24 CSPRNG bytes → base64url, matching generateSelfRegToken().

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
  -- Lock the registration so concurrent mints (webhook retry racing a manual
  -- reconcile) serialise on the same row and each sees the other's inserts.
  select id, event_id, status into v_reg
  from public.event_registrations
  where id = p_registration_id
  for update;

  if not found then return 0; end if;
  if v_reg.status not in ('paid', 'free') then return 0; end if;

  -- Per ticket type: purchased = sum(item quantities); existing = current
  -- non-released ticket rows of that type (includes the just-seeded lead). Mint the
  -- shortfall as 'issued' rows, each with its own credential. greatest(...,0) makes
  -- a re-run a no-op once existing has caught up to purchased.
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
    (event_id, registration_id, ticket_type_id, slot_status, credential_token)
  select v_reg.event_id, v_reg.id, tm.ticket_type_id, 'issued',
         replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
  from to_mint tm
  cross join lateral generate_series(1, greatest(tm.purchased - tm.existing, 0)) gs;

  get diagnostics v_minted = row_count;
  return v_minted;
end;
$function$;

-- Event tables are RLS-enabled with access via the service-role admin client only.
revoke all on function public.mint_registration_tickets(uuid) from public, anon, authenticated;
grant execute on function public.mint_registration_tickets(uuid) to service_role;
