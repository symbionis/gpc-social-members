import { captureServerEvent } from "@/lib/analytics/server";

/**
 * Fire a PostHog `agent_action` event for an agent route. Designed so the
 * call site is one line per return path:
 *
 *   trackAgentAction({ endpoint: "/api/agent/events", method: "GET",
 *                      status_code: 200, started_at, extra: { count: 12 } });
 *   return NextResponse.json(...);
 *
 * Fire-and-forget; never throws.
 */
export function trackAgentAction(args: {
  endpoint: string;
  method: string;
  status_code: number;
  started_at: number;
  extra?: Record<string, unknown>;
}): void {
  captureServerEvent("agent_action", {
    endpoint: args.endpoint,
    method: args.method,
    status_code: args.status_code,
    latency_ms: Date.now() - args.started_at,
    ...(args.extra ?? {}),
  });
}
