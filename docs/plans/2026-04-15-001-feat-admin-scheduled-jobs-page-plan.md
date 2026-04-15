---
title: "feat: Admin scheduled jobs dashboard"
type: feat
status: active
date: 2026-04-15
---

# Admin Scheduled Jobs Dashboard

## Overview

Add a dedicated `/admin/scheduled-jobs` page that surfaces all 5 cron jobs in one view. Each job shows its schedule, enabled status, last 10 execution results, and a "Run Now" button. Replaces the single "Scheduled Job" card currently embedded in the Email Templates page.

## Problem Frame

The app runs 5 `node-cron` jobs in-process on Railway, but admin visibility is limited to a single "Scheduled Job" widget on the Email Templates page (renewal reminders only). There is no way to see whether committee reminders, payment reminders, expire-memberships, or the hold-expiry safety net have run, failed, or need manual triggering. This page gives super admins full operational visibility.

## Requirements Trace

- R1. Display all 5 cron jobs with name, description, cron schedule, and human-readable timing
- R2. Show enabled/disabled status per job (where applicable)
- R3. Store and display last 10 execution results per job (timestamp, outcome, counts)
- R4. Provide a "Run Now" button per job that triggers immediate execution
- R5. Super admin only access (consistent with Email Templates)
- R6. Remove the "Scheduled Job" section from the Email Templates page to avoid duplication

## Scope Boundaries

- No external cron service integration (jobs stay in-process via `node-cron`)
- No real-time log streaming or websocket updates
- No job scheduling configuration from the UI (schedules are code-defined)
- No enable/disable toggle for jobs that don't already have one in `email_settings`

## Context & Research

### Relevant Code and Patterns

- `lib/cron/scheduler.ts` — central scheduler with all 5 job registrations
- `lib/cron/renewal-reminders.ts`, `payment-reminders.ts`, `committee-reminders.ts`, `expire-memberships.ts` — job implementations
- `components/admin/EmailTemplateList.tsx` — existing "Scheduled Job" UI with Run Now pattern
- `app/api/admin/email-settings/run-now/route.ts` — existing run-now API (super_admin gated)
- `app/(admin)/admin/email-templates/page.tsx` — server component data fetching pattern
- `components/admin/AdminSidebar.tsx` — navigation, super_admin-gated links at lines 49-53
- `email_settings` table — stores `last_run`, `last_result` in JSON `value` column

### Institutional Learnings

- Stripe/Postmark SDK must use lazy getter pattern, never module-scope init (applies to any run-now handler importing these)

## Key Technical Decisions

- **Storage: `cron_job_runs` table** — A new table stores execution history. The existing `email_settings.value` JSON approach doesn't scale to 5 jobs and 10 runs each. A proper table allows simple queries and cleanup.
- **Job registry as static config** — Job metadata (name, description, schedule, function reference) lives in a `lib/cron/job-registry.ts` file. The UI reads this registry. No need for a database-backed job definition since schedules are code-defined.
- **Unified run-now API** — One POST endpoint `/api/admin/scheduled-jobs/run` accepts a `job_key` parameter, looks up the job in the registry, and executes it. Replaces the single-purpose `email-settings/run-now` route.
- **Log rotation** — On each run, keep only the latest 10 entries per job key. Delete older rows.

## Open Questions

### Resolved During Planning

- **Where to store run history?** New `cron_job_runs` table. The JSON-in-`email_settings` pattern doesn't scale.
- **How to wire logging into existing jobs?** A `withJobLogging` wrapper function that each job calls through. Captures start time, result, errors, and writes to `cron_job_runs`.

### Deferred to Implementation

- Exact Tailwind class names and spacing for the job cards
- Whether to show committee-reminders and hold-expiry-safety-net as one combined card or two separate cards (they share a file but run independently)

## Implementation Units

- [ ] **Unit 1: Database migration — `cron_job_runs` table**

  **Goal:** Create a table to store job execution history.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Create: Supabase migration (run via MCP or dashboard)

  **Approach:**
  - Table: `cron_job_runs` with columns: `id` (uuid, PK), `job_key` (text, indexed), `started_at` (timestamptz), `finished_at` (timestamptz), `status` (text: `success` | `error`), `result` (jsonb — stores counts like `{sent, skipped}` or error message), `triggered_by` (text: `cron` | `manual`)
  - RLS: service_role only (no anon/authenticated access needed)
  - Index on `(job_key, started_at DESC)` for efficient last-10 queries

  **Patterns to follow:**
  - Existing table conventions in `types/database.ts`

  **Test scenarios:**
  - Happy path: Insert a row and query back by job_key ordered by started_at DESC returns correct order
  - Edge case: Table allows null finished_at (job in progress)

  **Verification:**
  - Table exists in Supabase, types regenerated

- [ ] **Unit 2: Job registry and logging wrapper**

  **Goal:** Create a central registry of all jobs and a wrapper that logs execution to `cron_job_runs`.

  **Requirements:** R1, R3

  **Dependencies:** Unit 1

  **Files:**
  - Create: `lib/cron/job-registry.ts`
  - Modify: `lib/cron/scheduler.ts`

  **Approach:**
  - `job-registry.ts` exports a `JOB_REGISTRY` map keyed by `job_key` string. Each entry has: `name`, `description`, `schedule` (cron expression), `scheduleLabel` (human-readable), `run` (async function returning a result object)
  - Job keys: `renewal-reminders`, `expire-memberships`, `payment-reminders`, `committee-reminders`, `hold-expiry-safety`
  - `withJobLogging(jobKey, runFn, triggeredBy)` wrapper: records start time, calls `runFn`, writes result row to `cron_job_runs`, prunes rows older than 10th per job_key
  - Update `scheduler.ts` to call jobs through `withJobLogging` instead of directly

  **Patterns to follow:**
  - Existing lazy getter pattern for Supabase admin client (`createAdminClient()`)
  - Existing scheduler structure in `lib/cron/scheduler.ts`

  **Test scenarios:**
  - Happy path: `withJobLogging` writes a `success` row with result JSON after a job completes
  - Error path: `withJobLogging` writes an `error` row when the job throws, and does not swallow the error log
  - Edge case: Log rotation — after 12 runs for one job, only 10 rows remain
  - Integration: `JOB_REGISTRY` entries all have valid `run` functions that are callable

  **Verification:**
  - Scheduler logs show `[cron]` entries as before; `cron_job_runs` table populates on next job execution

- [ ] **Unit 3: Run-now API endpoint**

  **Goal:** Unified API to manually trigger any registered job.

  **Requirements:** R4, R5

  **Dependencies:** Unit 2

  **Files:**
  - Create: `app/api/admin/scheduled-jobs/run/route.ts`

  **Approach:**
  - POST endpoint accepting `{ job_key: string }`
  - Validates super_admin role (same pattern as `email-settings/run-now`)
  - Looks up job in `JOB_REGISTRY`, calls `withJobLogging(jobKey, job.run, 'manual')`
  - Returns the job result as JSON
  - Returns 400 for unknown job_key, 401/403 for unauthorized

  **Patterns to follow:**
  - `app/api/admin/email-settings/run-now/route.ts` — auth check pattern

  **Test scenarios:**
  - Happy path: POST with valid job_key and super_admin returns 200 with result
  - Error path: POST with unknown job_key returns 400
  - Error path: POST without super_admin role returns 401
  - Error path: Job throws internally — returns 500 with error message

  **Verification:**
  - Manual curl or browser fetch to endpoint triggers job and writes to `cron_job_runs`

- [ ] **Unit 4: Scheduled jobs page and component**

  **Goal:** Admin page displaying all jobs with status, history, and run-now buttons.

  **Requirements:** R1, R2, R3, R4, R5

  **Dependencies:** Unit 2, Unit 3

  **Files:**
  - Create: `app/(admin)/admin/scheduled-jobs/page.tsx`
  - Create: `components/admin/ScheduledJobsList.tsx`
  - Modify: `components/admin/AdminSidebar.tsx`

  **Approach:**
  - **Server component** (`page.tsx`): Fetches last 10 runs per job from `cron_job_runs` grouped by job_key. Also fetches `email_settings` for enabled/disabled status of configurable jobs. Passes data to client component.
  - **Client component** (`ScheduledJobsList.tsx`): Renders a card per job from `JOB_REGISTRY`. Each card shows:
    - Job name and description
    - Schedule (human-readable)
    - Enabled/disabled badge (for jobs with `email_settings` entries)
    - Last run timestamp and result
    - "Run Now" button with loading state
    - Expandable log view showing last 10 runs (timestamp, status, result, triggered_by)
  - **Sidebar**: Add "Scheduled Jobs" link with `icon: "clock"` in the super_admin section, between "Users" and "Email Templates"

  **Patterns to follow:**
  - `components/admin/EmailTemplateList.tsx` — Run Now button pattern, loading states
  - `app/(admin)/admin/members/page.tsx` — server component data fetching
  - Tailwind classes: `bg-marine`, `text-white`, `font-heading`, `font-body` brand tokens

  **Test scenarios:**
  - Happy path: Page renders all 5 jobs with correct names, schedules, and descriptions
  - Happy path: Run Now triggers API call, shows loading spinner, displays result on completion
  - Happy path: Log view shows last 10 runs in reverse chronological order
  - Edge case: Job with no execution history shows "Never" for last run
  - Edge case: Job currently has no `email_settings` entry — shows as "Always on" (no enable/disable toggle)
  - Error path: Run Now fails — shows error message inline, not a full-page error

  **Verification:**
  - Navigate to `/admin/scheduled-jobs` as super_admin, see all 5 jobs
  - Click "Run Now" on a job, see it execute and log entry appear
  - Non-super-admin cannot see the link in sidebar

- [ ] **Unit 5: Clean up Email Templates page**

  **Goal:** Remove the "Scheduled Job" section from Email Templates to avoid duplication.

  **Requirements:** R6

  **Dependencies:** Unit 4

  **Files:**
  - Modify: `components/admin/EmailTemplateList.tsx`
  - Modify: `app/(admin)/admin/email-templates/page.tsx` (if it passes scheduled job data that's no longer needed)

  **Approach:**
  - Remove the "Scheduled Job" card, "Run Now" button, and associated state (`runningNow`, `runResult`, `lastRun`, `lastResult`) from `EmailTemplateList.tsx`
  - Keep the auto-renewal reminder settings (enable/disable, reminder day configuration) since those are email template configuration, not job monitoring
  - Optionally add a small link: "View job status in Scheduled Jobs" pointing to the new page

  **Patterns to follow:**
  - Existing component structure in `EmailTemplateList.tsx`

  **Test scenarios:**
  - Happy path: Email Templates page no longer shows the "Scheduled Job" section
  - Happy path: Auto-renewal settings still save and load correctly
  - Integration: "Run Now" is only available on the new Scheduled Jobs page

  **Verification:**
  - Email Templates page loads without the scheduled job widget
  - Settings save/load still works

## System-Wide Impact

- **Interaction graph:** The `withJobLogging` wrapper wraps all 5 existing job functions. Any changes to job return types need to stay JSON-serializable.
- **Error propagation:** Job errors are caught by the wrapper and stored as `error` status rows. The scheduler's existing `console.error` logging is preserved.
- **State lifecycle risks:** Log rotation (keep 10) runs after each job — low risk of table bloat.
- **API surface parity:** The existing `/api/admin/email-settings/run-now` endpoint becomes redundant. It can be kept for backward compatibility or removed in this PR.
- **Unchanged invariants:** `email_settings` table and its PATCH API remain unchanged. Auto-renewal settings UI stays on the Email Templates page.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `withJobLogging` wrapper adds latency to job execution | Wrapper only does a single INSERT + DELETE (prune). Negligible overhead. |
| Logging writes fail (Supabase down) | Wrapper catches logging errors separately from job errors. Job still runs even if logging fails. |
| Run Now on committee-reminders sends real emails in production | This is by design — same as existing Run Now. Add a confirmation prompt on the button for safety. |

## Sources & References

- Related code: `lib/cron/scheduler.ts`, `components/admin/EmailTemplateList.tsx`
- Related UI: Existing "Scheduled Job" widget on Email Templates page
