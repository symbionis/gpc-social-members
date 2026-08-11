"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { redactUrlForAnalytics } from "@/lib/analytics/redact-path";
import { redactAnalyticsEvent } from "@/lib/analytics/redact-event";

/**
 * Initializes PostHog and tracks pageviews on App Router navigation.
 *
 * Web analytics only — session replay, surveys, and heatmaps are disabled.
 * Reads its config from data-attributes on <body> so Railway runtime envs
 * work even when not baked into the build (matches the Supabase pattern in
 * `app/layout.tsx`).
 */
export default function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as { __ph_initialized?: boolean }).__ph_initialized) return;

    const body = document.body;
    const key =
      body.getAttribute("data-posthog-key") ||
      process.env.NEXT_PUBLIC_POSTHOG_KEY ||
      "";
    const host =
      body.getAttribute("data-posthog-host") ||
      process.env.NEXT_PUBLIC_POSTHOG_HOST ||
      "https://eu.i.posthog.com";

    if (!key) return; // No key configured — silently no-op (e.g. preview deploys without analytics).

    posthog.init(key, {
      api_host: host,
      defaults: "2026-01-30",
      person_profiles: "identified_only",
      capture_pageview: false, // we manually capture on App Router route changes
      capture_pageleave: true,
      disable_session_recording: true,
      disable_surveys: true,
      autocapture: true,
      capture_exceptions: true,
      // U5/KTD4 offer-token redaction plus third-party noise filtering. The body
      // lives in lib/analytics/redact-event.ts so it is unit-testable — the leak
      // this guards against was a property of the hook, not of its helpers.
      before_send: redactAnalyticsEvent,
    });

    (window as { __ph_initialized?: boolean }).__ph_initialized = true;
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  );
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!(window as { __ph_initialized?: boolean }).__ph_initialized) return;
    if (!pathname) return;

    // U5/KTD4: an offer path carries a long-lived emailed secret — in its last
    // segment on the landing itself, and in ?next= on the /login round trip
    // (AE8). Redact the whole URL, never just the path.
    const url = redactUrlForAnalytics(
      window.location.origin +
        pathname +
        (searchParams && searchParams.toString()
          ? `?${searchParams.toString()}`
          : "")
    );

    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
