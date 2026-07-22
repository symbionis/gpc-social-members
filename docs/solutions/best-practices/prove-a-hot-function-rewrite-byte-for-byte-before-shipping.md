---
title: "Prove a hot read-function rewrite is byte-for-byte identical against real data before shipping"
date: 2026-07-22
category: best-practices
module: events
problem_type: best_practice
component: database
severity: high
applies_when:
  - "Rewriting a hot read function (seat counts, balances, availability) whose result must not change for the common case"
  - "The rewrite adds a subtracted/added term that should be zero for existing rows"
  - "Dev and prod share one Supabase database, so an applied migration hits prod immediately"
tags:
  - shared-prod-db
  - hot-function
  - rewrite-equivalence
  - rolled-back-transaction
  - seat-count
  - regression-proof
related_components:
  - database
  - payments
---

# Prove a hot read-function rewrite is byte-for-byte identical against real data before shipping

## Context

U14 (PR #91) had to rewrite `seats_used(eid)` and `seats_used_by_events(ids)` — hot capacity functions read on every checkout — to subtract a new `cancelled_seats` term. The safety property the plan demanded: for an event with **no cancellations**, the result must be *byte-for-byte* what it returned before, because dev and prod share one database and the function governs whether a checkout is allowed. A silent off-by-one here would over- or under-sell real events. There is no pgTAP / DB test harness, and the function runs against live production rows.

## Guidance

Before applying the rewrite, prove equivalence **against every real row** inside a single rolled-back transaction, using a throwaway parallel function so both the old and new logic exist at once:

```sql
BEGIN;
-- add any columns the new logic references (additive; rolled back anyway)
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS cancellation_status text;

-- the NEW logic under a throwaway name, so it can be compared to the live one
CREATE FUNCTION public.seats_used_v2(eid uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT ( <purchased term, copied verbatim from the current function>
         - COALESCE((SELECT COUNT(*) FROM ... WHERE cancellation_status IS NOT NULL ...), 0)
         )::integer;
$$;

-- compare across ALL events, not a sample
SELECT count(*)                                                   AS total_events,
       count(*) FILTER (WHERE public.seats_used(e.id) <> public.seats_used_v2(e.id)) AS mismatches,
       coalesce(sum(public.seats_used(e.id)),0)    AS total_old,
       coalesce(sum(public.seats_used_v2(e.id)),0) AS total_new
FROM public.events e;
ROLLBACK;   -- v2 and the column vanish; the DB is untouched
```

Ship only when `mismatches = 0` and the totals match. The observed result was `23 events, 0 mismatches, 1115 == 1115`.

Two more properties are worth proving in the same rolled-back style:

- **The positive path** — apply the *real* new definitions, cancel one seat-counting ticket, and confirm both the single and batch functions drop by **exactly 1**.
- **Idempotency** — re-running the state change (a second cancel request, guarded on `cancellation_status IS NULL`) frees **no extra** seat.

Design the new term so equivalence is provable, not just observed: a `COUNT(*)` over an empty set is `0`, so the subtracted term is `0` for every pre-existing row, and the purchased term is copied verbatim — making the no-change case identical by construction (`supabase/migrations/20260722120000_ticket_cancellation.sql`).

## Why This Matters

"Add a term to a hot function" reads as low-risk, but the function decides real money and real capacity, and the shared dev/prod database gives you no staging buffer — the apply *is* production. A rolled-back transaction lets you exercise the exact new SQL against the exact production data with zero residue: the throwaway function and any additive columns disappear on `ROLLBACK`. Comparing **all** rows (not a spot check) is what converts "looks equivalent" into "is equivalent for today's data," which is the only claim that matters for the no-change guarantee.

## When to Apply

- Any rewrite of a read function that must preserve results for the common case (capacity, balances, availability, pricing rollups).
- Especially when the DB is shared dev/prod and the function is on a hot path.
- When the new logic adds a term that *should* be inert for existing data — prove the inertness against real rows rather than reasoning about it.

## Examples

- **Verified rewrite**: `seats_used` / `seats_used_by_events` in `supabase/migrations/20260722120000_ticket_cancellation.sql` — the purchased term is textually identical to the prior `20260526132000_seats_used_line_items.sql`; the only change is a subtracted `COALESCE((SELECT COUNT(*) ... WHERE cancellation_status IS NOT NULL ...), 0)`.
- **Consumer that this proof does not cover**: proving the *count* is right does not prove the *door* is right — see [`../logic-errors/releasing-a-seat-without-invalidating-its-ticket-lets-the-holder-still-enter.md`](../logic-errors/releasing-a-seat-without-invalidating-its-ticket-lets-the-holder-still-enter.md).

## Related

- Sibling technique for verifying an RPC's *behaviour* (as opposed to a read function's *equivalence*): [`./verify-security-definer-rpc-do-block-rollback.md`](./verify-security-definer-rpc-do-block-rollback.md). Same rolled-back-transaction discipline on the same shared DB; this doc is the equivalence-of-a-rewrite angle, that one is the assert-behaviour angle.
- [`./audit-production-before-assuming-data-migration.md`](./audit-production-before-assuming-data-migration.md) — check real data before assuming a migration's shape.
