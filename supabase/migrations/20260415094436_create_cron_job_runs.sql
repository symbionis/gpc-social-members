-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-15, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

CREATE TABLE cron_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  result jsonb,
  triggered_by text NOT NULL CHECK (triggered_by IN ('cron', 'manual'))
);

CREATE INDEX idx_cron_job_runs_job_key_started ON cron_job_runs (job_key, started_at DESC);

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;
