---
title: "Postmark Mustachio: Scoping Rules for Section Blocks ({{.}}, {{../}}, and Boolean Truthiness)"
date: 2026-03-29
last_updated: 2026-04-13
category: integration-issues
module: email
problem_type: integration_issue
component: email_processing
severity: high
symptoms:
  - Email button href renders empty despite variable being passed
  - Template conditional block renders when boolean false is passed
  - Variable substitution works outside section blocks but not inside
  - Variables like first_name and portal_url render blank inside {{#has_card}} or {{#card_number}} blocks
root_cause: scope_issue
resolution_type: code_fix
tags: [postmark, mustachio, email-templates, template-scoping, parent-scope]
related:
  - docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md
  - docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md
---

# Postmark Mustachio: Scoping Rules for Section Blocks

## Problem

Postmark email templates using `{{#section}}` blocks render variables blank or behave unexpectedly. This has manifested in three distinct ways across sessions:

1. **Mar 29:** Button href renders empty inside `{{#checkout_url}}` — using `{{checkout_url}}` instead of `{{.}}`
2. **Mar 29:** Conditional block renders when `has_payment: false` is passed — boolean `false` is truthy in Mustachio
3. **Apr 13:** Variables like `{{first_name}}`, `{{portal_url}}` render blank inside `{{#has_card}}` block — parent scope inaccessible without `{{../}}` syntax (session history)

## Root Cause

Postmark uses **Mustachio** (a Mustache variant). Three key behaviors differ from expectations:

### 1. Section blocks change context scope

When you write `{{#checkout_url}}`, Mustachio scopes the context inside the block to the **value** of `checkout_url` (the URL string). Inside that block, `{{checkout_url}}` tries to look up a property called `checkout_url` on the string itself — which doesn't exist — so it renders empty.

### 2. Boolean `false` is not falsy

Mustachio treats any **present** value (including boolean `false`) as truthy for section blocks. Only `null`, `undefined`, empty string, or missing keys are falsy.

### 3. Parent scope requires `{{../}}` traversal

Inside any `{{#section}}` block — whether the section value is a string, boolean, or object — sibling variables from the parent scope are **not** automatically accessible. You must use `{{../variable}}` to walk up the scope chain. This applies even when using a boolean `true` as the section value. (auto memory [claude])

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

## Solution: Parent Scope Access with `{{../}}` (Apr 13)

When a section block needs to display **other** variables from the parent scope (not just the section's own value), use `{{../variable}}` to traverse up.

### Before (broken — variables blank inside section)

```handlebars
{{#has_card}}
  <p>Welcome, {{first_name}}!</p>
  <p>Card: {{card_number}}</p>
  <a href="{{portal_url}}">Access Portal</a>
{{/has_card}}
```

```typescript
templateModel: {
  first_name: "Frank",
  has_card: true,       // scopes context to boolean — first_name invisible
  card_number: "GPC-001",
  portal_url: "https://...",
}
```

### What didn't work (session history)

- **Boolean `has_card: true`** — Mustachio still scopes context to the boolean value; parent variables invisible
- **Object `has_card: { first_name: "...", card_number: "..." }`** — works but duplicates data, violates DRY

### After (working — `{{../}}` for parent access)

```handlebars
{{#has_card}}
  <p>Welcome, {{../first_name}}!</p>
  <p>Card: {{../card_number}}</p>
  <a href="{{../portal_url}}">Access Portal</a>
{{/has_card}}
```

```typescript
templateModel: {
  first_name: "Frank",
  has_card: true,
  card_number: "GPC-001",
  portal_url: "https://...",
}
```

Reference: [Postmark template syntax docs](https://postmarkapp.com/support/article/1077-template-syntax)

## Key Mustachio Rules

| Rule | Detail |
|------|--------|
| `{{#var}}` scopes context | Inside the block, `{{.}}` = the value; `{{var}}` looks for a property on the value |
| `{{../var}}` for parent scope | Access sibling variables from outside the current section block |
| Boolean `false` is truthy | Only missing/null/undefined/empty-string keys are falsy |
| Use variable as guard | `{{#checkout_url}}` gates on presence — no separate boolean needed |
| `{{.}}` for current value | Always use dot notation inside section blocks to reference the scoped value |
| Pass `null` not `""` | Empty string is truthy; pass `null` for absent optional values |

## Prevention Checklist

- [ ] Any `{{#var}}...{{/var}}` block that needs the var's value uses `{{.}}`, not `{{var}}`
- [ ] Any `{{#var}}...{{/var}}` block that needs **other** variables uses `{{../other_var}}`
- [ ] No boolean `false` values are sent to control section visibility
- [ ] Absent optional values passed as `null`, never `""`
- [ ] Template tested via Postmark preview with representative data
- [ ] Template data shape documented alongside the template files

## Files Changed

- `docs/email-templates/member-approved.html` — `{{#checkout_url}}` + `{{.}}` in href
- `docs/email-templates/member-approved.txt` — same fix for text version
- `docs/email-templates/application-declined.html` — `{{.}}` for notes inside `{{#notes}}`
- `docs/email-templates/application-declined.txt` — same
- `docs/email-templates/payment-confirmed.html` — cleaned up triple braces
