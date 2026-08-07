---
module: "admin/finance"
date: "2026-08-07"
problem_type: runtime_error
component: tooling
severity: high
symptoms:
  - "Every request to /admin/finance renders the generic \"Something Went Wrong\" error boundary in production"
  - "Railway deploy logs show: Error: Attempted to call tabFrom() from the server but tabFrom is on the client; it can only be rendered as a Component or passed to props of a Client Component"
  - "All local gates pass on the broken code: tsc --noEmit, npm run lint, npm run build, and the full vitest suite (724 tests, 67 files)"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - "FinanceTabs"
  - "finance tab vocabulary module"
tags:
  - "nextjs"
  - "app-router"
  - "server-components"
  - "use-client"
  - "client-reference"
  - "admin-finance"
---

# Server component called a plain function exported from a "use client" module

## Problem

`/admin/finance` is a server component (`app/(admin)/admin/finance/page.tsx:22`) that normalizes the `?tab=` search param by calling `tabFrom()`. That helper was a plain string normalizer — no JSX, no hooks — but it was exported from `components/admin/finance/FinanceTabs.tsx`, a module carrying `"use client"` (`components/admin/finance/FinanceTabs.tsx:1`). Under the React Server Components contract, *every* export of a `"use client"` module becomes a client reference: the server can render it as a component or pass it as a prop, but it can never invoke it as an ordinary function. The result was that every authenticated request to `/admin/finance` — the page where super_admin and finance users read the club's numbers — threw during server render and showed the generic error boundary. Nothing about it was visible locally: typecheck, lint, `next build`, and the whole unit suite were green on the broken code.

## Symptoms

- Every request to `/admin/finance` rendered the app's generic "Something Went Wrong" error boundary — no partial page, no useful client-side message.
- Railway deploy logs for the PR preview environment carried the real cause:

  ```
  ⨯ Error: Attempted to call tabFrom() from the server but tabFrom is on the client.
  It's not possible to invoke a client function from the server, it can only be
  rendered as a Component or passed to props of a Client Component.
      at .next/server/app/(admin)/admin/finance/page.js:1:310
      digest: '2491958858'
  ```

- The failure was 100% reproducible in the deployed environment and 0% reproducible through any local gate.
- A naive `curl` against the deployed URL returned a healthy-looking `307`, not a `500` — see the last item in the next section.

## What Didn't Work

This is the heart of the learning. Every gate the repo has was green while the page was broken on every request, and each was green for a different, understandable reason:

- **`npx tsc --noEmit` — green.** The import was real and correctly typed: `tabFrom` genuinely existed in `FinanceTabs.tsx`, genuinely accepted `string | string[] | undefined`, and genuinely returned `FinanceTab`. The server/client boundary is a *runtime and bundler* contract enforced by the RSC module graph, not a type-level one. TypeScript has no notion of a `"use client"` directive, so there is nothing for it to complain about. **Typecheck can never catch this class of bug.**

- **`npm run lint` — green.** Next's lint rules cover things like importing server-only APIs into client code and hook usage; they did not flag a server module importing a non-component value out of a client module. No rule existed to fire.

- **`npm run build` (`next build`) — green, and this is the most misleading one.** Next's production build *compiled the page successfully*. Building resolves and bundles the module graph; it does not execute the page's render. The client reference was emitted fine — it only explodes at the moment the server actually calls it, i.e. on a request. A successful production build was taken as evidence the page worked, and it was not evidence of that at all.

- **The full vitest suite (`npm run test:unit`, 724 tests across 67 files) — green.** The unit test for the normalizer imported `tabFrom` directly out of the client module. In a vitest/node environment the `"use client"` directive is an inert string literal, so the import resolved to the plain function and the behavioral assertions passed. The test was performing *exactly the call the server component is forbidden to make* and reporting success. The test didn't merely miss the bug — it actively simulated the broken call in an environment where it works, and certified it.

- **A `curl` smoke check of the deployed URL — misleadingly green.** `middleware.ts:58-63` redirects any unauthenticated `/admin/*` request (other than `/admin/login`) to the admin login page. An anonymous request therefore gets a `307` and never reaches the page component at all. A status-code smoke check on a totally broken page returns a healthy-looking result. **Only an authenticated request reaches the render, and only the render throws.**

Diagnosis came from none of the above. It came from pulling the Railway deploy logs for the PR preview environment and reading the actual server-side stack.

## Solution

Shipped in **PR #95**, squash-merged to `main` as `50ce17a`. (The original feature-branch commit no longer exists on `main` — this repo squash-merges, so cite the PR, not a branch SHA.)

Create a **third module** holding the shared vocabulary, with no directive at all — `components/admin/finance/tabs.ts`:

```ts
export type FinanceTab = "membership" | "events" | "originator";

export const FINANCE_TABS: { id: FinanceTab; label: string }[] = [
  { id: "membership", label: "Membership" },
  { id: "events", label: "Events" },
  { id: "originator", label: "Originator" },
];

const TAB_IDS = new Set<string>(FINANCE_TABS.map((t) => t.id));

export function tabFrom(value: string | string[] | undefined): FinanceTab {
  return typeof value === "string" && TAB_IDS.has(value) ? (value as FinanceTab) : "membership";
}
```

(`components/admin/finance/tabs.ts:13-28`; the file opens with a comment block at lines 1-11 recording exactly why the directive must never be added.)

Both sides now import from it:

- The server page imports the normalizer: `import { tabFrom } from "@/components/admin/finance/tabs";` (`app/(admin)/admin/finance/page.tsx:7`), used at `page.tsx:49`.
- The client tab bar imports the constant and the type: `import { FINANCE_TABS, type FinanceTab } from "./tabs";` (`components/admin/finance/FinanceTabs.tsx:4`), and no longer re-exports either.

**A constraint that shaped the fix:** moving the normalizer *into* `page.tsx` would also have worked at runtime but was not acceptable, because `page.tsx` imports the Supabase server client and request-time helpers at module scope (`page.tsx:1-5`) — a unit test cannot import that module without dragging in the whole server environment. The function genuinely needed a home that is neither the client component nor the server page.

Then guard the directive itself with a test — `components/admin/finance/tabs.test.ts:35-41`:

```ts
it("keeps the tabs module free of a 'use client' directive", () => {
  const source = readFileSync(
    join(process.cwd(), "components/admin/finance/tabs.ts"),
    "utf8",
  );
  expect(source).not.toMatch(/^\s*["']use client["']/m);
});
```

alongside the behavioral cases for the fallback, the known tabs, and the repeated-param-as-array case (`tabs.test.ts:6-25`).

## Why This Works

`"use client"` is a property of the **module**, not of the individual export. When the RSC bundler sees the directive it replaces the entire module's exports, in the server graph, with client *references* — opaque handles the server runtime knows how to serialize into the client payload. Rendering one as a component works because rendering a reference is exactly what the payload is for. Calling one as a function has no meaning on the server, so the runtime throws the "Attempted to call ... from the server" error. There is no way to exempt one export: a single directive at the top of the file marks all of them.

A directive-free module is compiled into *both* graphs. The server graph gets the real function and can call it; the client graph gets the real constant and can render it. That is why the shared vocabulary needs its own home — it is the only placement where both sides get the actual values rather than a reference or a server-only import.

The directive-assertion test works because the failure mode is textual and binary: the bug is not "the function is wrong", it is "this file grew a directive". A regex against the file's own source is the cheapest possible check for exactly that regression, and it costs nothing to run. It compensates for the fact that no compiler in the stack models this boundary.

## Prevention

- **Shared vocabulary gets its own directive-free module.** Types, constants, and pure helpers used on *both* sides of the server/client boundary belong in a plain `.ts` file — not in the client component that happens to render them, and not in the server page that happens to import Supabase. If a value is consumed by a server component and a client component, that is the signal to extract it. In this repo the pattern is `components/<area>/<feature>/tabs.ts`-style siblings next to the component.

- **Guard the directive with a one-line test** wherever a server component calls into a shared module. It runs in milliseconds and catches the exact regression a future refactor would introduce (someone adds a hook to `tabs.ts`, drops in `"use client"`, and every gate goes green again):

  ```ts
  const source = readFileSync(join(process.cwd(), "<path>/<module>.ts"), "utf8");
  expect(source).not.toMatch(/^\s*["']use client["']/m);
  ```

- **Never treat a green `next build` as proof a page renders.** The build compiles the module graph; it does not evaluate page components. For any change touching the server/client boundary, the only real gate is loading the page.

- **A smoke check must hit an authenticated route as an authenticated user.** `middleware.ts:58-63` turns every anonymous `/admin/*` request into a `307`, so a status-code check on an anonymous request proves only that middleware is alive. Either sign in (Playwright's admin project, `npm run test:admin`, already carries authenticated storage state) or accept that the check is worthless for admin pages.

- **When local gates are green and the deployed page is broken, go straight to the deploy logs.** The Railway logs for the PR preview environment named the function, the file, and the rule in one line. Everything before that was guesswork against tools that structurally cannot see this class of failure.

- **A unit test importing a helper out of a `"use client"` module is a smell, not a passing test.** vitest treats the directive as an inert string, so such a test proves the function's behavior while silently endorsing an import the server cannot make. If the helper is worth unit testing, it belongs in a module without a directive.

## Related

- [`docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md`](../build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md) — the same *shape* of App Router bug (a special file imposes an export contract you did not know about) with the same fix (extract the shared code into a third, unconstrained module). It differs where it matters: that one is a build-time rejection that blocks every build, this one is build-green and only fails on a real request.
- [`docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md`](../build-errors/third-party-sdk-env-vars-at-module-load.md) — another Next.js failure that the normal build does not exercise. Different root cause and fix; thematically adjacent only.
- [`docs/solutions/runtime-errors/safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md`](./safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md) — shares the "green tests and green build, only a real request surfaced it" shape, with an unrelated mechanism.
