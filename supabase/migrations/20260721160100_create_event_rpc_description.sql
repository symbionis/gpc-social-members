-- Thread the new event_ticket_types.description through the event-create RPC.
--
-- create_event_with_ticket_types owns atomicity only; the admin create route
-- (its sole caller) normalizes each type and passes already-clean values as
-- p_types jsonb. This CREATE OR REPLACE adds description to the ticket-type
-- INSERT so a described type created at event-create time persists its blurb.
--
-- Column list kept in sync with app/api/admin/events/create/route.ts. The event
-- INSERT and create_event_registration are unchanged — description is live
-- metadata on the type, never snapshotted into registration line items.
--
-- Backward compatible: not-yet-updated app code passes no 'description' key, and
-- NULLIF(t->>'description', '') yields NULL cleanly. Apply AFTER
-- 20260721160000_ticket_type_description.sql (the INSERT references the new
-- column); a plpgsql body is planned at first call, so an out-of-order apply
-- would fail on first RPC use, not at CREATE time.

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
    (event_id, title, price_member, price_non_member, invite_price, counts_as_seat, sort_order, description)
  SELECT
    v_event_id,
    t->>'title',
    NULLIF(t->>'price_member', '')::numeric,
    NULLIF(t->>'price_non_member', '')::numeric,
    NULLIF(t->>'invite_price', '')::numeric,
    COALESCE((t->>'counts_as_seat')::boolean, true),
    COALESCE((t->>'sort_order')::integer, 0),
    NULLIF(t->>'description', '')
  FROM jsonb_array_elements(p_types) AS t;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_with_ticket_types(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_with_ticket_types(jsonb, jsonb) TO service_role;
