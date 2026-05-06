/**
 * Fire-and-forget server-side PostHog event capture.
 *
 * Uses the standard /i/v0/e/ HTTPS capture endpoint so we don't pull in
 * `posthog-node` for the handful of server events we emit. Reads its config
 * from `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` (the same
 * vars the client uses). Silently no-ops when either is missing — useful
 * for local dev without a key and for preview deploys.
 *
 * Errors and slow PostHog responses NEVER block the calling request:
 * the fetch is intentionally not awaited at the call site, and any failure
 * is swallowed by `.catch`.
 */
export function captureServerEvent(
  event: string,
  properties: Record<string, unknown> = {},
  distinctId: string = "agent:openclaw"
): void {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const apiHost =
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
  if (!apiKey) return;

  const payload = {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties,
    timestamp: new Date().toISOString(),
  };

  // Fire and forget. Do not await; do not propagate errors.
  fetch(`${apiHost}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    /* swallow — analytics must never affect the request response */
  });
}
