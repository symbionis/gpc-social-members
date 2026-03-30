---
title: "Postmark Mustachio: Use {{.}} Inside Section Blocks, Not Variable Names"
date: 2026-03-29
category: integration-issues
component: email/postmark-templates
technologies: [Postmark, Mustachio, Mustache, HTML email]
symptoms:
  - Email button href renders empty despite variable being passed
  - Template conditional block renders when boolean false is passed
  - Variable substitution works outside section blocks but not inside
related:
  - docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md
---

# Postmark Mustachio: Use `{{.}}` Inside Section Blocks

## Problem

The approval email's "Complete Payment" button rendered with `href=""` despite `checkout_url` being passed as a valid Stripe URL in the template model. The `{{#has_payment}}` conditional block also rendered when `has_payment: false` was passed.

## Root Cause

Postmark uses **Mustachio** (a Mustache variant). Two key behaviors differ from expectations:

### 1. Section blocks change context scope

When you write `{{#checkout_url}}`, Mustachio scopes the context inside the block to the **value** of `checkout_url` (the URL string). Inside that block, `{{checkout_url}}` tries to look up a property called `checkout_url` on the string itself — which doesn't exist — so it renders empty.

### 2. Boolean `false` is not falsy

Mustachio treats any **present** value (including boolean `false`) as truthy for section blocks. Only `null`, `undefined`, empty string, or missing keys are falsy.

## Investigation

1. Template model confirmed valid: `checkout_url` contained a full Stripe URL
2. Switched from `{{{checkout_url}}}` (triple braces) to `{{checkout_url}}` (double braces) — still empty
3. Examined Postmark's Mustachio documentation — confirmed section scoping behavior
4. Tested `{{.}}` inside the block — worked

## Solution

Use `{{.}}` (dot = current context value) inside section blocks. Use the data variable itself as the conditional guard instead of a separate boolean.

### Before (broken)

```handlebars
{{#has_payment}}
<a href="{{checkout_url}}">Complete Payment</a>
{{/has_payment}}
{{^has_payment}}
<p>Your membership is now active.</p>
{{/has_payment}}
```

```typescript
templateModel: {
  checkout_url: checkoutUrl,
  has_payment: !!checkoutUrl,  // boolean false is truthy in Mustachio!
}
```

### After (working)

```handlebars
{{#checkout_url}}
<a href="{{.}}">Complete Payment</a>
{{/checkout_url}}
{{^checkout_url}}
<p>Your membership is now active.</p>
{{/checkout_url}}
```

```typescript
templateModel: {
  checkout_url: checkoutUrl,  // empty string = falsy in Mustachio
  // no separate boolean needed
}
```

## Key Mustachio Rules

| Rule | Detail |
|------|--------|
| `{{#var}}` scopes context | Inside the block, `{{.}}` = the value; `{{var}}` looks for a property on the value |
| Boolean `false` is truthy | Only missing/null/undefined/empty-string keys are falsy |
| Use variable as guard | `{{#checkout_url}}` gates on presence — no separate boolean needed |
| `{{.}}` for current value | Always use dot notation inside section blocks to reference the scoped value |

## Prevention Checklist

- [ ] Any `{{#var}}...{{/var}}` block that needs the var's value uses `{{.}}`, not `{{var}}`
- [ ] No boolean `false` values are sent to control section visibility
- [ ] Template tested via Postmark preview with representative data
- [ ] Template data shape documented alongside the template files

## Files Changed

- `docs/email-templates/member-approved.html` — `{{#checkout_url}}` + `{{.}}` in href
- `docs/email-templates/member-approved.txt` — same fix for text version
- `docs/email-templates/application-declined.html` — `{{.}}` for notes inside `{{#notes}}`
- `docs/email-templates/application-declined.txt` — same
- `docs/email-templates/payment-confirmed.html` — cleaned up triple braces
