-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-03-30, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

ALTER TABLE admin_users ADD COLUMN can_invite_honorary boolean NOT NULL DEFAULT false;
