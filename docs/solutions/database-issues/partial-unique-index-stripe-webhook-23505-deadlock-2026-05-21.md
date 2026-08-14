---
title: Partial unique index on a staged pending→paid table deadlocks the Stripe webhook
date: 2026-05-21
category: database-issues
module: events
problem_type: database_issue
component: payments
symptoms:
  - "Stripe checkout.session.completed webhook returns HTTP 500 and Stripe retries the same delivery for days"
  - "A customer is charged but has no confirmed registration and receives no confirmation email"
  - "Postgres 23505 unique_violation raised on the event_registrations pending to paid UPDATE"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components: [database]
tags: [stripe, webhook, postgres, "23505", unique-index, idempotency, race-condition, registrations]
---

# Partial unique index on a staged pending→paid table deadlocks the Stripe webhook

## Problem
Adding a partial unique index to `event_registrations` (for race-safe duplicate-registration guarding) introduced a latent P0 in an unrelated file — the Stripe `checkout.session.completed` webhook. On a *paid* event, another live registration can take the unique slot while a customer's checkout is in flight, so the webhook's `pending→paid` promotion fails with `23505` and Stripe retries it forever: the customer is charged but never registered. The original trigger was a waitlist comp; since PR #113 retired comp conversion, the live trigger is **two waitlist offers to the same person both being redeemed** — offers now redeem through ordinary checkout, so they race on the same `(event_id, lower(email))` promotion. The collision shape is identical and the handler comment says so (`app/api/webhooks/stripe/route.ts:434-441`).

## Symptoms
- The Stripe `checkout.session.completed` webhook returns HTTP 500 and Stripe retries the same delivery for ~3 days.
- A customer is charged but has no confirmed (`paid`) registration and gets no confirmation email.
- Postgres raises `23505 unique_violation` on the `event_registrations` `pending→paid` `UPDATE`.

## What Didn't Work
- The index itself was correct and applied cleanly (a duplicate pre-check confirmed zero existing violations). The trap: the failure lived entirely in a file **not in the feature's diff** — the Stripe webhook — so testing the waitlist feature locally never exercised it.
- The pre-existing webhook update-error handler returned 500 for *any* error, treating all failures as transient/retryable. For a permanent constraint violation, 500 just creates an infinite retry loop — retries can never resolve a duplicate.

## Solution
The bug only surfaced through an adversarial code-review scenario (it requires a paid event + an in-flight checkout colliding with a comp). Three coordinated fixes:

**1. The dedupe index** (`supabase/migrations/20260521120000_event_registrations_dedupe_index_and_converted_by.sql`) — note the predicate does **not** cover `pending`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_email_paidfree_uniq
  ON public.event_registrations (event_id, lower(email))
  WHERE status IN ('paid', 'free');
```

**2. The Stripe webhook** (`app/api/webhooks/stripe/route.ts`) — on the `pending→paid` update error, catch `23505` specifically: don't 500-loop, acknowledge with 200, and leave a durable trail for a refund:

```ts
if (updateErr) {
  // A paid/free row already occupies (event_id, lower(email)) — likely a waitlist
  // comp took the slot mid-checkout. The customer WAS charged. Do NOT 500-loop.
  if ((updateErr as { code?: string }).code === "23505") {
    console.error("[webhook] duplicate registration on pending→paid — NEEDS MANUAL REFUND", {
      registrationId: existing.id, sessionId: session.id, paymentIntent: session.payment_intent,
    });
    if (typeof session.payment_intent === "string") {
      try {
        await getStripe().paymentIntents.update(session.payment_intent, {
          metadata: { needs_refund: "duplicate_registration", registration_id: existing.id },
        });
      } catch (tagErr) {
        console.error("[webhook] failed to tag PaymentIntent for refund", tagErr);
      }
    }
    return NextResponse.json({ received: true, duplicate_registration: true }); // 200 stops the retry loop
  }
  // ...transient errors still return 500 for Stripe to retry
}
```

**3. The insert paths** — the public register route (`app/api/events/[id]/register/route.ts:400`) and the since-retired waitlist-convert route both mapped a `23505` on insert to their existing "already registered" 409, so the new index never surfaces as an opaque 500 for the free-event duplicate race. The convert route was deleted with comp conversion in PR #113; the surviving insert paths are the register route and the guest-list sponsor flow (`lib/events/guest-list.ts:182`).

## Why This Works
A `23505` on the `pending→paid` promotion means a `paid`/`free` registration *already exists* for that `(event_id, lower(email))` — the Stripe event is effectively a duplicate that no retry can resolve. Returning 200 acknowledges it and stops the retry storm; tagging the PaymentIntent metadata (`needs_refund: duplicate_registration`) makes the charged customer findable in the Stripe dashboard for a manual refund, surviving log rotation. (For *membership* dues, the `payments` table is the source of truth for financial records — auto memory [claude]. Event money is not in `payments`: it lives in `event_registrations` / `event_registration_items` / `tickets`, and since PR #105 Stripe is the reconciliation authority for event refunds. See `docs/solutions/best-practices/a-comment-that-justifies-an-omission-is-load-bearing.md`.)

## Prevention
- **When adding a partial/conditional unique index to a table with a staged status lifecycle** (e.g. `pending → paid`), enumerate every path that INSERTs or UPDATEs a row *into* the indexed status set — especially **promotions from a non-indexed staging state into an indexed one**. Each must handle `23505` gracefully. The enumeration anchor is now a named constant: `lib/events/registration.ts:11` exports `REGISTERED_STATUSES = ["paid", "free"]`, explicitly kept in sync with the index predicate — start there, then grep its usages. The live paths are now three: the register route, the guest-list sponsor flow (`lib/events/guest-list.ts:182`), and the webhook promotion — the waitlist-convert route was retired with comp conversion in PR #113.
- A partial index whose `WHERE` excludes the staging state does **not** block concurrent duplicates while rows sit in staging; the collision is deferred to promotion time. Decide deliberately whether the duplicate pre-check should also cover the staging state.
- Treat "applied a migration to a shared/prod DB" as a change that can affect code paths **outside the current diff**. Run an adversarial review that constructs cross-feature scenarios, not just diff-local ones.
- In webhook handlers, distinguish permanent (constraint) from transient errors: only 500 (retry) on transient failures; acknowledge permanent ones with 200 + a durable side-record.
- **A "flag it for manual refund" branch is a promise about a workflow that may change.** This handler's `needs_refund` paths still ask a human to refund in the Stripe dashboard, which now sits alongside a process control saying event refunds go through the admin UI only (PR #105). They do not conflict on the books — each of these cases leaves the money outside the counted set, because a duplicate registration stays `pending` and an unapplied top-up or conversion writes no `event_registration_items` lines, while gross reads the lines — but that reasoning was reconstructed after the fact rather than recorded. If you add a fourth `needs_refund` branch, state whether its money was ever counted as revenue.

## Related Issues
- `docs/solutions/logic-errors/stripe-webhook-metadata-missing-skips-cleanup.md` — same webhook handler, a different unhandled post-payment failure mode.
- `docs/solutions/database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md` — the same `lower(email)` key at a different granularity. Deduping one *registration* per email per event is sound (a family books once); deduping a per-*person* write on contact is not.
- `docs/solutions/database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md` — same table and `paid/free` set. A related but **distinct** race: this doc guards duplicate-email registration (one paid/free row per email); that doc's open "oversell race for quantity > 1" note is a separate *capacity* race (concurrent distinct checkouts) that the unique index does **not** address.
- `docs/solutions/integration-issues/stripe-supabase-payment-flow-integration-issues.md` — see also: Stripe↔Supabase boundary failure modes.
- `docs/solutions/design-patterns/draft-row-claim-and-transition-2026-05-06.md` — conceptual sibling: single-row status-lifecycle transitions.
- Shipped in PR #22 (waitlist → registration); the index + `converted_by` audit column were added there.
