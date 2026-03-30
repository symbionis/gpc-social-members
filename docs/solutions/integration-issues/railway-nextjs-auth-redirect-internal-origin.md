---
title: "Railway + Next.js: Auth Redirect Uses Internal 0.0.0.0:8080 Origin"
date: 2026-03-29
category: integration-issues
component: auth/member-confirm-route
technologies: [Railway, Next.js, Supabase Auth, Magic Link]
symptoms:
  - Magic link login redirects to https://0.0.0.0:8080/dashboard
  - Auth callback works locally but breaks on Railway
  - Admin auth callback works but member auth callback doesn't
related:
  - docs/solutions/auth/supabase-magic-link-redirect-query-params-stripped.md
  - docs/solutions/integration-issues/railway-nextjs-supabase-env-and-url-config.md
---

# Railway + Next.js: Auth Redirect Uses Internal Origin

## Problem

After clicking a magic link, the member auth callback redirected to `https://0.0.0.0:8080/dashboard` instead of the production Railway URL. The admin auth callback worked correctly because it had already been fixed with an env var fallback.

## Root Cause

Two compounding issues:

### 1. `request.url` returns internal container address

On Railway, `new URL(request.url).origin` returns `https://0.0.0.0:8080` — the internal container host, not the public-facing domain.

### 2. `NEXT_PUBLIC_*` vars are build-time only

`NEXT_PUBLIC_APP_URL` is inlined by Next.js at build time. If not set during the build, it's permanently empty at runtime. A server-only env var (`APP_URL`) is needed for reliable runtime resolution.

## Solution

Replace naive `request.url` origin with a cascading fallback in all auth callback routes:

```typescript
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

### Priority order

1. `APP_URL` — runtime server env var (most reliable on Railway)
2. `NEXT_PUBLIC_APP_URL` — build-time inlined (works if set before build)
3. Forwarded headers — works behind reverse proxies
4. `request.url` origin — last resort (breaks on Railway)

### Railway setup

Set `APP_URL` as a runtime environment variable (no rebuild needed):

```
APP_URL=https://gpc-social-members-production.up.railway.app
```

## Why Admin Worked But Member Didn't

The admin confirm route (`/auth/confirm/route.ts`) had already been fixed with the `NEXT_PUBLIC_APP_URL` fallback in an earlier session. The member confirm route (`/auth/member-confirm/route.ts`) still used the naive `new URL(request.url).origin`.

## Prevention

- **Never use `new URL(request.url).origin`** in containerized environments
- **Use `APP_URL` (no NEXT_PUBLIC_ prefix)** for server-side origin resolution
- **Centralize origin resolution** in a utility function to avoid inconsistency
- **After changing `NEXT_PUBLIC_*` vars**, always redeploy (they're baked at build time)

## Files Changed

- `app/auth/member-confirm/route.ts` — added APP_URL + forwarded headers fallback
- `app/auth/confirm/route.ts` — added APP_URL as first priority
