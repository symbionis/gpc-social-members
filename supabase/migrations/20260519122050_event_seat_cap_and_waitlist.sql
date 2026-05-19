-- Event registration capacity + waitlist.
--
-- See docs/plans/2026-05-19-001-feat-event-registration-cap-plan.md
-- Origin: docs/brainstorms/2026-05-19-event-registration-cap-requirements.md
--
-- seat_cap is nullable (NULL = uncapped, unchanged behaviour for existing events).
-- Cap counts SUM(quantity) across event_registrations WHERE status IN ('paid','free').
-- Pending checkouts are NOT counted (oversell-by-one race accepted; see plan Key Decisions).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS seat_cap integer NULL;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_seat_cap_positive;

ALTER TABLE public.events
  ADD CONSTRAINT events_seat_cap_positive
  CHECK (seat_cap IS NULL OR seat_cap > 0);

-- Minimal waitlist: name + email + created_at, scoped to event. No quantity,
-- no member linkage, no status lifecycle, no dedupe. Admin manages manually.
CREATE TABLE IF NOT EXISTS public.event_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_waitlist_event_created_idx
  ON public.event_waitlist(event_id, created_at);
