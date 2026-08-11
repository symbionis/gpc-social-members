---
title: Supabase JS row-fetch under-counts past 1000 rows when used as an aggregate
date: 2026-05-19
category: database-issues
module: events
problem_type: database_issue
component: database
symptoms:
  - "Capacity guard accepts registrations past the configured seat_cap once paid+free rows on a single event exceed ~1000"
  - "Admin attendees view shows correct count but server-side enforcement silently disagrees"
  - "No error, no warning — the guard simply stops working as event volume grows"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [supabase, postgres-rpc, aggregation, pagination, security-definer]
---

# Supabase JS row-fetch under-counts past 1000 rows when used as an aggregate

## Problem

The events capacity check (PR #17) computed seat usage by fetching `event_registrations` rows and summing `quantity` in app code:

```ts
const { data } = await supabase
  .from("event_registrations")
  .select("quantity")
  .eq("event_id", eventId)
  .in("status", ["paid", "free"]);
return (data ?? []).reduce((acc, row) => acc + (row.quantity ?? 0), 0);
```

`@supabase/supabase-js` applies a default row limit of **1000** to every `select()` query unless `.range()` or `.limit()` is explicitly passed. The truncation is silent — no error, no warning in the response. Once a single event had >1000 paid+free registrations, the sum would silently undercount, and the cap-enforcement check `seatsUsed + quantity > seat_cap` would start accepting registrations past the configured capacity. The documented "oversell-by-one" trade-off for the simultaneous-checkout race would have turned into an unbounded oversell as event volume grew. Caught in code review before any event reached the threshold.

## Symptoms

- Capacity guard accepts registrations past the configured `seat_cap` once paid+free rows on a single event exceed ~1000.
- Admin attendees view shows correct count but server-side enforcement silently disagrees.
- No error, no warning — the guard simply stops working as event volume grows.

## What Didn't Work

- **Adding `.range(0, 9999)`**: works for events under 10k rows but kicks the can down the road, requires asserting `count <= rows.length`, and still pulls every row over the wire just to discard them. Not the right primitive for an aggregate.
- **Relying on the existing `quantity` validator in the route**: the per-registration `quantity` is clamped to 6 in the request handler, but that has nothing to do with the cap check — capacity enforcement is a separate path that depends on the recount being correct.
- **Trusting that admin will spot the overbook on the attendees page**: the page reads `SUM(quantity)` via the same client (now via RPC), but it's a passive display, not enforcement. Reactive cleanup is not a substitute for a working guard.

## Solution

Move the aggregation into Postgres. Two `SECURITY DEFINER` SQL functions, one for the single-event check and one for the batch case (list pages):

```sql
-- supabase/migrations/20260519145000_event_seats_used_rpc.sql

CREATE OR REPLACE FUNCTION public.seats_used(eid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM public.event_registrations
  WHERE event_id = eid
    AND status IN ('paid', 'free');
$$;

CREATE OR REPLACE FUNCTION public.seats_used_by_events(ids uuid[])
RETURNS TABLE(event_id uuid, seats_used integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    event_id,
    COALESCE(SUM(quantity), 0)::integer AS seats_used
  FROM public.event_registrations
  WHERE event_id = ANY(ids)
    AND status IN ('paid', 'free')
  GROUP BY event_id;
$$;

GRANT EXECUTE ON FUNCTION public.seats_used(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.seats_used_by_events(uuid[]) TO authenticated, anon, service_role;
```

**Superseded bodies, same contract.** `supabase/migrations/20260526132000_seats_used_line_items.sql` `CREATE OR REPLACE`d both functions when per-type ticketing landed: a registration's seats are now the sum of its `counts_as_seat` line-item quantities, falling back to `event_registrations.quantity` only for genuinely itemless rows. `20260722120000_ticket_cancellation.sql` later subtracted cancelled seats. Return shapes never changed, so `lib/events/seat-usage.ts` was never touched — which is the payoff described below, not an aside.

Callers switch from row-fetch to `supabase.rpc(...)`:

```ts
// lib/events/seat-usage.ts (after)
export async function getSeatsUsed(supabase, eventId): Promise<number> {
  const { data, error } = await supabase.rpc("seats_used", { eid: eventId });
  if (error) throw new Error(`Failed to compute seat usage: ${error.message}`);
  return typeof data === "number" ? data : 0;
}
```

Regenerate `types/database.ts` (Supabase MCP `generate_typescript_types`) so the new RPCs are typed. **Re-append the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases after every regen — the Supabase generator drops them.** (auto memory [claude])

## Why This Works

Aggregation now happens server-side in a single SQL query. The 1000-row client limit cannot apply because no rows cross the wire — only the aggregate scalar (or, for the batch function, one row per event). `SECURITY DEFINER` lets the function read across the table regardless of caller RLS context, which is what an enforcement check needs. `STABLE` tells Postgres the function does no writes and can be optimized.

The semantic guarantee is also better: the aggregation rule lives in one place — the SQL — instead of being re-implemented in two TypeScript helpers that could drift. That paid off twice. When per-type ticketing changed the rule from `SUM(quantity)` to "sum the `counts_as_seat` line items, falling back to `quantity` for itemless rows," and again when cancellation subtracted a term, each was one migration and zero TypeScript changes. Had the two helpers still owned the arithmetic, that would have been two edits apiece with a chance to disagree.

## Prevention

- **Any time you count, sum, or aggregate Supabase rows for an enforcement check, use an RPC function, not row-fetch.** Counting is not the same workload as listing. The 1000-row default is fine for "show me the first page of attendees" and silently broken for "tell me how many seats are used."
- **When the row count contributes to a guard or limit decision, make it a Postgres function with `SECURITY DEFINER` and `STABLE`.** Adds the side benefit of consolidating the aggregation rule in one place.
- **Reviewers should treat `.select(...).in(...)` followed by an in-app `reduce`/`length` check as a code-smell on enforcement paths.** Even if today's row counts are small, the truncation is silent and the failure mode is unbounded.
- **Code-review checklist item for any new admin-facing or anonymous-write endpoint that depends on a "count from DB" comparison**: confirm the count is computed in SQL, not in TypeScript over a fetched array.
- **A reporting aggregate is not exempt — it just fails differently.** An enforcement aggregate that truncates over-admits; a *reporting* one under-reports money and renders cleanly. `lib/admin/finance.ts` cannot use an RPC (it folds nine tables into one summary), so it pages explicitly: `fetchAll` reads 1000-row `.range()` pages ordered by `id` and returns `complete: false` when any page errors, which `getFinanceSummary` and `getFinanceTransactions` propagate so the caller refuses rather than serving a short read. The riskiest of those reads is `tickets` — it carries the refund position, so truncating it silently restores gross as the headline. Pinned by tests in `lib/admin/finance.test.ts`, including one asserting `complete: false` when *only* the `tickets` read fails.

## Related Issues

- PR #17 — `feat: event-seat-cap` (merged commit `f0dc2b4`)
- Brainstorm: `docs/brainstorms/2026-05-19-event-registration-cap-requirements.md`
- Plan: `docs/plans/2026-05-19-001-feat-event-registration-cap-plan.md`
- Notion follow-up (separate concurrency concern): "Event registration: tighten oversell race for quantity > 1"
- Related learning: `docs/solutions/best-practices/a-comment-that-justifies-an-omission-is-load-bearing.md` — the finance aggregate reporting a wrong number again, from the opposite cause: an omitted column rather than a truncated read. It cites this doc for why `getFinanceSummary` paginates.
- Related learning: `docs/solutions/database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md` — duplicate-email race-safety on the same table via a partial unique index (distinct from the capacity oversell race noted above; the index also created a Stripe-webhook 23505 edge case).
- Related auto-memory note: `feedback_db_types_aliases.md` — re-append hand-written type aliases after every Supabase regen
