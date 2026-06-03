-- Named-attendee roster — the per-person source of truth for every event.
--
-- Replaces email-keyed event_checkins as the identity record. Each attendee is
-- one named person (name + email or phone) who signs their own waiver and is
-- checked in at the door. The lead/purchaser is an attendee too. Rows arrive via:
--   registration (U12 seeds the lead), self-registration link (U9), bulk import
--   (U3), backfill (below), or ops. event_checkins stays for history (frozen).
--
-- This migration is ADDITIVE ONLY. It creates event_attendees and backfills one
-- is_lead attendee per existing paid/free registration on a published/upcoming
-- event, so purchasers stay matchable without re-import.
--
-- DEPLOY ORDERING: safe to apply before the cutover code ships — nothing reads
-- the table yet. NB: dev and prod share one Supabase database, so applying this
-- mutates production immediately. The backfill is guarded with NOT EXISTS so a
-- re-apply double-counts nothing.
-- PRE-FLIGHT (run before applying against the shared DB): confirm row volume
-- (SELECT count(*) FROM event_registrations WHERE status IN ('paid','free')).
-- TYPES: types/database.ts must be regenerated AFTER this is applied (the admin
-- client is untyped, so app code compiles meanwhile); re-append the manual
-- MemberStatus / PaymentCaptureStatus aliases at the tail after regen.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_attendees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- The party this attendee belongs to. Nullable: admin / bulk-imported attendees
  -- may have no registration. SET NULL keeps the attendee (and its waiver audit)
  -- if the registration is later deleted.
  registration_id    uuid REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  -- Resolved member, when the attendee maps to one. SET NULL on member delete.
  member_id          uuid REFERENCES public.members(id) ON DELETE SET NULL,
  -- name + a contact are required for a 'claimed' row; an 'unclaimed' pre-provisioned
  -- slot (Milestone 2) is an empty placeholder until a guest claims it, so the
  -- CHECKs below are gated on slot_status.
  name               text,
  email              text,
  phone_e164         text,
  is_lead            boolean NOT NULL DEFAULT false,
  slot_status        text NOT NULL DEFAULT 'claimed'
                       CHECK (slot_status IN ('unclaimed', 'claimed')),
  -- Per-attendee waiver acceptance, mirroring event_checkins' audit shape
  -- (content-hash version + accepted_at + language). Set server-side at whichever
  -- entry point signs (self-registration or the door).
  waiver_version     text,
  waiver_accepted_at timestamptz,
  language           varchar(2),
  marketing_consent  boolean,
  -- Arrival timestamp. NULL until checked in at the door (idempotency key for
  -- re-check-in is the row itself).
  checked_in_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_attendees_contact_present CHECK (
    slot_status = 'unclaimed' OR email IS NOT NULL OR phone_e164 IS NOT NULL
  ),
  CONSTRAINT event_attendees_claimed_named CHECK (
    slot_status = 'unclaimed' OR name IS NOT NULL
  ),
  CONSTRAINT event_attendees_email_lower CHECK (
    email IS NULL OR email = lower(email)
  )
);

-- Lookup indexes for door matching by phone or email (non-unique: a shared family
-- contact may map to several attendees; the matcher resolves deterministically).
CREATE INDEX IF NOT EXISTS event_attendees_event_email_idx
  ON public.event_attendees (event_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_attendees_event_phone_idx
  ON public.event_attendees (event_id, phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_attendees_registration_idx
  ON public.event_attendees (registration_id);
CREATE INDEX IF NOT EXISTS event_attendees_event_arrived_idx
  ON public.event_attendees (event_id) WHERE checked_in_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill (idempotent): one is_lead attendee per paid/free registration on a
-- published / upcoming event. lower(trim(email)) defends the email-lower CHECK
-- against a legacy non-normalized address (a single bad row would otherwise abort
-- the migration on the shared DB). Empty-email rows are skipped (they would
-- violate the contact CHECK). Scoped to upcoming events to avoid a long lock on
-- event_registrations from an all-history sweep; historical events can be
-- backfilled separately if analytics ever need them.
-- ---------------------------------------------------------------------------

INSERT INTO public.event_attendees
  (event_id, registration_id, member_id, name, email, is_lead, slot_status)
SELECT r.event_id, r.id, r.member_id, r.name, lower(trim(r.email)), true, 'claimed'
FROM public.event_registrations r
JOIN public.events e ON e.id = r.event_id
WHERE r.status IN ('paid', 'free')
  AND e.is_published = true
  AND (e.start_date IS NULL OR e.start_date >= CURRENT_DATE)
  AND trim(COALESCE(r.name, '')) <> ''
  AND trim(COALESCE(r.email, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.event_attendees a
    WHERE a.registration_id = r.id AND a.is_lead = true
  );

-- ---------------------------------------------------------------------------
-- RLS: enable with no policies — anon/authenticated denied, only the service-role
-- key (used by all app code via createAdminClient) can read/write. Mirrors
-- event_checkins and the other event child tables.
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
