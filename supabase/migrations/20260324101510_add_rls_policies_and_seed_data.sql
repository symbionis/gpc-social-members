-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-03-24, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- ROW LEVEL SECURITY
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

-- Tiers: publicly readable (signup page)
CREATE POLICY "Tiers are publicly readable"
  ON membership_tiers FOR SELECT USING (true);

-- Seasons: publicly readable
CREATE POLICY "Seasons are publicly readable"
  ON seasons FOR SELECT USING (true);

-- Members: read own record
CREATE POLICY "Members can read own record"
  ON members FOR SELECT
  USING (auth.uid() = auth_user_id);

-- Members: admins read all
CREATE POLICY "Admins can read all members"
  ON members FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid()));

-- Members: admins insert
CREATE POLICY "Admins can insert members"
  ON members FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid()));

-- Members: admins update
CREATE POLICY "Admins can update members"
  ON members FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid()));

-- Members: update own profile
CREATE POLICY "Members can update own profile"
  ON members FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

-- Members: anonymous application submission
CREATE POLICY "Anyone can submit application"
  ON members FOR INSERT
  WITH CHECK (status = 'pending');

-- Payments: members see own
CREATE POLICY "Members can read own payments"
  ON payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM members WHERE members.id = payments.member_id AND members.auth_user_id = auth.uid()));

-- Payments: admins manage all
CREATE POLICY "Admins can manage payments"
  ON payments FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid()));

-- Cards: members see own
CREATE POLICY "Members can read own card"
  ON membership_cards FOR SELECT
  USING (EXISTS (SELECT 1 FROM members WHERE members.id = membership_cards.member_id AND members.auth_user_id = auth.uid()));

-- Cards: admins manage all
CREATE POLICY "Admins can manage cards"
  ON membership_cards FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid()));

-- Applications: admins manage all
CREATE POLICY "Admins can manage applications"
  ON applications FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid()));

-- Admin users: admins can read
CREATE POLICY "Admins can read admin users"
  ON admin_users FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.auth_user_id = auth.uid()));

-- Admin users: super admins manage
CREATE POLICY "Super admins can manage admin users"
  ON admin_users FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.auth_user_id = auth.uid() AND au.role = 'super_admin'));

-- Referrals: originators see own
CREATE POLICY "Originators can read own referrals"
  ON referrals FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = referrals.originator_id AND admin_users.auth_user_id = auth.uid()));

-- Referrals: super admins manage all
CREATE POLICY "Super admins can manage all referrals"
  ON referrals FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.auth_user_id = auth.uid() AND admin_users.role = 'super_admin'));

-- SEED: Membership Tiers
INSERT INTO membership_tiers (name, slug, category, price_eur, company_size_label, benefits, sort_order) VALUES
('Classic Social Membership', 'classic', 'individual', 500.00, NULL, '["Digital membership card", "General access to events and tournaments", "Remerciements", "Exclusive VIP lodge", "Welcome kit", "Guest invitations"]'::jsonb, 1),
('Elite Social Membership', 'elite', 'individual', 1000.00, NULL, '["Digital membership card", "Full access to events and tournaments", "Special offers and gifts from club partners", "Remerciements", "Exclusive VIP lodge", "Welcome kit", "Guest invitations"]'::jsonb, 2),
('Corporate Social Membership (Small)', 'corporate-small', 'corporate', 3000.00, 'Up to 50 employees', '["Digital membership card", "Company logo on club website and remerciements", "Team photo with a club polo team", "1 fieldside private afterwork with polo match", "Guest invitations"]'::jsonb, 3),
('Corporate Social Membership (Medium)', 'corporate-medium', 'corporate', 6000.00, 'Up to 100 employees', '["Digital membership card", "Company logo on club website and remerciements", "Team photo with a club polo team", "1 fieldside private afterwork with polo match", "Guest invitations"]'::jsonb, 4),
('Corporate Social Membership (Large)', 'corporate-large', 'corporate', 12000.00, '200+ employees', '["Digital membership card", "Company logo on club website and remerciements", "Team photo with a club polo team", "1 fieldside private afterwork with polo match", "Guest invitations"]'::jsonb, 5);

-- SEED: Seasons
INSERT INTO seasons (name, slug, start_date, end_date, is_current) VALUES
('2025 Season', '2025', '2025-04-26', '2025-09-28', false),
('2026 Season', '2026', '2026-04-25', '2026-09-27', true);
