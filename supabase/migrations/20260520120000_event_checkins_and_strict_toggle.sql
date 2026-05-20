-- Event door check-in: per-person self-service check-in + waiver audit, plus the
-- per-event strict check-in toggle.
--
-- See docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md
-- Origin: docs/brainstorms/2026-05-20-event-checkin-requirements.md
--
-- event_checkins is the single source of truth for arrival (registered attendee,
-- walk-up member, or invited guest). The legacy event_registrations.checked_in_at
-- column is superseded and dropped in a follow-up migration once all code
-- references are gone (see 20260520120100_drop_event_registrations_checked_in_at.sql).
-- Access is service-role only at the app layer; RLS is enabled with no policies so
-- anon/authenticated are denied and only the service-role key (used by all
-- server-side check-in/admin code) can read or write, matching event_registrations.

-- Per-event strict check-in toggle: when true, only matched registrations/members
-- may check in (no invited-guest path). Default false (invited walk-ins allowed).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS strict_checkin boolean NOT NULL DEFAULT false;

-- One row per person who checks in at the door, for any event. Holds the
-- per-person waiver acceptance audit. registration_id / member_id link to the
-- matched row when known; both NULL for an invited guest.
--
-- email is always stored lowercased (enforced by the email_lower CHECK) so the
-- (event_id, email) UNIQUE key is a robust idempotency key: a repeat scan with the
-- same email is a 23505 the app treats as "already checked in", not an error.
-- FK ON DELETE: event_id CASCADE (arrivals belong to the event); registration_id
-- and member_id SET NULL so deleting a registration/member never erases the
-- waiver audit record.
CREATE TABLE IF NOT EXISTS public.event_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NULL REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  member_id uuid NULL REFERENCES public.members(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  kind text NOT NULL,
  inviter_name text NULL,
  language text NOT NULL,
  waiver_version text NOT NULL,
  waiver_accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checkins_kind_check
    CHECK (kind IN ('registered', 'member', 'guest')),
  CONSTRAINT event_checkins_language_check
    CHECK (language IN ('fr', 'en')),
  CONSTRAINT event_checkins_name_len_check
    CHECK (char_length(name) <= 200),
  CONSTRAINT event_checkins_inviter_len_check
    CHECK (inviter_name IS NULL OR char_length(inviter_name) <= 200),
  CONSTRAINT event_checkins_email_lower_check
    CHECK (email = lower(email)),
  CONSTRAINT event_checkins_event_email_unique
    UNIQUE (event_id, email)
);

CREATE INDEX IF NOT EXISTS event_checkins_event_created_idx
  ON public.event_checkins (event_id, created_at);

-- RLS enabled, no policies: anon/authenticated denied, service-role bypasses.
-- All app access is via the service-role client (createAdminClient).
ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;
