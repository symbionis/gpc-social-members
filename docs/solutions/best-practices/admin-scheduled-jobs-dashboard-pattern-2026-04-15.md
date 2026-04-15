---
title: Admin scheduled jobs dashboard with centralized registry and execution logging
date: 2026-04-15
category: best-practices
module: admin-panel
problem_type: best_practice
component: background_job
severity: medium
applies_when:
  - Adding new cron jobs to the application
  - Admin needs visibility into whether background jobs are running
  - Manual triggering of cron jobs is needed for testing or operational purposes
tags:
  - cron-jobs
  - admin-panel
  - node-cron
  - job-registry
  - execution-logging
  - scheduled-tasks
  - supabase
---

# Admin scheduled jobs dashboard with centralized registry and execution logging

## Context

The app runs 5 `node-cron` jobs in-process on Railway (renewal reminders, expire memberships, payment reminders, committee reminders, hold-expiry safety net). Admin visibility was limited to a single "Scheduled Job" widget on the Email Templates page showing only renewal reminders. There was no way to see whether other jobs had run, failed, or needed manual triggering.

## Guidance

### Shared job definitions (single source of truth)

Extract job metadata into a server/client-safe file (`lib/cron/job-definitions.ts`) that both the server-side registry and client component import from. This eliminates duplication drift.

```typescript
// lib/cron/job-definitions.ts
export interface JobUIDefinition {
  name: string;
  description: string;
  schedule: string;
  scheduleLabel: string;
  emailSettingsKey?: string;
}

export const JOB_DEFINITIONS: Record<string, JobUIDefinition> = {
  "renewal-reminders": {
    name: "Renewal Reminders",
    description: "Sends multi-stage email reminders...",
    schedule: "0 0 * * *",
    scheduleLabel: "Daily at 00:00 UTC",
    emailSettingsKey: "auto_renewal_reminder",
  },
  // ... other jobs
};
```

### Job registry with logging wrapper

The server-side registry extends definitions with `run` functions and a `withJobLogging` wrapper that records every execution to a `cron_job_runs` table.

Key design decisions:
- **Re-throw after logging**: `withJobLogging` catches errors to write the log row, then re-throws so API callers receive proper HTTP 500 responses. The scheduler's own try/catch handles the re-throw for cron-triggered runs.
- **Log rotation**: After each run, prune rows beyond the 10 most recent per job key.
- **Unified run-now endpoint**: One POST endpoint (`/api/admin/scheduled-jobs/run`) accepts a `job_key` parameter and looks it up in the registry. Validates `typeof jobKey === "string"` and uses a static error message for unknown keys (never reflects user input).

### Execution history table

```sql
CREATE TABLE cron_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  result jsonb,
  triggered_by text NOT NULL CHECK (triggered_by IN ('cron', 'manual'))
);

CREATE INDEX idx_cron_job_runs_job_key_started
  ON cron_job_runs (job_key, started_at DESC);

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;
```

### Admin page pattern

Server component fetches runs and email settings in parallel, passes to a client component that renders cards per job with:
- Name, description, schedule, enabled/disabled badge
- Last run timestamp, status, and result
- "Run Now" button with `confirm()` dialog and loading state
- Expandable history table (last 10 runs with duration, status, trigger)

## Why This Matters

Without centralized job visibility, admins cannot tell whether background processes are running correctly. Failed cron jobs go unnoticed until members complain about missing emails or expired memberships not being processed. The dashboard provides operational confidence and a manual override for testing.

## When to Apply

- When adding any new `node-cron` job: add it to `JOB_DEFINITIONS` and `JOB_RUNNERS` — it automatically appears in the dashboard
- When debugging "did this job run?": check the Scheduled Jobs page instead of Railway logs
- When testing a job in production: use Run Now instead of waiting for the cron schedule

## Examples

Adding a new job requires two changes:

1. Add the definition to `lib/cron/job-definitions.ts`:
```typescript
"new-job-key": {
  name: "New Job",
  description: "What it does",
  schedule: "0 6 * * *",
  scheduleLabel: "Daily at 06:00 UTC",
},
```

2. Add the runner to `lib/cron/job-registry.ts`:
```typescript
const JOB_RUNNERS: Record<string, () => Promise<Record<string, unknown>>> = {
  // ... existing runners
  "new-job-key": async () => ({ ...await runNewJob() }),
};
```

The scheduler, API endpoint, and admin page all pick it up automatically.

## Related

- `lib/cron/scheduler.ts` — central scheduler using `node-cron`
- `lib/cron/job-definitions.ts` — shared job metadata
- `lib/cron/job-registry.ts` — server registry with logging wrapper
- `app/(admin)/admin/scheduled-jobs/page.tsx` — admin page
- `components/admin/ScheduledJobsList.tsx` — client component
