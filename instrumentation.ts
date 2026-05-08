import type { Instrumentation } from "next";

export async function register() {
  // Only run cron jobs on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronJobs } = await import("@/lib/cron/scheduler");
    startCronJobs();
  }
}

// PostHog Error Tracking: forward unhandled exceptions thrown from API routes,
// server components, and server actions. Handled responses (4xx returned by
// route logic) do NOT reach this hook — only true exceptions do.
//
// The whole body is wrapped: this hook fires *because a request already
// errored*, so a second exception here would pollute logs and risk masking
// the original. Telemetry must never amplify failure.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  try {
    const { captureServerException } = await import(
      "@/lib/analytics/server-errors"
    );
    captureServerException(error, {
      path: request.path,
      method: request.method,
      route_kind: context.routerKind,
    });
  } catch {
    /* telemetry must never throw */
  }
};
