-- FEAT-41 / U6 — Buy-more top-up under an existing registration.
-- Plan: docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md
--
-- The one-registration-per-email partial unique index blocks a second paid
-- registration for the same email/event, so additional tickets are added UNDER the
-- existing registration. A pending top-up row records the priced items; the Stripe
-- webhook applies it (idempotently, keyed on the top-up id) BEFORE its paid
-- short-circuit, so a top-up against an already-paid registration is not swallowed.
--
-- ADDITIVE: new event_registration_topups table + apply_registration_topup RPC.

create table if not exists public.event_registration_topups (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'applied')),
  items           jsonb not null,
  created_at      timestamptz not null default now(),
  applied_at      timestamptz
);

alter table public.event_registration_topups enable row level security;
create index if not exists event_registration_topups_registration_idx
  on public.event_registration_topups (registration_id);

-- Apply a paid top-up: add its items under the existing registration and bump
-- event_registrations.quantity by the added units (the per-party cap and door roster
-- both derive remaining capacity from quantity, so the bump is what makes the bought
-- tickets fillable). Idempotent: the row's pending→applied flip under a lock means a
-- webhook replay returns 'already' and adds nothing. There is NO unique index on
-- (registration_id, ticket_type_id), so repeated types insert distinct item rows that
-- mint_registration_tickets sums per type. Minting is done by the caller afterwards.
create or replace function public.apply_registration_topup(p_topup_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_topup record;
  v_item  jsonb;
  v_added integer := 0;
begin
  SELECT id, registration_id, status, items INTO v_topup
  FROM public.event_registration_topups
  WHERE id = p_topup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_topup.status = 'applied' THEN
    RETURN jsonb_build_object('status', 'already', 'registration_id', v_topup.registration_id);
  END IF;

  -- Lock the registration so the quantity bump serialises with concurrent fills.
  PERFORM 1 FROM public.event_registrations WHERE id = v_topup.registration_id FOR UPDATE;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_topup.items)
  LOOP
    INSERT INTO public.event_registration_items
      (registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf)
    VALUES
      (v_topup.registration_id,
       (v_item->>'ticket_type_id')::uuid,
       v_item->>'title_snapshot',
       (v_item->>'quantity')::int,
       (v_item->>'unit_amount_chf')::numeric,
       (v_item->>'line_total_chf')::numeric);
    v_added := v_added + (v_item->>'quantity')::int;
  END LOOP;

  UPDATE public.event_registrations
    SET quantity = COALESCE(quantity, 0) + v_added
  WHERE id = v_topup.registration_id;

  UPDATE public.event_registration_topups
    SET status = 'applied', applied_at = now()
  WHERE id = p_topup_id;

  RETURN jsonb_build_object('status', 'applied', 'registration_id', v_topup.registration_id, 'added', v_added);
end;
$function$;

revoke all on function public.apply_registration_topup(uuid) from public, anon, authenticated;
grant execute on function public.apply_registration_topup(uuid) to service_role;
