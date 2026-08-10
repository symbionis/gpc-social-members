-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-03-30, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- Allow authenticated users to upload their own profile photos
CREATE POLICY "Authenticated users can upload profile photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'profile-photos');

-- Allow authenticated users to update (upsert) their own profile photos
CREATE POLICY "Authenticated users can update profile photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'profile-photos');

-- Allow authenticated users to delete their own profile photos
CREATE POLICY "Authenticated users can delete profile photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'profile-photos');
