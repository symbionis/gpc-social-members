import cron from "node-cron";
import { runRenewalReminders } from "./renewal-reminders";

let initialized = false;

export function startCronJobs() {
  if (initialized) return;
  initialized = true;

  // Renewal reminders — daily at midnight UTC (02:00 Geneva summer, 01:00 winter)
  cron.schedule("0 0 * * *", async () => {
    console.log("[cron] Running renewal reminders...");
    try {
      const result = await runRenewalReminders();
      console.log("[cron] Renewal reminders complete:", result);
    } catch (error) {
      console.error("[cron] Renewal reminders failed:", error);
    }
  });

  console.log("[cron] Scheduled: renewal-reminders (0 0 * * *)");
}
