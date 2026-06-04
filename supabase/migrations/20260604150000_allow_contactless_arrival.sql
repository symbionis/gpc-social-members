-- Allow a contactless attendee ONLY when added at the door as already-arrived.
--
-- Children / contactless guests can't self-register (no email or phone) and can't
-- be matched at the strict door — but a parent turns up with them and door staff
-- add them by name on the spot, marked arrived. Relax the contact-present CHECK so
-- a claimed row with no contact is allowed iff checked_in_at is set (a door-added
-- arrival). A pre-event roster row still requires a contact; only a recorded
-- arrival may be contactless. The claimed-named CHECK still requires a name.
--
-- ADDITIVE (constraint widened — every existing row still satisfies it). NB: dev
-- and prod share one Supabase database, so applying this mutates production.

ALTER TABLE public.event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_contact_present;

ALTER TABLE public.event_attendees
  ADD CONSTRAINT event_attendees_contact_present CHECK (
    slot_status = 'unclaimed'
    OR email IS NOT NULL
    OR phone_e164 IS NOT NULL
    OR checked_in_at IS NOT NULL
  );
