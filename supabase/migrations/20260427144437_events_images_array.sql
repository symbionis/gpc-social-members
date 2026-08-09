-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-27, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

-- Add images array (first item = hero)
ALTER TABLE events
  ADD COLUMN images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill from existing image_url + image_url_2
UPDATE events
SET images = (
  SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
  FROM (
    SELECT image_url AS v WHERE image_url IS NOT NULL
    UNION ALL
    SELECT image_url_2 AS v WHERE image_url_2 IS NOT NULL
  ) AS t
)
WHERE image_url IS NOT NULL OR image_url_2 IS NOT NULL;
