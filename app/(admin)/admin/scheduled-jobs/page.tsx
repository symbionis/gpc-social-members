import { createAdminClient } from "@/lib/supabase/admin";
import ScheduledJobsList from "@/components/admin/ScheduledJobsList";

export default async function ScheduledJobsPage() {
  const supabase = createAdminClient();

  const [{ data: runs }, { data: settings }] = await Promise.all([
    supabase
      .from("cron_job_runs")
      .select("id, job_key, started_at, finished_at, status, result, triggered_by")
      .order("started_at", { ascending: false })
      .limit(100),
    supabase
      .from("email_settings")
      .select("key, enabled"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-heading font-bold text-marine mb-6">
        Scheduled Jobs
      </h1>
      <ScheduledJobsList
        runs={runs || []}
        emailSettings={settings || []}
      />
    </div>
  );
}
