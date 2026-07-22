-- U14 — Ticket cancellation + immediate seat release.
--
-- A ticket holder may request cancellation of any ticket at their address from the manage
-- page. The request is final on the holder side; an admin later marks it refunded manually
-- and links out to Stripe. Cancelling a seat-counting ticket frees its seat IMMEDIATELY, by
-- subtracting a cancelled-seats term from the seat-count functions.
--
-- KTD6 safety property: when an event has NO cancellations the subtracted term is 0, so
-- seats_used / seats_used_by_events return byte-for-byte what they returned before this
-- migration (verified against every event on the shared DB in a throwaway function before
-- this was applied). The regression surface is empty for the normal case.
--
-- Scope: cancellation only. The door `released_at` release keeps its existing (unchanged)
-- seat behaviour — deliberately out of scope so door counts don't shift silently.

-- 1. Per-ticket cancellation status. NULL = live; 'requested' = holder cancelled (seat freed,
--    refund pending); 'refunded' = admin completed the Stripe refund. BOTH non-null states
--    free the seat — the holder isn't attending either way.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS cancellation_status text
    CHECK (cancellation_status IN ('requested', 'refunded')),
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_refunded_at timestamptz;

-- Partial index: the seat-count term and the admin cancellation view both scan only the
-- (small) set of cancelled tickets per event. NULL rows — the overwhelming majority — are
-- excluded from the index entirely.
CREATE INDEX IF NOT EXISTS tickets_cancellation_idx
  ON public.tickets (event_id)
  WHERE cancellation_status IS NOT NULL;

-- 2. Seat math now subtracts this event's cancelled seat-counting tickets. The PURCHASED
--    term is unchanged from 20260526132000 (per-registration line-item sum, with the
--    itemless parent-quantity fallback gated on NOT EXISTS(any items)); the CANCELLED term
--    counts tickets whose type counts as a seat and that carry any cancellation_status.
--    COUNT over an empty/all-NULL set is 0, so a no-cancellation event is byte-for-byte
--    identical to the previous definition.
CREATE OR REPLACE FUNCTION public.seats_used(eid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    COALESCE((
      SELECT SUM(
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
      )
      FROM public.event_registrations r
      WHERE r.event_id = eid
        AND r.status IN ('paid', 'free')
    ), 0)
    -
    COALESCE((
      SELECT COUNT(*)
      FROM public.tickets tk
      JOIN public.event_ticket_types t2 ON t2.id = tk.ticket_type_id
      WHERE tk.event_id = eid
        AND tk.cancellation_status IS NOT NULL
        AND t2.counts_as_seat
    ), 0)
  )::integer;
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
    (
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
      ), 0)
      -
      COALESCE((
        SELECT COUNT(*)
        FROM public.tickets tk
        JOIN public.event_ticket_types t2 ON t2.id = tk.ticket_type_id
        WHERE tk.event_id = r.event_id
          AND tk.cancellation_status IS NOT NULL
          AND t2.counts_as_seat
      ), 0)
    )::integer AS seats_used
  FROM public.event_registrations r
  WHERE r.event_id = ANY(ids)
    AND r.status IN ('paid', 'free')
  GROUP BY r.event_id;
$$;

-- Preserve the existing grants (reads invoked from member/public and service contexts).
GRANT EXECUTE ON FUNCTION public.seats_used(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.seats_used_by_events(uuid[]) TO authenticated, anon, service_role;
