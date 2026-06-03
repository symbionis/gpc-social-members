-- Capture a phone number at event registration, and seed the purchaser as the
-- lead attendee (U12). Going forward every registrant lands on the roster and is
-- matchable at the door by phone or email — not just self-registered guests and
-- imports.
--
-- This migration is ADDITIVE ONLY: a nullable phone column plus a guarded seed
-- function. NB: dev and prod share one Supabase database, so applying this mutates
-- production immediately. Nothing reads phone_e164 until the cutover code ships.
-- DEPLOY ORDERING: apply after 20260603120000_event_attendees (the function
-- inserts into event_attendees). TYPES: regenerate types/database.ts after apply.

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS phone_e164 text;

COMMENT ON COLUMN public.event_registrations.phone_e164 IS
  'E.164 phone captured at registration (U12). NULL on legacy / phone-less rows.';

-- Seed one is_lead attendee from a confirmed registration. SECURITY DEFINER so the
-- service-role app code can call it; paid/free-gated and NOT EXISTS-guarded inside
-- so it is safe to call from both the free-registration path and the Stripe webhook
-- (and idempotent against re-delivery). U8 (Milestone 2) supersedes this by seeding
-- inside create_event_registration's N-slot pre-provisioning.
CREATE OR REPLACE FUNCTION public.seed_lead_attendee(p_registration_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.event_attendees
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead, slot_status)
  SELECT r.event_id, r.id, r.member_id, r.name, lower(trim(r.email)), r.phone_e164, true, 'claimed'
  FROM public.event_registrations r
  WHERE r.id = p_registration_id
    AND r.status IN ('paid', 'free')
    AND trim(COALESCE(r.name, '')) <> ''
    AND trim(COALESCE(r.email, '')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.event_attendees a
      WHERE a.registration_id = r.id AND a.is_lead = true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_lead_attendee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_lead_attendee(uuid) TO service_role;
