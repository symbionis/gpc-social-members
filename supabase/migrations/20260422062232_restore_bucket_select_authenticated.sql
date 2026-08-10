-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-22, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

create policy "Authenticated can read profile photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'profile-photos');

create policy "Authenticated can read event images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'event-images');
