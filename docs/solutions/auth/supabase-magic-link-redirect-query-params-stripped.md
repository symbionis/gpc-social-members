---
title: Dual-role users always redirected to admin dashboard regardless of login page
slug: supabase-magic-link-redirect-query-params-stripped
date: 2026-03-27
type: integration_issue
component: auth
framework: nextjs
library: supabase
symptoms:
  - User with email in both admin_users and members tables always lands on admin dashboard
  - Member login page (/login) redirects dual-role users to admin instead of member portal
  - Query params appended to emailRedirectTo URL are stripped or not preserved by Supabase magic link flow
  - Role-based routing via search params (?from=member, ?from=admin) in auth callback is unreliable
root_cause: Supabase preserves the PATH of the emailRedirectTo URL during magic link flow but strips query parameters, making a single /auth/confirm route with query-param-based role disambiguation impossible.
solved: true
---

## Problem

A user whose email exists in both `admin_users` and `members` tables was always redirected to the admin dashboard, regardless of which login page they used (`/login` for members, `/admin/login` for admins).

The auth callback route (`/auth/confirm`) checked `admin_users` first, so dual-role users always resolved to admin.

## Failed Approaches

### Attempt 1: Query param on `emailRedirectTo`

```typescript
// LoginForm.tsx
emailRedirectTo: `${window.location.origin}/auth/confirm?from=member`
```

Then in `auth/confirm/route.ts`, read `searchParams.get("from")` to decide where to redirect.

**Why it failed:** Supabase's magic link flow does not reliably preserve query parameters in the `emailRedirectTo` URL. The browser receives a redirect to `/auth/confirm?code=xxx` — the `from=member` param is silently dropped during the token verification redirect chain.

## Root Cause

Supabase's magic link flow involves two hops before your app sees the URL:

1. User receives email with link to `https://<project>.supabase.co/auth/v1/verify?token=...&redirect_to=<your-encoded-url>`
2. Supabase verifies the token and issues a `302` redirect to your `redirect_to` value, appending `?code=xxx` for PKCE
3. Your callback route exchanges the code for a session

At step 2, query parameters in the `redirect_to` value are stripped or overwritten. Supabase preserves only the **path** of the redirect URL — not any query params you appended.

## Solution

Encode login intent in the **path**, not query params. Create two separate callback routes with mirrored but priority-inverted logic.

### Mapping

| Login page | `emailRedirectTo` | Handler | Priority |
|---|---|---|---|
| `/login` (member) | `/auth/member-confirm` | `app/auth/member-confirm/route.ts` | Member first |
| `/admin/login` (admin) | `/auth/confirm` | `app/auth/confirm/route.ts` | Admin first |

### 1. `app/(public)/login/LoginForm.tsx`

```typescript
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/member-confirm`, // ← separate path
  },
});
```

### 2. `app/admin/login/AdminLoginForm.tsx`

```typescript
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/confirm`, // ← original path
  },
});
```

### 3. `app/auth/member-confirm/route.ts` (new file)

Same PKCE exchange logic as `auth/confirm`, but **member is checked first**:

```typescript
// Member portal takes priority — this is the member login path
if (member) {
  response.headers.set("Location", `${origin}/dashboard`);
  return response;
}

// Fallback to admin if no member record exists
if (adminUser) {
  response.headers.set("Location", `${origin}/admin/dashboard`);
  return response;
}
```

### 4. `app/auth/confirm/route.ts` (existing — admin priority unchanged)

```typescript
// Admin takes priority — this is the admin login path
if (adminUser) {
  response.headers.set("Location", `${origin}/admin/dashboard`);
  return response;
}

if (member) {
  response.headers.set("Location", `${origin}/dashboard`);
  return response;
}
```

## Related Files

- `app/auth/confirm/route.ts` — admin-priority callback
- `app/auth/member-confirm/route.ts` — member-priority callback
- `app/(public)/login/LoginForm.tsx` — member magic link form
- `app/admin/login/AdminLoginForm.tsx` — admin magic link form
- `middleware.ts` — enforces role-based route protection downstream of auth

## Prevention

### Rule: one auth intent = one redirect path = one route handler

Never try to branch on a query param in a single shared callback route. When adding future flows:

| Future flow | Recommended path |
|---|---|
| Invited member onboarding | `/auth/invite-confirm` |
| Corporate login | `/auth/corporate-confirm` |

### Supabase redirect URL allowlist

The wildcard `http://localhost:3000/**` (and your production equivalent `https://yourdomain.com/**`) covers all paths including new callback routes — you don't need to add each path individually. The wildcard governs path matching only; it does not guarantee query string preservation.

### PKCE gotchas

- The `code` param is **single-use and short-lived** — if the handler throws before completing the exchange, the user must request a new link.
- The exchange must happen **server-side** in the route handler via `supabase.auth.exchangeCodeForSession(code)`. Never forward the code to a client component.
- PKCE is **single-device** — the code verifier is stored in the browser that requested the link. If the user opens the link in a different browser, the exchange fails.
- Post-auth state (e.g. "this user was invited by X") belongs in the database, not in `emailRedirectTo` params.
