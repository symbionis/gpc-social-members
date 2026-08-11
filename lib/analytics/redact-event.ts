// The body of PostHog's `before_send` hook, extracted from
// components/PostHogProvider.tsx so it can be unit-tested without a DOM or a live
// posthog-js.
//
// This is where the offer-token redaction actually takes effect. Testing only the
// pure redactPathForAnalytics/redactUrlForAnalytics helpers proved nothing about
// the hook: the helpers were already correct when autocapture was still shipping
// live tokens, because the hook applied them to too little. Cover the hook.
//
// See U5/KTD4 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md.

import { redactPathForAnalytics, redactUrlForAnalytics } from "./redact-path";

/** The shape of a captured event this hook touches. Structural, so it accepts
 * posthog-js's CaptureResult without importing its types into tests. */
export interface CapturedEventLike {
  event?: string;
  properties?: Record<string, unknown>;
}

// Browser-extension and in-app-webview noise: thrown by code that is not ours and
// that we cannot fix, on pages we do not control.
const DROPPED_EXCEPTION_FRAGMENTS = [
  // A content script (commonly Microsoft Editor and similar) throws this verbatim.
  "Object Not Found Matching Id",
  // Android WebView: native bridge GC'd while a JS postMessage was in flight.
  "Java object is gone",
  // iOS WKWebView: third-party SDK probing for a handler the host app never registered.
  "window.webkit.messageHandlers",
];

/**
 * Redacts offer tokens from a captured event and drops known third-party noise.
 * Returns null to discard the event, mirroring PostHog's `before_send` contract.
 *
 * Mutates and returns the event it is given, as the hook does.
 */
export function redactAnalyticsEvent<T extends CapturedEventLike | null>(
  event: T
): T | null {
  if (!event) return event;

  // Redact on EVERY captured event, not just the manual $pageview: autocapture
  // (clicks, form submits) and $exception stamp $current_url/$pathname from
  // window.location independently of that call.
  if (typeof event.properties?.$current_url === "string") {
    event.properties.$current_url = redactUrlForAnalytics(
      event.properties.$current_url
    );
  }
  if (typeof event.properties?.$pathname === "string") {
    event.properties.$pathname = redactPathForAnalytics(
      event.properties.$pathname
    );
  }

  if (event.event === "$exception") {
    const list = event.properties?.$exception_list as
      | Array<{ value?: string; type?: string }>
      | undefined;
    const value = list?.[0]?.value || "";
    if (DROPPED_EXCEPTION_FRAGMENTS.some((f) => value.includes(f))) return null;
  }

  return event;
}
