---
title: "Honorary (Free-Tier) Member Onboarding Pattern"
date: 2026-04-14
category: best-practices
module: payments-and-membership
problem_type: best_practice
component: payments
severity: high
applies_when:
  - Adding free/honorary tier alongside paid tiers in a membership system
  - A shared application form serves both paid and free members
  - Admin needs to manually renew members without payment
tags:
  - honorary
  - free-tier
  - stripe
  - membership
  - onboarding
  - server-side-validation
---

# Honorary (Free-Tier) Member Onboarding Pattern

## Context

The GPC Social Members app has a card-capture application flow where applicants authorize a payment hold during signup. Honorary (free) members need to go through the same form but skip payment entirely. The challenge is ensuring security (no one can get free membership without authorization) while keeping the UX clean.

## Guidance

### 1. Use a System-Level Param, Not Per-User Permissions

Instead of giving individual originators a `can_invite_honorary` flag (which requires managing per-user permissions), use a single rotatable code as a URL parameter:

```
/apply/ORIGINATOR_CODE?hono=SECRET_CODE
```

- The code is stored in a settings table, manageable by admin
- Works with any originator's invite link
- Rotatable instantly if leaked
- Applications still require committee approval (the code only unlocks the free tier, not automatic membership)

### 2. Server-Side Validation is Mandatory

The client-side form filters tiers based on the param, but a direct POST could bypass this. The server action must independently validate:

- Free tier selected → require valid hono param
- Paid tier selected with hono param → reject (prevents submitting paid tier to skip payment)
- No hono param → only paid tiers accepted

### 3. Free-Tier Approval Skips Stripe Entirely

When admin approves a pending member whose tier has `price_eur === 0`:

- Single atomic UPDATE: `pending → active` (not `pending → approved → active`)
- Create a `payment_status: "free"` payment record for financial tracking
- Generate card and send email in the same operation
- Skip all Stripe logic — no PaymentIntent, no Checkout Session

### 4. Committee Notification Timing Differs

For paid applications, committee notification comes from the Stripe webhook after card authorization. For free applications, there's no webhook — send committee notification and applicant confirmation immediately from the submit action.

### 5. Upsert Existing Members on Re-Application

When an expired or declined member applies via honorary:
- Update their existing record (don't create a duplicate)
- Set status to `pending`, update tier and profile fields
- Preserve payment and card history (only update member fields)

### 6. Self-Service Renewal Excludes Free Tiers

Expired honorary members see only paid tiers on the `/renew` page — honorary is one-time. Admin can manually renew as honorary via a dedicated button with confirmation dialog.

## Why This Matters

Without these patterns:
- Security bypass: anyone could POST a free tier ID and skip payment
- Race conditions: two-step status updates allow duplicate cards/payments
- Data inconsistency: free-tier approvals could leave members in limbo
- UX confusion: honorary applicants see a payment form they can't use

## When to Apply

- Adding any free/comped tier to a paid membership system
- Any form that serves both paying and non-paying users
- Admin override flows (manual renewals, tier changes)

## Related

- [docs/solutions/integration-issues/stripe-supabase-payment-flow-integration-issues.md](../integration-issues/stripe-supabase-payment-flow-integration-issues.md) — Stripe/Supabase integration patterns
- [docs/brainstorms/2026-04-14-honorary-onboarding-renewal-tiers-requirements.md](../../brainstorms/2026-04-14-honorary-onboarding-renewal-tiers-requirements.md) — Full requirements
- [docs/plans/2026-04-14-001-feat-honorary-onboarding-renewal-tiers-plan.md](../../plans/2026-04-14-001-feat-honorary-onboarding-renewal-tiers-plan.md) — Implementation plan
