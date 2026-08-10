-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied directly to the database on 2026-06-04 and never committed, so the repo
-- could not rebuild the schema from scratch. Content is the exact SQL the ledger
-- recorded; the version stamp matches the ledger row, so `db push` treats it as
-- already applied and will not re-run it.

-- SECURITY FIX: Supabase default privileges grant EXECUTE on new public functions
-- to anon + authenticated; REVOKE ... FROM PUBLIC does not remove those. These two
-- functions are SECURITY DEFINER (bypass RLS), so they must be service_role-only.
REVOKE EXECUTE ON FUNCTION public.seed_lead_attendee(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.import_event_attendees(uuid, jsonb) FROM anon, authenticated;
