-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied directly to the database on 2026-05-20 and never committed, so the repo
-- could not rebuild the schema from scratch. Content is the exact SQL the ledger
-- recorded; the version stamp matches the ledger row, so `db push` treats it as
-- already applied and will not re-run it.

-- Enable RLS on event_checkins with no policies: only the service-role key (used
-- by all server-side check-in/admin code) can access it; anon/authenticated are
-- denied. Matches the posture of event_registrations and the other core tables.
ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;
