-- Postgres-side aggregation for event seat usage. Replaces row-fetch counting
-- which was vulnerable to the Supabase JS 1000-row default silently
-- under-counting on hot events and turning the documented oversell-by-one
-- trade-off into an unbounded oversell.
--
-- Two functions:
--   seats_used(eid)              -> integer, single-event sum
--   seats_used_by_events(ids)    -> table(event_id, seats_used), batch version

CREATE OR REPLACE FUNCTION public.seats_used(eid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM public.event_registrations
  WHERE event_id = eid
    AND status IN ('paid', 'free');
$$;

CREATE OR REPLACE FUNCTION public.seats_used_by_events(ids uuid[])
RETURNS TABLE(event_id uuid, seats_used integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    event_id,
    COALESCE(SUM(quantity), 0)::integer AS seats_used
  FROM public.event_registrations
  WHERE event_id = ANY(ids)
    AND status IN ('paid', 'free')
  GROUP BY event_id;
$$;

GRANT EXECUTE ON FUNCTION public.seats_used(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.seats_used_by_events(uuid[]) TO authenticated, anon, service_role;
