"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { redactPathForAnalytics } from "@/lib/analytics/redact-path";

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
      before_send: (event) => {
        if (!event) return event;
        // U5/KTD4: redact the offer token from EVERY captured event, not just the
        // manual $pageview call below — autocapture (clicks, form submits) and
        // $exception events stamp $current_url/$pathname from window.location
        // independently of that call, and would otherwise ship the live token.
        if (typeof event.properties?.$current_url === "string") {
          try {
            const url = new URL(event.properties.$current_url);
            url.pathname = redactPathForAnalytics(url.pathname);
            event.properties.$current_url = url.toString();
          } catch {
            /* malformed $current_url — leave as-is rather than throw in an analytics hook */
          }
        }
        if (typeof event.properties?.$pathname === "string") {
          event.properties.$pathname = redactPathForAnalytics(event.properties.$pathname);
        }
        if (event.event === "$exception") {
          const list = event.properties?.$exception_list as
            | Array<{ value?: string; type?: string }>
            | undefined;
          const first = list?.[0];
          const value = first?.value || "";
          // Browser-extension noise: a content script (commonly Microsoft Editor
          // and similar) throws this verbatim into the page. Not our code.
          if (value.includes("Object Not Found Matching Id")) return null;
          // Android WebView in-app browser: native bridge is GC'd while a JS
          // postMessage is in flight (user backgrounded the host app).
          if (value.includes("Java object is gone")) return null;
          // iOS WKWebView in-app browser: third-party SDK/bridge code probes for
          // a native message handler the host app didn't register.
          if (value.includes("window.webkit.messageHandlers")) return null;
        }
        return event;
      },
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

    // U5/KTD4: an offer path carries a long-lived emailed secret in its last
    // segment — never ship the live token to PostHog.
    const url =
      window.location.origin +
      redactPathForAnalytics(pathname) +
      (searchParams && searchParams.toString()
        ? `?${searchParams.toString()}`
        : "");

    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
