import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_DEFINITIONS, type JobUIDefinition } from "./job-definitions";
import { runRenewalReminders } from "./renewal-reminders";
import { runPaymentReminders } from "./payment-reminders";
import {
  runCommitteeReminders,
  runHoldExpirySafetyNet,
} from "./committee-reminders";
import { runExpireMemberships } from "./expire-memberships";

export type { JobUIDefinition };
export { JOB_DEFINITIONS };

export interface JobDefinition extends JobUIDefinition {
  run: () => Promise<Record<string, unknown>>;
}

const JOB_RUNNERS: Record<string, () => Promise<Record<string, unknown>>> = {
  "renewal-reminders": async () => ({ ...await runRenewalReminders() }),
  "expire-memberships": async () => ({ ...await runExpireMemberships() }),
  "payment-reminders": async () => ({ ...await runPaymentReminders() }),
  "committee-reminders": async () => ({ ...await runCommitteeReminders() }),
  "hold-expiry-safety": async () => ({ ...await runHoldExpirySafetyNet() }),
};

export const JOB_REGISTRY: Record<string, JobDefinition> = Object.fromEntries(
  Object.entries(JOB_DEFINITIONS).map(([key, def]) => [
    key,
    { ...def, run: JOB_RUNNERS[key] },
  ])
);

const MAX_RUNS_PER_JOB = 10;

export async function withJobLogging(
  jobKey: string,
  runFn: () => Promise<Record<string, unknown>>,
  triggeredBy: "cron" | "manual"
): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();
  const startedAt = new Date().toISOString();

  let result: Record<string, unknown>;
  let status: "success" | "error";

  let thrownError: unknown = null;

  try {
    result = await runFn();
    status = "success";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { error: message };
    status = "error";
    thrownError = err;
    console.error(`[cron][${jobKey}] Job failed:`, err);
  }

  const finishedAt = new Date().toISOString();

  try {
    await supabase.from("cron_job_runs").insert({
      job_key: jobKey,
      started_at: startedAt,
      finished_at: finishedAt,
      status,
      result,
      triggered_by: triggeredBy,
    });

    // Prune old rows — keep only the latest MAX_RUNS_PER_JOB
    const { data: rows } = await supabase
      .from("cron_job_runs")
      .select("id")
      .eq("job_key", jobKey)
      .order("started_at", { ascending: false })
      .range(MAX_RUNS_PER_JOB, 999);

    if (rows && rows.length > 0) {
      await supabase
        .from("cron_job_runs")
        .delete()
        .in(
          "id",
          rows.map((r) => r.id)
        );
    }
  } catch (logErr) {
    console.error(`[cron][${jobKey}] Failed to write job log:`, logErr);
  }

  // Re-throw after logging so callers (API route) can return proper HTTP error
  if (thrownError) throw thrownError;

  return result;
}
