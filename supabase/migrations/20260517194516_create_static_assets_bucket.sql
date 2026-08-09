-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied directly to the database on 2026-05-17 and never committed, so the repo
-- could not rebuild the schema from scratch. Content is the exact SQL the ledger
-- recorded; the version stamp matches the ledger row, so `db push` treats it as
-- already applied and will not re-run it.

INSERT INTO storage.buckets (id, name, public) VALUES ('static-assets', 'static-assets', true) ON CONFLICT (id) DO NOTHING;
