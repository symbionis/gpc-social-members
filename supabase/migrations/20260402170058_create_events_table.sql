-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-02, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id uuid NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  season_id uuid REFERENCES seasons(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  start_date date NOT NULL,
  end_date date,
  start_time time,
  location text,
  is_confirmed boolean NOT NULL DEFAULT true,
  is_published boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_published_date ON events (start_date) WHERE is_published = true;

INSERT INTO events (event_type_id, title, start_date, end_date, is_confirmed, season_id)
SELECT et.id, v.title, v.start_date::date, v.end_date::date, v.is_confirmed, s.id
FROM (VALUES
  ('Daisy Cup', '2026-05-16', '2026-05-17', false),
  ('Season Open', '2026-06-05', '2026-06-07', true),
  ('Solstice Cup', '2026-06-20', '2026-06-21', false),
  ('Sun Cup', '2026-07-11', '2026-07-12', false),
  ('Fire & Ice Cup', '2026-08-29', '2026-08-30', false),
  ('Season Finale', '2026-09-11', '2026-09-13', true)
) AS v(title, start_date, end_date, is_confirmed)
CROSS JOIN event_types et
CROSS JOIN (SELECT id FROM seasons WHERE is_current = true LIMIT 1) s
WHERE et.slug = 'tournament';
