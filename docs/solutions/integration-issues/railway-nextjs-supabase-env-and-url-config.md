---
title: "Railway + Next.js + Supabase: Env Vars, URL Config, and Internal Address Issues"
date: 2026-03-29
category: integration-issues
tags:
  - supabase
  - supabase-ssr
  - railway
  - environment-variables
  - magic-link
  - auth
  - redirect
  - standalone
symptoms:
  - '@supabase/ssr throws "URL and API key are required" on client-side login form'
  - "Magic link email redirects to 0.0.0.0:8080 instead of production domain"
  - "Post-auth redirect navigates to 0.0.0.0:8080 (Railway internal address)"
affected_components:
  - app/admin/login/AdminLoginForm.tsx
  - app/admin/login/actions.ts
  - app/auth/confirm/route.ts
environment: railway
framework: nextjs
severity: high
---

## Summary

Three compounding issues blocked the admin magic-link login flow on Railway. Each sits at a different layer of the stack — build-time env, third-party config, runtime networking — but together they form a single broken chain.

| # | Layer | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Build-time | `NEXT_PUBLIC_` vars not in Railway build container → compiled as `undefined` | Move Supabase auth call to a Server Action |
| 2 | Config | Supabase Site URL still pointed at `http://0.0.0.0:8080` | Update Site URL and Redirect URLs in Supabase dashboard |
| 3 | Runtime networking | `request.url` host is Railway's internal bind address behind its proxy | Derive `origin` from `x-forwarded-*` headers or `NEXT_PUBLIC_APP_URL` |

---

## Fix 1: `NEXT_PUBLIC_` Variables Compiled as `undefined`

> **The root cause below still holds; the prescribed fix has been superseded (2026-08-11).**
> The app now solves this two ways, neither of which is "move it to a Server Action":
>
> 1. **Declare the build args.** `Dockerfile` explicitly declares `ARG NEXT_PUBLIC_APP_URL`, `ARG NEXT_PUBLIC_SUPABASE_URL`, `ARG NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. A variable set on Railway but **not declared as an ARG reads as undefined during the build, silently** — the same failure later recurred with `POSTHOG_PERSONAL_API_KEY`/`POSTHOG_ENV_ID` and shipped minified stack traces to production until it was caught. That generalisation is the durable lesson here.
> 2. **Runtime fallback via body data-attributes.** `lib/supabase/client.ts` reads `document.body.dataset.supabaseUrl` / `.supabaseAnonKey`, injected by `app/layout.tsx`. Browser clients therefore work even when the build-time inline is missing, so the "always move it server-side" advice below is no longer the standing pattern — two components still use the browser client deliberately.
>
> Note `lib/supabase/client.ts` carries a comment saying `NEXT_PUBLIC_` vars "aren't available at build time" on Railway. That described the pre-ARG world; with the ARGs declared, the fallback is belt-and-braces rather than the primary mechanism.

### Root Cause

Next.js inlines `NEXT_PUBLIC_` variables at **build time**, not runtime. When Railway builds the Docker image, it runs `next build` inside a build container. If `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not present in that container's environment, Next.js replaces every reference with the literal string `undefined` — producing a broken client bundle that fails at runtime with no obvious pointer back to the missing variables.

A debug API route (server-side) will show the vars as present because the running container has them at runtime — this does **not** mean the client bundle has them.

### Fix

Move the Supabase auth call off the client entirely into a Server Action, which runs server-side at request time where env vars are always available.

**Before — `app/admin/login/AdminLoginForm.tsx`**
```tsx
"use client";
import { createClient } from "@/lib/supabase/client"; // createBrowserClient under the hood

async function handleSubmit(e: React.FormEvent) {
  const supabase = createClient(); // NEXT_PUBLIC_ vars compiled as "undefined" on Railway
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
  });
}
```

**After — `app/admin/login/actions.ts`** (new file)
```ts
"use server";

import { createClient } from "@/lib/supabase/server";

export async function sendAdminMagicLink(email: string, redirectTo: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) return { error: error.message };
  return { error: null };
}
```

**After — `app/admin/login/AdminLoginForm.tsx`**
```tsx
"use client";
import { sendAdminMagicLink } from "./actions"; // no Supabase client on the client

async function handleSubmit(e: React.FormEvent) {
  const redirectTo = `${window.location.origin}/auth/confirm`;
  const result = await sendAdminMagicLink(email, redirectTo);
  if (result.error) { /* handle */ }
}
```

---

## Fix 2: Magic Link Email Redirecting to an Internal Address

> **Still correct, but no longer the main path (2026-08-11).** Login is now a 6-digit OTP: `app/actions/auth.ts` calls `signInWithOtp` with no `emailRedirectTo` anywhere in the repo, and the redirect is a relative path handed back to the client. The confirm routes survive as a secondary path and are exercised by the E2E setup, so the Site URL config below still matters — it is just no longer what most sign-ins touch.

### Root Cause

Supabase generates magic-link URLs using the **Site URL** configured in the dashboard. It had never been updated from the local dev default (`http://0.0.0.0:8080`). Every magic-link email therefore contained a confirmation link pointing at the local address, unreachable from any external browser.

### Fix

In the Supabase dashboard → **Authentication → URL Configuration**:

1. Set **Site URL** to: `https://social.genevapolo.com`
2. Add to **Redirect URLs** allowlist: `https://social.genevapolo.com/**`
3. Keep `http://localhost:3000/**` in the allowlist for local development

---

## Fix 3: Post-Auth Redirect Using Internal Railway Address

### Root Cause

Railway's `output: "standalone"` Next.js server binds to `0.0.0.0` on its internal port (`8080` when this was written; the Dockerfile now sets `PORT=3000`, so the address you actually see may differ — the shape of the bug is what matters, not the number). `request.url` in Route Handlers reflects this internal binding address, not the public domain. Extracting `origin` from `request.url` yields `http://0.0.0.0:8080`, which becomes the base for all post-auth redirects.

### Fix

**Before — `app/auth/confirm/route.ts`**
```ts
const { searchParams, origin } = new URL(request.url);
// origin = the container's internal bind address, not the public domain
```

**After** — the cascade now in `app/auth/confirm/route.ts:11-19` and `app/auth/member-confirm/route.ts:7-18`:
```ts
const { searchParams } = new URL(request.url);
// APP_URL is a runtime env var (not inlined at build like NEXT_PUBLIC_APP_URL)
const origin =
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (() => {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return `${proto}://${host}`;
  })();
```

**Priority order, and why:**

1. `APP_URL` — runtime server env var. Most reliable on Railway: changing it needs no rebuild.
2. `NEXT_PUBLIC_APP_URL` — inlined at build, so it is only right if it was set before the build.
3. Forwarded headers — correct behind a reverse proxy.
4. `request.url` origin — last resort; this is the thing that breaks.

`APP_URL` is a **runtime** variable and is absent from `.env.local.example`, so nothing in the repo tells you to set it. It must be set on the Railway service.

**Why one route worked and its sibling did not.** The admin confirm route was fixed in an earlier session with a `NEXT_PUBLIC_APP_URL` fallback; the member confirm route still used the naive `new URL(request.url).origin`. The same fix reached one file and not its neighbour — which is the argument for centralising origin resolution rather than fixing it per route.

**That centralisation was never done, and the anti-pattern has since returned.** `app/auth/callback/route.ts:8` and `app/auth/session/route.ts:7` both destructure `origin` straight from `new URL(request.url)` and redirect from it. They are reachable in the OTP flow; if a redirect ever lands on an internal address again, start there.

---

## Prevention Checklist

### Before Every Railway Deploy

- [ ] All `NEXT_PUBLIC_` variables are set in Railway **Variables** *before* triggering the build
- [ ] `NEXT_PUBLIC_APP_URL` is set to the public-facing domain (not an internal address)
- [ ] A **full redeploy** (not just a restart) is triggered any time a `NEXT_PUBLIC_` variable changes
- [ ] Supabase **Site URL** is updated to the production domain
- [ ] Supabase **Redirect URLs** allowlist includes the production domain

### Supabase Dashboard on First Production Deploy

1. **Authentication → URL Configuration** → Site URL → production domain
2. **Authentication → URL Configuration** → Redirect URLs → add `https://[domain]/**`
3. **Authentication → Email Templates** → confirm no hardcoded `localhost` in overrides
4. **Project Settings → API** → confirm keys match what's set in Railway Variables

### Best Practices

**Prefer Server Actions over client-side SDK for auth flows.** Client-side Supabase auth requires `NEXT_PUBLIC_` vars in the browser and ties redirect logic to browser-visible URLs. Server Actions run at request time with full server env access.

**Never derive redirects from `request.url` behind a Railway proxy.** The internal bind address leaks into `request.url`. Always use `NEXT_PUBLIC_APP_URL` or reconstruct origin from `x-forwarded-proto` + `x-forwarded-host` headers.

**A server-side debug route confirming env vars does not prove the client bundle has them.** Server reads vars at runtime; client bundle has them baked in at build time. These are independent.
