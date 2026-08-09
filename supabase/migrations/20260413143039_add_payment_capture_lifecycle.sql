-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-13, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- Create payment_capture_status enum
CREATE TYPE payment_capture_status AS ENUM (
  'pending',
  'authorized',
  'hold_expired',
  'charging_offsession',
  'succeeded',
  'failed',
  'requires_action',
  'cancelled'
);

-- Add authorization lifecycle columns to payments
ALTER TABLE payments
  ADD COLUMN payment_capture_status payment_capture_status,
  ADD COLUMN stripe_payment_method_id TEXT,
  ADD COLUMN authorized_at TIMESTAMPTZ,
  ADD COLUMN capture_before TIMESTAMPTZ,
  ADD COLUMN payment_failed_at TIMESTAMPTZ,
  ADD COLUMN payment_retry_deadline TIMESTAMPTZ,
  ADD COLUMN reminder_day1_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN reminder_day3_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN reminder_day4_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Add stripe_customer_id and consent fields to members
ALTER TABLE members
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN consent_given_at TIMESTAMPTZ,
  ADD COLUMN consent_ip TEXT;

-- Create payment_retry_tokens table
CREATE TABLE payment_retry_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on payment_retry_tokens
ALTER TABLE payment_retry_tokens ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (matches pattern of other tables)
CREATE POLICY "Service role full access" ON payment_retry_tokens
  FOR ALL USING (true) WITH CHECK (true);

-- Add index for token lookups
CREATE INDEX idx_payment_retry_tokens_token ON payment_retry_tokens(token);

-- Add index for payment_capture_status queries (committee reminders cron)
CREATE INDEX idx_payments_capture_status ON payments(payment_capture_status)
  WHERE payment_capture_status IS NOT NULL;
