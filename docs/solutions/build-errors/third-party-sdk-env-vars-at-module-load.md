---
title: Next.js Build Failure — Third-Party SDK Clients Instantiated at Module Scope
slug: third-party-sdk-env-vars-at-module-load
date: 2026-03-29
category: build-errors
tags:
  - nextjs
  - stripe
  - postmark
  - environment-variables
  - lazy-initialization
  - build
severity: high
status: solved
framework: Next.js 15
related_files:
  - lib/stripe.ts
  - lib/postmark.ts
  - app/api/stripe/checkout/route.ts
  - app/api/email/welcome/route.ts
  - app/api/webhooks/stripe/route.ts
---

## Symptoms

Railway (or any CI) build fails during `next build` with errors like:

```
Error: Neither apiKey nor config.authenticator provided
    at new Stripe (...)
    at 45688 (.next/server/app/api/webhooks/stripe/route.js:...)
```

```
b: A valid API token must be provided.
    at b.ErrorHandler.a.buildError (...)
    at 50230 (.next/server/app/api/email/declined/route.js:...)
```

The build output shows `[Failed to collect page data for /api/webhooks/stripe]` or similar routes.

## Root Cause

During `next build`, Next.js evaluates route modules to collect page data and build the optimized bundle. **This evaluation runs without production environment variables.** If a third-party SDK client is instantiated at module scope, its constructor runs at build time — before env vars are available — and throws.

```ts
// ❌ Executes at module load (build time) — throws if env var is absent
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});
```

Using `|| ""` as a fallback does **not** help. Postmark's `ServerClient` (and many others) validate the token in the constructor and reject empty strings:

```ts
// ❌ Still throws — "" is an invalid token
export const postmark = new ServerClient(process.env.POSTMARK_SERVER_TOKEN || "");
```

## Solution: Lazy Singleton Pattern

Defer client instantiation to the first runtime call using a getter function. The module evaluates successfully at build time (getter is never called); at request time, the env var is present.

### Stripe

```ts
// lib/stripe.ts
import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    });
  }
  return _stripe;
}
```

### Postmark

```ts
// lib/postmark.ts
import { ServerClient } from "postmark";

let _client: ServerClient | null = null;

function getClient(): ServerClient {
  if (!_client) {
    if (!process.env.POSTMARK_SERVER_TOKEN) {
      throw new Error("POSTMARK_SERVER_TOKEN is not set");
    }
    _client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);
  }
  return _client;
}

// Public API — callers use sendEmail(), never getClient() directly
export async function sendEmail({ to, templateAlias, templateModel }: SendEmailOptions) {
  await getClient().sendEmailWithTemplate({ ... });
}
```

### Update Callers

All imports of the named client export must switch to the getter:

```ts
// Before
import { stripe } from "@/lib/stripe";
await stripe.checkout.sessions.create({ ... });

// After
import { getStripe } from "@/lib/stripe";
await getStripe().checkout.sessions.create({ ... });
```

Files updated in this project:
- `app/api/stripe/checkout/route.ts`
- `app/api/email/welcome/route.ts`
- `app/api/webhooks/stripe/route.ts`

## Why This Pattern Works

| | Module-scope (broken) | Lazy singleton (fixed) |
|---|---|---|
| When constructor runs | Build time | First runtime request |
| Env var required | At build | At request time |
| Build outcome | Fails if var missing | Always succeeds |
| Instance count | 1 (or throws) | 1 (cached after first call) |

## Other SDKs Affected by the Same Issue

Any SDK that validates credentials in its constructor:

| SDK | Constructor |
|---|---|
| Stripe | `new Stripe(apiKey)` |
| Postmark | `new ServerClient(token)` |
| SendGrid | `new MailService()` + `.setApiKey()` |
| Twilio | `new Twilio(accountSid, authToken)` |
| OpenAI | `new OpenAI({ apiKey })` |
| Anthropic | `new Anthropic({ apiKey })` |
| Firebase Admin | `admin.initializeApp(credentials)` |
| AWS SDK | `new S3Client({ credentials })` |
| Slack | `new WebClient(token)` |

Apply the lazy singleton to all of them.

## Prevention

**Code review checklist — flag any `new SDKClient(...)` at module scope:**

- [ ] Is the `new` call inside a function, not at the top level of the file?
- [ ] Is the env var accessed inside the function, not outside it?
- [ ] Is there an explicit `if (!process.env.X)` guard with a clear error message?
- [ ] Is the instance cached (`let _client: X | null = null`) to avoid repeated instantiation?

**Detect early — build with env vars unset:**

```bash
STRIPE_SECRET_KEY="" POSTMARK_SERVER_TOKEN="" npm run build
```

If this fails, you have a module-scope instantiation problem. Fix it before pushing.

## Related

- `docs/solutions/auth/supabase-magic-link-redirect-query-params-stripped.md`
