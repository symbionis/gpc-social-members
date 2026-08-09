-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-03-30, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- renewal_tokens table
CREATE TABLE renewal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id),
  originator_id uuid NOT NULL REFERENCES admin_users(id),
  token text NOT NULL UNIQUE,
  used boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_renewal_tokens_token ON renewal_tokens(token);
CREATE INDEX idx_renewal_tokens_member_id ON renewal_tokens(member_id);

-- email_settings table
CREATE TABLE email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users(id)
);

-- Seed default auto-renewal reminder setting
INSERT INTO email_settings (key, value, enabled) VALUES
  ('auto_renewal_reminder', '{"days_before_expiry": 30}', false);

-- Backfill members with NULL originator_id
UPDATE members
SET originator_id = '99ab0581-85f6-43e8-b5a8-de4447ef65ed'
WHERE originator_id IS NULL;
