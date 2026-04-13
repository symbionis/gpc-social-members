import cron from "node-cron";
import { runRenewalReminders } from "./renewal-reminders";
import { runPaymentReminders } from "./payment-reminders";
import { runCommitteeReminders, runHoldExpirySafetyNet } from "./committee-reminders";

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

  // Payment reminders — daily at 08:00 UTC (10:00 Geneva summer, 09:00 winter)
  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] Running payment reminders...");
    try {
      const result = await runPaymentReminders();
      console.log("[cron] Payment reminders complete:", result);
    } catch (error) {
      console.error("[cron] Payment reminders failed:", error);
    }
  });

  // Committee reminders — hourly (remind committee about pending applications with card holds)
  cron.schedule("0 * * * *", async () => {
    console.log("[cron] Running committee reminders...");
    try {
      const result = await runCommitteeReminders();
      console.log("[cron] Committee reminders complete:", result);
    } catch (error) {
      console.error("[cron] Committee reminders failed:", error);
    }
  });

  // Hold expiry safety net — daily at 02:00 UTC (catch missed payment_intent.canceled webhooks)
  cron.schedule("0 2 * * *", async () => {
    console.log("[cron] Running hold expiry safety net...");
    try {
      const result = await runHoldExpirySafetyNet();
      console.log("[cron] Hold expiry safety net complete:", result);
    } catch (error) {
      console.error("[cron] Hold expiry safety net failed:", error);
    }
  });

  console.log("[cron] Scheduled: renewal-reminders (0 0 * * *)");
  console.log("[cron] Scheduled: payment-reminders (0 8 * * *)");
  console.log("[cron] Scheduled: committee-reminders (0 * * * *)");
  console.log("[cron] Scheduled: hold-expiry-safety (0 2 * * *)");
}
