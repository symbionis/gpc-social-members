-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-02, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

ALTER TABLE members ADD COLUMN IF NOT EXISTS linkedin_url text;
