import { createAdminClient } from "@/lib/supabase/admin";
import ScheduledJobsList from "@/components/admin/ScheduledJobsList";
import EventReminderSettings from "@/components/admin/EventReminderSettings";

type Slot = "morning" | "lunch" | "evening";

const DEFAULT_REMINDER_SETTINGS = {
  presets: [
    { days_before: 1, slot: "morning" as Slot, enabled: true },
    { days_before: 0, slot: "morning" as Slot, enabled: false },
  ],
  slot_times: { morning: "08:00", lunch: "12:00", evening: "18:00" } as Record<
    Slot,
    string
  >,
};

export default async function ScheduledJobsPage() {
  const supabase = createAdminClient();

  const [{ data: runs }, { data: settings }, { data: reminderSetting }] =
    await Promise.all([
      supabase
        .from("cron_job_runs")
        .select("id, job_key, started_at, finished_at, status, result, triggered_by")
        .order("started_at", { ascending: false })
        .limit(100),
      supabase.from("email_settings").select("key, enabled"),
      supabase
        .from("email_settings")
        .select("enabled, value")
        .eq("key", "event_reminder_default")
        .limit(1)
        .maybeSingle(),
    ]);

  const reminderValue =
    (reminderSetting?.value as typeof DEFAULT_REMINDER_SETTINGS | null) ||
    DEFAULT_REMINDER_SETTINGS;

  return (
    <div>
      <h1 className="text-2xl font-heading font-bold text-marine mb-6">
        Scheduled Jobs
      </h1>
      <EventReminderSettings
        initialEnabled={reminderSetting?.enabled ?? true}
        initialValue={reminderValue}
      />
      <ScheduledJobsList
        runs={runs || []}
        emailSettings={settings || []}
      />
    </div>
  );
}
