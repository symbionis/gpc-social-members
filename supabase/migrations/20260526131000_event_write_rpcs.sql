-- Atomic write RPCs for the ticket-types model.
--
-- A registration now spans two tables (event_registrations parent +
-- event_registration_items lines) and event creation spans two
-- (events + event_ticket_types). The Supabase JS client never throws on a
-- failed write, so an "insert parent, then insert children" sequence can leave
-- a chargeable parent with no lines, or a typeless event — silent corruption.
-- These functions make each multi-row write all-or-nothing in one transaction.
--
-- Both are SECURITY DEFINER (they write tables whose RLS denies anon/auth) and
-- are restricted to the service_role the app uses (createAdminClient). They are
-- NOT callable by anon/authenticated clients.

-- ---------------------------------------------------------------------------
-- create_event_registration: parent event_registrations row + N line items,
-- atomically. Computes the denormalized quantity/total from the items so the
-- two layers cannot drift. Used by the register route (U5) and the waitlist
-- conversion (U9, passing p_converted_by). The partial unique index on
-- event_registrations (event_id, lower(email)) WHERE status IN ('paid','free')
-- still applies — a duplicate raises 23505, which propagates to the caller to
-- map to a 409.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_event_registration(
  p_event_id       uuid,
  p_name           text,
  p_email          text,
  p_is_member      boolean,
  p_member_id      uuid,
  p_status         text,
  p_reference_code text,
  p_paid_at        timestamptz,
  p_converted_by   uuid,
  p_items          jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration_id uuid;
  v_quantity        integer;
  v_total           numeric(10,2);
BEGIN
  SELECT
    COALESCE(SUM((item->>'quantity')::integer), 0),
    COALESCE(SUM((item->>'line_total_chf')::numeric), 0)
  INTO v_quantity, v_total
  FROM jsonb_array_elements(p_items) AS item;

  IF v_quantity < 1 THEN
    RAISE EXCEPTION 'create_event_registration: items must total at least 1 ticket';
  END IF;

  -- unit_amount_chf on the parent is a legacy denormalization; total_amount_chf
  -- is authoritative and the per-line unit prices live on the items. Set 0.
  INSERT INTO public.event_registrations
    (event_id, name, email, quantity, is_member, member_id,
     unit_amount_chf, total_amount_chf, status, reference_code, paid_at, converted_by)
  VALUES
    (p_event_id, p_name, p_email, v_quantity, p_is_member, p_member_id,
     0, v_total, p_status, p_reference_code, p_paid_at, p_converted_by)
  RETURNING id INTO v_registration_id;

  INSERT INTO public.event_registration_items
    (registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf)
  SELECT
    v_registration_id,
    (item->>'ticket_type_id')::uuid,
    item->>'title_snapshot',
    (item->>'quantity')::integer,
    (item->>'unit_amount_chf')::numeric,
    (item->>'line_total_chf')::numeric
  FROM jsonb_array_elements(p_items) AS item;

  RETURN v_registration_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- create_event_with_ticket_types: event row + its seeded ticket types,
-- atomically, so an event can never exist without >=1 type. The caller
-- (admin create route U4, agent create/draft U13) does all input normalization
-- and passes already-clean values; this function only owns atomicity. The
-- column list mirrors what app/api/admin/events/create/route.ts inserts (minus
-- the price columns, which now live on the types). Keep them in sync.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_event_with_ticket_types(
  p_event jsonb,
  p_types jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.events (
    title, event_type_id, start_date, end_date, start_time, location,
    description, is_confirmed, is_published, notes, season_id,
    image_url, image_url_2, images, visibility, registration_enabled,
    reminder_schedule
  )
  VALUES (
    p_event->>'title',
    NULLIF(p_event->>'event_type_id', '')::uuid,
    (p_event->>'start_date')::date,
    NULLIF(p_event->>'end_date', '')::date,
    NULLIF(p_event->>'start_time', ''),
    NULLIF(p_event->>'location', ''),
    NULLIF(p_event->>'description', ''),
    COALESCE((p_event->>'is_confirmed')::boolean, false),
    COALESCE((p_event->>'is_published')::boolean, false),
    NULLIF(p_event->>'notes', ''),
    NULLIF(p_event->>'season_id', '')::uuid,
    NULLIF(p_event->>'image_url', ''),
    NULLIF(p_event->>'image_url_2', ''),
    COALESCE(p_event->'images', '[]'::jsonb),
    COALESCE(p_event->>'visibility', 'members_only'),
    COALESCE((p_event->>'registration_enabled')::boolean, false),
    COALESCE(p_event->'reminder_schedule', '[]'::jsonb)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.event_ticket_types
    (event_id, title, price_member, price_non_member, invite_price, counts_as_seat, sort_order)
  SELECT
    v_event_id,
    t->>'title',
    NULLIF(t->>'price_member', '')::numeric,
    NULLIF(t->>'price_non_member', '')::numeric,
    NULLIF(t->>'invite_price', '')::numeric,
    COALESCE((t->>'counts_as_seat')::boolean, true),
    COALESCE((t->>'sort_order')::integer, 0)
  FROM jsonb_array_elements(p_types) AS t;

  RETURN v_event_id;
END;
$$;

-- These functions write RLS-protected tables and bypass RLS — restrict to the
-- service_role the app uses. Never callable by anon/authenticated.
REVOKE ALL ON FUNCTION public.create_event_registration(uuid, text, text, boolean, uuid, text, text, timestamptz, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_with_ticket_types(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_registration(uuid, text, text, boolean, uuid, text, text, timestamptz, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_with_ticket_types(jsonb, jsonb) TO service_role;
