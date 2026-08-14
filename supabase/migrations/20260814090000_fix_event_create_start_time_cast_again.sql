-- Restore the ::time cast on start_time in create_event_with_ticket_types.
--
--   column "start_time" is of type time without time zone but expression is of type text
--
-- SECOND occurrence of this exact failure. 20260618120000_fix_event_create_start_time_cast.sql
-- added the cast; 20260721160100_create_event_rpc_description.sql (threading the ticket-type
-- description through) recreated the function from a pre-fix copy of the body and silently
-- dropped it again. Admin event creation was broken from 2026-07-21 until this migration.
--
-- LOAD-BEARING, and not optional on a technicality: p_event->>'start_time' is text, and
-- Postgres has no assignment cast from text to time, so the INSERT fails for EVERY input --
-- an empty Start Time field included (NULLIF yields a text NULL, not an untyped one).
-- Any future CREATE OR REPLACE of this function MUST carry the cast forward. Copy the body
-- from the latest migration, never from an older one.
--
-- Body is otherwise byte-identical to 20260721160100 (which is the current live definition);
-- the ticket-type INSERT keeps its description column. CREATE OR REPLACE preserves the
-- grants set by 20260809220000_revoke_anon_execute_secdef.sql.

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
    NULLIF(p_event->>'start_time', '')::time,  -- ::time is load-bearing; see header
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
