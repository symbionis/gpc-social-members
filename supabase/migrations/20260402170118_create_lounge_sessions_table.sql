-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-02, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

CREATE TABLE lounge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week text NOT NULL CHECK (day_of_week IN ('wednesday', 'saturday', 'sunday')),
  time_slot text NOT NULL CHECK (time_slot IN ('am', 'pm')),
  field_number integer NOT NULL DEFAULT 1 CHECK (field_number IN (1, 2)),
  is_open boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES admin_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO lounge_sessions (day_of_week, time_slot, field_number, is_open) VALUES
  ('wednesday', 'pm', 1, false),
  ('saturday', 'am', 1, false),
  ('sunday', 'am', 1, false);
