// Server-only. Do NOT import from client components.
//
// Captures unhandled exceptions to PostHog Error Tracking. Lazily instantiates
// a single posthog-node client (env-keyed) so it never runs at import time —
// the lazy-init pattern avoids breaking the Next build on Railway when the
// env vars are absent during a particular build phase.
//
// Always fire-and-forget: capture failures must never affect the calling
// request. The sanitizeContext allowlist enforces that no raw request bodies,
// headers, or query strings reach PostHog.

import "server-only";
import { PostHog } from "posthog-node";

let client: PostHog | null = null;
let initialized = false;

function getServerPosthog(): PostHog | null {
  if (initialized) return client;
  initialized = true;

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const apiHost =
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
  if (!apiKey) {
    client = null;
    return null;
  }

  client = new PostHog(apiKey, {
    host: apiHost,
    flushAt: 1, // exceptions are rare; ship immediately
    flushInterval: 0,
  });
  return client;
}

const ALLOWED_CONTEXT_KEYS = new Set([
  "path",
  "method",
  "status",
  "user_id",
  "distinct_id",
  "route_kind",
  "digest",
]);

function sanitizeContext(
  context: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    const value = context[key];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Capture a server-side exception to PostHog Error Tracking. Fire-and-forget;
 * never throws, never blocks the caller. Context is sanitized to a small
 * allowlist of safe metadata keys.
 */
export function captureServerException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  const ph = getServerPosthog();
  if (!ph) return;

  const safeContext = sanitizeContext(context);
  const distinctId =
    (typeof safeContext.distinct_id === "string" && safeContext.distinct_id) ||
    (typeof safeContext.user_id === "string" && safeContext.user_id) ||
    "server:anonymous";

  try {
    const err = error instanceof Error ? error : new Error(String(error));
    ph.captureException(err, distinctId, safeContext);
  } catch {
    /* swallow — error tracking must never affect the request response */
  }
}
