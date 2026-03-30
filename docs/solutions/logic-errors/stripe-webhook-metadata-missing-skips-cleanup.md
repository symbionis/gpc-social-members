---
title: Stripe webhook cleanup branch never executed due to unreliable metadata key
date: 2026-03-30
problem_type: conditional-branch-never-executed
component: stripe-webhook-handler
symptoms:
  - old membership_cards rows remained with is_active = true after renewal payment
  - renewal_tokens rows remained with used = false after successful payment
  - multiple active cards accumulating per member
  - payment recorded correctly and new card created correctly, only cleanup failed
tags:
  - stripe
  - webhook
  - supabase
  - membership-renewal
  - metadata
  - conditional-logic
  - next.js
  - typescript
---

## Problem

After completing a Stripe renewal payment, the webhook handler at `app/api/webhooks/stripe/route.ts` correctly recorded the payment and created a new membership card — but old cards were never deactivated and the renewal token was never marked as used. Each renewal test resulted in one more active card accumulating on the member.

## Root Cause

The cleanup code was guarded by `if (isRenewal && newCardId)`, where:

```typescript
const isRenewal = session.metadata?.renewal === "true";
```

Although `renewal: "true"` was set in the Stripe session metadata at checkout creation time, it was unreliable when read back from the `checkout.session.completed` webhook event payload. The condition evaluated to `false` on every webhook call, silently skipping the entire cleanup branch.

The core mistake: using a string boolean flag as a control-flow signal across an async network boundary. The flag could be correct at creation time and missing at delivery time, with no error raised.

## Solution

### Before (broken)

```typescript
const newCardId = newCards?.[0]?.id;

// If renewal: deactivate old cards and mark renewal token used
if (isRenewal && newCardId) {
  await supabase
    .from("membership_cards")
    .update({ is_active: false })
    .eq("member_id", memberId)
    .neq("id", newCardId)
    .eq("is_active", true);

  const renewalTokenId = session.metadata?.renewal_token_id;
  if (renewalTokenId) {
    await supabase
      .from("renewal_tokens")
      .update({ used: true })
      .eq("id", renewalTokenId);
  }
}
```

### After (fixed)

```typescript
const newCardId = newCards?.[0]?.id;

// Deactivate old cards whenever a new card is issued
if (newCardId) {
  await supabase
    .from("membership_cards")
    .update({ is_active: false })
    .eq("member_id", memberId)
    .neq("id", newCardId)
    .eq("is_active", true);
}

// Mark renewal token used if present in metadata
const renewalTokenId = session.metadata?.renewal_token_id;
if (renewalTokenId) {
  await supabase
    .from("renewal_tokens")
    .update({ used: true })
    .eq("id", renewalTokenId);
}
```

### Key Insight

The fix replaces a fragile boolean flag check with unconditional, data-driven logic:

- **Old card deactivation** now always runs when a new card exists. This is a safe no-op for initial signups — there are no prior active cards, so the query updates zero rows without side effects.
- **Renewal token marking** now runs only when `renewal_token_id` is present in metadata. The presence of the token ID is itself the signal that a renewal occurred. The condition and the required data are the same field — eliminating an entire class of synchronisation bug.

## Prevention Strategies

### Prefer data-driven conditions over boolean flags in webhook metadata

Boolean flags encode intent at checkout creation time. Data-driven conditions encode what needs to happen at handler execution time. These two moments are separated by a network boundary and an async queue.

| Avoid | Prefer |
|---|---|
| `if (metadata.renewal === "true")` | `if (metadata.renewal_token_id)` |
| `if (metadata.is_corporate === "true")` | `if (metadata.corporate_account_id)` |
| `if (metadata.send_welcome_email === "true")` | query member record to check `onboarded_at IS NULL` |

**Rule:** If a side-effect requires a row ID or token from metadata to execute, check for that ID directly. If the side-effect is unconditional for all successful checkouts, remove the guard entirely.

### Add structured logging at the start of every webhook handler

This single log line would have made the bug immediately visible — metadata would have shown as null or empty:

```typescript
console.log('[stripe/webhook] session.completed', {
  sessionId: session.id,
  metadata: session.metadata ?? null,
});
```

### Debug Stripe webhook metadata issues

```bash
# Forward live test events to local dev and inspect full payloads
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Resend a specific event by ID
stripe events resend evt_1ABC...

# Inspect the raw payload of any recent event
stripe events retrieve evt_1ABC... --format json
```

In the Stripe Dashboard: **Developers → Webhooks → Recent Deliveries** shows every attempt, its full request payload, and your server's response. Check this before writing handler logic.

If you need guaranteed access to all metadata, retrieve the full session in the handler:

```typescript
const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
  expand: ['line_items'],
});
```

### Test cases for this flow

- **Renewal happy path:** fire `checkout.session.completed` with `renewal_token_id` in metadata → assert new card active, old cards inactive, token `used = true`
- **New member (no renewal):** fire same event with no `renewal_token_id` → assert new card active, deactivation is a no-op, no error thrown
- **Metadata absent:** construct payload where `session.metadata` is null → assert handler returns 200, no unhandled exception
- **Idempotency replay:** fire same event ID twice → assert no duplicate card, no double token mark
- **Invalid token ID:** provide a `renewal_token_id` not in the database → assert handler logs warning and returns 200, membership still activated

## Related

- [`docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md`](../build-errors/third-party-sdk-env-vars-at-module-load.md) — Stripe lazy initialisation pattern used in the same webhook route
