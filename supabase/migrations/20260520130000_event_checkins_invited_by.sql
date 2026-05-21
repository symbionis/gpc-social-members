-- Link an invited guest's check-in to the actual person who invited them, so the
-- admin Check-ins view can nest guests under their host (e.g. a +1 under the
-- registrant who booked 2 tickets).
--
-- See docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md
--
-- Set at the door via a typeahead pick over this event's registrations + active
-- members. inviter_name remains as the display label / free-text fallback.
-- ON DELETE SET NULL so deleting a registration/member never erases the guest's
-- waiver audit record.
ALTER TABLE public.event_checkins
  ADD COLUMN IF NOT EXISTS invited_by_registration_id uuid
    REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_by_member_id uuid
    REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_checkins_invited_by_reg_idx
  ON public.event_checkins (invited_by_registration_id);
