-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-03-24, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ENUM TYPES
CREATE TYPE member_status AS ENUM (
  'pending', 'approved', 'active', 'expired', 'suspended', 'declined'
);

CREATE TYPE payment_status AS ENUM (
  'free', 'pending', 'paid', 'overdue', 'refunded'
);

CREATE TYPE admin_role AS ENUM (
  'super_admin', 'team_admin'
);

CREATE TYPE membership_category AS ENUM (
  'individual', 'corporate'
);

-- MEMBERSHIP TIERS
CREATE TABLE membership_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category membership_category NOT NULL,
  price_eur NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  company_size_label TEXT,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  guest_invitations_per_season INTEGER NOT NULL DEFAULT 2,
  stripe_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADMIN USERS
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role admin_role NOT NULL DEFAULT 'team_admin',
  is_originator BOOLEAN NOT NULL DEFAULT false,
  is_approval_committee BOOLEAN NOT NULL DEFAULT false,
  invite_code TEXT UNIQUE,
  invite_link_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MEMBERS
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  member_number TEXT UNIQUE,
  title TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  company_name TEXT,
  company_role TEXT,
  profile_photo_url TEXT,
  tier_id UUID NOT NULL REFERENCES membership_tiers(id),
  status member_status NOT NULL DEFAULT 'pending',
  originator_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  originator_note TEXT,
  approved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  declined_reason TEXT,
  start_date DATE,
  end_date DATE,
  is_migrated BOOLEAN NOT NULL DEFAULT false,
  communication_preferences JSONB NOT NULL DEFAULT '{"email": true, "sms": false}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_tier ON members(tier_id);
CREATE INDEX idx_members_originator ON members(originator_id);
CREATE INDEX idx_members_email ON members(email);
CREATE INDEX idx_members_member_number ON members(member_number);

-- APPLICATIONS
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status member_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_member ON applications(member_id);

-- PAYMENTS
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES membership_tiers(id),
  amount_eur NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_status payment_status NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_invoice_id TEXT,
  payment_method TEXT,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  season TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_member ON payments(member_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_payments_stripe ON payments(stripe_payment_intent_id);

-- DIGITAL MEMBERSHIP CARDS
CREATE TABLE membership_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  card_number TEXT NOT NULL UNIQUE,
  qr_code_data TEXT NOT NULL,
  tier_id UUID NOT NULL REFERENCES membership_tiers(id),
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cards_member ON membership_cards(member_id);
CREATE INDEX idx_cards_qr ON membership_cards(qr_code_data);

-- REFERRALS
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  originator_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  invite_code_used TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_originator ON referrals(originator_id);
CREATE INDEX idx_referrals_member ON referrals(member_id);

-- SEASONS
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  renewal_open_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MEMBER NUMBER SEQUENCE
CREATE SEQUENCE member_number_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_member_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.member_number IS NULL THEN
    NEW.member_number := 'GPC-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(nextval('member_number_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_number
  BEFORE INSERT ON members
  FOR EACH ROW
  EXECUTE FUNCTION generate_member_number();

-- UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tiers_updated_at
  BEFORE UPDATE ON membership_tiers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
