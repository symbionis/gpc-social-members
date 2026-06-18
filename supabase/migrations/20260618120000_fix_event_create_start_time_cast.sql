-- Fix: event creation fails with
--   column "start_time" is of type time without time zone but expression is of type text
--
-- create_event_with_ticket_types builds the INSERT values from jsonb (p_event->>'key'),
-- which yields text. start_date/end_date are cast (::date) but start_time was not, and
-- Postgres has no implicit text→time assignment cast, so any event with a time fails to
-- create. The edit path uses PostgREST .update() (typed values) and is unaffected.
--
-- ADDITIVE (CREATE OR REPLACE only). NB: dev and prod share one Supabase database, so
-- applying this updates the production function immediately. Mirrors the current body
-- from 20260604200000_kids_tickets.sql with the single ::time cast added.

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
    NULLIF(p_event->>'start_time', '')::time,
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
    (event_id, title, price_member, price_non_member, invite_price, counts_as_seat, is_child, sort_order)
  SELECT
    v_event_id,
    t->>'title',
    NULLIF(t->>'price_member', '')::numeric,
    NULLIF(t->>'price_non_member', '')::numeric,
    NULLIF(t->>'invite_price', '')::numeric,
    COALESCE((t->>'counts_as_seat')::boolean, true),
    COALESCE((t->>'is_child')::boolean, false),
    COALESCE((t->>'sort_order')::integer, 0)
  FROM jsonb_array_elements(p_types) AS t;

  RETURN v_event_id;
END;
$$;
