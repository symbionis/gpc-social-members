-- The purchaser's own ticket type (U12 — "buyer picks their ticket first").
--
-- At purchase the buyer chooses a basket of per-type quantities, but we never
-- recorded WHICH ticket is the buyer's own — so the seeded lead attendee had no
-- ticket type, and per-type self-reg capacity was off by one (the lead consumed a
-- party slot but no type slot). Record the buyer's chosen type on the registration
-- and copy it onto the seeded lead, so the lead holds a real ticket and the per-type
-- math is exact.
--
-- ADDITIVE (nullable column + function replace). NB: dev and prod share one
-- Supabase database, so applying this mutates production immediately.

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS lead_ticket_type_id uuid
    REFERENCES public.event_ticket_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_registrations.lead_ticket_type_id IS
  'The ticket type the purchaser (lead) holds — chosen at registration. Copied onto '
  'the seeded lead attendee so the lead carries a ticket. NULL on legacy rows.';

-- Re-seed the lead WITH its ticket type. Same 2-arg signature → CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.seed_lead_attendee(
  p_registration_id uuid,
  p_phone_e164 text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.event_attendees
    (event_id, registration_id, member_id, name, email, phone_e164, is_lead,
     slot_status, ticket_type_id)
  SELECT r.event_id, r.id, r.member_id, r.name, lower(trim(r.email)),
         COALESCE(p_phone_e164, r.phone_e164), true, 'claimed', r.lead_ticket_type_id
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

REVOKE ALL ON FUNCTION public.seed_lead_attendee(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_lead_attendee(uuid, text) TO service_role;
