---
title: "Stripe Elements + Supabase Payment Flow: Silent Failures and Config Mismatches"
date: 2026-04-13
category: integration-issues
module: payments
problem_type: integration_issue
component: payments
severity: high
symptoms:
  - "Stripe 400 error: payment_method_types mismatch between client Elements and server PaymentIntent"
  - "Payment rows never appear in Supabase despite API returning success"
  - "Email button href empty due to variable name mismatch between code and Postmark template"
  - "CSP font-src errors in console from Stripe cross-origin iframe"
root_cause: config_error
resolution_type: code_fix
related_components:
  - email_processing
  - database
tags:
  - stripe
  - payment-element
  - payment-method-types
  - supabase-insert
  - error-handling
  - silent-failure
---

# Stripe Elements + Supabase Payment Flow: Silent Failures and Config Mismatches

## Problem

During the first implementation of Stripe Elements (Payment Element with manual capture) in the GPC Social Members app, four distinct integration issues surfaced. All share a theme: **configuration mismatches across integration boundaries** that fail silently or with opaque errors.

## Symptoms

1. **Stripe 400 on payment confirmation** — `"Payment details were collected through Stripe Elements using payment_method_types and cannot be confirmed through the API configured with automatic payment methods"`
2. **Empty payments table** — Payment inserts silently failing, no rows in Supabase despite successful Stripe PI creation
3. **Email button with empty href** — "Access Member Portal" button does nothing because template expects `{{portal_url}}` but code passes `dashboard_url`
4. **Console font errors** — `font-src 'none'` CSP violations from Stripe's own iframe

## What Didn't Work

### Stripe payment_method_types (Issue 1)
- Adding `paymentMethodTypes: ["card"]` only on the client-side Elements without matching it on the server-side PaymentIntent — Stripe requires both sides to use the same mode (explicit vs automatic)

### Supabase silent insert (Issue 2)
- The insert appeared to work because `await supabase.from("payments").insert({...})` doesn't throw on failure — it returns `{ data, error }` and the error was never checked (session history: a similar silent failure occurred in Mar 29 with RLS + anon key blocking member inserts)

### CSP font errors (Issue 4)
- Adding `https://b.stripecdn.com` and `https://*.stripecdn.com` to the parent page's `font-src` CSP directive — the fonts load inside Stripe's **cross-origin iframe** which has its own CSP (`font-src 'none'`). Parent page CSP cannot control iframe resources per the CSP spec

## Solution

### Issue 1: Stripe payment_method_types must match client and server

```typescript
// Server — create-payment-intent/route.ts AND retry-payment/route.ts
const paymentIntent = await stripe.paymentIntents.create({
  amount: amountInCentimes,
  currency: "chf",
  payment_method_types: ["card"],  // MUST match client
  // ...
});

// Client — PaymentSection.tsx AND PaymentRetryForm.tsx
<Elements
  stripe={stripePromise}
  options={{
    mode: "payment",
    amount: Math.round(amount * 100),
    currency: "chf",
    paymentMethodTypes: ["card"],  // MUST match server
    // ...
  }}
>
```

Both the apply page and retry-payment page needed this fix independently.

### Issue 2: Always check Supabase insert errors

```typescript
// Before (broken — silent failure)
await supabase.from("payments").insert({ ... });

// After (fixed — error surfaces)
const { error: insertError } = await supabase.from("payments").insert({ ... });
if (insertError) {
  console.error("[create-payment-intent] Payment row insert failed:", insertError);
}
```

### Issue 3: Email template variable names must match exactly

```typescript
// Before (broken — template expects portal_url)
templateModel: {
  dashboard_url: `${appUrl}/login`,  // wrong key
}

// After (fixed)
templateModel: {
  portal_url: `${appUrl}/login`,  // matches {{portal_url}} in template
}
```

### Issue 4: Remove custom CSP when using Stripe Elements

The custom CSP header was removed from `middleware.ts` entirely. Stripe's iframe font errors are a known Stripe bug — cosmetic only, payment form still functions with system font fallback.

## Why This Works

Each issue is a boundary mismatch:

1. **Stripe client/server** — Stripe has two payment method modes (explicit and automatic). When Elements uses explicit types but the PI uses automatic (the default), confirmation fails with a 400. Both must agree.
2. **Supabase error contract** — Unlike most ORMs, the Supabase JS client never throws on query failures. The `{ error }` return value is the only signal. Unchecked errors are silent data loss.
3. **Postmark variable contract** — Postmark silently renders unmatched placeholders as empty strings. No validation that model keys match template placeholders.
4. **CSP iframe boundary** — Each document (including iframes) enforces its own CSP independently. Parent CSP controls what the parent loads, not what a cross-origin iframe loads.

## Prevention

- **Stripe:** When using Elements with `paymentMethodTypes`, grep all `paymentIntents.create` calls to verify they include matching `payment_method_types`. Consider a shared constant.
- **Supabase:** Always destructure `{ data, error }` from every Supabase query. Add a lint rule or wrapper that enforces this pattern. Note: 18 `.insert()` calls exist in the codebase — not all check errors.
- **Postmark:** Define a TypeScript type per template model. Keep a comment in the code listing expected template variables. Send a test email before deploying.
- **CSP + third-party iframes:** Test all third-party embeds (Stripe, Google Maps) when adding CSP headers. Do not attempt to control cross-origin iframe resources via parent CSP.

## Related Issues

- [docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md](../integration-issues/postmark-mustachio-dot-notation-in-block-scope.md) — Mustachio scoping rules (related template issue)
- [docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md](../integration-issues/postmark-mustachio-conditional-syntax.md) — `{{#if}}` rejection and `null` vs `""`
- [docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md](../build-errors/third-party-sdk-env-vars-at-module-load.md) — Stripe/Postmark lazy init pattern

## Files Changed

- `app/api/stripe/create-payment-intent/route.ts` — added `payment_method_types: ["card"]` + insert error handling
- `app/api/stripe/retry-payment/route.ts` — added `payment_method_types: ["card"]`
- `components/public/PaymentSection.tsx` — added `paymentMethodTypes: ["card"]`
- `components/public/PaymentRetryForm.tsx` — added `paymentMethodTypes: ["card"]`
- `app/api/webhooks/stripe/route.ts` — fixed `portal_url` variable name, added webhook update error handling
- `middleware.ts` — removed custom CSP header
