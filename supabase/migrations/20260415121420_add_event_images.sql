-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-15, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- Add image URL columns to events table
ALTER TABLE events
  ADD COLUMN image_url text,
  ADD COLUMN image_url_2 text;

-- Create storage bucket for event images
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to read event images
CREATE POLICY "Public read access for event images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

-- Allow admins to upload event images (authenticated users)
CREATE POLICY "Authenticated users can upload event images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'event-images' AND auth.role() = 'authenticated');

-- Allow admins to update/overwrite event images
CREATE POLICY "Authenticated users can update event images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'event-images' AND auth.role() = 'authenticated');

-- Allow admins to delete event images
CREATE POLICY "Authenticated users can delete event images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'event-images' AND auth.role() = 'authenticated');
