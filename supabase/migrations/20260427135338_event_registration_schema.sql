-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-27, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- Add registration columns to events
ALTER TABLE events
  ADD COLUMN price_member numeric(10,2) NULL,
  ADD COLUMN price_non_member numeric(10,2) NULL,
  ADD COLUMN visibility text NOT NULL DEFAULT 'members_only'
    CHECK (visibility IN ('members_only','public')),
  ADD COLUMN registration_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE events
  ADD CONSTRAINT events_prices_required_when_registration_enabled
  CHECK (
    registration_enabled = false
    OR (price_member IS NOT NULL AND price_non_member IS NOT NULL)
  );

-- New event_registrations table
CREATE TABLE event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  is_member boolean NOT NULL,
  member_id uuid NULL REFERENCES members(id) ON DELETE SET NULL,
  unit_amount_chf numeric(10,2) NOT NULL,
  total_amount_chf numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','free','refunded')),
  reference_code text NOT NULL UNIQUE,
  stripe_checkout_session_id text NULL UNIQUE,
  stripe_payment_intent_id text NULL,
  paid_at timestamptz NULL,
  checked_in_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_registrations_event_id_status_idx
  ON event_registrations (event_id, status);
CREATE INDEX event_registrations_email_idx
  ON event_registrations (email);

-- RLS — admin/service role only; no anon policies (API uses service role)
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;
