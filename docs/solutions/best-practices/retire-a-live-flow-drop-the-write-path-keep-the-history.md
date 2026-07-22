---
title: "Retiring a live user-facing flow: drop the write path, keep the history, gate the view deletion on zero live consumers"
date: 2026-07-22
category: best-practices
module: events
problem_type: best_practice
component: database
severity: medium
applies_when:
  - "Removing a user-facing flow that has already produced data other people may still be holding"
  - "The feature spans a write path, a read/delegate view, DB columns, and an external template"
  - "You need to retire the capability without stranding anyone mid-flight"
tags:
  - deprecation
  - safe-deletion
  - retire-flow
  - historical-data
  - upcoming-vs-past
related_components:
  - database
  - service_object
---

# Retiring a live user-facing flow: drop the write path, keep the history

## Context

R28 (PR #92) retired ticket forwarding — a live flow that let a lead hand a batch of tickets to a delegate, who received an email and a delegate page. The flow spanned a **write path** (the forward route + two SECURITY DEFINER RPCs), a **delegate view** (a page + a fill route + a component), **DB columns** (`tickets.batch_token`), and an **external Postmark template**. The trap in deleting all of it at once: 44 tickets already carried `batch_token` from real forwards, and delegates could still be holding links to the delegate page. Delete indiscriminately and you either lose provenance data or strand a real guest.

## Guidance

Separate what a retirement *stops* from what it must *preserve*, and gate anything user-reachable on live data:

1. **Drop the write path in full** — the routes, RPCs, and external template that *create* new instances of the flow. Nothing new can happen after this.
2. **Keep the historical data** — columns and rows already written are provenance, not dead weight. Retire the *reads* (drop the `SELECT` of the column and any UI that renders it), but leave the column. Cheap to keep, expensive to reconstruct.
3. **Before deleting a user-reachable *view* that serves already-created data, prove zero live consumers** — query for how many rows are still actionable, scoped to **upcoming** (not all-time) data:

   ```sql
   -- forwarded tickets on an UPCOMING event → would stranding the delegate page hurt anyone?
   select count(*) filter (where e.start_date >= current_date) as forwarded_upcoming
   from public.tickets t join public.events e on e.id = t.event_id
   where t.batch_token is not null and t.released_at is null;
   -- result: 0  → safe to delete the delegate page
   ```

   `0` on upcoming data means deletion strands no one; the 44 historical rows sit on past events and never needed the page again.
4. **Drop the now-callerless backends** only after the routes that called them are gone, and verify each drop against the live DB (rolled-back) before applying.
5. **Sweep for orphans across the whole repo**, not just the changed directory — a runtime string endpoint or an email link is invisible to the type-checker.

## Why This Matters

"Retire the forward flow" sounds like one delete, but a live flow has four different lifetimes: the ability to start it (retire now), the code that renders its data (retire now), the data itself (keep — it's history), and the instances people are mid-way through (protect until they can't be harmed). Collapsing these into a single delete is how a cleanup strands a real guest or throws away provenance. The `upcoming vs all-time` distinction is the cheap check that tells you which category the user-facing view is in.

## When to Apply

- Deprecating any flow that has run in production and left data or in-flight instances.
- Especially when the flow spans app code + DB objects + an external service (email templates, webhooks) that each retire on different terms.

## Examples

- **Kept, not dropped**: `tickets.batch_token` — retired from every `SELECT` (`app/(checkin)/public/bookings/[token]/page.tsx`, the convert route) but the column stays (`supabase/migrations/20260722140000_retire_forward_rpcs.sql` documents the intent). 44 historical rows preserved.
- **Dropped after proving callerless**: `forward_ticket_batch` and `fill_batch_ticket` RPCs, plus the `claim_self_registration` RPC and the `event_registrations.self_reg_token` column (a U16 follow-up folded into the same PR), each verified gone in a rolled-back transaction with `540 registrations intact`.
- **External surface, manual step**: the `event-ticket-forward` Postmark template — the app can't reach Postmark admin, so retirement shipped a one-shot idempotent delete script (`scripts/postmark/delete-ticket-forward-template.mjs`) rather than a code path.

## Related

- Same shared-DB rolled-back verification discipline: [`./verify-security-definer-rpc-do-block-rollback.md`](./verify-security-definer-rpc-do-block-rollback.md).
- Auditing production before assuming a migration's shape: [`./audit-production-before-assuming-data-migration.md`](./audit-production-before-assuming-data-migration.md).
