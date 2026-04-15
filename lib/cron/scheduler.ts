import cron from "node-cron";
import { JOB_REGISTRY, withJobLogging } from "./job-registry";

let initialized = false;

export function startCronJobs() {
  if (initialized) return;
  initialized = true;

  for (const [jobKey, job] of Object.entries(JOB_REGISTRY)) {
    cron.schedule(job.schedule, async () => {
      console.log(`[cron] Running ${jobKey}...`);
      try {
        const result = await withJobLogging(jobKey, job.run, "cron");
        console.log(`[cron] ${jobKey} complete:`, result);
      } catch (error) {
        console.error(`[cron] ${jobKey} failed:`, error);
      }
    });

    console.log(`[cron] Scheduled: ${jobKey} (${job.schedule})`);
  }
}
