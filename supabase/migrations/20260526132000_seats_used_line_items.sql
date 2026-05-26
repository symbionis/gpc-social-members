-- Recompute event seat usage from line items, honoring the per-type
-- counts_as_seat flag, with a fallback to the parent quantity for itemless rows.
--
-- Before ticket types, seats_used summed event_registrations.quantity. Now a
-- registration's seats are the sum of its SEAT-COUNTING line-item quantities.
-- The fallback to the parent quantity is per-registration and gated on
-- NOT EXISTS(any items) — NOT on "no rows survive the counts_as_seat join" —
-- so a registration that legitimately bought only non-seat types contributes 0,
-- and only genuinely itemless rows (legacy, or old-code deploy-window rows
-- later promoted by the webhook) fall back to the parent quantity.
--
-- Return shapes are unchanged, so lib/events/seat-usage.ts callers are untouched.
-- DEPLOY ORDERING: apply after the ticket-types tables + backfill (U1) exist.

CREATE OR REPLACE FUNCTION public.seats_used(eid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.event_registration_items i
        WHERE i.registration_id = r.id
      )
      THEN (
        SELECT COALESCE(SUM(i.quantity), 0)
        FROM public.event_registration_items i
        JOIN public.event_ticket_types t ON t.id = i.ticket_type_id
        WHERE i.registration_id = r.id AND t.counts_as_seat
      )
      ELSE r.quantity
    END
  ), 0)::integer
  FROM public.event_registrations r
  WHERE r.event_id = eid
    AND r.status IN ('paid', 'free');
$$;

CREATE OR REPLACE FUNCTION public.seats_used_by_events(ids uuid[])
RETURNS TABLE(event_id uuid, seats_used integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.event_id,
    COALESCE(SUM(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.event_registration_items i
          WHERE i.registration_id = r.id
        )
        THEN (
          SELECT COALESCE(SUM(i.quantity), 0)
          FROM public.event_registration_items i
          JOIN public.event_ticket_types t ON t.id = i.ticket_type_id
          WHERE i.registration_id = r.id AND t.counts_as_seat
        )
        ELSE r.quantity
      END
    ), 0)::integer AS seats_used
  FROM public.event_registrations r
  WHERE r.event_id = ANY(ids)
    AND r.status IN ('paid', 'free')
  GROUP BY r.event_id;
$$;

-- Preserve the existing grants (these are reads invoked from member/public and
-- service contexts).
GRANT EXECUTE ON FUNCTION public.seats_used(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.seats_used_by_events(uuid[]) TO authenticated, anon, service_role;
