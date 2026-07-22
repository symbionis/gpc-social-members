---
title: "Freeing a seat without invalidating its ticket lets the holder still walk in"
date: 2026-07-22
category: logic-errors
module: events
problem_type: logic_error
component: database
symptoms:
  - "A cancelled ticket's seat is released and resold, yet the original holder's QR still scans in at the door"
  - "Two people admitted against one seat — the overbooking the seat release was meant to prevent"
  - "Seat count is correct, but admission is not"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags:
  - ticket-cancellation
  - seat-release
  - double-admit
  - door-check-in
  - capacity
  - state-machine
related_components:
  - service_object
  - payments
---

# Freeing a seat without invalidating its ticket lets the holder still walk in

## Problem

Holder-requested ticket cancellation (U14, PR #91) freed a seat **immediately** by subtracting cancelled tickets from the seat-count functions — so a waitlister or new buyer could take the freed seat. But cancellation only set a per-ticket `cancellation_status`; it never touched the ticket's `released_at` or its `credential_token`. Every door-admission path filtered on `released_at`/`checked_in_at` only, **not** on `cancellation_status`. Result: the cancelled holder still held a live QR and could scan in — so the same seat admitted **two people**, re-creating the exact overbooking the release was supposed to prevent.

## Symptoms

- Guest buys a seat-counting ticket (`seats_used = 1`), then cancels from their manage page. `seats_used` drops to `0` and a second booker takes the freed seat.
- On event day the original guest's QR email still resolves: scanning `/c/<credential_token>` returns `checked_in` and admits them.
- The seat *count* is right at every step — the defect is invisible until two bodies show up for one seat.

## What Didn't Work

- **Trusting that "the seat count is correct" means "the system is correct."** The seat math (`seats_used` / `seats_used_by_events`) was rewritten and byte-for-byte verified — that work was sound. But a released resource has *two* sides: the counter that says it's free, and the credential that still lets the old holder consume it. Only the first was handled.
- **Leaning on the plan's scope boundary.** The plan deliberately scoped the door *out* of the cancellation unit ("door `released_at` release is out of scope"). That boundary was about the door's own seat-release behaviour — it did **not** license leaving the door able to admit a cancelled ticket. The gap was only caught in code review, not by the plan.

## Solution

Enforce the cancelled state at **every** admission path, not just the count. The fix (PR #91) touched three:

1. **The QR-scan RPC** — a new migration (`supabase/migrations/20260722130000_checkin_reject_cancelled.sql`) adds a guard to `checkin_by_credential` so a cancelled ticket returns `not_recognised`:

   ```sql
   IF NOT FOUND OR v_t.released_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'not_recognised'); END IF;
   -- A cancelled ticket is void — refuse admission (its seat was freed / possibly resold).
   IF v_t.cancellation_status IS NOT NULL THEN RETURN jsonb_build_object('status', 'not_recognised'); END IF;
   ```

2. **The lost-QR / by-id check-in** — `lib/events/checkin.ts:70` refuses a cancelled ticket (the route already maps any non-`needs_waiver` failure to "not recognised"):

   ```ts
   if (attendee.cancellation_status != null) return { ok: false, reason: "not_found" };
   ```

3. **The hand-check door roster** — `lib/events/door-roster.ts` carries a `cancelled` flag per row (`:248`), strikes cancelled rows on the printed sheet, adds a `cancelled` column to the CSV, and excludes them from catering totals (`:417`) so staff don't hand-admit or over-cater.

The RPC guard was proven in a rolled-back transaction before applying: a live ticket returned `would_proceed`, the same ticket after `cancellation_status='requested'` returned `not_recognised`.

## Why This Works

A cancellation is a state transition that **releases a shared resource** (a seat). A released resource has more than one consumer: the capacity counter *and* every gate that admits against the ticket. Subtracting the seat from the count made capacity honest; refusing the credential at every door path makes admission honest. The two must move together, or the resource is double-spent. Keeping the credential live but the seat freed is precisely the inconsistent middle state that produced the double-admit.

## Prevention

- **When a state frees a shared resource, enumerate every consumer of that resource and guard the new state at each one — not just where the resource is counted.** For a ticket: the seat count, the QR-scan RPC, the by-id check-in, and any printed/exported roster. A grep for the resource's existing gate (here, `released_at`/`checked_in_at` filters) finds the consumers that also need the new guard.
- **Treat "the count is right" and "the system is right" as different claims.** Verify the counter *and* the consumers.
- **A plan's scope boundary is not a correctness proof.** "Out of scope" for a deliberate reason (don't change door seat-release) does not extend to "this feature can't create a new hole at the door." Re-derive the blast radius from the code, and let review check the boundary.
- Consider making the two sides atomic where possible (e.g., a single status that both the count and the gates read) so a future change can't update one without the other.

## Related Issues

- Shipped in PR #91 (U14 — ticket cancellation + immediate seat release); the guard migration is `20260722130000_checkin_reject_cancelled.sql`.
- The seat-count rewrite it pairs with: [`../best-practices/prove-a-hot-function-rewrite-byte-for-byte-before-shipping.md`](../best-practices/prove-a-hot-function-rewrite-byte-for-byte-before-shipping.md).
- Related field-ownership trap: [`../architecture-patterns/single-writer-field-ownership-across-routes.md`](../architecture-patterns/single-writer-field-ownership-across-routes.md).
