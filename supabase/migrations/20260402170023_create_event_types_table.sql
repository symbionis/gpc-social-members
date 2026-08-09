-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-02, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

CREATE TABLE event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#5BA4C9',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO event_types (name, slug, color, sort_order) VALUES
  ('Tournament', 'tournament', '#052938', 0),
  ('Social', 'social', '#5BA4C9', 1),
  ('Dinner', 'dinner', '#8B6914', 2),
  ('Tasting', 'tasting', '#7B2D3B', 3),
  ('Wellness', 'wellness', '#4A7C59', 4);
