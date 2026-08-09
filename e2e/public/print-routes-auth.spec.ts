import { test, expect } from "@playwright/test";

// The (print) route group is the one admin surface with no layer behind it:
// middleware.ts only matches /admin and the member routes, and
// app/(print)/layout.tsx is presentational with no auth. Each page's own
// requireAdminUser() call is therefore the ONLY thing keeping /print/* off the
// public internet — lose that line and the route is world-readable with nothing
// else to catch it.
//
// Lives in the public project (unauthenticated by construction, no fixtures and
// no seeded admin needed) so it runs on every run in every environment. It used
// to sit in admin/events-flyer.spec.ts behind that suite's events-admin gate,
// which meant this guard was never actually exercised.

test.describe("Print routes require an admin session", () => {
  test("events flyer redirects an unauthenticated request to admin login", async ({
    page,
  }) => {
    await page.goto("/print/events-flyer");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
