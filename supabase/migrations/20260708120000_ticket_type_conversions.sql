-- FEAT / U1 — Convert Ticket Type (self-service, upgrade-only).
-- Plan: docs/plans/2026-07-08-001-feat-convert-ticket-type-plan.md
--
-- A Lead can change ONE of their tickets to a same-or-higher priced ticket type,
-- paying the difference through Stripe. A pending conversion row snapshots the agreed
-- prices; the Stripe webhook applies it (idempotently, keyed on the conversion id)
-- BEFORE its paid short-circuit (the registration is already 'paid'). A delta-0
-- conversion is applied immediately by the route, no checkout.
--
-- The apply RPC swaps tickets.ticket_type_id and reconciles event_registration_items
-- (-1 on the from-type line, +1 on the to-type line) so that mint_registration_tickets'
-- per-type quantity invariant (sum(line_item.quantity) == live ticket count per type)
-- stays intact — a later top-up's mint must remain a no-op.
--
-- SHARED DEV/PROD DATABASE: this migration applies to production immediately. It is
-- ADDITIVE (new event_ticket_type_conversions table + new apply_ticket_type_conversion
-- function), so there is no data backfill and nothing destructive. Apply this migration
-- to the shared database before (or atomically with) deploying the route/webhook/UI —
-- migration-before-code is safe (unused table/function); code-before-migration 500s.

create table if not exists public.event_ticket_type_conversions (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  ticket_id       uuid not null references public.tickets(id) on delete cascade,
  from_type_id    uuid not null references public.event_ticket_types(id),
  to_type_id      uuid not null references public.event_ticket_types(id),
  from_unit_chf   numeric not null,
  to_unit_chf     numeric not null,
  delta_chf       numeric not null,
  status          text not null default 'pending' check (status in ('pending', 'applied')),
  created_at      timestamptz not null default now(),
  applied_at      timestamptz
);

-- Service-role-only in fact, not just by convention: RLS on with no anon/authenticated
-- policies (mirrors event_registration_topups). The admin client bypasses RLS.
alter table public.event_ticket_type_conversions enable row level security;
create index if not exists event_ticket_type_conversions_registration_idx
  on public.event_ticket_type_conversions (registration_id);

-- Apply a paid (or free, delta-0) ticket-type conversion. Idempotent: the row's
-- pending→applied flip under a lock means a webhook replay returns 'already' and mutates
-- nothing. Re-verifies the ticket is STILL the from-type under a row lock (KTD4) so a
-- ticket that was checked-in / released / forwarded / already-converted between checkout
-- and webhook returns 'conflict' rather than corrupting state. Line-item reconciliation
-- is quantity-preserving per type (KTD5) so mint_registration_tickets stays a no-op.
create or replace function public.apply_ticket_type_conversion(p_conversion_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_conv       record;
  v_ticket     record;
  v_from_line  record;
  v_to_line    record;
  v_to_title   text;
  v_new_qty    integer;
begin
  -- Lock the conversion; the applied-flip under this lock is what makes replay a no-op.
  SELECT id, registration_id, ticket_id, from_type_id, to_type_id,
         from_unit_chf, to_unit_chf, delta_chf, status
    INTO v_conv
  FROM public.event_ticket_type_conversions
  WHERE id = p_conversion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_conv.status = 'applied' THEN
    RETURN jsonb_build_object('status', 'already', 'registration_id', v_conv.registration_id);
  END IF;

  -- Serialise with concurrent fills/top-ups on the same registration.
  PERFORM 1 FROM public.event_registrations WHERE id = v_conv.registration_id FOR UPDATE;

  -- Re-verify eligibility under a row lock (KTD4). Every guard the route checked can have
  -- changed between checkout and webhook; ticket_type_id = from_type_id is the double-apply
  -- / drift guard (a re-converted ticket no longer matches its snapshotted from-type).
  SELECT t.id, t.ticket_type_id
    INTO v_ticket
  FROM public.tickets t
  WHERE t.id = v_conv.ticket_id
    AND t.registration_id = v_conv.registration_id
    AND t.released_at IS NULL
    AND t.checked_in_at IS NULL
    AND t.batch_token IS NULL
    AND t.slot_status IN ('issued', 'claimed')
    AND t.ticket_type_id = v_conv.from_type_id
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  -- Swap the ticket's type. Credential/QR, is_lead, name/contact and quantity are all
  -- untouched — only the type changes.
  UPDATE public.tickets
    SET ticket_type_id = v_conv.to_type_id
  WHERE id = v_conv.ticket_id;

  -- Line-item reconciliation (KTD5), quantity-preserving so the mint invariant holds.
  -- Decrement one from-type line by 1 (OQ1 default: the oldest by created_at), deleting
  -- it if it reaches 0. If no from-type line with quantity >= 1 exists, still swap +
  -- insert the to-line + add the delta, and log — never write a negative quantity.
  SELECT id, quantity, unit_amount_chf
    INTO v_from_line
  FROM public.event_registration_items
  WHERE registration_id = v_conv.registration_id
    AND ticket_type_id = v_conv.from_type_id
    AND quantity >= 1
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_new_qty := v_from_line.quantity - 1;
    IF v_new_qty <= 0 THEN
      DELETE FROM public.event_registration_items WHERE id = v_from_line.id;
    ELSE
      UPDATE public.event_registration_items
        SET quantity = v_new_qty,
            line_total_chf = round(unit_amount_chf * v_new_qty, 2)
      WHERE id = v_from_line.id;
    END IF;
  ELSE
    RAISE NOTICE 'apply_ticket_type_conversion: no from-type line item to decrement (conversion %, from_type %)',
      p_conversion_id, v_conv.from_type_id;
  END IF;

  -- Increment an existing to-type line by 1 (recomputing its line total from its own unit),
  -- or insert a fresh line at the snapshotted to_unit_chf.
  SELECT id, quantity, unit_amount_chf
    INTO v_to_line
  FROM public.event_registration_items
  WHERE registration_id = v_conv.registration_id
    AND ticket_type_id = v_conv.to_type_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_new_qty := v_to_line.quantity + 1;
    UPDATE public.event_registration_items
      SET quantity = v_new_qty,
          line_total_chf = round(unit_amount_chf * v_new_qty, 2)
    WHERE id = v_to_line.id;
  ELSE
    SELECT title INTO v_to_title FROM public.event_ticket_types WHERE id = v_conv.to_type_id;
    INSERT INTO public.event_registration_items
      (registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf)
    VALUES
      (v_conv.registration_id, v_conv.to_type_id, COALESCE(v_to_title, 'Ticket'),
       1, v_conv.to_unit_chf, round(v_conv.to_unit_chf, 2));
  END IF;

  -- Bump the registration total by the agreed delta (R5). Top-up leaves total_amount_chf
  -- alone, so this is not a strict sum-of-lines invariant — it records what was paid.
  UPDATE public.event_registrations
    SET total_amount_chf = total_amount_chf + v_conv.delta_chf
  WHERE id = v_conv.registration_id;

  UPDATE public.event_ticket_type_conversions
    SET status = 'applied', applied_at = now()
  WHERE id = p_conversion_id;

  RETURN jsonb_build_object('status', 'applied', 'registration_id', v_conv.registration_id);
end;
$function$;

-- FROM PUBLIC alone leaves SECURITY DEFINER functions anon-callable on Supabase; revoke
-- from anon/authenticated too and grant only to the service role (mirrors fill_ticket).
revoke all on function public.apply_ticket_type_conversion(uuid) from public, anon, authenticated;
grant execute on function public.apply_ticket_type_conversion(uuid) to service_role;
