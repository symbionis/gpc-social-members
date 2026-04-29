---
title: Next.js App Router rejects non-handler exports from route files at build time
module: app/api
date: 2026-04-29
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "Type error: Route '...' does not match the required types of a Next.js Route. '<helperName>' is not a valid Route export field."
  - "Local typecheck passes but Railway production build fails"
  - "Next.js build worker exited with code: 1"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - rails_controller
tags:
  - nextjs
  - app-router
  - route-handlers
  - build-failure
  - module-organization
---

# Next.js App Router rejects non-handler exports from route files at build time

## Problem

Adding a helper function alongside the HTTP method handlers in a `route.ts` file passes local TypeScript checks but breaks the production build with a typed-routes error. The helper was a clean, exported function meant to be reused by another route — Next.js rejects this at build time on the App Router.

## Symptoms

- Local `npx tsc --noEmit` clean.
- Railway / `next build` fails with:
  ```
  Type error: Route "app/api/admin/members/request-reactivation/route.ts" does not match the required types of a Next.js Route.
    "sendReactivationEmail" is not a valid Route export field.
  ```
- The build worker exits with code 1, blocking the deploy entirely.

## What Didn't Work

- **Adding `export async function POST(...)` and a separate `export async function sendReactivationEmail(...)` in the same file.** Felt natural — both are async functions, both belong to the reactivation feature — but Next.js App Router enforces a strict allowlist of exports for `route.ts` files: only the HTTP method handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`), `runtime`, `dynamic`, `revalidate`, etc. Anything else — including reusable helpers — fails the typed-routes check at build.
- **`tsc --noEmit` doesn't catch it.** The typed-routes check is a Next.js build-time concern, not a vanilla TypeScript one. Local typecheck cannot replace `next build` for Next.js-specific contracts.

## Solution

Extract the helper into `lib/` and import it from both the original route and any sibling routes that need to call it.

**Before** (`app/api/admin/members/request-reactivation/route.ts`):

```ts
export async function POST(request: NextRequest) {
  // ...
  const result = await sendReactivationEmail(member_id, { force });
  // ...
}

// ❌ Next.js rejects this at build time
export async function sendReactivationEmail(memberId: string, opts: { force?: boolean } = {}) {
  // ...
}
```

**After** — split into two files:

```ts
// lib/members/reactivation.ts (new)
export async function sendReactivationEmail(memberId: string, opts: { force?: boolean } = {}) {
  // ...
}

// app/api/admin/members/request-reactivation/route.ts
import { sendReactivationEmail } from "@/lib/members/reactivation";

export async function POST(request: NextRequest) {
  // ...
  const result = await sendReactivationEmail(member_id, { force });
  // ...
}

// app/api/admin/members/bulk-reactivation-expired/route.ts
import { sendReactivationEmail } from "@/lib/members/reactivation";
// ...
```

## Why This Works

`route.ts` files in the App Router are runtime contracts, not arbitrary modules. Next.js parses each route file at build time and rejects exports outside the documented allowlist so it can wire request handling deterministically. Helpers belong in plain TypeScript modules under `lib/` (or any non-route path), where the typed-routes check doesn't apply.

This also forces a cleaner separation: route files become thin auth + validation + response wrappers, and business logic lives in importable modules that any consumer (route, cron, background job, server action) can call.

## Prevention

- **Run `npm run build` locally before pushing** for any route-file change. The typed-routes check only fires during `next build`, not `tsc --noEmit`. Wall-time cost ≈ 30s, dwarfed by the cost of a failed deploy.
- **Convention: route files only export HTTP method handlers + Next.js-recognised config exports.** Anything else — helpers, types, constants — moves to `lib/`. If a route file is over ~100 lines or contains multiple top-level functions, that's the smell.
- **CI guard (future)**: add a lint rule or a small grep step that fails CI if `app/**/route.ts` contains an `export` other than the allowlisted names. ~10 lines of work, eliminates the class of bug entirely.
- **When extracting**: import the helper from a path that naturally describes the feature (`lib/members/reactivation.ts`, not `lib/utils/sendReactivationEmail.ts`). Encourages cohesive grouping.

## Related Docs

- Plan that introduced this (and surfaced the bug on first deploy): `docs/plans/` — reactivation flow.
- Build-error sibling: `docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md` — another `next build`-only failure mode worth running `npm run build` locally to catch.
