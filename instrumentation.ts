export async function register() {
  // Only run cron jobs on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronJobs } = await import("@/lib/cron/scheduler");
    startCronJobs();
  }
}
